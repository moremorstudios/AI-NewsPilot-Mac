// FILE: electron/main.js
'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, shell, ipcMain, Menu } = require('electron');

const { ensureAll } = require('./paths');
const { registerAudioIpc } = require('./ipc-audio');
const { registerOpenAISttIpc } = require('./ipc-openai-stt');

// ---- Cache dirs: avoid "Access denied" / cache creation failures in dev ----
try {
  const ud = app.getPath('userData'); // writable
  app.commandLine.appendSwitch('disk-cache-dir', path.join(ud, 'Cache'));
  app.commandLine.appendSwitch('gpu-cache-dir', path.join(ud, 'GPUCache'));
} catch (_) {}

let win = null;

function createWindow() {
  ensureAll();

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    backgroundColor: '#0b0f14',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  // Hide menu bar for a more "native app" feel on Windows
  win.setMenuBarVisibility(false);
  win.setAutoHideMenuBar(true);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

    win.webContents.on('context-menu', (_event, params) => {
    const template = [];

    if (params.isEditable) {
      template.push(
        { role: 'undo', label: 'Undo' },
        { role: 'redo', label: 'Redo' },
        { type: 'separator' },
        { role: 'cut', label: 'Cut' },
        { role: 'copy', label: 'Copy' },
        { role: 'paste', label: 'Paste' },
        { type: 'separator' },
        { role: 'selectAll', label: 'Select All' }
      );
    } else if (params.selectionText && params.selectionText.trim()) {
      template.push(
        { role: 'copy', label: 'Copy' },
        { type: 'separator' },
        { role: 'selectAll', label: 'Select All' }
      );
    }

    if (!template.length) return;

    Menu.buildFromTemplate(template).popup({ window: win });
  });

    win.loadFile(path.join(__dirname, '..', 'src', 'index.html'));

  // TEMP DEBUG: open renderer DevTools automatically
 
  win.on('closed', () => { win = null; });
}



function candidateStoreBridgePaths() {
  const candidates = [];

  try {
    // packaged app: helper copied into resources/bridge/StoreBridge/
    candidates.push(path.join(process.resourcesPath || '', 'bridge', 'StoreBridge', 'StoreBridge.exe'));
  } catch (_) {}

  try {
    // dev/repo paths
    const root = path.join(__dirname, '..');
    candidates.push(path.join(root, 'bridge', 'StoreBridge', 'bin', 'Release', 'net8.0-windows10.0.19041.0', 'StoreBridge.exe'));
    candidates.push(path.join(root, 'bridge', 'StoreBridge', 'bin', 'Debug', 'net8.0-windows10.0.19041.0', 'StoreBridge.exe'));
  } catch (_) {}

  return candidates;
}

function findStoreBridgeExe() {
  const candidates = candidateStoreBridgePaths();
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return '';
}

function runStoreBridge(action) {
  return new Promise((resolve) => {
    try {
      const exe = findStoreBridgeExe();
      if (!exe) {
        resolve({ ok: false, error: 'StoreBridge.exe not found. Build the bridge first.' });
        return;
      }

      const { execFile } = require('child_process');
      execFile(exe, [String(action || '')], {
        windowsHide: true,
        timeout: 30000,
        maxBuffer: 1024 * 1024
      }, (error, stdout, stderr) => {
        if (error) {
          resolve({
            ok: false,
            error: String(error && error.message ? error.message : error),
            stderr: String(stderr || '').trim()
          });
          return;
        }

        const text = String(stdout || '').trim();
        if (!text) {
          resolve({ ok: false, error: 'StoreBridge returned empty output.' });
          return;
        }

        try {
          const parsed = JSON.parse(text);
          resolve(parsed);
        } catch (e) {
          resolve({
            ok: false,
            error: 'StoreBridge returned invalid JSON.',
            raw: text,
            parseError: String(e && e.message ? e.message : e)
          });
        }
      });
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message ? e.message : e) });
    }
  });
}

try { app.setAppUserModelId('MoremorStudios.AINewsPilot'); } catch (_) {}

app.whenReady().then(() => {
  registerAudioIpc();
  registerOpenAISttIpc();

  ipcMain.handle('store:getLicenseStatus', async () => {
    return runStoreBridge('getStatus');
  });

  ipcMain.handle('store:purchaseBasic', async () => {
    return runStoreBridge('purchaseBasic');
  });

  ipcMain.handle('store:purchasePro', async () => {
    return runStoreBridge('purchasePro');
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
