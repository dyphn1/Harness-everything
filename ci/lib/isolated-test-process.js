'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

// Do not rely on the caller remembering HOME/CODEX_HOME: even a test that
// accidentally invokes a real installer must inherit a disposable user home.
function spawnTestNode(args, options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-test-home-'));
  try {
    return spawnSync(process.execPath, args, {
      ...options,
      env: {
        ...process.env,
        ...options.env,
        HOME: home,
        USERPROFILE: home,
        CODEX_HOME: path.join(home, '.codex'),
        APPDATA: path.join(home, 'AppData', 'Roaming'),
        LOCALAPPDATA: path.join(home, 'AppData', 'Local'),
      },
    });
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
}

module.exports = { spawnTestNode };
