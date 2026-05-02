# HE Académico — BUG RESUELTO ✅
*Resuelto: 2026-05-01*

---

## Estado actual del problema

**La app funciona en dev, falla en packaged.** Crash inmediato antes de que corra ningún JS.

```bash
npx electron . --dev     # ✅ FUNCIONA — UI visible, Python arranca, DevTools abre
npx electron-builder --mac && open dist/...  # ❌ CRASH — trace trap, sin output
```

---

## Síntomas exactos

- **Señal:** `EXC_BREAKPOINT` / `SIGTRAP` / `brk 0` (aborto deliberado de V8)
- **Log:** `→ JS NO corrió` — `/tmp/he-log.txt` nunca se escribe
- **stderr:** Completamente vacío incluso con `ELECTRON_ENABLE_LOGGING=1 ELECTRON_ENABLE_STACK_DUMPING=1`
- **Crash report:** `v8::Context::FromSnapshot → v8::ObjectTemplate::SetHandler → ElectronMain@+116 → start`
- **Thread principal crashea:** CrBrowserMain con `brk 0` en V8/cppgc init
- **Otros threads:** Algunos `ThreadPoolForegroundWorker` con `(Instruction Abort) Translation fault`

---

## Entorno

- **macOS:** 26.4.1 (25E253) — Tahoe, Apple Silicon M1 MacBook Air
- **Electron:** 41.4.0
- **electron-builder:** 26.8.1
- **Arch:** arm64
- **Developer Mode:** habilitado (confirmado en crash report)
- **Certificado Apple:** NINGUNO — firma ad-hoc (`identityName=-`)

---

## Lo que se intentó y descartó

| Hipótesis | Resultado |
|-----------|-----------|
| `hardenedRuntime: false` (original) | ❌ sigue crasheando |
| `hardenedRuntime: true` + entitlements JIT | ❌ sigue crasheando |
| afterSign re-firma con `--options runtime` + entitlements | ❌ sigue crasheando |
| ASAR integrity hash incorrecto (electron-builder bug) | ❌ **fuse DISABLED** — nunca fue el crash |
| macOS Gatekeeper bloqueando | ❌ logs del kernel no muestran bloqueo a `HE Académico` |
| AMFI bloqueando por signing | No confirmado, pero signing no cambia el crash |
| V8 snapshot corrupto/diferente | ❌ MD5 idéntico entre original y packaged |
| Fuses diferentes entre original y packaged | ❌ bits idénticos en ambos |

---

## Hallazgos clave confirmados

### 1. Fuses de Electron (idénticos en original y packaged)
```
[0] RunAsNode:                              ENABLED  (0x31)
[1] EnableCookieEncryption:                 DISABLED (0x30)
[2] EnableNodeOptionsEnvironmentVariable:   ENABLED  (0x31)
[3] EnableNodeCliInspectArguments:          ENABLED  (0x31)
[4] EnableEmbeddedAsarIntegrityValidation:  DISABLED (0x30)  ← ASAR hash no se valida
[5] OnlyLoadAppFromAsar:                    DISABLED (0x30)
[6] LoadBrowserProcessSpecificV8Snapshot:   DISABLED (0x30)
[7] GrantFileProtocolExtraPrivileges:       ENABLED  (0x31)
[8] EnableNodeCliInspectArguments2:         ENABLED  (0x31)
```

### 2. Recursos idénticos entre original y packaged
- `v8_context_snapshot.arm64.bin`: MD5 idéntico, mismo tamaño (715208 bytes)
- Frameworks: mismos archivos
- Diferencia de tamaño del framework binary (1MB): solo la firma más pequeña

### 3. El ElectronAsarIntegrity hash ESTABA incorrecto (bug de electron-builder)
- Info.plist guardaba: `fef0ab5d...`
- ASAR real: `9df0cf65...`
- Ya se corrigió en `afterPack.js` pero NO era el crash real

