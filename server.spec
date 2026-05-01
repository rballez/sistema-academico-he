# -*- mode: python ; coding: utf-8 -*-
"""
server.spec — PyInstaller spec para HE Académico
Genera un ejecutable nativo que incluye Python + todas las dependencias.
No se requiere Python instalado en el equipo del usuario final.

Uso:
    pyinstaller server.spec

Salida: python-dist/server/  (referenciada por electron-builder como extraResources)
"""

import sys
from pathlib import Path

block_cipher = None

# ── Rutas base ──────────────────────────────────────────────────────────────────
ROOT   = Path(SPECPATH)          # directorio donde está este .spec
PY_DIR = ROOT / 'python'
DB_DIR = ROOT / 'db'

a = Analysis(
    [str(PY_DIR / 'server.py')],
    pathex=[str(PY_DIR)],
    binaries=[],
    datas=[
        # schema.sql se copia a db/ dentro del bundle → db.py lo busca ahí
        (str(DB_DIR / 'schema.sql'), 'db'),
    ],
    hiddenimports=[
        # módulos locales importados dinámicamente en server.py
        'db',
        'gestionar_alumnos',
        'importar_zipgrade',
        'calcular_calificaciones',
        'registro_manual',
        'generar_reportes',
        'generar_hojas_wrapper',
        'generar_hojas',
        # dependencias de terceros que PyInstaller puede no detectar
        'openpyxl',
        'openpyxl.styles',
        'openpyxl.utils',
        'reportlab',
        'reportlab.lib',
        'reportlab.lib.pagesizes',
        'reportlab.lib.styles',
        'reportlab.lib.units',
        'reportlab.platypus',
        'pypdf',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # excluir lo que definitivamente no se usa para reducir tamaño
        'tkinter',
        'matplotlib',
        'numpy',
        'pandas',
        'scipy',
        'PIL',
        'PyQt5',
        'wx',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='server',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,            # stdin/stdout IPC requiere consola
    disable_windowed_traceback=False,
    argv_emulation=False,    # sólo aplica a macOS .app bundles
    target_arch=None,        # None = arquitectura del host; en CI se puede forzar
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='server',
)
