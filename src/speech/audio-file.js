// FILE: src/speech/audio-file.js
'use strict';

function filenameFromPath(p) {
  const s = String(p || '');
  const parts = s.split(/[/\\]/);
  return parts[parts.length - 1] || '';
}

export function toFileUrl(filePath) {
  const p = String(filePath || '');
  if (!p) return '';
  const normalized = p.replace(/\\/g, '/');
  return 'file:///' + encodeURI(normalized);
}

export async function writeRecordingToDisk(blob, ext = 'wav', suggestedName = 'clip') {
  if (!blob) return { ok: false, filePath: '', name: '' };
  if (!window.np || !window.np.writeRecording) return { ok: false, filePath: '', name: '', error: 'IPC not available' };

  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);

  const res = await window.np.writeRecording({ bytes, ext, suggestedName });
  if (!res || res.ok === false) {
    return { ok: false, filePath: '', name: '', error: res?.error || 'write failed' };
  }

  const filePath = res.filePath || '';
  const name = res.name || filenameFromPath(filePath) || '';
  return { ok: true, filePath, name, filename: name };
}

export function saveAudioBlob(blob, filename = 'speech.wav') {
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}