### 4. Sin output de ningún tipo en packaged
- `ELECTRON_ENABLE_LOGGING=1` no produce nada
- El crash es antes de que Chromium inicialice su sistema de logging
- Esto apunta al inicio ABSOLUTO de ElectronMain

---

## Diferencias reales entre dev y packaged (no descartadas aún)

1. **Nombre del ejecutable con UTF-8**: En dev = `Electron`, en packaged = `HE Académico` (contiene `é` U+00E9)
2. **Bundle ID**: Dev = `com.github.Electron`, Packaged = `mx.hospitalEscandon.academico`
3. **Firma**: Dev = Apple Developer ID de GitHub, Packaged = ad-hoc (`-`)
4. **ASAR**: Dev sin ASAR (archivos sueltos), Packaged con `app.asar`

---

## Hipótesis más probable sin confirmar

### → Caracter `é` en el nombre del ejecutable/bundle

El ejecutable se llama `HE Académico` (con `é` U+00E9). En macOS 26, si hay
una regresión en cómo Chromium/V8 maneja paths con UTF-8 no-ASCII en las
primeras líneas de `ElectronMain`, causaría exactamente este crash antes
de que el logging esté disponible.

**Test inmediato:** Cambiar `productName` en `package.json` a `"HE Academico"`
(sin acento) y reconstruir. Si funciona, el bug es el caracter UTF-8.

---

## Estado actual de archivos modificados

### `package.json` (build config actual)
```json
"afterPack": "./scripts/after-pack.js",
"mac": {
  "hardenedRuntime": false,
  "gatekeeperAssess": false
  // sin entitlements, sin afterSign
}
```

### `scripts/after-pack.js` (modificado)
Hace dos cosas:
1. Firma binarios Python con `codesign --sign -`
2. Corrige el hash `ElectronAsarIntegrity` en `Info.plist` (bug de electron-builder)

### `scripts/after-sign.js` (creado, actualmente NO usado)
Re-firma todo el bundle con entitlements JIT. Fue creado para el hipótesis
de permisos JIT, pero no resolvió el crash.

---

## Siguiente paso recomendado

**Test 1 — Nombre ASCII (más probable que resuelva):**
```bash
# En package.json cambiar:
# "productName": "HE Académico"  →  "productName": "HE Academico"
cd ~/Desktop/HE-APP
rm -rf dist
npx electron-builder --mac
xattr -cr "dist/mac-arm64/HE Academico.app"
open "dist/mac-arm64/HE Academico.app"
```

**Test 2 — Si el nombre no es el problema, descartar ASAR completamente:**
```json
// En package.json build:
"asar": false
```
Si sin ASAR funciona → bug específico de cómo Electron 41 carga el ASAR en packaged.

**Test 3 — Si todo lo anterior falla, downgrade de Electron:**
```bash
rm -rf node_modules package-lock.json
npm install --save-dev electron@36 electron-builder@26
npx electron-builder --mac
```

---

## Estructura del proyecto

```
HE-APP/
├── app/
│   ├── main.js          # Proceso principal Electron
│   ├── preload.js       # contextBridge (IPC seguro)
│   ├── renderer.js      # UI
│   ├── index.html
│   └── styles.css
├── python/
│   └── server.py        # Backend Python (stdio IPC)
├── python-dist/
│   └── server/          # PyInstaller bundle (binario nativo)
├── db/
│   └── schema.sql
├── assets/
│   ├── icons/
│   └── logos/
├── build/
│   └── entitlements.mac.plist  # JIT + filesystem entitlements
├── scripts/
│   ├── after-pack.js    # Hook: firma Python + corrige ASAR hash
│   ├── after-sign.js    # Hook: re-firma con entitlements (INACTIVO)
│   └── build-python.sh
└── package.json
```

## Arquitectura de la app

- Electron 41 (main process) ↔ Python server (stdin/stdout JSON IPC)
- Renderer (index.html + renderer.js) ↔ main via contextBridge/IPC
- DB: SQLite en `~/.hospital_escandon/academico.db`
- App de gestión académica para Hospital Escandón (residentes médicos)
