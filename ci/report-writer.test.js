'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const ROOT = path.resolve(__dirname, '..');
const CLI = path.join(ROOT, 'scripts', 'report-writer.js');

function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-report-writer-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function run(args, { preload, env = process.env } = {}) {
  return spawnSync(process.execPath, [...(preload ? ['-r', preload] : []), CLI, ...args], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
  });
}

function assertOk(result) {
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

function assertRejected(result, message) {
  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /report-writer:/);
  if (message) assert.match(result.stderr, message);
}

function writeArgs(output, status, mode, ...extra) {
  return ['write', '--output', output, '--status', status, ...mode, ...extra];
}

function readbackHook(dir) {
  const hook = path.join(dir, 'fail-readback.cjs');
  fs.writeFileSync(hook, `
const fs = require('node:fs');
const path = require('node:path');
const readFileSync = fs.readFileSync;
fs.readFileSync = function (file, ...args) {
  const actual = path.resolve(String(file));
  const target = path.resolve(process.env.REPORT_WRITER_FAIL_PATH);
  const mode = process.env.REPORT_WRITER_FAIL_MODE;
  const staged = path.dirname(actual) === path.dirname(target)
    && path.basename(actual).startsWith('.' + path.basename(target) + '.')
    && path.basename(actual).endsWith('.tmp');
  if ((mode === 'staged' && staged) || (mode === 'published' && actual === target)) {
    const error = new Error('controlled read-back failure');
    error.code = 'EIO';
    throw error;
  }
  return readFileSync.call(this, file, ...args);
};
`);
  return hook;
}

test('writes DONE from --context and the checker accepts the exact artifact', t => {
  const dir = tempDir(t);
  const output = path.join(dir, 'report.md');
  const result = run(writeArgs(output, 'DONE', ['--context', 'Summary\nEvidence']))
  assertOk(result);
  assert.equal(fs.readFileSync(output, 'utf8'), 'Summary\nEvidence\nSTATUS: DONE\n');
  assertOk(run(['check', '--file', output]));
});

test('preserves body-file CRLF bytes and accepts numeric zero status', t => {
  const dir = tempDir(t);
  const body = path.join(dir, 'body.md');
  const output = path.join(dir, 'report.md');
  fs.writeFileSync(body, 'First\r\nSecond\r\n');
  assertOk(run(writeArgs(output, '0', ['--body-file', body])));
  assert.equal(fs.readFileSync(output, 'utf8'), 'First\r\nSecond\r\nSTATUS: DONE\r\n');
});

test('writes BLOCKED with a nonempty single-line reason', t => {
  const dir = tempDir(t);
  const output = path.join(dir, 'report.md');
  assertOk(run(writeArgs(output, 'BLOCKED', ['--context', 'Work stopped'], '--reason', 'verification unavailable')));
  assert.equal(fs.readFileSync(output, 'utf8'), 'Work stopped\nSTATUS: BLOCKED: verification unavailable\n');
  assertOk(run(['check', '--file', output]));
});

test('maps a nonzero status and repeated --error values to one reason line', t => {
  const dir = tempDir(t);
  const output = path.join(dir, 'report.md');
  assertOk(run(writeArgs(output, '2', ['--context', 'Work stopped'], '--error', 'build failed', '--error', 'required gate unavailable')));
  assert.equal(fs.readFileSync(output, 'utf8'), 'Work stopped\nSTATUS: BLOCKED: build failed; required gate unavailable\n');
});

test('revises an existing artifact as one complete report', t => {
  const dir = tempDir(t);
  const output = path.join(dir, 'report.md');
  fs.writeFileSync(output, 'Old body\nSTATUS: DONE\n');
  assertOk(run(writeArgs(output, 'BLOCKED', ['--context', 'New body'], '--reason', 'gate failed')));
  assert.equal(fs.readFileSync(output, 'utf8'), 'New body\nSTATUS: BLOCKED: gate failed\n');
  assertOk(run(['check', '--file', output]));
});

test('imports a raw Codex report without altering its source', t => {
  const dir = tempDir(t);
  const raw = path.join(dir, 'raw.txt');
  const output = path.join(dir, 'report.md');
  const rawBytes = Buffer.from('Summary\r\nEvidence\r\nSTATUS: DONE\r\n');
  fs.writeFileSync(raw, rawBytes);
  assertOk(run(writeArgs(output, '0', ['--from-codex-output', raw])));
  assert.deepEqual(fs.readFileSync(raw), rawBytes);
  assert.equal(fs.readFileSync(output, 'utf8'), rawBytes.toString('utf8'));
  assertOk(run(['check', '--file', output]));
});

