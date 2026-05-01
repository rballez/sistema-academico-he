@echo off
REM =============================================================================
REM scripts\build-python.bat
REM Crea (o reutiliza) un venv, instala dependencias y corre PyInstaller.
REM Compatible con Windows.
REM =============================================================================
setlocal

set ROOT=%~dp0..
set VENV=%ROOT%\.venv-build

echo ──────────────────────────────────────────────
echo  HE Académico — Build Python (PyInstaller)
echo  Directorio: %ROOT%
echo ──────────────────────────────────────────────

REM 1. Crear venv si no existe
if not exist "%VENV%" (
    echo ^ Creando entorno virtual en .venv-build ...
    python -m venv "%VENV%"
) else (
    echo ^ Reutilizando entorno virtual existente
)

REM 2. Activar venv
call "%VENV%\Scripts\activate.bat"

REM 3. Instalar/actualizar dependencias
echo ^ Instalando dependencias Python ...
pip install --quiet --upgrade pip
pip install --quiet pyinstaller
pip install --quiet -r "%ROOT%\requirements.txt"

REM 4. Correr PyInstaller
echo ^ Ejecutando PyInstaller ...
cd /d "%ROOT%"
pyinstaller server.spec --distpath python-dist --noconfirm --clean

REM 5. Desactivar venv
call deactivate

echo.
echo OK Listo. Ejecutable en: python-dist\server\server.exe
endlocal
