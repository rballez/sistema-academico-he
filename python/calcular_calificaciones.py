#!/usr/bin/env python3
"""
=============================================================================
CALCULAR_CALIFICACIONES.PY — Cálculo de calificaciones
Sistema de Gestión Académica — Hospital Escandón
=============================================================================
FÓRMULA POR MATERIA:
  Rotación  × 60%  → de rotaciones_raw (promedio si múltiples activas)
  Parcial   × 10%  → de examenes_raw (MAX si doble)
  Final     × 15%  → de examenes_raw (MAX si doble)
  Entregas  × 15%  → rúbrica manual

CALIFICACIÓN GLOBAL:
  Promedio de todas las materias del alumno

RÚBRICA ENTREGAS:
  excelente      → 100
  bien           → 85
  decente        → 70
  deficiente     → 50
  no_participa   → 0
=============================================================================
"""

from db import get_connection, get_ciclo_actual, rows_to_list

MATERIAS = ['Cirugía', 'Medicina Interna', 'Urgencias', 'Pediatría', 'Familiar', 'GyO']
RUBRICA_VALORES = { 'excelente': 100.0, 'bien': 85.0, 'decente': 70.0, 'deficiente': 50.0, 'no_participa': 0.0 }

def recalcular_todo(ciclo: str = None, usar_troncal: bool = True, usar_remedial: bool = True) -> dict:
    if ciclo is None: ciclo = get_ciclo_actual()
    conn = get_connection()
    try: 
        # AUTO-SANADOR: Etiquetar exámenes "huérfanos" (manuales viejos) con el grado real del alumno
        conn.execute("""
            UPDATE examenes_raw 
            SET grado_ref = (SELECT grado FROM alumnos WHERE alumnos.mip_id = examenes_raw.student_id) 
            WHERE grado_ref IS NULL OR grado_ref = '' OR grado_ref = 'None'
        """)
        conn.commit()

        alumnos = conn.execute("SELECT mip_id FROM alumnos WHERE activo=1").fetchall()
    finally: conn.close()

    resultados = [recalcular_alumno(a['mip_id'], ciclo, usar_troncal, usar_remedial) for a in alumnos]
    return {'ciclo': ciclo, 'alumnos_procesados': len(resultados)}

def recalcular_alumno(mip_id: str, ciclo: str = None, usar_troncal: bool = True, usar_remedial: bool = True) -> dict:
    if ciclo is None: ciclo = get_ciclo_actual()
    conn = get_connection()
    try:
        glob = conn.execute("SELECT cal_entregas FROM calificaciones WHERE mip_id=? AND materia='GLOBAL' AND ciclo=?", (mip_id, ciclo)).fetchone()
        cal_entregas_global = glob['cal_entregas'] if glob and glob['cal_entregas'] is not None else None

        for materia in MATERIAS:
            # HISTORIAL COMPLETO: Ya no filtramos por ciclo aquí, sumamos la historia del MIP_ID
            rot_rows = conn.execute("SELECT earned_points FROM rotaciones_raw WHERE student_id=? AND materia=? AND estado='activo'", (mip_id, materia)).fetchall()
            cal_rotacion = sum(r['earned_points'] for r in rot_rows) / len(rot_rows) if rot_rows else None

            tipos_parcial = ["'parcial'"]
            if usar_remedial: tipos_parcial.append("'remedial'")
            if usar_troncal: tipos_parcial.append("'troncal'")
            # HISTORIAL COMPLETO para MAX Parcial
            max_p_row = conn.execute(f"SELECT MAX(percent_correct) as m FROM examenes_raw WHERE student_id=? AND materia=? AND tipo_examen IN ({','.join(tipos_parcial)})", (mip_id, materia)).fetchone()
            cal_parcial = max_p_row['m'] if max_p_row else None

            tipos_final = ["'final'"]
            if usar_remedial: tipos_final.append("'remedial'")
            if usar_troncal: tipos_final.append("'troncal'")
            # HISTORIAL COMPLETO para MAX Final
            max_f_row = conn.execute(f"SELECT MAX(percent_correct) as m FROM examenes_raw WHERE student_id=? AND materia=? AND tipo_examen IN ({','.join(tipos_final)})", (mip_id, materia)).fetchone()
            cal_final = max_f_row['m'] if max_f_row else None

            ponderada = _calcular_ponderada(cal_rotacion, cal_parcial, cal_final, cal_entregas_global, 0.0)

            conn.execute("""
                INSERT INTO calificaciones (mip_id, materia, ciclo, cal_rotacion, cal_parcial, cal_final, cal_entregas, extra_puntos, ultima_actualizacion)
                VALUES (?,?,?,?,?,?,?,?,datetime('now'))
                ON CONFLICT(mip_id, materia, ciclo) DO UPDATE SET cal_rotacion=excluded.cal_rotacion, cal_parcial=excluded.cal_parcial, cal_final=excluded.cal_final, cal_entregas=excluded.cal_entregas, ultima_actualizacion=excluded.ultima_actualizacion
            """, (mip_id, materia, ciclo, cal_rotacion, cal_parcial, cal_final, cal_entregas_global, 0.0))
        conn.commit()
        return {'mip_id': mip_id}
    finally: conn.close()

