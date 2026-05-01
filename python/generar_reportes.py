#!/usr/bin/env python3
"""
=============================================================================
GENERAR_REPORTES.PY — Exportar calificaciones a Excel
Sistema de Gestión Académica — Hospital Escandón
=============================================================================
"""

import os
import pathlib
import math
from db import get_connection, get_ciclo_actual, rows_to_list

def redondear(val):
    if val is None or str(val).strip() == '': return None
    return math.floor(float(val) + 0.5)

def exportar_lista_asistencia(tipo: str, grado_filtro: str = 'Todos', ciclo: str = None) -> str:
    """Genera un archivo Excel formateado como lista de asistencia"""
    if ciclo is None: ciclo = get_ciclo_actual()
    conn = get_connection()
    try:
        # BUG FIX: Quitamos 'AND ciclo_ingreso=?' porque los MIP 2 entraron en ciclos anteriores.
        # Al pedir 'activo=1' nos aseguramos de traer a todos los que están en el hospital hoy.
        query = "SELECT ap_paterno, ap_materno, nombres, grado FROM alumnos WHERE activo=1"
        params = []
        if grado_filtro != 'Todos':
            query += " AND grado=?"
            params.append(grado_filtro)
        query += " ORDER BY grado DESC, ap_paterno, ap_materno, nombres"
        alumnos = rows_to_list(conn.execute(query, params).fetchall())
    finally: conn.close()

    try:
        import openpyxl
        from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
        
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Lista de Alumnos"
        
        fill_header = PatternFill(start_color="E0E0E0", end_color="E0E0E0", fill_type="solid")
        font_bold = Font(bold=True, size=11)
        font_normal = Font(size=10)
        border_thin = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
        align_center = Alignment(horizontal='center', vertical='center')
        align_left = Alignment(horizontal='left', vertical='center')

        ws.column_dimensions['A'].width = 45
        if tipo == 'asistencia':
            for col in range(2, 22): ws.column_dimensions[openpyxl.utils.get_column_letter(col)].width = 4

        row_idx = 1
        grupos = {'MIP 2': [a for a in alumnos if a['grado'] == 'MIP 2'], 'MIP 1': [a for a in alumnos if a['grado'] == 'MIP 1']}
        
        for grado_lbl, lista in grupos.items():
            if not lista: continue
            
            # Título principal
            end_col = 21 if tipo == 'asistencia' else 1
            ws.merge_cells(start_row=row_idx, start_column=1, end_row=row_idx, end_column=end_col)
            c = ws.cell(row=row_idx, column=1, value=f"LISTA DE ASISTENCIA {grado_lbl} {ciclo}")
            c.fill = fill_header; c.font = font_bold; c.alignment = align_center
            for col in range(1, end_col + 1): ws.cell(row=row_idx, column=col).border = border_thin
            row_idx += 1
            
            # Alumnos
            for a in lista:
                nombre = f"{a['ap_paterno']} {a['ap_materno']} {a['nombres']}".strip()
                c_nom = ws.cell(row=row_idx, column=1, value=nombre)
                c_nom.font = font_normal; c_nom.alignment = align_left; c_nom.border = border_thin
                
                if tipo == 'asistencia':
                    for col in range(2, 22):
                        c_check = ws.cell(row=row_idx, column=col)
                        c_check.border = border_thin
                row_idx += 1
            
            row_idx += 2 # Espacio entre MIP 1 y MIP 2

        # Configuración de impresión (Orientación horizontal, tamaño A4)
        ws.page_setup.orientation = ws.ORIENTATION_LANDSCAPE
        ws.page_setup.paperSize = ws.PAPERSIZE_A4
        ws.page_margins.left = 0.5; ws.page_margins.right = 0.5
        ws.page_margins.top = 0.5; ws.page_margins.bottom = 0.5

        dest = pathlib.Path.home() / 'Desktop' / f'Lista_{"Asistencia" if tipo=="asistencia" else "Nombres"}_{ciclo}.xlsx'
        wb.save(dest)
        return str(dest)
    except ImportError:
        raise RuntimeError("La librería openpyxl no está instalada. Ejecuta: pip install openpyxl")


