#!/usr/bin/env python3
import csv
import hashlib
import io
import re
from datetime import datetime
from db import get_connection, get_ciclo_actual, rows_to_list

KEY_VERSION_MAP = { 'C':'Cirugía', 'M':'Medicina Interna', 'U':'Urgencias', 'P':'Pediatría', 'F':'Familiar', 'G':'GyO' }
UMBRAL_DOBLE_ESCANEO_MIN = 5
UMBRAL_ROTACION_MULTIPLE_DIAS = 1

def _sha256(texto: str) -> str: return hashlib.sha256(texto.encode('utf-8')).hexdigest()

def _parse_timestamp(ts: str) -> datetime | None:
    for fmt in ['%Y/%m/%d %I:%M %p', '%Y-%m-%d %H:%M:%S', '%Y/%m/%d %H:%M']:
        try: return datetime.strptime(ts.strip(), fmt)
        except ValueError: continue
    return None

def _detectar_delimiter(contenido: str) -> str:
    try: return csv.Sniffer().sniff(contenido[:4096], delimiters=',;|\t').delimiter
    except Exception: return ','

def extraer_mip_id(texto: str) -> str:
    m = re.search(r"\b(\d{9})\b", str(texto).strip())
    return m.group(1) if m else ""

def importar_rotaciones(contenido_csv: str, nombre_archivo: str = 'rotaciones.csv') -> dict:
    delimiter = _detectar_delimiter(contenido_csv)
    reader = csv.DictReader(io.StringIO(contenido_csv), delimiter=delimiter)
    fieldnames = {k.strip().lower(): k for k in (reader.fieldnames or [])}

    if not any('key' in k for k in fieldnames) or not any('time' in k or 'date' in k for k in fieldnames):
        return {'ok': False, 'error': '❌ Este archivo no tiene la estructura de Rotaciones de ZipGrade (Falta Key Version o Timestamp).'}

    ciclo = get_ciclo_actual()
    conn = get_connection()
    try:
        cur = conn.execute("INSERT INTO historial_importaciones (tipo, archivo_nombre, archivo_hash, ciclo) VALUES ('rotaciones',?,?,?)", (nombre_archivo, _sha256(contenido_csv), ciclo))
        importacion_id = cur.lastrowid

        def get_col(row, *nombres):
            for n in nombres:
                for k_low, k_real in fieldnames.items():
                    if n in k_low: return str(row.get(k_real, '')).strip()
            return ""

        total = insertados = ignorados = 0
        duplicados_alerta = []
        for i, row in enumerate(reader, start=2):
            total += 1
            student_id = extraer_mip_id(get_col(row, 'student id', 'id'))
            earned_raw = get_col(row, 'earned points', 'score', 'calificacion')
            earned_points = float(earned_raw) if earned_raw else 0.0
            timestamp_str = get_col(row, 'paper timestamp', 'date', 'fecha')
            key_version = get_col(row, 'key version', 'key').upper()

            if not student_id or not timestamp_str or not key_version: ignorados += 1; continue

            materia = KEY_VERSION_MAP.get(key_version, key_version)
            ts_dt = _parse_timestamp(timestamp_str)
            if not ts_dt: ignorados += 1; continue

            existentes = rows_to_list(conn.execute("SELECT * FROM rotaciones_raw WHERE student_id=? AND materia=? AND ciclo=? AND estado='activo' ORDER BY paper_timestamp", (student_id, materia, ciclo)).fetchall())

            insertar = True
            for ex in existentes:
                ts_ex = _parse_timestamp(ex['paper_timestamp'])
                if not ts_ex: continue
                diff_min = abs((ts_dt - ts_ex).total_seconds()) / 60
                if abs(earned_points - ex['earned_points']) < 0.01 and diff_min < 1: insertar = False; ignorados += 1; break
                if diff_min < UMBRAL_DOBLE_ESCANEO_MIN: insertar = False; ignorados += 1; break
                if diff_min >= UMBRAL_ROTACION_MULTIPLE_DIAS * 24 * 60:
                    duplicados_alerta.append({'student_id': student_id, 'materia': materia, 'registro_existente': ex, 'registro_nuevo': {'earned_points': earned_points, 'paper_timestamp': timestamp_str, 'key_version': key_version}, 'diferencia_dias': diff_min / (24 * 60)})
                    break

            if insertar:
                estado = 'duplicado' if any(d['student_id'] == student_id and d['materia'] == materia for d in duplicados_alerta) else 'activo'
                conn.execute("INSERT INTO rotaciones_raw (student_id, earned_points, paper_timestamp, key_version, materia, ciclo, importacion_id, estado) VALUES (?,?,?,?,?,?,?,?)", (student_id, earned_points, timestamp_str, key_version, materia, ciclo, importacion_id, estado))
                insertados += 1

        conn.execute("UPDATE historial_importaciones SET registros_total=?, registros_ok=?, registros_skip=?, registros_dup=? WHERE id=?", (total, insertados, ignorados, len(duplicados_alerta), importacion_id))
        for dup in duplicados_alerta:
            rots = rows_to_list(conn.execute("SELECT id FROM rotaciones_raw WHERE student_id=? AND materia=? AND ciclo=? AND estado='duplicado'", (dup['student_id'], dup['materia'], ciclo)).fetchall())
            if len(rots) >= 2: conn.execute("INSERT OR IGNORE INTO alertas_duplicados (student_id, materia, rot_id_1, rot_id_2, diferencia_dias) VALUES (?,?,?,?,?)", (dup['student_id'], dup['materia'], rots[-2]['id'], rots[-1]['id'], dup['diferencia_dias']))
        conn.commit()
        return {'total': total, 'insertados': insertados, 'ignorados': ignorados, 'duplicados_alerta': duplicados_alerta}
    finally: conn.close()

