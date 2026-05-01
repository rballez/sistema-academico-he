#!/usr/bin/env python3
"""
=============================================================================
GENERADOR DE HOJAS DE EVALUACIÓN - Hospital Escandón
=============================================================================
Genera automáticamente:
  1. Hojas de Rotación (2 páginas: anverso + reverso)
  2. Hojas de Examen (1 página)

Requisitos:
  - Lista.csv (columnas: Nombre | ID | Grado)
  - Hoja_rotacion_ans.pdf
  - Hoja_rotacion_rev.pdf
  - Hoja_respuestas.pdf
  - Avenir.ttc (fuente)

Uso:
  python generar_hojas.py

Autor: Hospital Escandón - Departamento de Enseñanza
Fecha: 2026
=============================================================================
"""

import csv
import os
import re
from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas
from reportlab.lib.colors import black
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont

# =============================================================================
# CONFIGURACIÓN GENERAL
# =============================================================================
CSV_FILE = "Lista.csv"
FONT_TTC = "Avenir.ttc"
FONT_NAME = "Avenir"
TTC_SUBFONT_INDEX = 0

# Templates
TEMPLATE_ROTACION_ANS = "Hoja_rotacion_ans.pdf"
TEMPLATE_ROTACION_REV = "Hoja_rotacion_rev.pdf"
TEMPLATE_EXAMEN = "Hoja_respuestas.pdf"

# Carpetas de salida
OUT_DIR_ROTACION = "Hojas_Rotacion"
OUT_DIR_EXAMEN = "Hojas_Examen"

# =============================================================================
# COORDENADAS - HOJA DE ROTACIÓN (ANVERSO)
# =============================================================================
# Basado en el PDF real - Tamaño Carta: 612 × 792 pt
# ALINEACIÓN: IZQUIERDA (como en el ejemplo)
ROT_ANS_NAME_X = 95.0
ROT_ANS_NAME_Y = 710.0  # Bajado de 713 para centrar con "NOMBRE:"
ROT_ANS_NAME_SIZE = 8

ROT_ANS_ID_X = 95.0
ROT_ANS_ID_Y = 695.0  # Subido de 693 (centrar mejor)
ROT_ANS_ID_SIZE = 8

ROT_ANS_UNIV_X = 95.0
ROT_ANS_UNIV_Y = 680.0  # Subido mucho de 671 (estaba en grado)
ROT_ANS_UNIV_SIZE = 7

ROT_ANS_GRADO_X = 95.0
ROT_ANS_GRADO_Y = 665.0  # Subido mucho de 649 (estaba en periodo)
ROT_ANS_GRADO_SIZE = 8

# =============================================================================
# COORDENADAS - HOJA DE ROTACIÓN (REVERSO)
# =============================================================================
# Grid de MIP ID (9 dígitos)
ROT_REV_PAGE_W = 1224.0
ROT_REV_PAGE_H = 1584.0

ROT_REV_X_COLS = [
    656.092793, 685.944009, 716.140811, 745.991982, 776.188828,
    805.372383, 835.848018, 866.088018, 895.896035
]

ROT_REV_Y_ROWS_BASE = [
    685.267207, 642.023965, 606.167930, 572.040000, 536.040000,
    500.400000, 465.120000, 429.480000, 393.840000, 354.023965
]

# Ajustes finos
ROT_REV_DX = 0.0
ROT_REV_DY = -4.0  # Ajuste general (antes era -6.0)

ROT_REV_ROW_NUDGE = {
    0: 0.0,   # Dígito 0: sin ajuste adicional
    1: +2.0,  # Dígito 1: SUBIR 2mm (~5.6pt) para que no salga abajo
    6: -1.0,  # Dígito 6: Bajar un poco
    7: -2.0,  # Dígito 7: Bajar más
    8: -3.0,  # Dígito 8: Bajar aún más
}

ROT_REV_Y_AFTER_2_COMP = +4.0  # Compensación para dígitos 2-9
ROT_REV_BUBBLE_RADIUS = 10.5  # Aumentado para llenar mejor el círculo
ROT_REV_TEXT_SIZE = 16
ROT_REV_Y_TEXT_CENTER = 720.0

