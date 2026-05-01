#!/usr/bin/env python3
"""
=============================================================================
SERVER.PY — Servidor IPC Electron ↔ Python (stdin/stdout JSON)
Sistema de Gestión Académica — Hospital Escandón
=============================================================================
Protocolo: Una línea JSON por mensaje
  → {"id":"uuid","action":"nombre_accion","payload":{...}}
  ← {"id":"uuid","ok":true,"data":{...}}  |  {"id":"uuid","ok":false,"error":"msg"}
=============================================================================
"""

import json
import sys
import os
import traceback
import shutil
import pathlib
import hashlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import db
import gestionar_alumnos as ga
import importar_zipgrade as iz
import calcular_calificaciones as cc
import registro_manual as rm

def log(msg: str): print(f"[SERVER] {msg}", file=sys.stderr, flush=True)

def _sha256(texto: str) -> str:
    return hashlib.sha256(texto.encode('utf-8')).hexdigest()

def handle(action: str, payload: dict) -> dict:
    if action == 'ping': return {'pong': True, 'version': '1.0.0'}
    elif action == 'init_db': return {'db_path': db.init_db()}
    elif action == 'get_config': return {'valor': db.get_config(payload.get('clave'), payload.get('default'))}
    elif action == 'set_config': db.set_config(payload['clave'], payload['valor']); return {'ok': True}
    elif action == 'get_ciclo_actual': return {'ciclo': db.get_ciclo_actual()}
    
    # ── SEGURIDAD (CONTRASEÑA) ──
    elif action == 'auth_check': return {'has_password': db.get_config('app_pwd') is not None}
    elif action == 'auth_setup': db.set_config('app_pwd', _sha256(payload['pwd'])); return {'ok': True}
    elif action == 'auth_login': return {'valid': db.get_config('app_pwd') == _sha256(payload['pwd'])}

    # ── ALUMNOS Y ESCUELAS ──
    elif action == 'listar_universidades': return {'universidades': ga.listar_universidades()}
    elif action == 'listar_alumnos': return {'alumnos': ga.listar_alumnos(grado=payload.get('grado'), universidad_id=payload.get('universidad_id'), solo_activos=payload.get('solo_activos', True))}
    elif action == 'crear_alumno': return {'alumno': ga.crear_alumno(mip_id=payload.get('mip_id', ''), ap_paterno=payload['ap_paterno'], ap_materno=payload.get('ap_materno', ''), nombres=payload['nombres'], universidad_id=payload['universidad_id'], grado=payload.get('grado', 'MIP 1'), ciclo=payload.get('ciclo'))}
    elif action == 'actualizar_alumno': return ga.actualizar_alumno(mip_id_old=payload['mip_id_old'], mip_id_new=payload['mip_id_new'], ap_paterno=payload['ap_paterno'], ap_materno=payload.get('ap_materno', ''), nombres=payload['nombres'], universidad_id=payload['universidad_id'], grado=payload.get('grado', 'MIP 1'), ciclo=payload['ciclo'])
    elif action == 'importar_alumnos_csv': return ga.importar_alumnos_csv(payload['contenido'])
    elif action == 'eliminar_alumno': return {'eliminado': ga.eliminar_alumno(payload['mip_id'])}
    elif action == 'egresar_alumno_individual': return ga.egresar_alumno_individual(payload['mip_id'])
    elif action == 'listar_egresados': return {'egresados': ga.listar_egresados(payload.get('ciclo_egreso'))}
    elif action == 'promover_curso': return ga.promover_curso(payload['ciclo_nuevo'])
    
    elif action == 'generar_csv_ejemplo_alumnos': return {'csv': ga.generar_csv_ejemplo_alumnos()}
    elif action == 'generar_csv_ejemplo_guardias': return {'csv': ga.generar_csv_ejemplo_guardias()}

    # ── IMPORTACIÓN Y PREVISUALIZACIÓN ──
    elif action == 'importar_rotaciones': result = iz.importar_rotaciones(contenido_csv=payload['contenido'], nombre_archivo=payload.get('nombre_archivo', 'rotaciones.csv')); cc.recalcular_todo(); return result
    elif action == 'importar_examenes_preview': return iz.importar_examenes_preview(payload['contenido'])
    elif action == 'guardar_examenes_lote': result = iz.guardar_examenes_lote(registros=payload['registros'], materia=payload['materia'], tipo_examen=payload['tipo_examen']); cc.recalcular_todo(); return result
    elif action == 'registrar_manual': result = rm.registrar_calificacion_manual(mip_id=payload['mip_id'], materia=payload['materia'], tipo_registro=payload['tipo_registro'], calificacion=float(payload['calificacion']), ciclo=payload.get('ciclo')); cc.recalcular_todo(); return result
    elif action == 'aplicar_campana': result = rm.aplicar_campana(materia=payload['materia'], tipo_registro=payload['tipo_registro'], cal_base=float(payload['cal_base']), ciclo=payload.get('ciclo')); cc.recalcular_todo(); return result
    elif action == 'get_alertas_duplicados': return {'alertas': iz.get_alertas_duplicados_pendientes()}
    elif action == 'resolver_duplicado': result = iz.resolver_duplicado(alerta_id=payload['alerta_id'], resolucion=payload['resolucion'], materia_destino=payload.get('materia_destino')); cc.recalcular_todo(); return result
    elif action == 'get_historial_importaciones': return {'historial': iz.get_historial_importaciones()}

    # ── CALIFICACIONES Y TABLAS ──
    elif action == 'recalcular_todo': return cc.recalcular_todo(payload.get('ciclo'), payload.get('usar_troncal', True), payload.get('usar_remedial', True))
    elif action == 'get_tabla_global': return {'tabla': cc.get_tabla_global(grado=payload.get('grado'), ciclo=payload.get('ciclo'), usar_troncal=payload.get('usar_troncal', True), usar_remedial=payload.get('usar_remedial', True))}
    elif action == 'get_vista_global_examenes': return {'tabla': cc.get_vista_global_examenes(ciclo=payload.get('ciclo'), usar_troncal=payload.get('usar_troncal', True), usar_remedial=payload.get('usar_remedial', True))}
    elif action == 'get_tabla_examenes': return {'tabla': cc.get_tabla_examenes(materia=payload['materia'], tipo_examen=payload['tipo_examen'], grado=payload.get('grado'), ciclo=payload.get('ciclo'))}
    elif action == 'get_top_3_examenes': return cc.get_top_3_examenes(ciclo=payload.get('ciclo'))
    elif action == 'set_rubrica_entregas_global': return cc.set_rubrica_entregas_global(mip_id=payload['mip_id'], rubrica=payload['rubrica'], ciclo=payload.get('ciclo'))

    # ── HERENCIA DEL SISTEMA (DB) ──
    elif action == 'exportar_bd':
        db_path = os.environ.get('HE_DB_PATH', os.path.join(pathlib.Path.home(), '.hospital_escandon', 'academico.db'))
        # Usar Desktop si existe; si no (Linux u otras configs), usar el home del usuario
        desktop = pathlib.Path.home() / 'Desktop'
        if not desktop.exists():
            desktop = pathlib.Path.home()
        dest = desktop / 'Respaldo_HE_Academico.db'
        shutil.copy2(db_path, dest)
        return {'ok': True, 'path': str(dest)}

    elif action == 'importar_bd':
        desktop = pathlib.Path.home() / 'Desktop'
        if not desktop.exists():
            desktop = pathlib.Path.home()
        src = desktop / 'Respaldo_HE_Academico.db'
        if not src.exists():
            return {'ok': False, 'error': f'No se encontró "Respaldo_HE_Academico.db" en {desktop}.'}
        db_path = os.environ.get('HE_DB_PATH', os.path.join(pathlib.Path.home(), '.hospital_escandon', 'academico.db'))
        shutil.copy2(src, db_path)
        return {'ok': True}
        
    elif action == 'borrar_todo_sistema':
        conn = db.get_connection()
        try:
            # FIX: Apagamos llaves foráneas para borrar sin bloqueos
            conn.execute("PRAGMA foreign_keys = OFF;")
            tablas = ['rotaciones_raw', 'examenes_raw', 'calificaciones', 'alertas_duplicados', 'historial_importaciones', 'ddd_usados', 'alumnos', 'egresados']
            for t in tablas: conn.execute(f"DELETE FROM {t}")
            conn.commit()
            conn.execute("PRAGMA foreign_keys = ON;")
            return {'ok': True}
        except Exception as e:
            conn.execute("PRAGMA foreign_keys = ON;")
            return {'ok': False, 'error': str(e)}
        finally: conn.close()

    # ── REPORTES PDF Y EXCEL ──
    elif action == 'exportar_lista_asistencia':
        from generar_reportes import exportar_lista_asistencia
        path = exportar_lista_asistencia(tipo=payload['tipo'], grado_filtro=payload['grado_filtro'], ciclo=payload.get('ciclo'))
        return {'path': path}

    elif action == 'exportar_lista_asistencia_pdf':
        from generar_reportes import exportar_lista_asistencia_pdf
        path = exportar_lista_asistencia_pdf(tipo=payload['tipo'], grado_filtro=payload['grado_filtro'], ciclo=payload.get('ciclo'))
        return {'path': path}

    elif action == 'exportar_resultados_examen':
        from generar_reportes import exportar_resultados_examen
        path = exportar_resultados_examen(materia=payload['materia'], tipo_examen=payload['tipo_examen'], export_type=payload['export_type'])
        return {'path': path}

    elif action == 'generar_hojas_rotacion':
        from generar_hojas_wrapper import generar_rotacion_desde_db
        return generar_rotacion_desde_db(grado=payload.get('grado'), desde_csv=payload.get('csv_guardias'), out_dir=payload.get('output_dir'))
    elif action == 'generar_hojas_examen':
        from generar_hojas_wrapper import generar_examen_desde_db
        return generar_examen_desde_db(grado=payload.get('grado'), desde_csv=payload.get('csv_guardias'), out_dir=payload.get('output_dir'))
    elif action == 'exportar_excel':
        # La tabla Global normal
        from generar_reportes import exportar_excel_global
        return {'path': exportar_excel_global(grado=payload.get('grado'))}

    else: raise ValueError(f"Acción desconocida: {action}")

def main():
    log("Servidor IPC iniciado. Esperando comandos...")
    try: db.init_db(); log("Base de datos inicializada")
    except Exception as e: log(f"ERROR inicializando BD: {e}")

    for line in sys.stdin:
        line = line.strip()
        if not line: continue
        msg_id = None
        try:
            msg = json.loads(line)
            msg_id, action, payload = msg.get('id', 'no-id'), msg.get('action', ''), msg.get('payload', {})
            data = handle(action, payload)
            response = {'id': msg_id, 'ok': True, 'data': data}
        except Exception as e:
            log(f"ERROR en {action}: {traceback.format_exc()}")
            response = {'id': msg_id, 'ok': False, 'error': str(e)}
        print(json.dumps(response, ensure_ascii=False, default=str), flush=True)

if __name__ == '__main__':
    main()