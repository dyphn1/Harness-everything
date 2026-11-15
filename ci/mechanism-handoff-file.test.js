'use strict';

// Component tests for the script-generated hand-off file (#233 / #409 L0).
// The generator writes a Markdown work order whose first bytes are a short YAML
// header; these tests pin the round-trip and the three rejection paths.

const assert = require('node:assert');
const { test } = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'handoff-file.js');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-handoff-'));

function run(args) {
  return execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8' });
}

function expectFailure(args) {
  try {
    run(args);
  } catch (err) {
    return String(err.stderr || err.message);
  }
  throw new Error(`expected failure for: ${args.join(' ')}`);
}

test('new writes a header that header round-trips back', () => {
  const out = path.join(tempRoot, 'roundtrip.md');
  run([
    'new',
    '--kind', 'implement',
    '--title', 'Cache fix',
    '--summary', 'Keep the read cache warm across restarts',
    '--out', out,
    '--writes', 'a.js,b.js',
    '--gate', 'node --test passes',
    '--report', 'reports/R.md',
  ]);
  assert.deepStrictEqual(JSON.parse(run(['header', out])), {
    'harness-handoff': 1,
    kind: 'implement',
    title: 'Cache fix',
    summary: 'Keep the read cache warm across restarts',
    writes: ['a.js', 'b.js'],
    gate: 'node --test passes',
    report: 'reports/R.md',
  });
  const body = fs.readFileSync(out, 'utf8');
  for (const section of ['## Scope anchor', '## Task', '## Write-set', '## Verification', '## Report']) {
    assert.ok(body.includes(section), `body is missing ${section}`);
  }
  assert.ok(body.trimEnd().endsWith('-->'), 'body should end with the pending status comment');
  assert.strictEqual(run(['check', out]).trim().endsWith('ok (kind=implement)'), true);
});

test('a summary longer than 200 characters is rejected', () => {
  const out = path.join(tempRoot, 'long-summary.md');
  const stderr = expectFailure([
    'new',
    '--kind', 'test',
    '--title', 'Too long',
    '--summary', 'a'.repeat(201),
    '--out', out,
  ]);
  assert.match(stderr, /200 characters/);
  assert.strictEqual(fs.existsSync(out), false);
});

test('a file without a header is rejected', () => {
  const out = path.join(tempRoot, 'no-header.md');
  fs.writeFileSync(out, '# Just prose\n', 'utf8');
  assert.match(expectFailure(['header', out]), /no handoff header/);
  assert.match(expectFailure(['check', out]), /no handoff header/);
});

test('a header larger than 2 KB is rejected', () => {
  const out = path.join(tempRoot, 'too-large.md');
  fs.writeFileSync(out, `---\nharness-handoff: 1\nkind: implement\ntitle: "${'a'.repeat(3000)}"\n---\n`, 'utf8');
  assert.match(expectFailure(['header', out]), /exceeds 2048 bytes/);
  assert.match(expectFailure(['check', out]), /exceeds 2048 bytes/);
});

test('values containing ":" and "#" survive the round-trip', () => {
  const out = path.join(tempRoot, 'punct.md');
  run([
    'new',
    '--kind', 'question',
    '--title', 'Fix: cache #1',
    '--summary', 'Why: it drops keys #2',
    '--out', out,
    '--gate', 'reviewer #A signs off: yes',
  ]);
  const header = JSON.parse(run(['header', out]));
  assert.strictEqual(header.title, 'Fix: cache #1');
  assert.strictEqual(header.summary, 'Why: it drops keys #2');
  assert.strictEqual(header.gate, 'reviewer #A signs off: yes');
});

test('new refuses a header it would write larger than 2 KB', () => {
  const out = path.join(tempRoot, 'new-too-large.md');
  const stderr = expectFailure([
    'new',
    '--kind', 'implement',
    '--title', 'a'.repeat(3000),
    '--summary', 'S',
    '--out', out,
  ]);
  assert.match(stderr, /exceeds 2048 bytes/);
  assert.strictEqual(fs.existsSync(out), false);
});

test('an unknown key is rejected', () => {
  const out = path.join(tempRoot, 'unknown-key.md');
  run(['new', '--kind', 'design', '--title', 'T', '--summary', 'S', '--out', out]);
  const body = fs.readFileSync(out, 'utf8').replace('summary: S', 'summary: S\nmystery: 7');
  fs.writeFileSync(out, body, 'utf8');
  assert.match(expectFailure(['check', out]), /unknown header key/);
});