test('strips only one valid terminal host label and reports the extraction', t => {
  const dir = tempDir(t);
  const raw = path.join(dir, 'raw.txt');
  const output = path.join(dir, 'report.md');
  const rawBytes = Buffer.from('Summary\nSTATUS: DONE\n<!-- harness-label {"v":1,"validity":"actionable"} -->\n');
  fs.writeFileSync(raw, rawBytes);
  const result = run(writeArgs(output, 'DONE', ['--from-codex-output', raw]));
  assertOk(result);
  assert.match(result.stderr, /stripped.*host label/i);
  assert.deepEqual(fs.readFileSync(raw), rawBytes);
  assert.equal(fs.readFileSync(output, 'utf8'), 'Summary\nSTATUS: DONE\n');
  assertOk(run(['check', '--file', output]));
});

test('rejects embedded STATUS in body without changing an existing target', t => {
  const dir = tempDir(t);
  const output = path.join(dir, 'report.md');
  const before = Buffer.from('Keep this report\nSTATUS: DONE\n');
  fs.writeFileSync(output, before);
  const result = run(writeArgs(output, 'DONE', ['--context', 'Summary\nSTATUS: DONE']));
  assertRejected(result, /STATUS/);
  assert.deepEqual(fs.readFileSync(output), before);
  assert.deepEqual(fs.readdirSync(dir), ['report.md']);
});