# =============================================================================
# COORDENADAS - HOJA DE EXAMEN
# =============================================================================
EXAM_NAME_X_LEFT = 95.0
EXAM_NAME_X_RIGHT = 360.0
EXAM_NAME_Y_CENTER = 680.0
EXAM_NAME_SIZE = 11

EXAM_GRADE_X_CENTER = 420.0
EXAM_GRADE_Y_CENTER = 680.0
EXAM_GRADE_SIZE = 18

# MIP ID (9 dígitos)
EXAM_MIP_COL_X = [
    378.1, 393.3, 408.3, 423.5, 438.4,
    453.6, 468.7, 483.9, 499.0
]

EXAM_MIP_ROW_Y = [
    234.5, 216.5, 198.5, 180.6, 162.7,
    144.8, 126.9, 108.9, 91.0, 72.3
]

EXAM_MIP_DIGIT_Y = 252.0
EXAM_ID_SIZE = 16
EXAM_BUBBLE_RADIUS = 7.0

EXAM_DX = 0.0
EXAM_DY = 0.0

# =============================================================================
# FUNCIONES AUXILIARES
# =============================================================================

def sanitize_filename(s: str) -> str:
    """Limpia un string para usarlo como nombre de archivo"""
    s = (s or "").strip()
    s = s.replace("/", "-")
    s = re.sub(r'[\\/*?:"<>|]+', "", s)
    s = re.sub(r"\s+", "_", s)
    return s


def normalize_spaces(s: str) -> str:
    """Normaliza espacios múltiples a uno solo"""
    s = (s or "").strip()
    return " ".join(s.split())


def only_digits(s: str) -> str:
    """Extrae solo dígitos de un string"""
    return "".join(ch for ch in str(s) if ch.isdigit())


def validate_id(sid: str) -> str:
    """Valida que el ID tenga exactamente 9 dígitos"""
    digits = only_digits(sid)
    if len(digits) != 9:
        raise ValueError(f"ID debe tener 9 dígitos, tiene {len(digits)}: {sid}")
    return digits


def detect_delimiter(path: str) -> str:
    """Detecta el delimitador del CSV"""
    with open(path, "r", encoding="utf-8-sig", newline="") as f:
        sample = f.read(4096)
    try:
        return csv.Sniffer().sniff(sample, delimiters=[",", "|", "\t", ";"]).delimiter
    except Exception:
        return ","


def register_font():
    """Registra la fuente Avenir si está disponible"""
    if not os.path.exists(FONT_TTC):
        print(f"⚠️  Fuente {FONT_TTC} no encontrada, usando Helvetica")
        return False
    try:
        pdfmetrics.registerFont(
            TTFont(FONT_NAME, FONT_TTC, subfontIndex=TTC_SUBFONT_INDEX)
        )
        print(f"✓ Fuente {FONT_NAME} registrada")
        return True
    except Exception as e:
        print(f"⚠️  Error registrando fuente: {e}")
        return False


def set_font(c, size: int, fallback="Helvetica-Bold"):
    """Establece la fuente en el canvas"""
    if FONT_NAME in pdfmetrics.getRegisteredFontNames():
        c.setFont(FONT_NAME, size)
    else:
        c.setFont(fallback, size)


def draw_centered_in_box(c, x_left, x_right, y_center, text, size, margin=8):
    """Dibuja texto centrado en una caja, truncando si es necesario"""
    text = normalize_spaces(text)
    font = FONT_NAME if FONT_NAME in pdfmetrics.getRegisteredFontNames() else "Helvetica-Bold"
    
    max_w = (x_right - x_left) - 2 * margin
    set_font(c, size)
    
    # Truncar si es muy largo
    while text and c.stringWidth(text, font, size) > max_w:
        text = text[:-1]
    
    baseline_fix = size * 0.35
    x_center = (x_left + x_right) / 2.0
    c.drawCentredString(x_center, y_center - baseline_fix, text)


