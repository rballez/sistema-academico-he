#!/usr/bin/env python3
"""
=============================================================================
GESTIONAR_ALUMNOS.PY — CRUD de alumnos y generación de MIP ID
Sistema de Gestión Académica — Hospital Escandón
=============================================================================
MIP ID formato: AABCCCDDD
  AA  = año de ingreso (2 dígitos, ej. 26)
  B   = grado: 1=MIP1, 2=MIP2
  CCC = código de universidad (3 dígitos)
  DDD = secuencial único por universidad
=============================================================================
"""

import csv
import io
import re
from datetime import datetime
from db import get_connection, get_ciclo_actual, rows_to_list

def generar_csv_ejemplo_alumnos() -> str:
    return "PATERNO,MATERNO,NOMBRE,UNIVERSIDAD,MIP_ID,GRADO,CICLO\nGARCIA,LOPEZ,JUAN,UNAM,261290001,MIP 1,2026-1\nCASTREJON,PEREZ,SAMANTHA,WESTHILL,,MIP 2,2025-2\nALBAÑIL,DIEGO,MONTSERRAT,IPN,,MIP 1,2026-1\n"

def generar_csv_ejemplo_guardias() -> str:
    return "NOMBRE,ID,GRADO,GUARDIA,UNIVERSIDAD\nJUAN GARCIA LOPEZ,261290001,MIP 1,A,UNAM\n"

def generar_mip_id(universidad_id: int, ciclo: str = None) -> str:
    """Genera un MIP ID único con formato AABCCCDDD, leyendo el código CCC desde la BD."""
    if ciclo is None: ciclo = get_ciclo_actual()
    year_match = re.search(r'(\d{4})', ciclo)
    aa = year_match.group(1)[-2:] if year_match else '26'
    b = '1' if ciclo.endswith('1') or '-1' in ciclo else '2'

    conn = get_connection()
    try:
        # Leer el código CCC directamente desde la tabla de universidades
        row = conn.execute("SELECT ccc FROM universidades WHERE id=?", (universidad_id,)).fetchone()
        ccc_str = row['ccc'].zfill(3) if row and row['ccc'] else '000'

        prefix = f"{aa}{b}{ccc_str}"
        # Recolectar secuenciales usados en alumnos activos/inactivos Y en egresados
        def _extraer_ddd(rows):
            return {int(str(r[0])[-3:]) for r in rows if str(r[0]).isdigit() and len(str(r[0])) == 9}

        usados_alumnos  = _extraer_ddd(conn.execute(
            "SELECT mip_id FROM alumnos WHERE mip_id LIKE ?", (f"{prefix}%",)
        ).fetchall())
        usados_egresados = _extraer_ddd(conn.execute(
            "SELECT mip_id FROM egresados WHERE mip_id LIKE ?", (f"{prefix}%",)
        ).fetchall())
        usados = usados_alumnos | usados_egresados

        ddd = 1
        while ddd in usados and ddd < 999: ddd += 1

        return f"{prefix}{ddd:03d}"
    finally: conn.close()

def crear_alumno(mip_id: str, ap_paterno: str, ap_materno: str, nombres: str, universidad_id: int, grado: str, ciclo: str) -> dict:
    if not ap_paterno or not nombres: raise ValueError("Paterno y nombres requeridos")
    if not mip_id: mip_id = generar_mip_id(universidad_id, ciclo)
    conn = get_connection()
    try:
        conn.execute("INSERT INTO alumnos (mip_id, ap_paterno, ap_materno, nombres, universidad_id, grado, ciclo_ingreso) VALUES (?,?,?,?,?,?,?)", 
                     (mip_id, ap_paterno.upper(), ap_materno.upper(), nombres.upper(), universidad_id, grado, ciclo))
        conn.commit()
        return dict(conn.execute("SELECT * FROM alumnos WHERE mip_id=?", (mip_id,)).fetchone())
    finally: conn.close()

