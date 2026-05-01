#!/usr/bin/env python3
"""
=============================================================================
GENERAR_HOJAS_WRAPPER.PY — Wrapper para integrar generar_hojas.py con la BD
Sistema de Gestión Académica — Hospital Escandón
=============================================================================
"""

import os
import csv
import sys
import tempfile
import pathlib

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from db import get_connection, get_ciclo_actual, rows_to_list
import gestionar_alumnos as ga


def _get_output_dir(user_dir=None):
    if user_dir and os.path.isdir(user_dir):
        return user_dir
    home = pathlib.Path.home()
    out = home / 'Desktop' / 'HE_Hojas'
    out.mkdir(parents=True, exist_ok=True)
    return str(out)


def _write_temp_csv(alumnos: list) -> str:
    tmp = tempfile.NamedTemporaryFile(
        mode='w', suffix='.csv', delete=False,
        encoding='utf-8-sig', newline=''
    )
    writer = csv.DictWriter(tmp, fieldnames=['NOMBRE', 'ID', 'GRADO', 'UNIVERSIDAD'])
    writer.writeheader()
    for a in alumnos:
        writer.writerow({
            'NOMBRE': f"{a.get('ap_paterno','')} {a.get('ap_materno','')} {a.get('nombres','')}".strip(),
            'ID': a.get('mip_id', ''),
            'GRADO': a.get('grado', ''),
            'UNIVERSIDAD': a.get('universidad_nombre', a.get('universidad_codigo', '')),
        })
    tmp.close()
    return tmp.name


def _merge_pdfs_by_guardia(pdf_map: dict, out_dir: str, prefijo: str) -> dict:
    """
    Recibe un dict {guardia: [lista de rutas de PDF]} y genera un PDF combinado
    por guardia en out_dir.

    Retorna {guardia: ruta_pdf_combinado}
    """
    from pypdf import PdfReader, PdfWriter

    combinados = {}
    for guardia, rutas in pdf_map.items():
        rutas_existentes = [r for r in rutas if os.path.exists(r)]
        if not rutas_existentes:
            continue

        writer = PdfWriter()
        for ruta in rutas_existentes:
            reader = PdfReader(ruta)
            for page in reader.pages:
                writer.add_page(page)

        nombre_archivo = f"{prefijo}_Guardia_{guardia}.pdf"
        out_path = os.path.join(out_dir, nombre_archivo)
        with open(out_path, 'wb') as f:
            writer.write(f)

        combinados[guardia] = out_path

        # Eliminar individuales ahora que el combinado está escrito
        for ruta in rutas_existentes:
            try:
                os.remove(ruta)
            except OSError:
                pass

    return combinados


def generar_rotacion_desde_db(grado: str = None, desde_csv: str = None, out_dir: str = None) -> dict:
    import generar_hojas as gh

    final_out_dir = os.path.join(_get_output_dir(out_dir), 'Rotacion')
    os.makedirs(final_out_dir, exist_ok=True)

    if desde_csv:
        alumnos = _parse_csv_guardias(desde_csv)
    else:
        alumnos = ga.listar_alumnos(grado=grado)

    if not alumnos:
        return {'ok': False, 'error': 'No hay alumnos para generar hojas', 'generados': 0}

    project_dir = pathlib.Path(__file__).parent.parent
    templates = {
        'ans': str(project_dir / 'assets' / 'Hoja_rotacion_ans.pdf'),
        'rev': str(project_dir / 'assets' / 'Hoja_rotacion_rev.pdf'),
    }

    faltantes = [k for k, v in templates.items() if not os.path.exists(v)]
    if faltantes:
        return {
            'ok': False,
            'error': f'Faltan plantillas PDF: {faltantes}. Colócalas en assets/',
            'generados': 0
        }

    orig_ans = gh.TEMPLATE_ROTACION_ANS
    orig_rev = gh.TEMPLATE_ROTACION_REV
    orig_out = gh.OUT_DIR_ROTACION

    gh.TEMPLATE_ROTACION_ANS = templates['ans']
    gh.TEMPLATE_ROTACION_REV = templates['rev']
    gh.OUT_DIR_ROTACION = final_out_dir

    gh.register_font()

    generados = 0
    errores = []

    # Ordenar por guardia y luego por nombre
    if desde_csv:
        alumnos.sort(key=lambda a: (a.get('guardia', 'Z'), a.get('nombre', '')))

    # Mapa guardia -> [rutas de PDFs individuales generados]
    guardia_pdfs = {}

    for i, alumno in enumerate(alumnos, start=1):
        nombre = f"{alumno.get('ap_paterno','')} {alumno.get('ap_materno','')} {alumno.get('nombres','')}".strip()
        if not nombre:
            nombre = alumno.get('nombre', alumno.get('NOMBRE', ''))
        sid = str(alumno.get('mip_id', alumno.get('ID', ''))).replace(' ', '')
        grado_al = alumno.get('grado', alumno.get('GRADO', ''))
        univ = alumno.get('universidad_nombre', alumno.get('UNIVERSIDAD', ''))
        guardia = alumno.get('guardia', '').strip().upper() or 'SIN_GUARDIA'

        try:
            sid9 = gh.validate_id(sid)
            out_path = gh.generar_hoja_rotacion(nombre, sid9, univ, grado_al, i)
            generados += 1

            # Registrar el PDF individual bajo su guardia
            if desde_csv:
                guardia_pdfs.setdefault(guardia, []).append(out_path)

        except Exception as e:
            errores.append({'nombre': nombre, 'error': str(e)})

    gh.TEMPLATE_ROTACION_ANS = orig_ans
    gh.TEMPLATE_ROTACION_REV = orig_rev
    gh.OUT_DIR_ROTACION = orig_out

    # Si viene de CSV, combinar por guardia
    combinados = {}
    if desde_csv and guardia_pdfs:
        combinados = _merge_pdfs_by_guardia(guardia_pdfs, final_out_dir, 'Rotacion')

    return {
        'ok': True,
        'generados': generados,
        'errores': errores,
        'directorio': final_out_dir,
        'combinados_por_guardia': combinados,
    }


