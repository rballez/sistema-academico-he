/**
 * scripts/after-sign.js — Hook afterSign de electron-builder
 *
 * ── POR QUÉ ESTE HOOK ────────────────────────────────────────────────────────
 *
 * En macOS 26 (Tahoe), V8/Chromium requiere entitlements JIT válidos incluso
 * con firma ad-hoc. electron-builder firma el bundle con `-` (ad-hoc) pero
 * en la práctica no embebe los entitlements en todos los binarios internos
 * del Electron Framework, lo que causa que V8 falle al inicializar con
 * EXC_BREAKPOINT / SIGTRAP antes de que corra ningún JS.
 *
 * Este hook re-firma TODOS los componentes del bundle en el orden correcto:
 *   1. dylibs y .so sueltos
 *   2. Helper .app bundles
 *   3. Electron Framework.framework
 *   4. El .app principal
 *
 * Así macOS 26 reconoce los entitlements y V8 puede mapear memoria JIT.
 */

const { execSync } = require('child_process');
const path = require('path');
const fs   = require('fs');

async function afterSign(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);

  if (!fs.existsSync(appPath)) {
    console.warn('[afterSign] .app no encontrado:', appPath);
    return;
  }

  const entitlements = path.join(__dirname, '..', 'build', 'entitlements.mac.plist');
  if (!fs.existsSync(entitlements)) {
    console.warn('[afterSign] entitlements.mac.plist no encontrado, saltando re-firma');
    return;
  }

  console.log('\n[afterSign] Re-firmando bundle con entitlements JIT (macOS 26+) …');

  const SIGN_OPTS = `--force --sign - --entitlements "${entitlements}" --options runtime --timestamp=none`;

  const signOne = (target) => {
    try {
      execSync(`codesign ${SIGN_OPTS} "${target}"`, { stdio: 'pipe' });
      console.log(`  ✓ ${path.basename(target)}`);
    } catch (e) {
      console.warn(`  ⚠ ${path.basename(target)}: ${String(e.stderr || e.message).slice(0, 120)}`);
    }
  };

  // 1. dylibs y .so sueltos (no dentro de sub-bundles)
  try {
    execSync(
      `find "${appPath}" \\( -name "*.dylib" -o -name "*.so" \\) -not -path "*/\\.app/*" ` +
      `-exec codesign ${SIGN_OPTS} {} \\;`,
      { stdio: 'pipe' }
    );
    console.log('  ✓ dylibs / .so');
  } catch (_) {}

  // 2. Helper .app bundles (orden: GPU, Renderer, Plugin, principal)
  const frameworksDir = path.join(appPath, 'Contents', 'Frameworks');
  if (fs.existsSync(frameworksDir)) {
    const helpers = fs.readdirSync(frameworksDir)
      .filter(f => f.endsWith('.app'))
      .sort(); // GPU < Plugin < Renderer < (main) — orden alfabético funciona
    for (const helper of helpers) {
      signOne(path.join(frameworksDir, helper));
    }
  }

  // 3. Electron Framework.framework
  const framework = path.join(frameworksDir, 'Electron Framework.framework');
  if (fs.existsSync(framework)) {
    signOne(framework);
  }

  // 4. El .app principal
  signOne(appPath);

  console.log('[afterSign] Re-firma completa ✓\n');
}

module.exports = exports.default = afterSign;