def actualizar_alumno(mip_id_old: str, mip_id_new: str, ap_paterno: str, ap_materno: str, nombres: str, universidad_id: int, grado: str, ciclo: str) -> dict:
    conn = get_connection()
    try:
        if mip_id_old != mip_id_new:
            exist = conn.execute("SELECT mip_id FROM alumnos WHERE mip_id=?", (mip_id_new,)).fetchone()
            if exist: return {'ok': False, 'error': 'El nuevo MIP ID ya está en uso.'}

        # Desactivar FK antes de iniciar cambios (evita errores en cascada al cambiar PK)
        conn.execute("PRAGMA foreign_keys = OFF;")

        conn.execute(
            "UPDATE alumnos SET mip_id=?, ap_paterno=?, ap_materno=?, nombres=?, universidad_id=?, grado=?, ciclo_ingreso=? WHERE mip_id=?",
            (mip_id_new, ap_paterno.upper(), ap_materno.upper(), nombres.upper(), universidad_id, grado, ciclo, mip_id_old)
        )

        if mip_id_old != mip_id_new:
            conn.execute("UPDATE rotaciones_raw SET student_id=? WHERE student_id=?", (mip_id_new, mip_id_old))
            conn.execute("UPDATE examenes_raw SET student_id=? WHERE student_id=?", (mip_id_new, mip_id_old))
            conn.execute("UPDATE calificaciones SET mip_id=? WHERE mip_id=?", (mip_id_new, mip_id_old))

        conn.commit()
        conn.execute("PRAGMA foreign_keys = ON;")
        return {'ok': True}
    except Exception as e:
        conn.rollback()
        conn.execute("PRAGMA foreign_keys = ON;")
        raise e
    finally: conn.close()

def egresar_alumno_individual(mip_id: str) -> dict:
    """Marca un alumno como inactivo y lo registra en la tabla egresados."""
    conn = get_connection()
    try:
        alumno = conn.execute("SELECT * FROM alumnos WHERE mip_id=?", (mip_id,)).fetchone()
        if not alumno:
            return {'ok': False, 'error': 'Alumno no encontrado'}
        ciclo_actual = get_ciclo_actual()
        conn.execute(
            "INSERT INTO egresados (mip_id, ap_paterno, ap_materno, nombres, universidad_id, ciclo_egreso) VALUES (?,?,?,?,?,?)",
            (mip_id, alumno['ap_paterno'], alumno['ap_materno'], alumno['nombres'], alumno['universidad_id'], ciclo_actual)
        )
        conn.execute("UPDATE alumnos SET activo=0 WHERE mip_id=?", (mip_id,))
        conn.commit()
        return {'ok': True}
    finally: conn.close()

def importar_alumnos_csv(contenido_csv: str) -> dict:
    ok, errores = [], []
    ciclo_global = get_ciclo_actual()
    try: delimiter = csv.Sniffer().sniff(contenido_csv[:2048], delimiters=',;|\t').delimiter
    except Exception: delimiter = ','
    reader = csv.DictReader(io.StringIO(contenido_csv), delimiter=delimiter)
    fieldnames_lower = {k.lower().strip(): k for k in (reader.fieldnames or [])}

    def get_field(row, *keys):
        for k in keys:
            for fn_low, fn_orig in fieldnames_lower.items():
                if k in fn_low: return row.get(fn_orig, '').strip()
        return ''

    conn = get_connection()
    for i, row in enumerate(reader, start=2):
        ap_paterno = get_field(row, 'paterno', 'apellido_p').upper()
        ap_materno = get_field(row, 'materno', 'apellido_m').upper()
        nombres    = get_field(row, 'nombre', 'nombre').upper()
        univ_code  = get_field(row, 'universidad', 'escuela', 'univ').upper()
        mip_id_csv = get_field(row, 'mip_id', 'id', 'matricula')
        grado_csv  = get_field(row, 'grado', 'nivel') or 'MIP 1'
        
        ciclo_csv = get_field(row, 'ciclo', 'periodo')
        if not ciclo_csv: ciclo_csv = ciclo_global

        if not ap_paterno or not nombres or not univ_code: errores.append({'fila': i, 'error': 'Datos incompletos'}); continue
        univ = conn.execute("SELECT id FROM universidades WHERE codigo=? OR nombre LIKE ?", (univ_code, f'%{univ_code}%')).fetchone()
        if not univ: errores.append({'fila': i, 'error': f'Universidad no encontrada: {univ_code}'}); continue

        try:
            alumno = crear_alumno(mip_id_csv, ap_paterno, ap_materno, nombres, univ['id'], grado_csv, ciclo_csv)
            ok.append(alumno)
        except Exception as e: errores.append({'fila': i, 'error': str(e)})
    conn.close()
    return {'ok': ok, 'errores': errores, 'total': len(ok) + len(errores)}

