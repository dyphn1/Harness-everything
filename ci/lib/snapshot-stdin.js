'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

// Give a synchronous checker a finite stdin snapshot instead of coordinating
// pipe EOF with spawnSync. The private file and descriptor belong to this call.
function spawnWithSnapshotInput(executable, args, options = {}) {
  if (options.input === undefined) return spawnSync(executable, args, options);
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-checker-input-'));
  let fd;
  try {
    const file = path.join(temp, 'input.json');
    fs.writeFileSync(file, options.input, { mode: 0o600 });
    fd = fs.openSync(file, 'r');
    const invocation = { ...options, stdio: [fd, 'pipe', 'pipe'] };
    delete invocation.input;
    return spawnSync(executable, args, invocation);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = { spawnWithSnapshotInput };