def draw_left_aligned(c, x, y, text, size):
    """Dibuja texto alineado a la IZQUIERDA en un punto específico"""
    text = normalize_spaces(text)
    set_font(c, size)
    baseline_fix = size * 0.35
    c.drawString(x, y - baseline_fix, text)


def draw_centered_at(c, x_center, y_center, text, size):
    """Dibuja texto CENTRADO en un punto específico"""
    text = normalize_spaces(text)
    set_font(c, size)
    baseline_fix = size * 0.35
    c.drawCentredString(x_center, y_center - baseline_fix, text)


# =============================================================================
# GENERADOR DE HOJA DE ROTACIÓN - ANVERSO
# =============================================================================

def make_rotacion_anverso_overlay(overlay_path: str, page_w: float, page_h: float,
                                   nombre: str, sid9: str, universidad: str, grado: str):
    """Genera el overlay para el anverso de la hoja de rotación"""
    c = canvas.Canvas(overlay_path, pagesize=(page_w, page_h))
    c.setFillColor(black)
    c.setStrokeColor(black)
    
    # NOMBRE (alineado a izquierda)
    draw_left_aligned(c, ROT_ANS_NAME_X, ROT_ANS_NAME_Y, nombre, ROT_ANS_NAME_SIZE)
    
    # ID (alineado a izquierda)
    draw_left_aligned(c, ROT_ANS_ID_X, ROT_ANS_ID_Y, sid9, ROT_ANS_ID_SIZE)
    
    # UNIVERSIDAD (alineado a izquierda)
    draw_left_aligned(c, ROT_ANS_UNIV_X, ROT_ANS_UNIV_Y, universidad, ROT_ANS_UNIV_SIZE)
    
    # GRADO (alineado a izquierda)
    draw_left_aligned(c, ROT_ANS_GRADO_X, ROT_ANS_GRADO_Y, grado, ROT_ANS_GRADO_SIZE)
    
    c.showPage()
    c.save()


# =============================================================================
# GENERADOR DE HOJA DE ROTACIÓN - REVERSO
# =============================================================================

def make_rotacion_reverso_overlay(overlay_path: str, sid9: str):
    """Genera el overlay para el reverso de la hoja de rotación"""
    c = canvas.Canvas(overlay_path, pagesize=(ROT_REV_PAGE_W, ROT_REV_PAGE_H))
    c.setFillColor(black)
    c.setStrokeColor(black)
    
    # Texto del ID (encima del grid)
    set_font(c, ROT_REV_TEXT_SIZE)
    baseline_fix = ROT_REV_TEXT_SIZE * 0.35
    y_text = ROT_REV_Y_TEXT_CENTER - baseline_fix
    
    for i, ch in enumerate(sid9):
        c.drawCentredString(ROT_REV_X_COLS[i], y_text, ch)
    
    # Burbujas (círculos rellenos)
    for i, ch in enumerate(sid9):
        digit = int(ch)
        x = ROT_REV_X_COLS[i] + ROT_REV_DX
        y = ROT_REV_Y_ROWS_BASE[digit] + ROT_REV_DY + ROT_REV_ROW_NUDGE.get(digit, 0.0)
        
        # Compensación para filas 2-9
        if digit >= 2:
            y += ROT_REV_Y_AFTER_2_COMP
        
        c.circle(x, y, ROT_REV_BUBBLE_RADIUS, stroke=0, fill=1)
    
    c.showPage()
    c.save()


# =============================================================================
# GENERADOR DE HOJA DE EXAMEN
# =============================================================================