def _calcular_ponderada(rot, parc, fin, ent, extra) -> float | None:
    if all(v is None for v in [rot, parc, fin, ent]): return None
    val = ((rot or 0)*0.60) + ((parc or 0)*0.10) + ((fin or 0)*0.15) + ((ent or 0)*0.15) + (extra or 0)
    return min(100.0, val)

def set_rubrica_entregas_global(mip_id: str, rubrica: str, ciclo: str = None) -> dict:
    if rubrica not in RUBRICA_VALORES: raise ValueError("Rúbrica inválida")
    if ciclo is None: ciclo = get_ciclo_actual()
    valor = RUBRICA_VALORES[rubrica]
    conn = get_connection()
    try:
        conn.execute("INSERT INTO calificaciones (mip_id, materia, ciclo, cal_entregas, rubrica_entregas) VALUES (?, 'GLOBAL', ?, ?, ?) ON CONFLICT(mip_id, materia, ciclo) DO UPDATE SET cal_entregas=excluded.cal_entregas, rubrica_entregas=excluded.rubrica_entregas", (mip_id, ciclo, valor, rubrica))
        conn.commit()
    finally: conn.close()
    recalcular_alumno(mip_id, ciclo)
    return {'ok': True}

def get_tabla_global(grado: str = None, ciclo: str = None, usar_troncal: bool = True, usar_remedial: bool = True) -> list:
    if ciclo is None: ciclo = get_ciclo_actual()
    recalcular_todo(ciclo, usar_troncal, usar_remedial)
    conn = get_connection()
    try:
        query = """
            SELECT a.mip_id, a.nombre_completo, a.grado, u.id as universidad_id, u.nombre as escuela,
                c_gyo.cal_rotacion as gyo_rot, c_gyo.cal_parcial as gyo_parcial, c_gyo.cal_final as gyo_final, c_gyo.cal_ponderada as gyo_total,
                c_mi.cal_rotacion as mi_rot, c_mi.cal_parcial as mi_parcial, c_mi.cal_final as mi_final, c_mi.cal_ponderada as mi_total,
                c_cir.cal_rotacion as ciru_rot, c_cir.cal_parcial as ciru_parcial, c_cir.cal_final as ciru_final, c_cir.cal_ponderada as ciru_total,
                c_ped.cal_rotacion as pedia_rot, c_ped.cal_parcial as pedia_parcial, c_ped.cal_final as pedia_final, c_ped.cal_ponderada as pedia_total,
                c_fam.cal_rotacion as fam_rot, c_fam.cal_parcial as fam_parcial, c_fam.cal_final as fam_final, c_fam.cal_ponderada as fam_total,
                c_urg.cal_rotacion as urg_rot, c_urg.cal_parcial as urg_parcial, c_urg.cal_final as urg_final, c_urg.cal_ponderada as urg_total,
                c_glob.rubrica_entregas as rubrica_entregas_global
            FROM alumnos a
            LEFT JOIN universidades u ON a.universidad_id = u.id
            LEFT JOIN calificaciones c_gyo ON a.mip_id=c_gyo.mip_id AND c_gyo.materia='GyO' AND c_gyo.ciclo=?
            LEFT JOIN calificaciones c_mi  ON a.mip_id=c_mi.mip_id  AND c_mi.materia='Medicina Interna' AND c_mi.ciclo=?
            LEFT JOIN calificaciones c_cir ON a.mip_id=c_cir.mip_id AND c_cir.materia='Cirugía' AND c_cir.ciclo=?
            LEFT JOIN calificaciones c_ped ON a.mip_id=c_ped.mip_id AND c_ped.materia='Pediatría' AND c_ped.ciclo=?
            LEFT JOIN calificaciones c_fam ON a.mip_id=c_fam.mip_id AND c_fam.materia='Familiar' AND c_fam.ciclo=?
            LEFT JOIN calificaciones c_urg ON a.mip_id=c_urg.mip_id AND c_urg.materia='Urgencias' AND c_urg.ciclo=?
            LEFT JOIN calificaciones c_glob ON a.mip_id=c_glob.mip_id AND c_glob.materia='GLOBAL' AND c_glob.ciclo=?
            WHERE a.activo=1
        """
        params = [ciclo] * 7
        if grado: query += " AND a.grado=?"; params.append(grado)
        query += " ORDER BY a.ap_paterno, a.nombres"
        rows = rows_to_list(conn.execute(query, params).fetchall())
        for r in rows:
            validos = [t for t in [r.get('gyo_total'), r.get('mi_total'), r.get('ciru_total'), r.get('pedia_total'), r.get('fam_total'), r.get('urg_total')] if t is not None]
            r['cal_final_global'] = min(100.0, sum(validos) / len(validos)) if validos else None
        return rows
    finally: conn.close()

