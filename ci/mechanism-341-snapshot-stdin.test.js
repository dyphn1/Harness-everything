'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnWithSnapshotInput } = require('./lib/snapshot-stdin');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-341-stdin-test-'));
const saved = new Map(['TMPDIR', 'TEMP', 'TMP'].map(key => [key, process.env[key]]));
try {
  for (const key of saved.keys()) process.env[key] = root;
  const text = 'finite JSON snapshot: 中\n' + 'x'.repeat(300000);
  const child = spawnWithSnapshotInput(process.execPath, ['-e', `
    const fs = require('node:fs');
    process.stdout.write(JSON.stringify({ regular: fs.fstatSync(0).isFile(), text: fs.readFileSync(0, 'utf8') }));
  `], { input: text, encoding: 'utf8', timeout: 10000 });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(JSON.parse(child.stdout), { regular: true, text });
  assert.deepEqual(fs.readdirSync(root), [], 'a completed child leaves no input snapshot');

  const failed = spawnWithSnapshotInput(process.execPath, ['-e', 'process.exit(7)'], {
    input: '{}', encoding: 'utf8', timeout: 10000,
  });
  assert.equal(failed.status, 7, 'a child failure is preserved, never credited as success');
  assert.deepEqual(fs.readdirSync(root), [], 'a failed child leaves no input snapshot');

  const timedOut = spawnWithSnapshotInput(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    input: '{}', encoding: 'utf8', timeout: 100, killSignal: 'SIGKILL',
  });
  assert.equal(timedOut.error.code, 'ETIMEDOUT', 'the external deadline still terminates a stuck child');
  assert.deepEqual(fs.readdirSync(root), [], 'a terminated child leaves no input snapshot');
  console.log('PASS snapshot stdin: finite UTF-8 input, failure/timeout propagation, and cleanup');
} finally {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(root, { recursive: true, force: true });
}