def make_examen_overlay(overlay_path: str, page_w: float, page_h: float,
                        nombre: str, grado: str, sid9: str):
    """Genera el overlay para la hoja de examen"""
    print(f"    [DEBUG] make_examen_overlay: nombre={nombre}, grado={grado}, sid9={sid9}")
    
    c = canvas.Canvas(overlay_path, pagesize=(page_w, page_h))
    c.setFillColor(black)
    c.setStrokeColor(black)
    
    # NOMBRE
    print(f"    [DEBUG] Dibujando nombre...")
    draw_centered_in_box(
        c,
        EXAM_NAME_X_LEFT + EXAM_DX,
        EXAM_NAME_X_RIGHT + EXAM_DX,
        EXAM_NAME_Y_CENTER + EXAM_DY,
        nombre,
        EXAM_NAME_SIZE
    )
    
    # GRADO
    if grado:
        print(f"    [DEBUG] Dibujando grado...")
        draw_centered_at(
            c,
            EXAM_GRADE_X_CENTER + EXAM_DX,
            EXAM_GRADE_Y_CENTER + EXAM_DY,
            grado,
            EXAM_GRADE_SIZE
        )
    
    # ID - Texto
    print(f"    [DEBUG] Dibujando ID texto...")
    set_font(c, EXAM_ID_SIZE)
    baseline_fix = EXAM_ID_SIZE * 0.35
    y_text = (EXAM_MIP_DIGIT_Y + EXAM_DY) - baseline_fix
    
    for i, ch in enumerate(sid9):
        x = EXAM_MIP_COL_X[i] + EXAM_DX
        c.drawCentredString(x, y_text, ch)
    
    # ID - Burbujas
    print(f"    [DEBUG] Dibujando ID burbujas...")
    for i, ch in enumerate(sid9):
        d = int(ch)
        x = EXAM_MIP_COL_X[i] + EXAM_DX
        y = EXAM_MIP_ROW_Y[d] + EXAM_DY
        c.circle(x, y, EXAM_BUBBLE_RADIUS, stroke=0, fill=1)
    
    print(f"    [DEBUG] Guardando overlay...")
    c.showPage()
    c.save()
    print(f"    [DEBUG] ✓ Overlay guardado")


# =============================================================================
# FUNCIONES DE MERGE
# =============================================================================

def merge_overlay(template_pdf: str, overlay_pdf: str, out_pdf: str):
    """
    Combina un template PDF con un overlay
    
    IMPORTANTE: El overlay debe quedar ENCIMA del template para que sea visible.
    Método: página en blanco → template abajo → overlay encima
    """
    base = PdfReader(template_pdf)
    ov = PdfReader(overlay_pdf)
    writer = PdfWriter()
    
    # Crear página en blanco del tamaño correcto
    template_page = base.pages[0]
    w = float(template_page.mediabox.width)
    h = float(template_page.mediabox.height)
    
    # Crear página en blanco
    blank = writer.add_blank_page(width=w, height=h)
    
    # Agregar template como fondo
    blank.merge_page(template_page)
    
    # Agregar overlay ENCIMA
    blank.merge_page(ov.pages[0])
    
    with open(out_pdf, "wb") as f:
        writer.write(f)


def merge_two_pages(page1_pdf: str, page2_pdf: str, out_pdf: str):
    """Combina dos PDFs en un solo archivo de 2 páginas, normalizando a Carta"""
    from pypdf import Transformation
    
    LETTER_W = 612.0
    LETTER_H = 792.0
    
    writer = PdfWriter()
    
    pdf1 = PdfReader(page1_pdf)
    pdf2 = PdfReader(page2_pdf)
    
    # Función auxiliar para normalizar una página a Carta
    def normalize_to_letter(src_page):
        src_w = float(src_page.mediabox.width)
        src_h = float(src_page.mediabox.height)
        
        # Si ya es Carta, agregar directamente
        if abs(src_w - LETTER_W) < 1 and abs(src_h - LETTER_H) < 1:
            writer.add_page(src_page)
            return
        
        # Escalar y centrar
        scale = min(LETTER_W / src_w, LETTER_H / src_h)
        new_w = src_w * scale
        new_h = src_h * scale
        tx = (LETTER_W - new_w) / 2.0
        ty = (LETTER_H - new_h) / 2.0
        
        letter_page = writer.add_blank_page(width=LETTER_W, height=LETTER_H)
        letter_page.merge_transformed_page(
            src_page, 
            Transformation().scale(scale).translate(tx, ty)
        )
    
    # Normalizar y agregar ambas páginas
    normalize_to_letter(pdf1.pages[0])
    normalize_to_letter(pdf2.pages[0])
    
    with open(out_pdf, "wb") as f:
        writer.write(f)


