'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-runner-isolation-'));
try {
  const repo = path.join(root, 'fixture');
  const ci = path.join(repo, 'ci');
  fs.mkdirSync(path.join(ci, 'lib'), { recursive: true });
  fs.copyFileSync(path.join(__dirname, 'mechanism-test.js'), path.join(ci, 'mechanism-test.js'));
  const helper = path.join(__dirname, 'lib', 'isolated-test-process.js');
  if (fs.existsSync(helper)) fs.copyFileSync(helper, path.join(ci, 'lib', 'isolated-test-process.js'));
  const report = path.join(root, 'child.json');
  fs.writeFileSync(path.join(ci, 'mechanism-fixture.test.js'), `
    const fs = require('fs');
    const assert = require('assert');
    const os = require('os');
    const path = require('path');
    assert.notStrictEqual(process.env.CODEX_HOME, process.env.PARENT_CODEX_HOME);
    assert.notStrictEqual(process.env.HOME, process.env.PARENT_HOME);
    assert.strictEqual(process.env.CODEX_HOME, path.join(process.env.HOME, '.codex'));
    assert.strictEqual(os.homedir(), process.env.HOME);
    fs.mkdirSync(process.env.CODEX_HOME, { recursive: true });
    fs.writeFileSync(path.join(process.env.CODEX_HOME, 'child-proof'), 'isolated');
    fs.writeFileSync(process.env.ISOLATION_REPORT, JSON.stringify({home: process.env.HOME}));
  `);
  const parentHome = path.join(root, 'parent-home');
  const parentCodex = path.join(parentHome, '.codex');
  const result = spawnSync(process.execPath, [path.join(ci, 'mechanism-test.js')], {
    encoding: 'utf8', env: { ...process.env, HOME: parentHome, USERPROFILE: parentHome,
      CODEX_HOME: parentCodex, PARENT_HOME: parentHome, PARENT_CODEX_HOME: parentCodex,
      ISOLATION_REPORT: report },
  });
  assert.strictEqual(result.status, 0, result.stdout + result.stderr);
  const child = JSON.parse(fs.readFileSync(report, 'utf8'));
  assert(!fs.existsSync(child.home), 'runner must clean its temporary home');
  assert(!fs.existsSync(parentHome), 'runner must not write into inherited home');
  // Both entry points must use the same isolated spawn implementation.
  const regression = fs.readFileSync(path.join(__dirname, '../self-evolve/scripts/self-regression.js'), 'utf8');
  assert(regression.includes('spawnTestNode('));
  assert(!regression.includes("spawnSync('node'"));
  console.log('PASS mechanism child receives a temporary CODEX_HOME/HOME; shared self-regression isolation and cleanup verified');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
