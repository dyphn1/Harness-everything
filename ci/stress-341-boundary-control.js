#!/usr/bin/env node
'use strict';

// Local/on-demand stress lane: four real C00 controls plus four bounded CPU workers.
// Kept on-demand rather than in every gate: CPU saturation multiplies CI load.
// The preload makes an unrelated sensitivity child unavailable deterministically;
// selecting N01d must not run that child, even when the selected assertion passed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

if (process.argv.includes('--worker')) {
  const { runChecks } = require('./mutation-check');
  const [result] = runChecks({ root: ROOT, timeoutMs: 60000, legacyAssertions: {}, checks: [{
    label: 'parallel selected boundary control', target: 'ci/lib/doc-evidence-boundary-check.js',
    mutantId: 'C00-noop-boundary', test: 'ci/mechanism-341-boundary-enforcement.test.js',
    caseId: 'C1-N01d-canonical',
    assertionId: 'C1-N01d-canonical.boundary.intended-code-CONTEXT_ALIAS_OR_COMPUTED_USE',
  }] });
  console.log(JSON.stringify(result));
  assert.equal(result.verdict, 'SURVIVED', result.reason);
} else {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-341-control-stress-'));
  const preload = path.join(temp, 'sensitivity-pressure.cjs');
  fs.writeFileSync(preload, `
const cp = require('node:child_process');
const original = cp.spawnSync;
cp.spawnSync = function (exe, args, options) {
  if (args && args.includes('--c1-isolation-child') && typeof options?.input === 'string') {
    console.error('stress: pipe-fed isolation child reached');
    return original(exe, ['-e', 'setTimeout(() => {}, 10000)'], { ...options, timeout: 25 });
  }
  if (args && /doc-evidence-boundary-check-baseline\\.js$/.test(args[0] || '')) {
    // Simulate a starved, UNSELECTED child at the actual subprocess boundary.
    console.error('stress: unselected sensitivity baseline reached');
    return original(exe, ['-e', 'setTimeout(() => {}, 10000)'], { ...options, timeout: 25 });
  }
  return original(exe, args, options);
};
`);
  const children = new Set();
  const timer = setTimeout(() => {
    for (const child of children) child.kill('SIGKILL');
  }, 150000);
  const env = { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${JSON.stringify(preload)}`.trim() };
  const run = args => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', (status, signal) => {
      children.delete(child);
      process.stdout.write(output);
      resolve({ status, signal });
    });
  });
  const burners = [];
  for (let i = 0; i < 4; i++) {
    const child = spawn(process.execPath, ['-e', 'const end = Date.now() + 140000; while (Date.now() < end) {}'], {
      stdio: 'ignore',
    });
    burners.push(child);
    children.add(child);
    child.on('error', () => {});
    child.on('close', () => children.delete(child));
  }
  Promise.all(Array.from({ length: 4 }, () => run([__filename, '--worker'])))
    .then(results => {
      assert.ok(results.every(result => result.status === 0 && !result.signal),
        `parallel C00 controls must survive: ${JSON.stringify(results)}`);
      console.log('PASS four parallel C00 controls under CPU load and input/selection isolation');
    })
    .catch(error => { console.error(error.message); process.exitCode = 1; })
    .finally(() => {
      clearTimeout(timer);
      for (const child of children) child.kill('SIGKILL');
      fs.rmSync(temp, { recursive: true, force: true });
    });
}