# =============================================================================
# GENERADORES PRINCIPALES
# =============================================================================

def generar_hoja_rotacion(nombre: str, sid9: str, universidad: str, grado: str, idx: int) -> str:
    """Genera una hoja de rotación completa (anverso + reverso)"""
    
    # Leer dimensiones del template
    base_ans = PdfReader(TEMPLATE_ROTACION_ANS)
    page_ans = base_ans.pages[0]
    page_w = float(page_ans.mediabox.width)
    page_h = float(page_ans.mediabox.height)
    
    # Paths temporales
    overlay_ans = os.path.join(OUT_DIR_ROTACION, f"__overlay_ans_{idx}.pdf")
    overlay_rev = os.path.join(OUT_DIR_ROTACION, f"__overlay_rev_{idx}.pdf")
    temp_ans = os.path.join(OUT_DIR_ROTACION, f"__temp_ans_{idx}.pdf")
    temp_rev = os.path.join(OUT_DIR_ROTACION, f"__temp_rev_{idx}.pdf")
    
    # Generar overlays
    make_rotacion_anverso_overlay(overlay_ans, page_w, page_h, nombre, sid9, universidad, grado)
    make_rotacion_reverso_overlay(overlay_rev, sid9)
    
    # Merge con templates
    merge_overlay(TEMPLATE_ROTACION_ANS, overlay_ans, temp_ans)
    merge_overlay(TEMPLATE_ROTACION_REV, overlay_rev, temp_rev)
    
    # Combinar en un solo PDF
    out_name = f"{sanitize_filename(nombre)}_{sid9}_{sanitize_filename(grado)}.pdf"
    out_path = os.path.join(OUT_DIR_ROTACION, out_name)
    merge_two_pages(temp_ans, temp_rev, out_path)
    
    # Limpiar temporales
    for temp in [overlay_ans, overlay_rev, temp_ans, temp_rev]:
        try:
            os.remove(temp)
        except OSError:
            pass
    
    return out_path


def generar_hoja_examen(nombre: str, sid9: str, grado: str, idx: int) -> str:
    """Genera una hoja de examen"""
    
    print(f"  [DEBUG] Generando examen para: {nombre}")
    
    # Leer dimensiones del template
    base = PdfReader(TEMPLATE_EXAMEN)
    page = base.pages[0]
    page_w = float(page.mediabox.width)
    page_h = float(page.mediabox.height)
    
    print(f"  [DEBUG] Template: {page_w}x{page_h}")
    
    # Paths
    overlay_path = os.path.join(OUT_DIR_EXAMEN, f"__overlay_{idx}.pdf")
    out_name = f"{sanitize_filename(nombre)}_{sid9}_{sanitize_filename(grado)}.pdf"
    out_path = os.path.join(OUT_DIR_EXAMEN, out_name)
    
    print(f"  [DEBUG] Overlay path: {overlay_path}")
    print(f"  [DEBUG] Output path: {out_path}")
    
    # Generar overlay
    print(f"  [DEBUG] Generando overlay...")
    make_examen_overlay(overlay_path, page_w, page_h, nombre, grado, sid9)
    
    # Verificar que el overlay se creó
    if os.path.exists(overlay_path):
        print(f"  [DEBUG] ✓ Overlay creado: {os.path.getsize(overlay_path)} bytes")
    else:
        print(f"  [DEBUG] ✗ ERROR: Overlay NO se creó")
        return out_path
    
    # Merge
    print(f"  [DEBUG] Haciendo merge...")
    merge_overlay(TEMPLATE_EXAMEN, overlay_path, out_path)
    
    # Verificar que el output se creó
    if os.path.exists(out_path):
        print(f"  [DEBUG] ✓ Output creado: {os.path.getsize(out_path)} bytes")
    else:
        print(f"  [DEBUG] ✗ ERROR: Output NO se creó")
    
    # Limpiar temporal
    try:
        os.remove(overlay_path)
        print(f"  [DEBUG] ✓ Overlay temporal eliminado")
    except OSError as e:
        print(f"  [DEBUG] ⚠ No se pudo eliminar overlay: {e}")
    
    return out_path


