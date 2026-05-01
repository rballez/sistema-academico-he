#!/usr/bin/env python3
import datetime
from db import get_connection, get_ciclo_actual

def registrar_calificacion_manual(mip_id: str, materia: str, tipo_registro: str, calificacion: float, ciclo: str = None) -> dict:
    if not ciclo: ciclo = get_ciclo_actual()
    conn = get_connection()
    try:
        # Extraer el grado actual del alumno para etiquetarlo en el historial
        al = conn.execute("SELECT grado FROM alumnos WHERE mip_id=?", (mip_id,)).fetchone()
        grado_actual = al['grado'] if al else 'MIP 1'

        if tipo_registro == 'rotacion':
            timestamp = datetime.datetime.now().strftime('%Y/%m/%d %H:%M:%S')
            conn.execute("""
                INSERT INTO rotaciones_raw (student_id, earned_points, paper_timestamp, key_version, materia, ciclo, estado, notas)
                VALUES (?, ?, ?, ?, ?, ?, 'activo', 'Registro manual')
            """, (mip_id, calificacion, timestamp, materia[0], materia, ciclo))
        else:
            conn.execute("""
                INSERT INTO examenes_raw (student_id, earned_points, percent_correct, grado_ref, materia, tipo_examen, ciclo)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, (mip_id, calificacion, calificacion, grado_actual, materia, tipo_registro, ciclo))
        conn.commit()
        return {'ok': True, 'mensaje': f'Calificación registrada en {materia}'}
    finally:
        conn.close()

def aplicar_campana(materia: str, tipo_registro: str, cal_base: float, ciclo: str = None) -> dict:
    if not ciclo: ciclo = get_ciclo_actual()
    conn = get_connection()
    try:
        if tipo_registro == 'rotacion':
            max_row = conn.execute("SELECT MAX(earned_points) as m FROM rotaciones_raw WHERE materia=? AND ciclo=? AND estado='activo'", (materia, ciclo)).fetchone()
            max_val = max_row['m'] if max_row and max_row['m'] else 0
            if max_val > 0:
                factor = cal_base / max_val
                # Escalar y topar en cal_base (el nuevo máximo deseado)
                conn.execute(
                    "UPDATE rotaciones_raw SET earned_points = MIN(?, earned_points * ?), notas='Campana aplicada' WHERE materia=? AND ciclo=? AND estado='activo'",
                    (cal_base, factor, materia, ciclo)
                )
        else:
            max_row = conn.execute("SELECT MAX(percent_correct) as m FROM examenes_raw WHERE materia=? AND tipo_examen=? AND ciclo=?", (materia, tipo_registro, ciclo)).fetchone()
            max_val = max_row['m'] if max_row and max_row['m'] else 0
            if max_val > 0:
                factor = cal_base / max_val
                # Escalar y topar en cal_base (el nuevo máximo deseado)
                conn.execute(
                    "UPDATE examenes_raw SET percent_correct = MIN(?, percent_correct * ?), earned_points = MIN(?, earned_points * ?) WHERE materia=? AND tipo_examen=? AND ciclo=?",
                    (cal_base, factor, cal_base, factor, materia, tipo_registro, ciclo)
                )
        
        conn.commit()
        if max_val > 0: return {'ok': True, 'max_anterior': max_val}
        else: return {'ok': False, 'error': 'No hay calificaciones registradas.'}
    finally: conn.close()