def resolver_duplicado(alerta_id: int, resolucion: str, materia_destino: str = None) -> dict:
    conn = get_connection()
    try:
        alerta = dict(conn.execute("SELECT * FROM alertas_duplicados WHERE id=?", (alerta_id,)).fetchone())
        rot1 = dict(conn.execute("SELECT * FROM rotaciones_raw WHERE id=?", (alerta['rot_id_1'],)).fetchone())
        rot2 = dict(conn.execute("SELECT * FROM rotaciones_raw WHERE id=?", (alerta['rot_id_2'],)).fetchone())

        if resolucion == 'promediar':
            prom = (rot1['earned_points'] + rot2['earned_points']) / 2
            conn.execute("UPDATE rotaciones_raw SET earned_points=?, estado='activo', notas='Promediado' WHERE id=?", (prom, rot1['id']))
            conn.execute("UPDATE rotaciones_raw SET estado='ignorado' WHERE id=?", (rot2['id'],))
        elif resolucion == 'mas_reciente':
            ts1, ts2 = _parse_timestamp(rot1['paper_timestamp']), _parse_timestamp(rot2['paper_timestamp'])
            if ts1 and ts2 and ts2 > ts1:
                conn.execute("UPDATE rotaciones_raw SET estado='activo' WHERE id=?", (rot2['id'],)); conn.execute("UPDATE rotaciones_raw SET estado='ignorado' WHERE id=?", (rot1['id'],))
            else:
                conn.execute("UPDATE rotaciones_raw SET estado='activo' WHERE id=?", (rot1['id'],)); conn.execute("UPDATE rotaciones_raw SET estado='ignorado' WHERE id=?", (rot2['id'],))
        elif resolucion == 'mejor':
            if rot2['earned_points'] > rot1['earned_points']:
                conn.execute("UPDATE rotaciones_raw SET estado='activo' WHERE id=?", (rot2['id'],)); conn.execute("UPDATE rotaciones_raw SET estado='ignorado' WHERE id=?", (rot1['id'],))
            else:
                conn.execute("UPDATE rotaciones_raw SET estado='activo' WHERE id=?", (rot1['id'],)); conn.execute("UPDATE rotaciones_raw SET estado='ignorado' WHERE id=?", (rot2['id'],))
        elif resolucion == 'guardar_duplicado':
            conn.execute("UPDATE rotaciones_raw SET estado='activo', notas='Duplicado confirmado' WHERE id IN (?,?)", (rot1['id'], rot2['id']))
        elif resolucion == 'otra_materia' and materia_destino:
            conn.execute("UPDATE rotaciones_raw SET materia=?, key_version=?, estado='activo' WHERE id=?", (materia_destino, materia_destino[0], rot2['id'])); conn.execute("UPDATE rotaciones_raw SET estado='activo' WHERE id=?", (rot1['id'],))

        conn.execute("UPDATE alertas_duplicados SET estado='resuelta', resolucion=?, fecha_resolucion=datetime('now') WHERE id=?", (resolucion, alerta_id))
        conn.commit()
        return {'ok': True, 'resolucion': resolucion}
    finally: conn.close()

