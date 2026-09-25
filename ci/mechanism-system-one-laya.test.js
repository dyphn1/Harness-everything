'use strict';
// Laya dense intent labeler contract (#255 Phase 1+2): the stdlib Python suite
// proves the mapping/validator/derive contract without any model weights.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');

test('S1-L01 the Laya dense labeler contract holds without model weights', () => {
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const r = spawnSync(python, [path.join(__dirname, 'system-one-laya-label-test.py')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('S1-L02 the Laya calibration contract holds without model weights', () => {
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const r = spawnSync(python, [path.join(__dirname, 'system-one-laya-calibrate-test.py')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('S1-L03 the Laya soft-target exporter contract holds without model weights', () => {
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const r = spawnSync(python, [path.join(__dirname, 'system-one-laya-export-test.py')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('S1-L04 the single-device trainer contract holds (torch parts skip without torch)', () => {
  const python = process.env.PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
  const r = spawnSync(python, [path.join(__dirname, 'system-one-laya-train-test.py')], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});
