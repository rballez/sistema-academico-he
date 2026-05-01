-- =============================================================================
-- ESQUEMA DE BASE DE DATOS — Sistema de Gestión Académica Hospital Escandón
-- =============================================================================
-- Versión: 1.0  |  Licencia: GPL-3.0
-- =============================================================================

PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- -----------------------------------------------------------------------------
-- 1. CONFIGURACIÓN DEL SISTEMA
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS configuracion (
    clave   TEXT PRIMARY KEY,
    valor   TEXT NOT NULL
);

INSERT OR IGNORE INTO configuracion VALUES
    ('ciclo_actual',     '2026-1'),
    ('tema',             'oscuro'),
    ('primer_inicio',    '1'),
    ('version_db',       '1');

-- -----------------------------------------------------------------------------
-- 2. UNIVERSIDADES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS universidades (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    codigo      TEXT    NOT NULL UNIQUE,   -- código corto (LSC, ANN, ...)
    nombre      TEXT    NOT NULL,
    ccc         TEXT    NOT NULL,          -- 3 dígitos para MIP ID
    logo_path   TEXT,                      -- ruta relativa al logo
    activa      INTEGER NOT NULL DEFAULT 1
);

INSERT OR IGNORE INTO universidades (codigo, nombre, ccc, logo_path) VALUES
    ('LSC', 'La Salle CDMX',        '050', 'assets/logos/lasalle_cdmx.png'),
    ('LSV', 'La Salle Victoria',    '051', 'assets/logos/lasalle_victoria.png'),
    ('ANS', 'Anáhuac Sur',          '020', 'assets/logos/anahuac_sur.png'),
    ('ANN', 'Anáhuac Norte',        '021', 'assets/logos/anahuac_norte.png'),
    ('IPN', 'IPN',                  '210', 'assets/logos/ipn.png'),
    ('UNA', 'UNAM',                 '290', 'assets/logos/unam.png'),
    ('UNS', 'UNSA',                 '740', 'assets/logos/unsa.png'),
    ('MON', 'MONTRER',              '360', 'assets/logos/montrer.png'),
    ('WST', 'Westhill',             '540', 'assets/logos/westhill.png'),
    ('SLK', 'Saint Luke',           '910', 'assets/logos/saint_luke.png'),
    ('TOM', 'Tominaga Nakamoto',    '430', 'assets/logos/tominaga.png'),
    ('UAH', 'UAEH',                 '760', 'assets/logos/uaeh.png'),
    ('OTR', 'Otros',                '650', 'assets/logos/otros.png'),
    ('EXT', 'Extranjeros',          '940', 'assets/logos/extranjeros.png'),
    ('INT', 'Intercambio',          '652', 'assets/logos/intercambio.png');

-- -----------------------------------------------------------------------------
-- 3. CONTROL DE IDs (DDD = 3 dígitos secuenciales por universidad)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ddd_usados (
    universidad_id  INTEGER NOT NULL REFERENCES universidades(id),
    ddd             TEXT    NOT NULL CHECK(length(ddd)=3),
    mip_id          TEXT    NOT NULL,
    PRIMARY KEY (universidad_id, ddd)
);

CREATE TABLE IF NOT EXISTS ddd_prohibidos (
    ddd TEXT PRIMARY KEY
);
-- Números con connotaciones negativas o ambiguos
INSERT OR IGNORE INTO ddd_prohibidos VALUES ('000'),('666'),('069'),('420');