# ── NUEVO: Pizarrón de Previsualización ──
def importar_examenes_preview(contenido_csv: str) -> dict:
    delimiter = _detectar_delimiter(contenido_csv)
    reader = csv.DictReader(io.StringIO(contenido_csv), delimiter=delimiter)
    fieldnames = {k.strip().lower(): k for k in (reader.fieldnames or [])}

    if not any('percent' in k or 'earned' in k for k in fieldnames):
        return {'ok': False, 'error': '❌ Este archivo parece de Rotaciones (Falta Percent Correct o Earned Points).'}

    def get_col(row, *nombres):
        for n in nombres:
            for k_low, k_real in fieldnames.items():
                if n in k_low: return str(row.get(k_real, '')).strip()
        return ""

    registros = []
    conn = get_connection()
    try:
        for i, row in enumerate(reader, start=2):
            student_id = extraer_mip_id(get_col(row, 'student id', 'id'))
            if not student_id: continue

            earned_raw = get_col(row, 'earned points', 'score')
            percent_raw = get_col(row, 'percent correct', 'percent')
            grado_ref = get_col(row, 'external ref', 'grado', 'class')

            earned_points = float(earned_raw) if earned_raw else 0.0
            percent_correct = float(percent_raw) if percent_raw else earned_points
            grado_norm = 'MIP 1' if '1' in grado_ref else ('MIP 2' if '2' in grado_ref else grado_ref)

            # Buscar nombre real
            al = conn.execute("SELECT nombre_completo, nombres, ap_paterno FROM alumnos WHERE mip_id=?", (student_id,)).fetchone()
            nombre = al['nombre_completo'] if al and al['nombre_completo'] else (f"{al['ap_paterno']} {al['nombres']}" if al else "Desconocido")

            registros.append({
                'mip_id': student_id,
                'nombre': nombre,
                'grado_ref': grado_norm,
                'base': percent_correct,
                'extra': 0.0
            })
        return {'ok': True, 'registros': registros}
    finally: conn.close()

# ── NUEVO: Guardar Lote Confirmado ──
def guardar_examenes_lote(registros: list, materia: str, tipo_examen: str, nombre_archivo: str = 'examenes.csv', hash_csv: str = '') -> dict:
    ciclo = get_ciclo_actual()
    conn = get_connection()
    try:
        cur = conn.execute("INSERT INTO historial_importaciones (tipo, archivo_nombre, archivo_hash, ciclo, materia, tipo_examen) VALUES ('examenes',?,?,?,?,?)", 
                           (nombre_archivo, hash_csv, ciclo, materia, tipo_examen))
        importacion_id = cur.lastrowid

        insertados = 0
        for reg in registros:
            student_id = reg['mip_id']
            # Tope estricto a 100
            total_calc = min(100.0, float(reg['base']) + float(reg['extra']))

            materias_destino = [materia]
            if materia == 'Urg-Fam': materias_destino = ['Urgencias', 'Familiar']
            elif materia == 'Troncal': materias_destino = ['Cirugía', 'Medicina Interna', 'Pediatría', 'GyO', 'Urgencias', 'Familiar']

            for mat in materias_destino:
                conn.execute("INSERT INTO examenes_raw (student_id, earned_points, percent_correct, grado_ref, materia, tipo_examen, ciclo, importacion_id) VALUES (?,?,?,?,?,?,?,?)", 
                             (student_id, total_calc, total_calc, reg['grado_ref'], mat, tipo_examen, ciclo, importacion_id))
            insertados += 1

        conn.execute("UPDATE historial_importaciones SET registros_total=?, registros_ok=?, registros_skip=? WHERE id=?", (len(registros), insertados, 0, importacion_id))
        conn.commit()
        return {'ok': True, 'insertados': insertados}
    finally: conn.close()

def get_alertas_duplicados_pendientes() -> list:
    conn = get_connection()
    try: return rows_to_list(conn.execute("SELECT ad.*, r1.earned_points as pts1, r1.paper_timestamp as ts1, r2.earned_points as pts2, r2.paper_timestamp as ts2 FROM alertas_duplicados ad JOIN rotaciones_raw r1 ON ad.rot_id_1=r1.id JOIN rotaciones_raw r2 ON ad.rot_id_2=r2.id WHERE ad.estado='pendiente' ORDER BY ad.fecha_creacion DESC").fetchall())
    finally: conn.close()

def get_historial_importaciones() -> list:
    conn = get_connection()
    try: return rows_to_list(conn.execute("SELECT * FROM historial_importaciones ORDER BY fecha DESC LIMIT 100").fetchall())
    finally: conn.close()