def eliminar_alumno(mip_id: str) -> bool:
    conn = get_connection()
    try:
        conn.execute("UPDATE alumnos SET activo=0 WHERE mip_id=?", (mip_id,))
        conn.commit(); return conn.total_changes > 0
    finally: conn.close()

def listar_alumnos(grado: str = None, universidad_id: int = None, solo_activos: bool = True) -> list:
    conn = get_connection()
    try:
        query = "SELECT a.*, u.nombre as universidad_nombre, u.codigo as universidad_codigo FROM alumnos a JOIN universidades u ON a.universidad_id = u.id WHERE 1=1"
        params = []
        if solo_activos: query += " AND a.activo=1"
        if grado: query += " AND a.grado=?"; params.append(grado)
        if universidad_id: query += " AND a.universidad_id=?"; params.append(universidad_id)
        query += " ORDER BY a.ap_paterno, a.ap_materno, a.nombres"
        return rows_to_list(conn.execute(query, params).fetchall())
    finally: conn.close()

def listar_egresados(ciclo_egreso: str = None) -> list:
    conn = get_connection()
    try:
        query = "SELECT e.*, u.nombre as universidad_nombre, u.codigo as universidad_codigo FROM egresados e LEFT JOIN universidades u ON e.universidad_id = u.id WHERE 1=1"
        params = []
        if ciclo_egreso: query += " AND e.ciclo_egreso=?"; params.append(ciclo_egreso)
        return rows_to_list(conn.execute(query + " ORDER BY e.ciclo_egreso DESC, e.ap_paterno, e.nombres", params).fetchall())
    finally: conn.close()

def promover_curso(ciclo_nuevo: str) -> dict:
    conn = get_connection()
    ciclo_actual = get_ciclo_actual()
    try:
        mip2 = rows_to_list(conn.execute("SELECT * FROM alumnos WHERE grado='MIP 2' AND activo=1").fetchall())
        mip1 = rows_to_list(conn.execute("SELECT * FROM alumnos WHERE grado='MIP 1' AND activo=1").fetchall())
        for a in mip2:
            conn.execute(
                "INSERT INTO egresados (mip_id, ap_paterno, ap_materno, nombres, universidad_id, ciclo_egreso) VALUES (?,?,?,?,?,?)",
                (a['mip_id'], a['ap_paterno'], a['ap_materno'], a['nombres'], a['universidad_id'], ciclo_actual)
            )
        conn.execute("UPDATE alumnos SET activo=0 WHERE grado='MIP 2'")
        conn.execute("UPDATE alumnos SET grado='MIP 2' WHERE grado='MIP 1' AND activo=1")
        conn.execute("INSERT OR REPLACE INTO configuracion (clave, valor) VALUES ('ciclo_actual',?)", (ciclo_nuevo,))
        conn.commit()
        return {'egresados': len(mip2), 'promovidos': len(mip1), 'ciclo_anterior': ciclo_actual, 'ciclo_nuevo': ciclo_nuevo}
    finally: conn.close()

def listar_universidades() -> list:
    conn = get_connection()
    try: return rows_to_list(conn.execute("SELECT * FROM universidades WHERE activa=1 ORDER BY nombre").fetchall())
    finally: conn.close()