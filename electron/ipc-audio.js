// FILE: electron/ipc-audio.js
'use strict';

const { ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

const { ensureAll, getTempDir, getRecordedVoiceDir } = require('./paths');

function safeExt(ext) {
  const t = String(ext || 'webm').toLowerCase();
  const clean = t.replace(/[^a-z0-9]/g, '');
  return clean || 'webm';
}

function sanitizeBaseName(name) {
  return String(name || '')
    .trim()
    .replace(/[^a-z0-9_\- ]/gi, '')
    .replace(/\s+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 60);
}

// Escape string for use in RegExp literal
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Naming policy (readable + short):
 * base_0001.wav, base_0002.wav ...
 * - Backward compatible: if base.wav exists, next becomes base_0002.wav
 */
async function nextSequentialName(dir, baseName, ext) {
  const safeBase = sanitizeBaseName(baseName) || 'clip';
  const e = safeExt(ext);

  const entries = await fs.promises.readdir(dir).catch(() => []);

  // Matches:
  // base.wav  (legacy, treated as #1)
  // base_0001.wav
  // base_0002.wav
  const baseRe = escapeRegExp(safeBase);
  const re = new RegExp(`^${baseRe}(?:_(\\d{4}))?\\.${escapeRegExp(e)}$`, 'i');

  let maxN = 0;

  for (const fname of entries) {
    const m = fname.match(re);
    if (!m) continue;

    // base.wav -> treat as 1
    const n = m[1] ? parseInt(m[1], 10) : 1;
    if (Number.isFinite(n) && n > maxN) maxN = n;
  }

  // If nothing exists -> base_0001.ext
  // If only legacy base.ext exists -> base_0002.ext
  const next = (maxN === 0) ? 1 : (maxN + 1);
  const padded = String(next).padStart(4, '0');
  return `${safeBase}_${padded}.${e}`;
}

// Strict path containment check
function isInsideDir(filePath, dirPath) {
  const resolved = path.resolve(String(filePath || ''));
  const resolvedDir = path.resolve(String(dirPath || ''));
  // Ensure boundary: "/dir" must not match "/dir2"
  return resolved === resolvedDir || resolved.startsWith(resolvedDir + path.sep);
}

function registerAudioIpc() {
  ensureAll();

  ipcMain.handle('fs:getRecordedVoiceDir', async () => {
    try {
      return { dir: getRecordedVoiceDir() };
    } catch {
      return { dir: '' };
    }
  });

  ipcMain.handle('fs:writeTempAudio', async (_event, { bytes, ext }) => {
    try {
      const dir = getTempDir();
      const e = safeExt(ext);
      const name = `np_${Date.now()}.${e}`;
      const filePath = path.join(dir, name);
      await fs.promises.writeFile(filePath, Buffer.from(bytes));
      return { ok: true, filePath, name };
    } catch (err) {
      console.error('fs:writeTempAudio error:', err);
      return { ok: false, filePath: '', name: '', error: String(err?.message || err) };
    }
  });

  ipcMain.handle('fs:writeRecording', async (_event, { bytes, ext, suggestedName }) => {
    try {
      const dir = getRecordedVoiceDir();
      const e = safeExt(ext);

      const baseName = sanitizeBaseName(suggestedName) || 'clip';
      const name = await nextSequentialName(dir, baseName, e);

      const filePath = path.join(dir, name);
      await fs.promises.writeFile(filePath, Buffer.from(bytes));

      return { ok: true, filePath, name };
    } catch (err) {
      console.error('fs:writeRecording error:', err);
      return { ok: false, filePath: '', name: '', error: String(err?.message || err) };
    }
  });

  ipcMain.handle('fs:listRecordings', async () => {
    try {
      const dir = getRecordedVoiceDir();
      const entries = await fs.promises.readdir(dir, { withFileTypes: true });
      const items = [];

      for (const ent of entries) {
        if (!ent.isFile()) continue;
        const filePath = path.join(dir, ent.name);
        let st;
        try { st = await fs.promises.stat(filePath); } catch { continue; }

        items.push({
          name: ent.name,
          filePath,
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      }

      items.sort((a, b) => (b.mtimeMs || 0) - (a.mtimeMs || 0));
      return { ok: true, items };
    } catch (err) {
      console.error('fs:listRecordings error:', err);
      return { ok: false, items: [] };
    }
  });

  ipcMain.handle('fs:deleteRecording', async (_event, { filePath }) => {
    try {
      const p = String(filePath || '');
      if (!p) return { ok: false, error: 'missing filePath' };

      const dir = getRecordedVoiceDir();

      // Safety: only allow deletes inside RecordedVoice (strict boundary)
      if (!isInsideDir(p, dir)) {
        return { ok: false, error: 'forbidden path' };
      }

      // Only unlink the single file (no folder ops)
      await fs.promises.unlink(path.resolve(p));
      return { ok: true };
    } catch (err) {
      console.error('fs:deleteRecording error:', err);
      return { ok: false, error: String(err?.message || err) };
    }
  });

  ipcMain.handle('audio:import', async (_event, { label }) => {
    try {
      const picked = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
          { name: 'Audio', extensions: ['wav','mp3','mpeg','m4a','aac','ogg','flac','webm'] },
          { name: 'All Files', extensions: ['*'] }
        ]
      });

      if (picked.canceled || !picked.filePaths?.[0]) {
        return { ok: false, canceled: true };
      }

      const src = String(picked.filePaths[0]);
      const dir = getRecordedVoiceDir();

      const extRaw = path.extname(src).toLowerCase().replace('.', '');
      const ext = safeExt(extRaw || 'wav');

      const base = sanitizeBaseName(label) || path.basename(src, path.extname(src));
      const name = await nextSequentialName(dir, base, ext);
      const filePath = path.join(dir, name);

      await fs.promises.copyFile(src, filePath);
      const st = await fs.promises.stat(filePath);

      return { ok: true, name, filePath, size: st.size, mtimeMs: st.mtimeMs };
    } catch (err) {
      console.error('audio:import error:', err);
      return { ok: false, error: String(err?.message || err) };
    }
  });
}

module.exports = { registerAudioIpc };