def exportar_lista_asistencia_pdf(tipo: str, grado_filtro: str = 'Todos', ciclo: str = None) -> str:
    """
    Genera un PDF de lista de alumnos ajustado a una sola hoja en ancho (landscape A4).
    Internamente crea primero el Excel y luego genera el PDF con reportlab.
    """
    import tempfile
    if ciclo is None: ciclo = get_ciclo_actual()

    # Paso 1: obtener datos (misma consulta que el Excel)
    conn = get_connection()
    try:
        query = "SELECT ap_paterno, ap_materno, nombres, grado FROM alumnos WHERE activo=1"
        params = []
        if grado_filtro != 'Todos':
            query += " AND grado=?"
            params.append(grado_filtro)
        query += " ORDER BY grado DESC, ap_paterno, ap_materno, nombres"
        alumnos = rows_to_list(conn.execute(query, params).fetchall())
    finally:
        conn.close()

    # Paso 2: crear Excel temporal (requerimiento del flujo interno)
    tmp_xlsx = tempfile.NamedTemporaryFile(suffix='.xlsx', delete=False)
    tmp_xlsx.close()
    try:
        import openpyxl
        _wb = openpyxl.Workbook()
        _ws = _wb.active
        for a in alumnos:
            _ws.append([f"{a['ap_paterno']} {a['ap_materno']} {a['nombres']}".strip(), a['grado']])
        _wb.save(tmp_xlsx.name)
    except ImportError:
        raise RuntimeError("La librería openpyxl no está instalada. Ejecuta: pip install openpyxl")

    # Paso 3: generar PDF con reportlab a partir de los mismos datos
    try:
        from reportlab.lib.pagesizes import landscape, A4
        from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Spacer, Paragraph
        from reportlab.lib.styles import getSampleStyleSheet
        from reportlab.lib import colors
        from reportlab.lib.units import cm
    except ImportError:
        raise RuntimeError("La librería reportlab no está instalada. Ejecuta: pip install reportlab")

    desktop = pathlib.Path.home() / 'Desktop'
    if not desktop.exists():
        desktop = pathlib.Path.home()
    tipo_lbl = 'Asistencia' if tipo == 'asistencia' else 'Nombres'
    dest = str(desktop / f'Lista_{tipo_lbl}_{ciclo}.pdf')

    PAGE_W, PAGE_H = landscape(A4)  # 841.9 x 595.3 pt
    MARGIN = 1.5 * cm
    usable_w = PAGE_W - 2 * MARGIN

    doc = SimpleDocTemplate(
        dest,
        pagesize=landscape(A4),
        leftMargin=MARGIN, rightMargin=MARGIN,
        topMargin=MARGIN, bottomMargin=MARGIN,
    )
    styles = getSampleStyleSheet()
    elements = []

    grupos = {
        'MIP 2': [a for a in alumnos if a['grado'] == 'MIP 2'],
        'MIP 1': [a for a in alumnos if a['grado'] == 'MIP 1'],
    }

    for grado_lbl, lista in grupos.items():
        if not lista:
            continue

        titulo = f"LISTA DE {'ASISTENCIA' if tipo == 'asistencia' else 'ALUMNOS'} — {grado_lbl}   {ciclo}"
        elements.append(Paragraph(f"<b>{titulo}</b>", styles['Normal']))
        elements.append(Spacer(1, 0.3 * cm))

        # Columnas: Nombre + (20 celdas de asistencia ó nada)
        if tipo == 'asistencia':
            n_dias = 20
            # Calcular ancho: nombre ocupa el resto, celdas de asistencia son iguales
            celda_w = 0.85 * cm
            nombre_w = usable_w - n_dias * celda_w
            col_widths = [nombre_w] + [celda_w] * n_dias
            header = ['Nombre'] + [str(i + 1) for i in range(n_dias)]
        else:
            col_widths = [usable_w]
            header = ['Nombre']

        table_data = [header]
        for a in lista:
            nombre = f"{a['ap_paterno']} {a['ap_materno']} {a['nombres']}".strip()
            if tipo == 'asistencia':
                table_data.append([nombre] + [''] * n_dias)
            else:
                table_data.append([nombre])

        t = Table(table_data, colWidths=col_widths, repeatRows=1)
        style_cmds = [
            # Encabezado
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#D0D0D0')),
            ('FONTNAME',   (0, 0), (-1, 0), 'Helvetica-Bold'),
            ('FONTSIZE',   (0, 0), (-1, 0), 7),
            ('ALIGN',      (0, 0), (-1, 0), 'CENTER'),
            # Datos
            ('FONTNAME',   (0, 1), (0, -1), 'Helvetica'),
            ('FONTSIZE',   (0, 1), (-1, -1), 7),
            ('ALIGN',      (1, 1), (-1, -1), 'CENTER'),
            ('ALIGN',      (0, 1), (0, -1), 'LEFT'),
            ('VALIGN',     (0, 0), (-1, -1), 'MIDDLE'),
            # Bordes
            ('GRID',       (0, 0), (-1, -1), 0.4, colors.grey),
            # Filas alternas
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F5F5F5')]),
            ('ROWHEIGHT', (0, 0), (-1, -1), 0.65 * cm),
        ]
        t.setStyle(TableStyle(style_cmds))
        elements.append(t)
        elements.append(Spacer(1, 0.8 * cm))

    doc.build(elements)

    # Limpiar Excel temporal
    try:
        os.remove(tmp_xlsx.name)
    except OSError:
        pass

    return dest