# =============================================================================
# MAIN
# =============================================================================

def main():
    print("=" * 80)
    print("GENERADOR DE HOJAS DE EVALUACIÓN - Hospital Escandón")
    print("=" * 80)
    
    # Validar archivos requeridos
    required_files = [
        CSV_FILE,
        TEMPLATE_ROTACION_ANS,
        TEMPLATE_ROTACION_REV,
        TEMPLATE_EXAMEN
    ]
    
    missing = [f for f in required_files if not os.path.exists(f)]
    if missing:
        print("\n❌ ERROR: Faltan archivos:")
        for f in missing:
            print(f"   - {f}")
        return
    
    # Crear carpetas de salida
    os.makedirs(OUT_DIR_ROTACION, exist_ok=True)
    os.makedirs(OUT_DIR_EXAMEN, exist_ok=True)
    
    # Registrar fuente
    register_font()
    
    # Leer CSV
    delim = detect_delimiter(CSV_FILE)
    print(f"\n📄 Leyendo {CSV_FILE} (delimitador: '{delim}')")
    
    ok_rotacion = 0
    ok_examen = 0
    errores = 0
    
    with open(CSV_FILE, "r", encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f, delimiter=delim)
        
        # Validar columnas
        required_cols = {"NOMBRE", "ID", "GRADO", "UNIVERSIDAD"}
        headers = set(reader.fieldnames or [])
        
        if not required_cols.issubset(headers):
            print(f"\n❌ ERROR: El CSV debe tener columnas: {required_cols}")
            print(f"   Encontradas: {reader.fieldnames}")
            return
        
        print(f"✓ Columnas encontradas: {', '.join(reader.fieldnames)}")
        print("\n" + "─" * 80)
        print("Procesando estudiantes...")
        print("─" * 80)
        
        for idx, row in enumerate(reader, start=1):
            nombre = normalize_spaces(row.get("NOMBRE", ""))
            sid = only_digits(row.get("ID", ""))
            grado = normalize_spaces(row.get("GRADO", ""))
            universidad = normalize_spaces(row.get("UNIVERSIDAD", ""))
            
            # Validar datos
            if not nombre or not sid or not grado or not universidad:
                errores += 1
                print(f"[SKIP] Fila {idx}: datos incompletos")
                continue
            
            try:
                sid9 = validate_id(sid)
            except ValueError as e:
                errores += 1
                print(f"[ERROR] Fila {idx}: {e}")
                continue
            
            # Generar hojas
            try:
                # Hoja de rotación
                out_rot = generar_hoja_rotacion(
                    nombre, sid9, universidad, grado, idx
                )
                ok_rotacion += 1
                print(f"[✓] Rotación: {os.path.basename(out_rot)}")
                
                # Hoja de examen
                out_exam = generar_hoja_examen(nombre, sid9, grado, idx)
                ok_examen += 1
                print(f"[✓] Examen:   {os.path.basename(out_exam)}")
                
            except Exception as e:
                errores += 1
                print(f"[ERROR] {nombre}: {e}")
    
    # Resumen
    print("\n" + "=" * 80)
    print("RESUMEN")
    print("=" * 80)
    print(f"✓ Hojas de Rotación generadas: {ok_rotacion} → {OUT_DIR_ROTACION}/")
    print(f"✓ Hojas de Examen generadas:   {ok_examen} → {OUT_DIR_EXAMEN}/")
    
    if errores > 0:
        print(f"⚠️  Errores/omitidos: {errores}")
    
    print("\n⚠️  IMPORTANTE AL IMPRIMIR:")
    print("   - Tamaño real / 100% (SIN 'Ajustar a página')")
    print("   - Verificar alineación con hoja de prueba")
    print("=" * 80)


if __name__ == "__main__":
    main()