'use strict';

const { contextBridge, ipcRenderer, shell } = require('electron');

function baseName(p) {
  try {
    const s = String(p || '').replace(/\\/g, '/');
    const parts = s.split('/').filter(Boolean);
    return parts.length ? parts[parts.length - 1] : '';
  } catch {
    return String(p || '');
  }
}

contextBridge.exposeInMainWorld('np', {
  // temp
  writeTempAudio: async ({ bytes, ext }) => {
    return ipcRenderer.invoke('fs:writeTempAudio', { bytes, ext });
  },

  // recordings
  writeRecording: async ({ bytes, ext, suggestedName }) => {
    const res = await ipcRenderer.invoke('fs:writeRecording', { bytes, ext, suggestedName });
    if (!res || !res.filePath) return { filePath: '' };
    return { filePath: res.filePath, name: baseName(res.filePath) };
  },

  listRecordings: async () => {
    const res = await ipcRenderer.invoke('fs:listRecordings');
    const items = (res && Array.isArray(res.items)) ? res.items : [];
    return items.map(x => ({
      id: x.filePath || x.name,
      name: x.name,
      path: x.filePath,
      mtime: x.mtimeMs || 0
    }));
  },

  deleteRecording: async ({ filePath }) => {
    return ipcRenderer.invoke('fs:deleteRecording', { filePath });
  },

  // import/upload
  importAudio: async ({ label }) => {
    return ipcRenderer.invoke('audio:import', { label });
  },

  // STT helpers expected by src/app/ui.js
  readFileBytes: async (filePath) => {
    return ipcRenderer.invoke('fs:readFileBytes', { filePath });
  },

  openaiTranscribeBytes: async ({ apiKey, bytes, filename, mimeType, language }) => {
    return ipcRenderer.invoke('openai:transcribeBytes', {
      apiKey,
      bytes,
      filename,
      mimeType,
      language
    });
  },

  // helpers
  revealFile: (filePath) => {
    try { shell.showItemInFolder(String(filePath || '')); } catch {}
  },

  openPath: (p) => {
    try { return shell.openPath(String(p || '')); } catch { return Promise.resolve(); }
  },

  // --- auto-update (GitHub Releases)
  update: {
    check: async () => ipcRenderer.invoke('update:check'),
    install: async () => ipcRenderer.invoke('update:install'),
    onStatus: (cb) => {
      if (typeof cb !== 'function') return () => {};
      const handler = (_evt, payload) => cb(payload);
      ipcRenderer.on('np:updateStatus', handler);
      return () => ipcRenderer.removeListener('np:updateStatus', handler);
    }
  }
});

// Microsoft Store license bridge
contextBridge.exposeInMainWorld('npStore', {
  getStatus: async () => ipcRenderer.invoke('store:getLicenseStatus'),
  purchaseBasic: async () => ipcRenderer.invoke('store:purchaseBasic'),
  purchasePro: async () => ipcRenderer.invoke('store:purchasePro')
});