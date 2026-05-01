/**
 * =============================================================================
 * PRELOAD.JS — Bridge seguro entre main y renderer (contextBridge)
 * Sistema de Gestión Académica — Hospital Escandón
 * =============================================================================
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // ── Python IPC ─────────────────────────────────────────────────────────────
  py: (action, payload = {}) => ipcRenderer.invoke('py:call', action, payload),

  // ── Diálogos de archivo ────────────────────────────────────────────────────
  openCSV:       (title)              => ipcRenderer.invoke('dialog:openCSV', title),
  saveCSV:       (content, name)      => ipcRenderer.invoke('dialog:saveCSV', content, name),
  openFolder:    (path)               => ipcRenderer.invoke('shell:openFolder', path),
  openFile:      (path)               => ipcRenderer.invoke('shell:openFile', path),
  openDirectory: (title)              => ipcRenderer.invoke('dialog:openDirectory', title),

  // ── Tema ───────────────────────────────────────────────────────────────────
  getSystemTheme: ()               => ipcRenderer.invoke('theme:get'),
});