def get_tabla_examenes(materia: str, tipo_examen: str, grado: str = None, ciclo: str = None) -> list:
    if ciclo is None: ciclo = get_ciclo_actual()
    conn = get_connection()
    try:
        # HISTORIAL COMPLETO para Resultados. Se omitió ciclo en los sub-selects.
        query = """
            SELECT a.mip_id, a.nombre_completo as nombre, a.grado, u.nombre as universidad,
                (SELECT MAX(percent_correct) FROM examenes_raw WHERE student_id=a.mip_id AND materia=? AND tipo_examen=? AND grado_ref='MIP 1') as mip1_score,
                (SELECT MAX(percent_correct) FROM examenes_raw WHERE student_id=a.mip_id AND materia=? AND tipo_examen=? AND grado_ref='MIP 2') as mip2_score
            FROM alumnos a
            LEFT JOIN universidades u ON a.universidad_id = u.id
            WHERE a.activo=1
        """
        params = [materia, tipo_examen, materia, tipo_examen]
        # grado=None → traer todos; grado especificado → filtrar
        if grado:
            query += " AND a.grado=?"
            params.append(grado)
        query += " ORDER BY a.ap_paterno, a.nombres"
        return rows_to_list(conn.execute(query, params).fetchall())
    finally: conn.close()

def get_top_3_examenes(ciclo: str = None) -> dict:
    if ciclo is None: ciclo = get_ciclo_actual()
    conn = get_connection()
    try:
        query = """
            SELECT a.nombre_completo as nombre, a.grado, u.nombre as escuela, AVG(e.percent_correct) as prom
            FROM examenes_raw e JOIN alumnos a ON e.student_id = a.mip_id LEFT JOIN universidades u ON a.universidad_id = u.id
            WHERE e.ciclo=? AND a.activo=1 GROUP BY a.mip_id ORDER BY prom DESC
        """
        todos = rows_to_list(conn.execute(query, (ciclo,)).fetchall())
        return {'mip1': [x for x in todos if x['grado'] == 'MIP 1'][:3], 'mip2': [x for x in todos if x['grado'] == 'MIP 2'][:3]}
    finally: conn.close()

def get_vista_global_examenes(ciclo: str = None, usar_troncal: bool = True, usar_remedial: bool = True) -> list:
    if ciclo is None: ciclo = get_ciclo_actual()
    conn = get_connection()
    try:
        alumnos = rows_to_list(conn.execute("SELECT a.mip_id, a.nombre_completo as nombre, u.id as universidad_id, u.nombre as escuela, a.grado FROM alumnos a LEFT JOIN universidades u ON a.universidad_id = u.id WHERE a.activo=1 ORDER BY a.ap_paterno").fetchall())
        # HISTORIAL COMPLETO: Ya no está atado al ciclo actual, saca todo el historial del alumno.
        examenes = rows_to_list(conn.execute("SELECT student_id, materia, tipo_examen, grado_ref, percent_correct FROM examenes_raw").fetchall())
        
        for a in alumnos:
            a['materias'] = {}
            for m in ['GyO', 'Pediatría', 'Cirugía', 'Medicina Interna', 'Urgencias', 'Familiar']:
                mis_ex = [e for e in examenes if e['student_id'] == a['mip_id'] and e['materia'] == m]
                
                m1_p = max([e['percent_correct'] for e in mis_ex if e['grado_ref'] == 'MIP 1' and e['tipo_examen'] == 'parcial'] + [None], key=lambda x: (x is not None, x))
                m1_f = max([e['percent_correct'] for e in mis_ex if e['grado_ref'] == 'MIP 1' and e['tipo_examen'] == 'final'] + [None], key=lambda x: (x is not None, x))
                m2_p = max([e['percent_correct'] for e in mis_ex if e['grado_ref'] == 'MIP 2' and e['tipo_examen'] == 'parcial'] + [None], key=lambda x: (x is not None, x))
                m2_f = max([e['percent_correct'] for e in mis_ex if e['grado_ref'] == 'MIP 2' and e['tipo_examen'] == 'final'] + [None], key=lambda x: (x is not None, x))
                
                tipos_p, tipos_f = ['parcial'], ['final']
                if usar_remedial: tipos_p.append('remedial'); tipos_f.append('remedial')
                if usar_troncal: tipos_p.append('troncal'); tipos_f.append('troncal')
                
                max_p = max([e['percent_correct'] for e in mis_ex if e['tipo_examen'] in tipos_p] + [None], key=lambda x: (x is not None, x))
                max_f = max([e['percent_correct'] for e in mis_ex if e['tipo_examen'] in tipos_f] + [None], key=lambda x: (x is not None, x))
                
                a['materias'][m] = {'m1_p': m1_p, 'm1_f': m1_f, 'm2_p': m2_p, 'm2_f': m2_f, 'max_p': max_p, 'max_f': max_f}
        return alumnos
    finally: conn.close()