-- -----------------------------------------------------------------------------
-- 4. ALUMNOS ACTIVOS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alumnos (
    mip_id          TEXT    PRIMARY KEY,           -- AABCCCDDD (9 chars)
    ap_paterno      TEXT    NOT NULL,
    ap_materno      TEXT    NOT NULL DEFAULT '',
    nombres         TEXT    NOT NULL,
    nombre_completo TEXT    GENERATED ALWAYS AS (
                        ap_paterno || ' ' || ap_materno || ' ' || nombres
                    ) VIRTUAL,
    universidad_id  INTEGER NOT NULL REFERENCES universidades(id),
    grado           TEXT    NOT NULL CHECK(grado IN ('MIP 1','MIP 2')),
    ciclo_ingreso   TEXT    NOT NULL,
    fecha_registro  TEXT    NOT NULL DEFAULT (datetime('now')),
    activo          INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_alumnos_universidad ON alumnos(universidad_id);
CREATE INDEX IF NOT EXISTS idx_alumnos_grado       ON alumnos(grado);

-- -----------------------------------------------------------------------------
-- 5. EGRESADOS (histórico)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS egresados (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    mip_id          TEXT    NOT NULL,
    ap_paterno      TEXT    NOT NULL,
    ap_materno      TEXT    NOT NULL DEFAULT '',
    nombres         TEXT    NOT NULL,
    universidad_id  INTEGER REFERENCES universidades(id),
    ciclo_egreso    TEXT    NOT NULL,
    fecha_egreso    TEXT    NOT NULL DEFAULT (datetime('now'))
);

-- -----------------------------------------------------------------------------
-- 6. ROTACIONES RAW (datos crudos de ZipGrade — CSV con coma)
-- Columnas ZipGrade: Quiz Name, Student First Name, Student Last Name,
--                    Student ID, Earned Points, Paper Timestamp, Key Version
-- Key Version: C=Cirugía M=Med.Interna U=Urgencias P=Pediatría F=Familiar G=GyO
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS rotaciones_raw (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id      TEXT    NOT NULL,
    earned_points   REAL    NOT NULL,
    paper_timestamp TEXT    NOT NULL,
    key_version     TEXT    NOT NULL,
    materia         TEXT    NOT NULL,   -- derivado de key_version
    ciclo           TEXT    NOT NULL,
    importacion_id  INTEGER REFERENCES historial_importaciones(id),
    estado          TEXT    NOT NULL DEFAULT 'activo'
                    CHECK(estado IN ('activo','ignorado','duplicado')),
    notas           TEXT
);

CREATE INDEX IF NOT EXISTS idx_rot_raw_student ON rotaciones_raw(student_id);
CREATE INDEX IF NOT EXISTS idx_rot_raw_materia  ON rotaciones_raw(materia);

-- -----------------------------------------------------------------------------
-- 7. EXÁMENES RAW (datos crudos de ZipGrade — CSV con punto y coma)
-- Columnas ZipGrade: Student ID;Earned Points;Percent Correct;
--                    Student First Name;Student Last Name;External Ref
-- External Ref: MIP 1 / MIP 2
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS examenes_raw (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id      TEXT    NOT NULL,
    earned_points   REAL    NOT NULL,
    percent_correct REAL,
    grado_ref       TEXT,               -- MIP 1 / MIP 2 de External Ref
    materia         TEXT    NOT NULL,   -- preguntado al importar
    tipo_examen     TEXT    NOT NULL CHECK(tipo_examen IN ('parcial','final','remedial','troncal')),
    ciclo           TEXT    NOT NULL,
    importacion_id  INTEGER REFERENCES historial_importaciones(id)
);

CREATE INDEX IF NOT EXISTS idx_exam_raw_student ON examenes_raw(student_id);
CREATE INDEX IF NOT EXISTS idx_exam_raw_materia  ON examenes_raw(materia, tipo_examen);

-- -----------------------------------------------------------------------------
-- 8. CALIFICACIONES CALCULADAS (por alumno por materia)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS calificaciones (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    mip_id          TEXT    NOT NULL REFERENCES alumnos(mip_id),
    materia         TEXT    NOT NULL,
    ciclo           TEXT    NOT NULL,

    -- Componentes (0-100 absoluto)
    cal_rotacion    REAL,               -- promedio de rotaciones_raw activas
    cal_parcial     REAL,               -- MAX de examenes parciales
    cal_final       REAL,               -- MAX de examenes finales
    cal_entregas    REAL,               -- rúbrica manual (0-100)
    extra_puntos    REAL DEFAULT 0,     -- puntos extra del examen

    -- Ponderado
    cal_ponderada   REAL GENERATED ALWAYS AS (
        COALESCE(cal_rotacion,0)*0.60 +
        COALESCE(cal_parcial,0)*0.10 +
        COALESCE(cal_final,0)*0.15 +
        COALESCE(cal_entregas,0)*0.15
    ) VIRTUAL,

    -- Rúbrica entregas (emoji referencia)
    rubrica_entregas TEXT,  -- 'excelente'|'bien'|'decente'|'deficiente'|'no_participa'

    ultima_actualizacion TEXT DEFAULT (datetime('now')),
    UNIQUE(mip_id, materia, ciclo)
);

CREATE INDEX IF NOT EXISTS idx_cal_mip     ON calificaciones(mip_id);
CREATE INDEX IF NOT EXISTS idx_cal_materia ON calificaciones(materia);

-- -----------------------------------------------------------------------------
-- 9. HISTORIAL DE IMPORTACIONES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS historial_importaciones (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tipo            TEXT    NOT NULL,   -- 'rotaciones'|'examenes'|'alumnos_csv'
    archivo_nombre  TEXT    NOT NULL,
    archivo_hash    TEXT,               -- SHA256 para detectar re-importaciones
    ciclo           TEXT,
    materia         TEXT,
    tipo_examen     TEXT,
    registros_total INTEGER DEFAULT 0,
    registros_ok    INTEGER DEFAULT 0,
    registros_skip  INTEGER DEFAULT 0,
    registros_dup   INTEGER DEFAULT 0,
    fecha           TEXT    NOT NULL DEFAULT (datetime('now')),
    notas           TEXT
);

-- -----------------------------------------------------------------------------
-- 10. ALERTAS DE DUPLICADOS PENDIENTES
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS alertas_duplicados (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    student_id      TEXT    NOT NULL,
    materia         TEXT    NOT NULL,
    rot_id_1        INTEGER REFERENCES rotaciones_raw(id),
    rot_id_2        INTEGER REFERENCES rotaciones_raw(id),
    diferencia_dias REAL    NOT NULL,
    estado          TEXT    NOT NULL DEFAULT 'pendiente'
                    CHECK(estado IN ('pendiente','resuelta','ignorada')),
    resolucion      TEXT,
    fecha_creacion  TEXT    NOT NULL DEFAULT (datetime('now')),
    fecha_resolucion TEXT
);