def exportar_resultados_examen(materia: str, tipo_examen: str, export_type: str = 'excel', ciclo: str = None) -> str:
    """Exporta solo a Excel. Usa formato condicional y redondeo."""
    if ciclo is None: ciclo = get_ciclo_actual()
    conn = get_connection()
    try:
        query = """
            SELECT a.nombre_completo as nombre, a.grado, 
                   MAX(e.percent_correct) as calificacion
            FROM alumnos a
            JOIN examenes_raw e ON a.mip_id = e.student_id
            WHERE a.activo=1 AND e.materia=? AND e.tipo_examen=? AND e.ciclo=?
            GROUP BY a.mip_id
        """
        rows = rows_to_list(conn.execute(query, (materia, tipo_examen, ciclo)).fetchall())
    finally: conn.close()

    mip2, mip1 = [], []
    for r in rows:
        r['cal_redondeada'] = redondear(r['calificacion'])
        if r['cal_redondeada'] is not None:
            if r['grado'] == 'MIP 2': mip2.append(r)
            else: mip1.append(r)
            
    mip2.sort(key=lambda x: x['cal_redondeada'], reverse=True)
    mip1.sort(key=lambda x: x['cal_redondeada'], reverse=True)

    try:
        import openpyxl
        from openpyxl.styles import PatternFill, Font, Alignment, Border, Side
        
        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = f"Resultados {materia}"
        
        fill_red = PatternFill(start_color="F5B7B1", end_color="F5B7B1", fill_type="solid")
        fill_yellow = PatternFill(start_color="F9E79F", end_color="F9E79F", fill_type="solid")
        fill_green = PatternFill(start_color="A9DFBF", end_color="A9DFBF", fill_type="solid")
        fill_header = PatternFill(start_color="F1948A", end_color="F1948A", fill_type="solid")
        font_bold = Font(bold=True); border_thin = Border(left=Side(style='thin'), right=Side(style='thin'), top=Side(style='thin'), bottom=Side(style='thin'))
        align_center = Alignment(horizontal='center', vertical='center')

        ws.column_dimensions['A'].width = 50
        ws.column_dimensions['B'].width = 15

        row_idx = 1
        for grado_lbl, data in [("MIPS 2", mip2), ("MIPS 1", mip1)]:
            if not data: continue
            ws.merge_cells(start_row=row_idx, start_column=1, end_row=row_idx, end_column=2)
            c = ws.cell(row=row_idx, column=1, value=grado_lbl)
            c.fill = fill_header; c.font = font_bold; c.alignment = align_center; c.border = border_thin
            ws.cell(row=row_idx, column=2).border = border_thin; row_idx += 1
            
            c1, c2 = ws.cell(row=row_idx, column=1, value="NOMBRE"), ws.cell(row=row_idx, column=2, value="CALIFICACIÓN")
            for c in [c1, c2]: c.fill = fill_header; c.font = font_bold; c.alignment = align_center; c.border = border_thin
            row_idx += 1
            
            for d in data:
                c1, c2 = ws.cell(row=row_idx, column=1, value=d['nombre']), ws.cell(row=row_idx, column=2, value=d['cal_redondeada'])
                c1.border = border_thin; c2.border = border_thin; c2.alignment = align_center; c2.font = font_bold
                val = d['cal_redondeada']
                if val >= 70: c2.fill = fill_green
                elif val >= 60: c2.fill = fill_yellow
                else: c2.fill = fill_red
                row_idx += 1
            row_idx += 2 
            
        dest = pathlib.Path.home() / 'Desktop' / f'Resultados_{materia}_{tipo_examen}.xlsx'
        wb.save(dest)
        return str(dest)
    except ImportError:
        raise RuntimeError("La librería openpyxl no está instalada. Ejecuta: pip install openpyxl")


