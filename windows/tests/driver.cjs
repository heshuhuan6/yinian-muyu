// Development-only harness. This file is never copied into the release archive.
const { app } = require('electron');
const path = require('node:path');
app.setPath('userData', path.join(__dirname, '..', 'test-results', 'profile'));
globalThis.__muyuTestHost = require('../main.cjs');
