// FILE: electron/paths.js
'use strict';

// Centralized app-data paths. All recordings live inside the app’s userData folder.

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

function getUserDataDir() {
  return app.getPath('userData'); // e.g. %APPDATA%/NewsPilot
}

function getTempDir() {
  return path.join(getUserDataDir(), 'Temp');
}

function getRecordedVoiceDir() {
  return path.join(getUserDataDir(), 'RecordedVoice');
}

function ensureDir(p) {
  try { fs.mkdirSync(p, { recursive: true }); } catch (_) {}
}

function ensureAll() {
  ensureDir(getTempDir());
  ensureDir(getRecordedVoiceDir());
}

module.exports = {
  getUserDataDir,
  getTempDir,
  getRecordedVoiceDir,
  ensureAll,
};