def exportar_excel_global(grado: str = None) -> str:
    """Exporta la tabla de calificaciones globales a Excel con formato condicional."""
    ciclo = get_ciclo_actual()
    conn = get_connection()
    try:
        query = """
            SELECT a.mip_id, a.nombre_completo, a.grado, u.nombre as escuela,
                c_gyo.cal_ponderada as gyo_total,
                c_mi.cal_ponderada  as mi_total,
                c_cir.cal_ponderada as ciru_total,
                c_ped.cal_ponderada as pedia_total,
                c_fam.cal_ponderada as fam_total,
                c_urg.cal_ponderada as urg_total,
                c_glob.rubrica_entregas as rubrica_entregas_global
            FROM alumnos a
            LEFT JOIN universidades u ON a.universidad_id = u.id
            LEFT JOIN calificaciones c_gyo  ON a.mip_id=c_gyo.mip_id  AND c_gyo.materia='GyO'              AND c_gyo.ciclo=?
            LEFT JOIN calificaciones c_mi   ON a.mip_id=c_mi.mip_id   AND c_mi.materia='Medicina Interna'  AND c_mi.ciclo=?
            LEFT JOIN calificaciones c_cir  ON a.mip_id=c_cir.mip_id  AND c_cir.materia='Cirugía'          AND c_cir.ciclo=?
            LEFT JOIN calificaciones c_ped  ON a.mip_id=c_ped.mip_id  AND c_ped.materia='Pediatría'        AND c_ped.ciclo=?
            LEFT JOIN calificaciones c_fam  ON a.mip_id=c_fam.mip_id  AND c_fam.materia='Familiar'         AND c_fam.ciclo=?
            LEFT JOIN calificaciones c_urg  ON a.mip_id=c_urg.mip_id  AND c_urg.materia='Urgencias'        AND c_urg.ciclo=?
            LEFT JOIN calificaciones c_glob ON a.mip_id=c_glob.mip_id AND c_glob.materia='GLOBAL'          AND c_glob.ciclo=?
            WHERE a.activo=1
        """
        params = [ciclo] * 7
        if grado:
            query += " AND a.grado=?"
            params.append(grado)
        query += " ORDER BY a.grado DESC, a.ap_paterno, a.nombres"
        rows = rows_to_list(conn.execute(query, params).fetchall())
    finally:
        conn.close()

    # Calcular promedio global
    for r in rows:
        validos = [v for v in [r.get('gyo_total'), r.get('mi_total'), r.get('ciru_total'),
                                r.get('pedia_total'), r.get('fam_total'), r.get('urg_total')] if v is not None]
        r['cal_final_global'] = min(100.0, sum(validos) / len(validos)) if validos else None

    try:
        import openpyxl
        from openpyxl.styles import PatternFill, Font, Alignment, Border, Side

        wb = openpyxl.Workbook()
        ws = wb.active
        ws.title = "Calificaciones Globales"

        fill_header  = PatternFill(start_color="2C4F7C", end_color="2C4F7C", fill_type="solid")
        fill_mip2    = PatternFill(start_color="E8F4FD", end_color="E8F4FD", fill_type="solid")
        fill_mip1    = PatternFill(start_color="FEF9E7", end_color="FEF9E7", fill_type="solid")
        fill_red     = PatternFill(start_color="F5B7B1", end_color="F5B7B1", fill_type="solid")
        fill_yellow  = PatternFill(start_color="F9E79F", end_color="F9E79F", fill_type="solid")
        fill_green   = PatternFill(start_color="A9DFBF", end_color="A9DFBF", fill_type="solid")
        font_wbold   = Font(bold=True, color="FFFFFF", size=10)
        font_bold    = Font(bold=True, size=10)
        font_normal  = Font(size=10)
        border_thin  = Border(left=Side(style='thin'), right=Side(style='thin'),
                              top=Side(style='thin'), bottom=Side(style='thin'))
        align_center = Alignment(horizontal='center', vertical='center')
        align_left   = Alignment(horizontal='left', vertical='center')

        # Anchos de columna
        ws.column_dimensions['A'].width = 38
        ws.column_dimensions['B'].width = 8
        ws.column_dimensions['C'].width = 16
        for col in range(4, 12):
            ws.column_dimensions[openpyxl.utils.get_column_letter(col)].width = 13

        # Encabezados
        headers = ['Nombre', 'Grado', 'Escuela',
                   'GyO', 'Med. Interna', 'Cirugía', 'Pediatría', 'Familiar', 'Urgencias',
                   'Entregas', 'FINAL GLOBAL']
        for col_idx, header in enumerate(headers, start=1):
            cell = ws.cell(row=1, column=col_idx, value=header)
            cell.fill = fill_header
            cell.font = font_wbold
            cell.alignment = align_center
            cell.border = border_thin
        ws.freeze_panes = 'A2'

        # Filas de datos
        col_keys = ['gyo_total', 'mi_total', 'ciru_total', 'pedia_total', 'fam_total', 'urg_total']
        for row_idx, r in enumerate(rows, start=2):
            fill_grado = fill_mip2 if r.get('grado') == 'MIP 2' else fill_mip1
            values = [r.get('nombre_completo', ''), r.get('grado', ''), r.get('escuela', '')]
            values += [redondear(r.get(k)) for k in col_keys]
            values += [r.get('rubrica_entregas_global', ''), redondear(r.get('cal_final_global'))]

            for col_idx, val in enumerate(values, start=1):
                cell = ws.cell(row=row_idx, column=col_idx, value=val)
                cell.border = border_thin
                if col_idx <= 3:
                    cell.font = font_normal
                    cell.alignment = align_left if col_idx == 1 else align_center
                    cell.fill = fill_grado
                else:
                    cell.alignment = align_center
                    cell.font = font_bold if col_idx == 11 else font_normal
                    if isinstance(val, (int, float)):
                        cell.fill = fill_green if val >= 70 else (fill_yellow if val >= 60 else fill_red)

        ws.page_setup.orientation = ws.ORIENTATION_LANDSCAPE
        ws.page_setup.paperSize = ws.PAPERSIZE_A4

        dest = pathlib.Path.home() / 'Desktop' / f'Calificaciones_Global_{ciclo}.xlsx'
        wb.save(dest)
        return str(dest)
    except ImportError:
        raise RuntimeError("La librería openpyxl no está instalada. Ejecuta: pip install openpyxl")