#!/usr/bin/env python3
"""
=============================================================================
DB.PY — Capa de base de datos SQLite
Sistema de Gestión Académica — Hospital Escandón
=============================================================================
"""

import sqlite3
import os
import pathlib

# Ruta de la base de datos (en la carpeta de datos del usuario o local)
def get_db_path():
    """Retorna la ruta de la base de datos."""
    if os.environ.get('HE_DB_PATH'):
        return os.environ['HE_DB_PATH']
    # Buscar carpeta de datos según SO
    home = pathlib.Path.home()
    data_dir = home / '.hospital_escandon'
    data_dir.mkdir(exist_ok=True)
    return str(data_dir / 'academico.db')


def get_schema_path():
    """Retorna la ruta del schema SQL.

    Soporta tres escenarios:
      1. PyInstaller frozen bundle  → sys._MEIPASS/db/schema.sql
      2. Desarrollo normal          → <repo>/db/schema.sql
      3. Fallback                   → mismo directorio del script
    """
    import sys as _sys
    if getattr(_sys, 'frozen', False):
        # Ejecutable generado por PyInstaller; los datas se extraen en _MEIPASS
        base = pathlib.Path(_sys._MEIPASS)
    else:
        # Script normal: __file__ es python/db.py → subir un nivel al repo
        base = pathlib.Path(__file__).resolve().parent.parent

    candidates = [
        base / 'db' / 'schema.sql',
        pathlib.Path(__file__).resolve().parent / 'schema.sql',
    ]
    for c in candidates:
        if c.exists():
            return str(c)
    raise FileNotFoundError(
        f"No se encontró schema.sql. Buscado en: {[str(c) for c in candidates]}"
    )


def get_connection() -> sqlite3.Connection:
    """Retorna una conexión a la BD con row_factory configurado."""
    db_path = get_db_path()
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    return conn


def init_db():
    """Inicializa la base de datos con el schema si no existe, y aplica migraciones."""
    schema_path = get_schema_path()
    conn = get_connection()
    with open(schema_path, 'r', encoding='utf-8') as f:
        schema = f.read()
    conn.executescript(schema)
    conn.commit()

    # ── MIGRACIÓN: ampliar CHECK de tipo_examen para incluir remedial y troncal ──
    # SQLite no permite ALTER TABLE para modificar CHECK constraints, así que
    # se recrea la tabla si sigue con la restricción original ('parcial','final').
    try:
        row = conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name='examenes_raw'"
        ).fetchone()
        if row and "'parcial','final'" in row['sql'] and "'remedial'" not in row['sql']:
            conn.executescript("""
                PRAGMA foreign_keys = OFF;
                ALTER TABLE examenes_raw RENAME TO _examenes_raw_bak;
                CREATE TABLE examenes_raw (
                    id              INTEGER PRIMARY KEY AUTOINCREMENT,
                    student_id      TEXT    NOT NULL,
                    earned_points   REAL    NOT NULL,
                    percent_correct REAL,
                    grado_ref       TEXT,
                    materia         TEXT    NOT NULL,
                    tipo_examen     TEXT    NOT NULL
                                    CHECK(tipo_examen IN ('parcial','final','remedial','troncal')),
                    ciclo           TEXT    NOT NULL,
                    importacion_id  INTEGER REFERENCES historial_importaciones(id)
                );
                INSERT INTO examenes_raw SELECT * FROM _examenes_raw_bak;
                DROP TABLE _examenes_raw_bak;
                CREATE INDEX IF NOT EXISTS idx_exam_raw_student ON examenes_raw(student_id);
                CREATE INDEX IF NOT EXISTS idx_exam_raw_materia  ON examenes_raw(materia, tipo_examen);
                PRAGMA foreign_keys = ON;
            """)
            conn.commit()
    except Exception as e:
        import sys
        print(f"[DB] Advertencia en migración tipo_examen: {e}", file=sys.stderr)

    # ── MIGRACIÓN: corregir códigos CCC de universidades ──
    # Los CCC definen los 3 dígitos del MIP ID. Esta migración los actualiza
    # a los valores oficiales usando UPDATE OR IGNORE (seguro en cualquier BD).
    try:
        ccc_correctos = [
            ('LSC', '050'), ('LSV', '051'), ('ANS', '020'), ('ANN', '021'),
            ('IPN', '210'), ('UNA', '290'), ('UNS', '740'), ('MON', '360'),
            ('WST', '540'), ('SLK', '910'), ('TOM', '430'), ('UAH', '760'),
            ('OTR', '650'), ('EXT', '940'), ('INT', '652'),
        ]
        for codigo, ccc in ccc_correctos:
            conn.execute("UPDATE universidades SET ccc=? WHERE codigo=?", (ccc, codigo))
        conn.commit()
    except Exception as e:
        import sys
        print(f"[DB] Advertencia en migración CCC: {e}", file=sys.stderr)

    conn.close()
    return get_db_path()


def get_config(clave: str, default=None):
    """Lee un valor de configuración."""
    conn = get_connection()
    row = conn.execute(
        "SELECT valor FROM configuracion WHERE clave = ?", (clave,)
    ).fetchone()
    conn.close()
    return row['valor'] if row else default


def set_config(clave: str, valor: str):
    """Guarda un valor de configuración."""
    conn = get_connection()
    conn.execute(
        "INSERT OR REPLACE INTO configuracion (clave, valor) VALUES (?, ?)",
        (clave, str(valor))
    )
    conn.commit()
    conn.close()


def get_ciclo_actual() -> str:
    return get_config('ciclo_actual', '2026-1')


def rows_to_list(rows) -> list:
    """Convierte rows de sqlite3 a lista de dicts."""
    return [dict(r) for r in rows]
