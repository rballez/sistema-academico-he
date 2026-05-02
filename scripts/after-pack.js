/**
 * scripts/after-pack.js — Hook afterPack de electron-builder
 *
 * 1. Firma binarios Python antes del sellado.
 * 2. Corrige el hash ElectronAsarIntegrity en Info.plist
 *    (bug de electron-builder 26.x que escribe un hash incorrecto).
 */

const { execSync } = require('child_process');
const path   = require('path');
const fs     = require('fs');
const crypto = require('crypto');

async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== 'darwin') return;

  const appName = packager.appInfo.productFilename;
  const appPath = path.join(appOutDir, `${appName}.app`);
  if (!fs.existsSync(appPath)) return;

  // ── 1. Firmar binarios Python ──────────────────────────────────────────────
  const pyDir = path.join(appPath, 'Contents', 'Resources', 'python-dist', 'server');
  if (fs.existsSync(pyDir)) {
    console.log('\n[afterPack] Firmando binarios Python antes del sellado …');
    try {
      execSync(
        `find "${pyDir}" \\( -name "*.dylib" -o -name "*.so" \\) -exec ` +
        `codesign --force --sign - --timestamp=none {} \\;`,
        { stdio: 'pipe' }
      );
      const serverExe = path.join(pyDir, 'server');
      if (fs.existsSync(serverExe)) {
        execSync(
          `codesign --force --sign - --timestamp=none "${serverExe}"`,
          { stdio: 'pipe' }
        );
      }
      console.log('[afterPack] Python server firmado ✓');
    } catch (e) {
      console.warn('[afterPack] Advertencia Python:', String(e.message || '').slice(0, 200));
    }
  }

  // ── 2. Corregir ElectronAsarIntegrity en Info.plist ───────────────────────
  const asarPath  = path.join(appPath, 'Contents', 'Resources', 'app.asar');
  const plistPath = path.join(appPath, 'Contents', 'Info.plist');

  if (fs.existsSync(asarPath) && fs.existsSync(plistPath)) {
    console.log('\n[afterPack] Corrigiendo ElectronAsarIntegrity en Info.plist …');
    const realHash = crypto.createHash('sha256')
      .update(fs.readFileSync(asarPath))
      .digest('hex');
    console.log(`[afterPack]   Hash real: ${realHash}`);

    let plistText = fs.readFileSync(plistPath, 'utf8');
    const hashRegex = /(<key>ElectronAsarIntegrity<\/key>[\s\S]*?<key>hash<\/key>\s*<string>)[^<]*/;
    if (hashRegex.test(plistText)) {
      plistText = plistText.replace(hashRegex, `$1${realHash}`);
      fs.writeFileSync(plistPath, plistText, 'utf8');
      console.log('[afterPack] Info.plist corregido ✓\n');
    }
  }
}

exports.default = afterPack;
