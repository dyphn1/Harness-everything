'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const scripts = [
  path.join(ROOT, 'hooks/scripts/workflow-disposition.js'),
  path.join(ROOT, 'plugins/harness-everything/hooks/scripts/workflow-disposition.js'),
];
const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-workflow-help-'));

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_STATE_HOME: stateHome },
  });
}

for (const script of scripts) {
  for (const flag of ['--help', '-h']) {
    const result = run(script, [flag]);
    assert.strictEqual(result.status, 0, `${path.relative(ROOT, script)} ${flag} exits successfully: ${result.stderr}`);
    assert.match(result.stdout, /^Usage: workflow-disposition\.js </);
    assert.strictEqual(result.stderr, '', 'help is written to stdout without an error');
    assert.deepStrictEqual(fs.readdirSync(stateHome), [], 'help does not read or create session state');
  }

  for (const args of [[], ['unknown']]) {
    const result = run(script, args);
    assert.strictEqual(result.status, 2, `${path.relative(ROOT, script)} invalid invocation retains exit 2`);
    assert.match(result.stderr, /Usage: workflow-disposition\.js/);
  }
}

fs.rmSync(stateHome, { recursive: true, force: true });
console.log('PASS workflow-disposition help is successful, read-only, and packaged');
