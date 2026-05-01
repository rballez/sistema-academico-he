#!/usr/bin/env bash
# =============================================================================
# scripts/build-python.sh
# Crea (o reutiliza) un venv, instala dependencias y corre PyInstaller.
# Compatible con macOS, Linux.
# =============================================================================
set -e  # salir si cualquier comando falla

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="$ROOT/.venv-build"

echo "──────────────────────────────────────────────"
echo " HE Académico — Build Python (PyInstaller)"
echo " Directorio: $ROOT"
echo "──────────────────────────────────────────────"

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