test('rejects label markers and malformed or duplicate body controls without creating an artifact', t => {
  const dir = tempDir(t);
  const output = path.join(dir, 'report.md');
  for (const body of [
    'Summary <!-- harness-label {"v":1} -->',
    'STATUS: broken',
    'STATUS: DONE\nSTATUS: DONE',
  ]) {
    assertRejected(run(writeArgs(output, 'DONE', ['--context', body])));
    assert.equal(fs.existsSync(output), false);
  }
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('rejects missing, blank, multiline, or unused outcome reasons without changing the target', t => {
  const dir = tempDir(t);
  const output = path.join(dir, 'report.md');
  const before = Buffer.from('Existing\nSTATUS: DONE\n');
  fs.writeFileSync(output, before);
  const cases = [
    ['BLOCKED', ['--context', 'body']],
    ['1', ['--context', 'body'], '--reason', '   '],
    ['BLOCKED', ['--context', 'body'], '--reason', 'line one\nline two'],
    ['DONE', ['--context', 'body'], '--reason', 'not used'],
    ['DONE\nSTATUS: BLOCKED: injected', ['--context', 'body']],
  ];
  for (const [status, mode, ...extra] of cases) {
    assertRejected(run(writeArgs(output, status, mode, ...extra)));
    assert.deepEqual(fs.readFileSync(output), before);
  }
});

test('rejects mismatched, malformed, duplicate, or trailing Codex controls and preserves both files', t => {
  const dir = tempDir(t);
  const raw = path.join(dir, 'raw.txt');
  const output = path.join(dir, 'report.md');
  const before = Buffer.from('Keep this report\nSTATUS: DONE\n');
  fs.writeFileSync(output, before);
  const invalidRaw = [
    'Summary\nSTATUS: BLOCKED: wrong reason\n',
    'Summary without status\n',
    'Summary\nSTATUS: DONE\nSTATUS: DONE\n',
    'Summary\nSTATUS: DONE\n\n',
    'Summary\nSTATUS: DONE\ntext after status\n',
    'Summary\nSTATUS: DONE\n<!-- harness-label {bad json} -->\n',
    'Summary\nSTATUS: DONE\n<!-- harness-label [] -->\n',
    'Summary\nSTATUS: DONE\n<!-- harness-label {"v":1} -->\n<!-- harness-label {"v":1} -->\n',
    'Summary\nSTATUS: DONE\n<!-- harness-label {"v":1} -->\ntrailing text',
    'Summary <!-- harness-label {"v":1} -->\nSTATUS: DONE\n',
  ];
  for (const contents of invalidRaw) {
    const rawBytes = Buffer.from(contents);
    fs.writeFileSync(raw, rawBytes);
    assertRejected(run(writeArgs(output, 'DONE', ['--from-codex-output', raw])));
    assert.deepEqual(fs.readFileSync(raw), rawBytes);
    assert.deepEqual(fs.readFileSync(output), before);
  }
});

test('rejects raw-input/output aliases', t => {
  const dir = tempDir(t);
  const raw = path.join(dir, 'raw.txt');
  const before = Buffer.from('Summary\nSTATUS: DONE\n');
  fs.writeFileSync(raw, before);
  assertRejected(run(writeArgs(raw, 'DONE', ['--from-codex-output', raw])), /alias/i);
  assert.deepEqual(fs.readFileSync(raw), before);
});

test('rejects a body-file/output alias before replacing the source', t => {
  const dir = tempDir(t);
  const body = path.join(dir, 'body.md');
  const before = Buffer.from('Summary');
  fs.writeFileSync(body, before);
  assertRejected(run(writeArgs(body, 'DONE', ['--body-file', body])), /alias/i);
  assert.deepEqual(fs.readFileSync(body), before);
});

test('requires exactly one body mode and rejects conflicting reason flags', t => {
  const dir = tempDir(t);
  const output = path.join(dir, 'report.md');
  assertRejected(run(['write', '--output', output, '--status', 'DONE']));
  assertRejected(run(['write', '--output', output, '--status', 'DONE', '--context', 'body', '--body-file', 'body.md']));
  assertRejected(run(writeArgs(output, 'BLOCKED', ['--context', 'body'], '--reason', 'one', '--error', 'two')));
  assert.equal(fs.existsSync(output), false);
});

test('check accepts one terminal status with LF or CRLF and rejects other control layouts', t => {
  const dir = tempDir(t);
  const file = path.join(dir, 'report.md');
  for (const valid of ['Summary\nSTATUS: DONE', 'Summary\nSTATUS: DONE\n', 'Summary\r\nSTATUS: BLOCKED: reason\r\n']) {
    fs.writeFileSync(file, valid);
    assertOk(run(['check', '--file', file]));
  }
  for (const invalid of [
    'Summary',
    'Summary\nSTATUS: DONE\n\n',
    'Summary\nSTATUS: DONE\ntrailing',
    'Summary\nSTATUS: DONE\nSTATUS: DONE',
    'Summary\nSTATUS: BLOCKED:   ',
    'Summary\nSTATUS: FINISHED',
    'Summary\nSTATUS: DONE\n<!-- harness-label {"v":1} -->',
    '<!-- harness-label {"v":1} -->\nSummary\nSTATUS: DONE',
  ]) {
    fs.writeFileSync(file, invalid);
    assertRejected(run(['check', '--file', file]));
  }
});

test('returns actionable errors for missing input and a bad output path', t => {
  const dir = tempDir(t);
  const missingBody = path.join(dir, 'missing.md');
  const badOutput = path.join(dir, 'missing-parent', 'report.md');
  assertRejected(run(writeArgs(path.join(dir, 'report.md'), 'DONE', ['--body-file', missingBody])), /read|open|ENOENT/i);
  assertRejected(run(writeArgs(badOutput, 'DONE', ['--context', 'Summary'])), /write|publish|ENOENT|directory/i);
  assert.equal(fs.existsSync(path.dirname(badOutput)), false);
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('a staged read-back failure leaves an existing report byte-identical and removes staging data', t => {
  const dir = tempDir(t);
  const output = path.join(dir, 'report.md');
  const before = Buffer.from('Existing\nSTATUS: DONE\n');
  fs.writeFileSync(output, before);
  const hook = readbackHook(dir);
  const result = run(writeArgs(output, 'DONE', ['--context', 'New body']), {
    preload: hook,
    env: { ...process.env, REPORT_WRITER_FAIL_PATH: output, REPORT_WRITER_FAIL_MODE: 'staged' },
  });
  assertRejected(result, /controlled read-back failure/);
  assert.deepEqual(fs.readFileSync(output), before);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['fail-readback.cjs', 'report.md']);
});

test('a published read-back failure is nonzero and keeps raw evidence intact', t => {
  const dir = tempDir(t);
  const raw = path.join(dir, 'raw.txt');
  const output = path.join(dir, 'report.md');
  const rawBytes = Buffer.from('Summary\nSTATUS: DONE\n');
  fs.writeFileSync(raw, rawBytes);
  const hook = readbackHook(dir);
  const result = run(writeArgs(output, 'DONE', ['--from-codex-output', raw]), {
    preload: hook,
    env: { ...process.env, REPORT_WRITER_FAIL_PATH: output, REPORT_WRITER_FAIL_MODE: 'published' },
  });
  assertRejected(result, /published.*verify|read-back/i);
  assert.deepEqual(fs.readFileSync(raw), rawBytes);
  assert.equal(fs.readFileSync(output, 'utf8'), 'Summary\nSTATUS: DONE\n');
});
