#!/usr/bin/env bash
# =============================================================================
# scripts/build-python.sh
# Crea (o reutiliza) un venv, instala dependencias y corre PyInstaller.
# En macOS también genera icon.icns desde icon.png si no existe.
# Compatible con macOS, Linux.
# =============================================================================
set -e  # salir si cualquier comando falla

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$ROOT/.venv-build"
ICON_PNG="$ROOT/assets/icons/icon.png"
ICON_ICNS="$ROOT/assets/icons/icon.icns"

echo "──────────────────────────────────────────────"
echo " HE Académico — Build Python (PyInstaller)"
echo " Directorio: $ROOT"
echo "──────────────────────────────────────────────"

# ── Generar icon.icns en macOS si no existe ─────────────────────────────────
if [[ "$(uname)" == "Darwin" ]] && [ ! -f "$ICON_ICNS" ]; then
  echo "▶ Generando icon.icns desde icon.png …"
  TMP="$ROOT/tmp_iconset.iconset"
  mkdir -p "$TMP"
  for size in 16 32 64 128 256 512; do
    sips -z $size $size "$ICON_PNG" --out "$TMP/icon_${size}x${size}.png"     > /dev/null
    sips -z $((size*2)) $((size*2)) "$ICON_PNG" --out "$TMP/icon_${size}x${size}@2x.png" > /dev/null
  done
  iconutil -c icns "$TMP" -o "$ICON_ICNS"
  rm -rf "$TMP"
  echo "   ✓ icon.icns creado"
fi

# 1. Crear venv si no existe
if [ ! -d "$VENV" ]; then
  echo "▶ Creando entorno virtual en .venv-build …"
  python3 -m venv "$VENV"
else
  echo "▶ Reutilizando entorno virtual existente"
fi

# 2. Activar venv
source "$VENV/bin/activate"

# 3. Instalar/actualizar dependencias
echo "▶ Instalando dependencias Python …"
pip install --quiet --upgrade pip
pip install --quiet pyinstaller
pip install --quiet -r "$ROOT/requirements.txt"

# 4. Correr PyInstaller
echo "▶ Ejecutando PyInstaller …"
cd "$ROOT"
pyinstaller server.spec --distpath python-dist --noconfirm --clean

# 5. Desactivar venv
deactivate

echo ""
echo "✅ Listo. Ejecutable en: python-dist/server/server"
