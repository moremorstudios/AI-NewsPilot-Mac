// FILE: electron/ipc-openai-stt.js
// IPC handler for OpenAI Whisper transcription.

const { ipcMain } = require('electron');
const fs = require('fs');
const { FormData, File, fetch } = require('undici');
const STT_SAFETY_PROMPT =
  "TRANSCRIBE ONLY. Do NOT translate. Keep the transcript in the same language as the audio. " +
  "Do not switch to English unless the audio is English. " +
  "No fabrication: do not invent names, institutions, dates, numbers, or events. " +
  "If unclear, write [inaudible] or [unclear] instead of guessing.";

function registerOpenAISttIpc() {
  ipcMain.handle('fs:readFileBytes', async (_event, { filePath }) => {
    try {
      const p = String(filePath || '').trim();
      if (!p) return new Uint8Array();
      const buf = await fs.promises.readFile(p);
      return new Uint8Array(buf);
    } catch (err) {
      console.error('fs:readFileBytes error:', err);
      return new Uint8Array();
    }
  });

  ipcMain.handle('openai:transcribeBytes', async (_event, { bytes, apiKey, language, mimeType, filename }) => {
    try {
      const key = String(apiKey || '').trim().replace(/[\u200B-\u200D\uFEFF]/g, '');
      if (!key) return { text: '' };

      const buf = Buffer.from(bytes);
      const mt = String(mimeType || 'audio/wav');
      const fn = String(filename || 'audio.wav');

      const form = new FormData();
      const file = new File([buf], fn, { type: mt });
      form.append('file', file);
      form.append('model', 'whisper-1');
      form.append('response_format', 'text');
      form.append('prompt', STT_SAFETY_PROMPT);
      const lang = String(language || '').trim();
      if (lang && lang !== 'auto') {
        // OpenAI expects ISO-639-1 language codes when provided.
        form.append('language', lang);
      }

      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
        },
        body: form,
      });

      if (!res.ok) {
        const t = await res.text().catch(() => '');
        console.error('openai:transcribeBytes failed:', res.status, t);
        return { text: '' };
      }

      const text = (await res.text()) || '';
      return { text: String(text).trim() };
    } catch (err) {
      console.error('openai:transcribeBytes error:', err);
      return { text: '' };
    }
  });
}

module.exports = { registerOpenAISttIpc };
