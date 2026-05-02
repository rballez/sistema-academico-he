/**
 * =============================================================================
 * MAIN.JS — Proceso principal de Electron
 * Sistema de Gestión Académica — Hospital Escandón
 * =============================================================================
 */

const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme } = require('electron');
const path  = require('path');
const { spawn } = require('child_process');
const fs    = require('fs');
const os    = require('os');
const crypto = require('crypto');

// ── Log de diagnóstico temprano ───────────────────────────────────────────────
// Escribe en /tmp/he-log.txt para saber si main.js llega a correr en el
// .app compilado. Se puede borrar cuando la app esté estable.
try {
  const _logPath = require('path').join(require('os').tmpdir(), 'he-log.txt');
  const _logLine = `[${new Date().toISOString()}] main.js cargado. isPackaged=${app.isPackaged ?? '?'} pid=${process.pid}\n`;
  require('fs').appendFileSync(_logPath, _logLine);
} catch (_) {}

const IS_DEV  = process.argv.includes('--dev');
const APP_DIR = path.join(__dirname, '..');
const PY_DIR  = path.join(APP_DIR, 'python');
const DB_DIR  = path.join(os.homedir(), '.hospital_escandon');

/** Busca Python del sistema (solo en modo dev). */
function getPythonPath() {
  const candidates = process.platform === 'win32'
    ? ['python', 'python3']
    : ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', '/usr/bin/python3', 'python3', 'python'];

  for (const c of candidates) {
    try {
      require('child_process').execFileSync(c, ['--version'], { timeout: 2000 });
      return c;
    } catch (_) {}
  }
  return 'python3';
}

/**
 * Devuelve la ruta al ejecutable Python bundled por PyInstaller.
 * En producción está en resources/python-dist/server/server[.exe].
 */
function getBundledPythonExe() {
  const exeName = process.platform === 'win32' ? 'server.exe' : 'server';
  return path.join(process.resourcesPath, 'python-dist', 'server', exeName);
}

let pyProcess = null;
let pendingCallbacks = new Map(); 

function startPython() {
  let pyCmd, pyArgs, pyCwd;

  if (app.isPackaged) {
    // ── PRODUCCIÓN: usar el ejecutable nativo generado por PyInstaller ──────
    pyCmd  = getBundledPythonExe();
    pyArgs = [];
    pyCwd  = path.dirname(pyCmd);
    console.log(`[Electron] Python bundled: ${pyCmd}`);

    // Verificar que el ejecutable exista antes de intentar arrancarlo
    if (!fs.existsSync(pyCmd)) {
      console.error(`[Electron] ERROR: No se encontró el ejecutable Python en ${pyCmd}`);
      // Mostrar diálogo de error al usuario
      app.whenReady().then(() => {
        dialog.showErrorBox(
          'Error de inicio',
          `No se encontró el componente Python del sistema.\nRuta esperada: ${pyCmd}\n\nIntenta reinstalar la aplicación.`
        );
        app.quit();
      });
      return;
    }
  } else {
    // ── DESARROLLO: usar Python del sistema con server.py ───────────────────
    pyCmd  = getPythonPath();
    pyArgs = [path.join(PY_DIR, 'server.py')];
    pyCwd  = PY_DIR;
    console.log(`[Electron] Python dev: ${pyCmd} ${pyArgs[0]}`);
  }

  pyProcess = spawn(pyCmd, pyArgs, {
    cwd: pyCwd,
    env: { ...process.env, HE_DB_PATH: path.join(DB_DIR, 'academico.db') },
  });

  let buffer = '';

  pyProcess.stdout.on('data', (data) => {
    buffer += data.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop(); 

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        const cb  = pendingCallbacks.get(msg.id);
        if (cb) {
          pendingCallbacks.delete(msg.id);
          if (msg.ok) cb.resolve(msg.data);
          else        cb.reject(new Error(msg.error || 'Error Python'));
        }
      } catch (e) {
        console.error('[Python stdout parse error]', trimmed, e.message);
      }
    }
  });

  pyProcess.stderr.on('data', (d) => {
    const msg = d.toString().trim();
    if (msg) console.log(`[Python] ${msg}`);
  });

  pyProcess.on('close', (code) => {
    console.log(`[Python] proceso terminó con código ${code}`);
    pyProcess = null;
  });

  pyProcess.on('error', (err) => {
    console.error('[Python] Error al iniciar:', err);
    for (const [id, cb] of pendingCallbacks) {
      cb.reject(new Error(`Python no disponible: ${err.message}`));
    }
    pendingCallbacks.clear();
  });
}

function callPython(action, payload = {}) {
  return new Promise((resolve, reject) => {
    if (!pyProcess) {
      return reject(new Error('Python no está corriendo'));
    }
    const id  = crypto.randomUUID();
    const msg = JSON.stringify({ id, action, payload }) + '\n';

    pendingCallbacks.set(id, { resolve, reject });

    setTimeout(() => {
      if (pendingCallbacks.has(id)) {
        pendingCallbacks.delete(id);
        reject(new Error(`Timeout en acción: ${action}`));
      }
    }, 30000);

    pyProcess.stdin.write(msg);
  });
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1000,
    minHeight: 650,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
    },
    icon: path.join(APP_DIR, 'assets', 'icons', 'icon.png'),
    show: false,
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (IS_DEV) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

ipcMain.handle('py:call', async (_evt, action, payload) => {
  try {
    const data = await callPython(action, payload);
    return { ok: true, data };
  } catch (err) {
    console.error(`[IPC] Error en ${action}:`, err.message);
    return { ok: false, error: err.message };
  }
});

ipcMain.handle('dialog:openCSV', async (_evt, title = 'Seleccionar CSV') => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const filePath = result.filePaths[0];
  const content  = fs.readFileSync(filePath, 'utf-8');
  return { path: filePath, name: path.basename(filePath), content };
});

ipcMain.handle('dialog:saveCSV', async (_evt, contenido, defaultName) => {
  const result = await dialog.showSaveDialog(mainWindow, {
    defaultPath: defaultName || 'ejemplo.csv',
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (result.canceled) return null;
  fs.writeFileSync(result.filePath, contenido, 'utf-8');
  return result.filePath;
});

// NUEVO: Permite elegir carpetas
ipcMain.handle('dialog:openDirectory', async (_evt, title = 'Seleccionar Carpeta') => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title,
    properties: ['openDirectory', 'createDirectory'],
  });
  return result.canceled || !result.filePaths.length ? null : result.filePaths[0];
});

ipcMain.handle('shell:openFolder', async (_evt, folderPath) => {
  shell.openPath(folderPath);
});

ipcMain.handle('shell:openFile', async (_evt, filePath) => {
  shell.openPath(filePath);
});

ipcMain.handle('theme:get', () => nativeTheme.shouldUseDarkColors ? 'oscuro' : 'claro');

app.whenReady().then(() => {
  if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
  startPython();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (pyProcess) {
    pyProcess.stdin.end();
    pyProcess.kill();
  }
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (pyProcess) {
    pyProcess.stdin.end();
    pyProcess.kill();
  }
});