def generar_examen_desde_db(grado: str = None, desde_csv: str = None, out_dir: str = None) -> dict:
    import generar_hojas as gh

    final_out_dir = os.path.join(_get_output_dir(out_dir), 'Examen')
    os.makedirs(final_out_dir, exist_ok=True)

    if desde_csv:
        alumnos = _parse_csv_guardias(desde_csv)
    else:
        alumnos = ga.listar_alumnos(grado=grado)

    if not alumnos:
        return {'ok': False, 'error': 'No hay alumnos para generar hojas', 'generados': 0}

    project_dir = pathlib.Path(__file__).parent.parent
    template = str(project_dir / 'assets' / 'Hoja_respuestas.pdf')

    if not os.path.exists(template):
        return {
            'ok': False,
            'error': 'Falta plantilla PDF: assets/Hoja_respuestas.pdf',
            'generados': 0
        }

    orig_template = gh.TEMPLATE_EXAMEN
    orig_font = gh.FONT_TTC
    orig_out = gh.OUT_DIR_EXAMEN

    gh.TEMPLATE_EXAMEN = template
    gh.FONT_TTC = str(project_dir / 'assets' / 'Avenir.ttc')
    gh.OUT_DIR_EXAMEN = final_out_dir

    gh.register_font()

    generados = 0
    errores = []

    if desde_csv:
        alumnos.sort(key=lambda a: (a.get('guardia', 'Z'), a.get('nombre', '')))

    # Mapa guardia -> [rutas de PDFs individuales generados]
    guardia_pdfs = {}

    for i, alumno in enumerate(alumnos, start=1):
        nombre = f"{alumno.get('ap_paterno','')} {alumno.get('ap_materno','')} {alumno.get('nombres','')}".strip()
        if not nombre:
            nombre = alumno.get('nombre', alumno.get('NOMBRE', ''))
        sid = str(alumno.get('mip_id', alumno.get('ID', ''))).replace(' ', '')
        grado_al = alumno.get('grado', alumno.get('GRADO', ''))
        guardia = alumno.get('guardia', '').strip().upper() or 'SIN_GUARDIA'

        try:
            sid9 = gh.validate_id(sid)
            out_path = gh.generar_hoja_examen(nombre, sid9, grado_al, i)
            generados += 1

            # Registrar el PDF individual bajo su guardia
            if desde_csv:
                guardia_pdfs.setdefault(guardia, []).append(out_path)

        except Exception as e:
            errores.append({'nombre': nombre, 'error': str(e)})

    gh.TEMPLATE_EXAMEN = orig_template
    gh.FONT_TTC = orig_font
    gh.OUT_DIR_EXAMEN = orig_out

    # Si viene de CSV, combinar por guardia
    combinados = {}
    if desde_csv and guardia_pdfs:
        combinados = _merge_pdfs_by_guardia(guardia_pdfs, final_out_dir, 'Examen')

    return {
        'ok': True,
        'generados': generados,
        'errores': errores,
        'directorio': final_out_dir,
        'combinados_por_guardia': combinados,
    }


def _parse_csv_guardias(contenido_csv: str) -> list:
    try:
        dialecto = csv.Sniffer().sniff(contenido_csv[:2048], delimiters=',;|\t')
        delimiter = dialecto.delimiter
    except Exception:
        delimiter = ','

    reader = csv.DictReader(contenido_csv.splitlines(), delimiter=delimiter)
    alumnos = []
    for row in reader:
        row_norm = {k.strip().lower(): v.strip() for k, v in row.items()}
        nombre = row_norm.get('nombre', '')
        parts = nombre.split()

        alumnos.append({
            'nombre': nombre,
            'ap_paterno': parts[0] if len(parts) > 0 else '',
            'ap_materno': parts[1] if len(parts) > 1 else '',
            'nombres': ' '.join(parts[2:]) if len(parts) > 2 else '',
            'mip_id': row_norm.get('id', ''),
            'grado': row_norm.get('grado', ''),
            'guardia': row_norm.get('guardia', ''),
            'universidad_nombre': row_norm.get('universidad', ''),
        })
    return alumnos