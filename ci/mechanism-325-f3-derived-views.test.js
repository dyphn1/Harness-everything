#!/usr/bin/env node
'use strict';

// F3 derived-views lock suite (strict RED): derived applicability in `check` and the pure
// `compare-derived` subcommand, per the A2 §1/§3/§4 spec frozen in the A2-advisor report:
// expected values come from the spec table never from running code.
//
// D cases run per leg (canonical scripts / packaged mirror) on tmp workspaces with a space in
// the name; P pins doc-check.js byte parity. D15 dogfoods the repo declaration.
//
// RED is expected until I2 lands: `compare-derived` is an unknown subcommand (exit 2, no JSON),
// and `check` marks nothing `unverified`. Each case must fail at an assertion, never crash.
// D1 (execution firebreak) and P1 may legitimately pass at RED.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const MODULE = 'doc-check.js';
const CONFIG = '.agents/harness-everything/project-docs.json';
const LEGS = [
  { name: 'source', dir: path.join(ROOT, 'harness-everything', 'scripts') },
  { name: 'packaged', dir: path.join(ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts') }
];

let passed = 0;
let failed = 0;
let skipped = 0;
const failures = [];
const tmpDirs = [];
const compareRuns = []; // every compare-derived stdout, for the D14 single-JSON-object lock

function record(status, id, leg, detail) {
  const where = leg ? ` [${leg}]` : '';
  if (status === 'PASS') passed += 1;
  else if (status === 'SKIP') skipped += 1;
  else { failed += 1; failures.push(`${id}${where}`); }
  console.log(`  ${status} ${id}${where}${detail ? ` — ${detail}` : ''}`);
}

function truncate(text) {
  const s = text === undefined ? 'undefined' : String(text);
  return s.length > 300 ? `${s.slice(0, 300)}…` : s;
}

function same(actual, expected, label) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${label}: got ${truncate(a)} expected ${truncate(e)}`);
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

// ---- Fixture helpers -----------------------------------------------------------------------------------------------
function removeTree(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function writeDoc(ws, relative, text) {
  const absolute = path.join(ws, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, text);
}

function makeWorkspace(config) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), 'f3 derived views '));
  tmpDirs.push(ws);
  if (config) writeDoc(ws, CONFIG, `${JSON.stringify(config, null, 2)}\n`);
  return ws;
}

function candidateDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'f3 candidates '));
  tmpDirs.push(dir);
  return dir;
}

const TARGET_BYTES = Buffer.from('# Generated index\n\n- [architecture](architecture.md)\n', 'utf8');
const refDoc = body => `---\nrole: reference\nstatus: active\n---\n\n${body}\n`;

// ---- Config factories -----------------------------------------------------------------------------------------------

// Config with one declared view whose generator is a sentinel: if the command string is ever
// executed during discovery or comparison it writes the marker file, and D1 catches it.
function markerPath(ws) {
  return path.join(ws, 'RAN').replace(/\\/g, '/');
}

function sentinelGenerator(ws) {
  return `node -e "require('fs').writeFileSync('${markerPath(ws)}','x')"`;
}

function viewWorkspace(extraDerived) {
  const ws = makeWorkspace(null);
  const config = {
    governed: [{ path: 'docs/a.md', role: 'reference' }],
    derived: Array.isArray(extraDerived) ? extraDerived : [{ path: 'docs/index.md', generator: sentinelGenerator(ws) }]
  };
  writeDoc(ws, CONFIG, `${JSON.stringify(config, null, 2)}\n`);
  return { ws };
}

function writeTarget(ws) {
  writeDoc(ws, 'docs/index.md', TARGET_BYTES.toString('utf8'));
}

function markerRan(ws) {
  return fs.existsSync(path.join(ws, 'RAN'));
}

function spawnIt(scriptDir, subcommand, flags, extra) {
  return spawnSync(process.execPath, [
    path.join(scriptDir, MODULE), subcommand,
    ...flags
  ], { encoding: 'utf8', cwd: os.tmpdir(), ...extra });
}

function runCheck(scriptDir, workspace, args) {
  return spawnIt(scriptDir, 'check', [
    '--workspace', workspace,
    '--config', CONFIG,
    ...(args || [])
  ]);
}

function runCompare(scriptDir, options) {
  const result = spawnIt(scriptDir, 'compare-derived', [
    ...(options.workspace ? ['--workspace', options.workspace, '--config', options.config] : []),
    ...(options.view ? ['--view', options.view] : []),
    ...(options.candidate ? ['--candidate', options.candidate] : []),
    ...(options.status ? ['--generation-status', options.status] : []),
    ...(options.args || [])
  ], options.extra);
  compareRuns.push({ output: result.stdout || '' });
  return result;
}

function jsonOut(result) {
  try { return JSON.parse(result.stdout); } catch {
    throw new Error(`stdout is not JSON (exit ${result.status}): ${truncate(result.stdout || result.stderr)}`);
  }
}

function assertPerLeg(id, fn) {
  for (const leg of LEGS) {
    if (!fs.existsSync(path.join(leg.dir, MODULE))) {
      record('FAIL', id, leg.name, `module-missing: ${path.relative(ROOT, path.join(leg.dir, MODULE))}`);
      continue;
    }
    try { fn(leg); record('PASS', id, leg.name); } catch (error) {
      record('FAIL', id, leg.name, error.message.split('\n')[0]);
    }
  }
}

// ---- D cases -------------------------------------------------------------------------------------------------------

// D1: discovery and comparison are non-executing. The sentinel generator must never run —
// through `check` (normal and malformed config) or through `compare-derived`. At RED this
// firebreak passes (nothing runs anything); it must keep passing at GREEN.
function caseD1(leg) {
  const { ws } = viewWorkspace();
  writeDoc(ws, 'docs/a.md', refDoc('Plain governed text.\n'));
  writeTarget(ws);
  const malformed = {
    ws: makeWorkspace(null),
  };
  writeDoc(malformed.ws, CONFIG, `${JSON.stringify({ governed: [{ path: 'docs/a.md', role: 'reference' }], derived: [{ path: 'docs/index.md' }] }, null, 2)}\n`);
  const dir = candidateDir();
  const candidate = path.join(dir, 'candidate.md');
  fs.writeFileSync(candidate, TARGET_BYTES);

  runCheck(leg.dir, ws, ['--changed-path', 'docs/a.md']);
  runCompare(leg.dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'ok' });
  if (markerRan(ws)) throw new Error('sentinel generator executed during check/compare');

  writeDoc(malformed.ws, 'docs/a.md', refDoc('Plain governed text.\n'));
  runCheck(leg.dir, malformed.ws, ['--changed-path', 'docs/a.md']);
  runCompare(leg.dir, { workspace: malformed.ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'ok' });
  if (markerRan(malformed.ws)) throw new Error('sentinel executed on malformed config');
}
assertPerLeg('case-d1:sentinel-never-executed', leg => caseD1(leg));

// D2: a governed source change with one derived view keeps the F2 check exit (0) as ordinary
// lint/link evidence, while coverage.unsupported names the affected view as unverified with the
// explicit conservative applicability label (A2 §1).
function caseD2(leg) {
  const { ws } = viewWorkspace();
  writeDoc(ws, 'docs/a.md', refDoc('Plain governed text.\n'));
  writeTarget(ws);
  const result = runCheck(leg.dir, ws, ['--changed-path', 'docs/a.md']);
  same(result.status, 0, 'check exit (F2 meaning preserved)');
  const out = jsonOut(result);
  const entry = (out.coverage.unsupported || []).find(item => item.path === 'docs/index.md');
  if (!entry) throw new Error(`no coverage.unsupported entry for docs/index.md: ${truncate(JSON.stringify(out.coverage))}`);
  same(entry.state, 'unverified', 'coverage state');
  same(entry.applicability, 'conservative-all-governed', 'coverage applicability');
  if (markerRan(ws)) throw new Error('sentinel generator executed during check');
}

assertPerLeg('case-d2:check-marks-affected-view-unverified', leg => caseD2(leg));

// D3: equal candidate with reported generation ok → exit 0, result equal (regenerate-equals).
function caseD3(leg) {
  const { ws } = viewWorkspace();
  writeTarget(ws);
  const dir = candidateDir();
  const candidate = path.join(dir, 'candidate.md');
  fs.writeFileSync(candidate, TARGET_BYTES);
  const result = runCompare(leg.dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'ok' });
  same(result.status, 0, 'exit');
  if (!JSON.stringify(jsonOut(result)).includes('equal')) throw new Error(`result state is not equal: ${truncate(result.stdout)}`);
}
assertPerLeg('case-d3:equal-candidate-exit-0-equal', leg => caseD3(leg));

// D4: a one-byte difference → exit 1 stale; the checked-in target must be preserved byte for byte.
function caseD4(leg) {
  const { ws } = viewWorkspace();
  writeTarget(ws);
  const dir = candidateDir();
  const candidate = path.join(dir, 'candidate.md');
  const differing = Buffer.concat([TARGET_BYTES.slice(0, TARGET_BYTES.length - 1), Buffer.from('X\n', 'utf8')]);
  fs.writeFileSync(candidate, differing);
  const before = sha256(path.join(ws, 'docs', 'index.md'));
  const result = runCompare(leg.dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'ok' });
  same(result.status, 1, 'exit');
  if (!JSON.stringify(jsonOut(result)).includes('stale')) throw new Error(`result state is not stale: ${truncate(result.stdout)}`);
  same(sha256(path.join(ws, 'docs', 'index.md')), before, 'target preserved');
}
assertPerLeg('case-d4:one-byte-diff-stale-target-preserved', leg => caseD4(leg));

// D5: the declared target file is absent → exit 1 missing-view.
function caseD5(leg) {
  const { ws } = viewWorkspace();
  const dir = candidateDir();
  const candidate = path.join(dir, 'candidate.md');
  fs.writeFileSync(candidate, TARGET_BYTES);
  const result = runCompare(leg.dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'ok' });
  same(result.status, 1, 'exit');
  if (!JSON.stringify(jsonOut(result)).includes('missing-view')) throw new Error(`result state is not missing-view: ${truncate(result.stdout)}`);
}
assertPerLeg('case-d5:missing-target-missing-view', leg => caseD5(leg));

// D6: reported generator failure with an artifact that happens to equal the target must not pass.
function caseD6(leg) {
  const { ws } = viewWorkspace();
  writeTarget(ws);
  const dir = candidateDir();
  const candidate = path.join(dir, 'candidate.md');
  fs.writeFileSync(candidate, TARGET_BYTES);
  const result = runCompare(leg.dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'failed' });
  same(result.status, 1, 'exit');
  if (!JSON.stringify(jsonOut(result)).includes('failed')) throw new Error(`result state is not generator-failed: ${truncate(result.stdout)}`);
}
assertPerLeg('case-d6:failed-status-equal-candidate-not-equal', leg => caseD6(leg));

// D7: reported timeout → exit 2 generation-timeout; the candidate must not be compared (an equal
// candidate would otherwise return equal on this lane).
function caseD7(leg) {
  const { ws } = viewWorkspace();
  writeTarget(ws);
  const dir = candidateDir();
  const candidate = path.join(dir, 'candidate.md');
  fs.writeFileSync(candidate, TARGET_BYTES);
  const result = runCompare(leg.dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'timeout' });
  same(result.status, 2, 'exit');
  const text = JSON.stringify(jsonOut(result));
  if (!text.includes('timeout')) throw new Error(`result state is not generation-timeout: ${truncate(result.stdout)}`);
  if (text.includes('"equal"')) throw new Error('candidate compared despite timeout');
}
assertPerLeg('case-d7:timeout-status-not-compared', leg => caseD7(leg));

// D8: reported unavailable generator → exit 2 generator-unavailable.
function caseD8(leg) {
  const { ws } = viewWorkspace();
  writeTarget(ws);
  const dir = candidateDir();
  const candidate = path.join(dir, 'candidate.md');
  fs.writeFileSync(candidate, TARGET_BYTES);
  const result = runCompare(leg.dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'unavailable' });
  same(result.status, 2, 'exit');
  if (!JSON.stringify(jsonOut(result)).includes('unavailable')) throw new Error(`result state is not generator-unavailable: ${truncate(result.stdout)}`);
}
assertPerLeg('case-d8:unavailable-status-exit-2', leg => caseD8(leg));

// D9: a missing or invalid --generation-status → exit 2 on both variants.
function caseD9(leg) {
  const { ws } = viewWorkspace();
  writeTarget(ws);
  const dir = candidateDir();
  const candidate = path.join(dir, 'candidate.md');
  fs.writeFileSync(candidate, TARGET_BYTES);
  same(runCompare(leg.dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate }).status, 2, 'missing status exit');
  same(runCompare(leg.dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'bogus' }).status, 2, 'invalid status exit');
}
assertPerLeg('case-d9:missing-or-invalid-status-exit-2', leg => caseD9(leg));

// D10: an undeclared view, and a config declaring the same view twice, both exit 2.
function caseD10(leg) {
  const plain = viewWorkspace();
  writeTarget(plain.ws);
  const dir = candidateDir();
  const candidate = path.join(dir, 'candidate.md');
  fs.writeFileSync(candidate, TARGET_BYTES);
  same(runCompare(leg.dir, { workspace: plain.ws, config: CONFIG, view: 'docs/other.md', candidate, status: 'ok' }).status, 2, 'undeclared view exit');

  const duplicate = viewWorkspace([
    { path: 'docs/index.md', generator: sentinelGenerator(plain.ws) },
    { path: 'docs/index.md', generator: sentinelGenerator(plain.ws) }
  ]);
  writeTarget(duplicate.ws);
  same(runCompare(leg.dir, { workspace: duplicate.ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'ok' }).status, 2, 'duplicate declaration exit');
}
assertPerLeg('case-d10:undeclared-or-duplicate-view-exit-2', leg => caseD10(leg));

// D11: a candidate that is the target itself — directly or through a symlink (skipped on
// win32 where symlinking may need privileges) — is rejected with exit 2.
function caseD11(leg) {
  const { ws } = viewWorkspace();
  writeTarget(ws);
  const direct = runCompare(leg.dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate: path.join(ws, 'docs', 'index.md'), status: 'ok' });
  same(direct.status, 2, 'direct alias exit');
  if (process.platform === 'win32') return;
  const link = path.join(ws, 'docs', 'alias.md');
  fs.symlinkSync(path.join(ws, 'docs', 'index.md'), link);
  const through = runCompare(leg.dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate: link, status: 'ok' });
  same(through.status, 2, 'symlink alias exit');
}
assertPerLeg('case-d11:candidate-aliases-target-exit-2', leg => caseD11(leg));

// D12: traversal, absolute, and a declared glob are all unsupported selections (exit 2).
function caseD12(leg) {
  const globbed = viewWorkspace([{ path: 'docs/*.md', generator: 'node generator.js' }]);
  writeTarget(globbed.ws);
  const dir = candidateDir();
  const candidate = path.join(dir, 'candidate.md');
  fs.writeFileSync(candidate, TARGET_BYTES);
  same(runCompare(leg.dir, { workspace: globbed.ws, config: CONFIG, view: '../x', candidate, status: 'ok' }).status, 2, 'traversal exit');
  same(runCompare(leg.dir, { workspace: globbed.ws, config: CONFIG, view: path.join(os.tmpdir(), 'elsewhere.md'), candidate, status: 'ok' }).status, 2, 'absolute view exit');
  const globResult = runCompare(leg.dir, { workspace: globbed.ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'ok' });
  same(globResult.status, 2, 'glob view exit');
  if (!JSON.stringify(jsonOut(globResult)).includes('unsupported')) throw new Error(`glob selection not reported unsupported: ${truncate(globResult.stdout)}`);
}
assertPerLeg('case-d12:traversal-absolute-glob-unsupported', leg => caseD12(leg));

// D13: CRLF candidate bytes against an LF target are stale — no normalization, no trimming.
function caseD13(leg) {
  const { ws } = viewWorkspace();
  writeTarget(ws);
  const dir = candidateDir();
  const candidate = path.join(dir, 'candidate.md');
  fs.writeFileSync(candidate, Buffer.from(TARGET_BYTES.toString('utf8').replace(/\n/g, '\r\n'), 'utf8'));
  const result = runCompare(leg.dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'ok' });
  let comparison;
  try { comparison = JSON.parse(result.stdout); } catch { comparison = null; }
  const detail = `compare-derived JSON: ${JSON.stringify(comparison)}; stdout: ${truncate(result.stdout)}; stderr: ${truncate(result.stderr)}`;
  same(result.status, 1, `exit; ${detail}`);
  if (!comparison || !JSON.stringify(comparison).includes('stale')) throw new Error(`CRLF candidate accepted; ${detail}`);
}
assertPerLeg('case-d13:crlf-candidate-not-normalized', leg => caseD13(leg));

// D14: every compare-derived lane above (plus D1) printed exactly one JSON object on stdout.
{
  const id = 'case-d14:stdout-single-json-object';
  try {
    const bad = compareRuns
      .filter(run => {
        const text = run.output.trim();
        if (!text.startsWith('{') || !text.endsWith('}')) return true;
        try { JSON.parse(text); return false; } catch { return true; }
      }).length;
    if (bad > 0) throw new Error(`${bad} compare-derived lane(s) without one JSON object on stdout`);
    record('PASS', id, 'both');
  } catch (error) {
    record('FAIL', id, 'both', error.message.split('\n')[0]);
  }
}

// D15: dogfood — the repo declares docs/governed-index.md; the index generator runs through
// explicit argv with Buffer capture, then compare-derived must see exit 0 equal. RED until the
// coordinator generates the index (A2 §2).
{
  const id = 'case-d15:dogfood-index-matches-checkin';
  assertPerLeg(id, leg => {
    const generation = spawnSync(process.execPath, [
      path.join(LEGS[0].dir, 'doc-lifecycle.js'), 'index',
      '--workspace', ROOT,
      '--config', CONFIG,
      '--all'
    ], { encoding: 'buffer', cwd: ROOT });
    if (generation.status !== 0) throw new Error(`index generation failed (exit ${generation.status}): ${truncate(generation.stderr.toString())}`);
    const dir = candidateDir();
    const candidate = path.join(dir, 'candidate-index.md');
    fs.writeFileSync(candidate, generation.stdout);
    const result = runCompare(leg.dir, { workspace: ROOT, config: CONFIG, view: 'docs/governed-index.md', candidate, status: 'ok' });
    same(result.status, 0, 'exit');
    if (!JSON.stringify(jsonOut(result)).includes('equal')) throw new Error(`result state is not equal: ${truncate(result.stdout)}`);
  });
}

// ---- P case: byte parity -------------------------------------------------------------------------------------------

{
  const id = 'case-p1:doc-check-byte-parity';
  try {
    same(sha256(path.join(LEGS[1].dir, MODULE)), sha256(path.join(LEGS[0].dir, MODULE)), 'sha256 doc-check.js source = packaged');
    record('PASS', id, 'both');
  } catch (error) {
    record('FAIL', id, 'both', error.message.split('\n')[0]);
  }
}

// ---- Mutation probes (run with --mutation-probes once the suite is GREEN) -------------------------------------------
// Probes mutate a tmp copy of the source scripts and expect the referenced case assertion to
// throw on the mutant (mutation detected). Each becomes meaningful at GREEN; at RED they may
// report that they did not apply — sharpen the locator for the implemented shape then.

class ProbeApplyError extends Error {}

function scriptCopy(prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  fs.cpSync(LEGS[0].dir, dir, { recursive: true });
  return dir;
}

function applyMutation(dir, needle, replacement, label) {
  const file = path.join(dir, MODULE);
  const original = fs.readFileSync(file, 'utf8');
  const occurrences = original.split(needle).length - 1;
  if (occurrences !== 1) throw new ProbeApplyError(`locator "${needle}" (${label}) matched ${occurrences} occurrences; probe did not apply`);
  fs.writeFileSync(file, original.replace(needle, replacement));
}

// mp1: ignore --generation-status (treat every reported status as ok). Shape-independent wiring:
// rewrite the extra argv so a `failed` report is presented as `ok`; D6 must then fail on the mutant.
function mp1Apply() {
  const dir = scriptCopy('f3 derived mp1 ');
  const marker = 'if (require.main === module)';
  const injected = 'if (process.env.F3_MP1) { const i = process.argv.indexOf(\'--generation-status\'); if (i >= 0 && process.argv[i + 1] !== undefined) process.argv.splice(i, 2, \'--generation-status\', \'ok\'); }\n';
  applyMutation(dir, marker, `${injected}${marker}`, 'mp1 main gate');
  return dir;
}

function mp1Assert(dir) {
  const { ws } = viewWorkspace();
  writeTarget(ws);
  const dirC = candidateDir();
  const candidate = path.join(dirC, 'candidate.md');
  fs.writeFileSync(candidate, TARGET_BYTES);
  // The D6 assertion: a failed generation report with an equal artifact must not pass.
  const result = runCompare(dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'failed', extra: { env: { ...process.env, F3_MP1: '1' } } });
  same(result.status, 1, 'exit (mutated ignored status must violate this)');
}

// mp2: normalize line endings while reading bytes; D13 (CRLF candidate) must then fail on the mutant.
function mp2Apply() {
  const dir = scriptCopy('f3 derived mp2 ');
  const file = path.join(dir, MODULE);
  const original = fs.readFileSync(file, 'utf8');
  const needle = 'const fs = require(\'fs\');';
  const occurrences = original.split(needle).length - 1;
  if (occurrences !== 1) throw new ProbeApplyError(`fs require hook (${occurrences}); sharpen this probe for the green shape`);
  const injected = `${needle}\n{ const _rf = fs.readFileSync; fs.readFileSync = (p, o) => { const b = _rf(p, o); if (Buffer.isBuffer(b)) return Buffer.from(b.toString('utf8').replace(/\\r\\n/g, '\\n')); return b; }; }`;
  fs.writeFileSync(file, original.replace(needle, injected));
  return dir;
}

function mp2Assert(dir) {
  const { ws } = viewWorkspace();
  writeTarget(ws);
  const dirC = candidateDir();
  const candidate = path.join(dirC, 'candidate.md');
  fs.writeFileSync(candidate, Buffer.from(TARGET_BYTES.toString('utf8').replace(/\n/g, '\r\n'), 'utf8'));
  // The D13 assertion: CRLF-vs-LF must stay stale under byte comparison.
  const result = runCompare(dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'ok' });
  same(result.status, 1, 'exit (mutated normalization must violate this)');
}

// mp3: neuter the sameFile identity guard; D11 must then fail on the mutant.
function mp3Apply() {
  const dir = scriptCopy('f3 derived mp3 ');
  // The guard's only decision line — elsewhere in the mutant the script stays intact, so the
  // aliased run proceeds to a real byte comparison (exit 0, equal) instead of crashing.
  applyMutation(dir, 'return x.ino > 0 && x.ino === y.ino && x.dev === y.dev;', 'return false;', 'mp3 sameFile identity guard');
  return dir;
}

function mp3Assert(dir) {
  const { ws } = viewWorkspace();
  writeTarget(ws);
  // The D11 assertion: the aliased candidate is rejected with exit 2 AND the identity/alias
  // reason, so the probe cannot pass because a crash or stale result happens to be non-zero.
  const direct = runCompare(dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate: path.join(ws, 'docs', 'index.md'), status: 'ok' });
  const out = jsonOut(direct);
  same(direct.status, 2, 'exit (mutated dropped alias check must violate this)');
  same(out.reason, 'candidate aliases the target', 'reason (mutated dropped alias check must violate this)');
}

if (process.argv.includes('--mutation-probes')) {
  for (const [id, apply, assertFn] of [
    ['mp1:generation-status-ignored-detected-by-d6', mp1Apply, mp1Assert],
    ['mp2:line-ending-normalization-detected-by-d13', mp2Apply, mp2Assert],
    ['mp3:alias-check-dropped-detected-by-d11', mp3Apply, mp3Assert]
  ]) {
    // A probe PASSES when the case assertion throws on the mutant (mutation detected).
    let dir;
    try { dir = apply(); } catch (error) {
      if (error instanceof ProbeApplyError) record('FAIL', id, 'source', `probe did not apply: ${error.message.split('\n')[0]}`);
      else record('FAIL', id, 'source', `apply error: ${error.message.split('\n')[0]}`);
      continue;
    }
    try { assertFn(dir); record('FAIL', id, 'source', 'mutation survived — the case passed on the mutant'); } catch (error) {
      record('PASS', id, 'source', `mutation detected: ${error.message.split('\n')[0]}`);
    }
  }
}

// ---- Summary -------------------------------------------------------------------------------------------------------

console.log(`\nF3 derived-views summary: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP${failed ? `\nFAILED assertions (${failures.length}):\n  ${failures.join('\n  ')}` : ''}${failed === 0 && skipped > 0 ? ' (skips are environment-gated cases only)' : ''}`);

for (const dir of tmpDirs) {
  try { removeTree(dir); } catch { /* tmp leftovers are harmless */ }
}

process.exitCode = failed > 0 ? 1 : 0;

// =====================================================================================================================
// Appended block (packet F3-T3) — D17–D23 and mp4–mp6, appended without touching the frozen cases above.
// Spec: the F3-W3 packet table plus F3-R report rows F3-01, F3-02, F3-08, F3-11; expected values come from that spec,
// never from running code. RED is expected until F3-W3 lands (each case must fail at an assertion, never crash).
// Because this block must be appended strictly after the frozen tail, the frozen mid-file summary is a snapshot;
// the trailing summary below is the authoritative total for the whole file.
// =====================================================================================================================

function appendMsg() {
  return '[T3 appended] ';
}

function runCheckEnv(scriptDir, workspace, args, extraEnv) {
  return spawnIt(scriptDir, 'check', [
    '--workspace', workspace,
    '--config', CONFIG,
    ...(args || [])
  ], { env: { ...process.env, ...(extraEnv || {}) } });
}

function unsupportedEntries(out) {
  return (out && out.coverage && Array.isArray(out.coverage.unsupported)) ? out.coverage.unsupported : [];
}

// ---- Git fixtures for the --base cases (D17, D18) -------------------------------------------------------------------

function gitRun(ws, args) {
  return spawnSync('git', ['-C', ws, ...args], { encoding: 'utf8' });
}

function initGitRepo(ws) {
  const r = gitRun(ws, ['init', '-q']);
  if (r.status !== 0) throw new Error(`git init failed: ${truncate(r.stderr)}`);
  const c = gitRun(ws, ['-c', 'user.email=red@example.invalid', '-c', 'user.name=F3 T3', '-c', 'commit.gpgsign=false', 'add', '-A']);
  if (c.status !== 0) throw new Error(`git add failed: ${truncate(c.stderr)}`);
  const d = gitRun(ws, ['-c', 'user.email=red@example.invalid', '-c', 'user.name=F3 T3', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'base']);
  if (d.status !== 0) throw new Error(`git commit failed: ${truncate(d.stderr)}`);
}

/// D17: with the declaration committed at HEAD and then removed in the working tree, `check --base HEAD` (config as a
/// changed path) must name the removed declaration: an unsupported entry {path:"docs/index.md", state:"unverified",
/// applicability:"declaration-removed"}. The F2 exit meaning is unchanged: the exit equals the same run with the
/// declaration still present. (F3-01, first lane.)
function caseD17Body(dir, extraEnv) {
  const { ws } = viewWorkspace();
  writeDoc(ws, 'docs/a.md', refDoc('Plain governed text.\n'));
  initGitRepo(ws);
  const flags = ['--base', 'HEAD', '--changed-path', CONFIG];
  const control = runCheckEnv(dir, ws, flags, extraEnv);
  same(control.status, 0, 'control exit (declaration present)');
  writeDoc(ws, CONFIG, `${JSON.stringify({ governed: [{ path: 'docs/a.md', role: 'reference' }], derived: [] }, null, 2)}\n`);
  const result = runCheckEnv(dir, ws, flags, extraEnv);
  const out = jsonOut(result);
  const entry = unsupportedEntries(out).find(item => item.path === 'docs/index.md');
  if (!entry) throw new Error(`no unsupported entry naming docs/index.md: ${truncate(JSON.stringify(unsupportedEntries(out)))}`);
  same(entry.state, 'unverified', 'coverage state');
  same(entry.applicability, 'declaration-removed', 'coverage applicability');
  same(result.status, control.status, 'exit unchanged by the added entry');
}

// D18: a committed declaration renamed to docs/new.md must produce entries for BOTH the old path (declaration-changed
// or declaration-removed) and the new path (unverified). (F3-01, rename lane.)
function caseD18Body(dir, extraEnv) {
  const { ws } = viewWorkspace();
  writeDoc(ws, 'docs/a.md', refDoc('Plain governed text.\n'));
  initGitRepo(ws);
  writeDoc(ws, CONFIG, `${JSON.stringify({ governed: [{ path: 'docs/a.md', role: 'reference' }], derived: [{ path: 'docs/new.md', generator: sentinelGenerator(ws) }] }, null, 2)}\n`);
  const result = runCheckEnv(dir, ws, ['--base', 'HEAD', '--changed-path', CONFIG], extraEnv);
  const out = jsonOut(result);
  const oldEntry = unsupportedEntries(out).find(item => item.path === 'docs/index.md');
  if (!oldEntry) throw new Error(`no unsupported entry naming docs/index.md: ${truncate(JSON.stringify(unsupportedEntries(out)))}`);
  same(oldEntry.state, 'unverified', 'old declaration state');
  if (oldEntry.applicability !== 'declaration-changed' && oldEntry.applicability !== 'declaration-removed') {
    throw new Error(`old declaration applicability: got ${JSON.stringify(oldEntry.applicability)} expected declaration-changed or declaration-removed`);
  }
  const newEntry = unsupportedEntries(out).find(item => item.path === 'docs/new.md');
  if (!newEntry) throw new Error(`no unsupported entry naming docs/new.md: ${truncate(JSON.stringify(unsupportedEntries(out)))}`);
  same(newEntry.state, 'unverified', 'new declaration state');
}

// D19: config changed with no --base → at least one entry whose reason starts with the exact warning text. (F3-01)
function caseD19Body(dir) {
  const { ws } = viewWorkspace();
  writeDoc(ws, 'docs/a.md', refDoc('Plain governed text.\n'));
  const result = runCheckEnv(dir, ws, ['--changed-path', CONFIG]);
  const out = jsonOut(result);
  const hit = unsupportedEntries(out).find(item => typeof item.reason === 'string' && item.reason.startsWith('config changed without --base'));
  if (!hit) throw new Error(`no "config changed without --base" entry: ${truncate(JSON.stringify(unsupportedEntries(out)))}`);
}

// D20: a glob declaration is reported as glob-unsupported and never as a concrete unverified view with the literal
// glob path. (F3-01, glob lane.)
function caseD20Body(dir, extraEnv) {
  const globbed = viewWorkspace([{ path: 'docs/*.md', generator: 'node generator.js' }]);
  writeDoc(globbed.ws, 'docs/a.md', refDoc('Plain governed text.\n'));
  const result = runCheckEnv(dir, globbed.ws, ['--changed-path', CONFIG], extraEnv);
  const out = jsonOut(result);
  if (!unsupportedEntries(out).some(item => item.applicability === 'glob-unsupported')) {
    throw new Error(`no glob-unsupported entry: ${truncate(JSON.stringify(unsupportedEntries(out)))}`);
  }
  if (unsupportedEntries(out).some(item => item.path === 'docs/*.md' && item.state === 'unverified')) {
    throw new Error(`the literal glob path is still reported as a concrete unverified view: ${truncate(JSON.stringify(unsupportedEntries(out)))}`);
  }
}

// D21: a FIFO candidate must give exit 2 comparison-unavailable well inside a 5 s timeout — the call must never hang.
// (F3-02; mp5 target. win32 skips: no mkfifo.)
function caseD21Body(dir, fifo, extraEnv) {
  const { ws } = viewWorkspace();
  writeTarget(ws);
  const start = Date.now();
  const result = spawnSync(process.execPath, [
    path.join(dir, MODULE), 'compare-derived',
    '--workspace', ws, '--config', CONFIG,
    '--view', 'docs/index.md', '--candidate', fifo,
    '--generation-status', 'ok'
  ], { encoding: 'utf8', cwd: os.tmpdir(), timeout: 5000, killSignal: 'SIGKILL', env: { ...process.env, ...(extraEnv || {}) } });
  if (result.error) throw new Error(`process killed or failed (${result.error.code || result.error}): this is a hang, not the required exit 2`);
  same(result.status, 2, 'exit');
  const out = jsonOut(result);
  if (!JSON.stringify(out).includes('comparison-unavailable')) throw new Error(`result is not comparison-unavailable: ${truncate(result.stdout)}`);
  const elapsed = Date.now() - start;
  if (elapsed > 4800) throw new Error(`completed after ${elapsed} ms, not well inside the 5 s timeout`);
}

// D22: the declared target symlinked OUT of the workspace is rejected with exit 2 — the symlink-escape guard must stay
// reachable by the suite. (F3-08; mp6 target. win32 skips: symlink dev mode.)
function caseD22Body(dir, extraEnv) {
  const { ws } = viewWorkspace();
  const far = candidateDir();
  const foreign = path.join(far, 'foreign.md');
  fs.writeFileSync(foreign, Buffer.from('# Foreign content outside the workspace\n', 'utf8'));
  fs.mkdirSync(path.join(ws, 'docs'), { recursive: true });
  fs.symlinkSync(foreign, path.join(ws, 'docs', 'index.md'));
  const d2Candidate = candidateDir();
  const candidate = path.join(d2Candidate, 'candidate.md');
  fs.writeFileSync(candidate, TARGET_BYTES);
  const result = runCompare(dir, { workspace: ws, config: CONFIG, view: 'docs/index.md', candidate, status: 'ok', extra: { env: { ...process.env, ...(extraEnv || {}) } } });
  same(result.status, 2, 'exit');
  const out = jsonOut(result);
  if (!JSON.stringify(out).includes('unsupported')) throw new Error(`escaped target not reported unsupported: ${truncate(result.stdout)}`);
}

// D23: a declared view that is also governed must be flagged self-governed in unsupported. (F3-11)
function caseD23Body(dir, extraEnv) {
  const ws = makeWorkspace(null);
  const config = {
    governed: [{ path: 'docs/a.md', role: 'reference' }, { path: 'docs/index.md', role: 'reference' }],
    derived: [{ path: 'docs/index.md', generator: sentinelGenerator(ws) }]
  };
  writeDoc(ws, CONFIG, `${JSON.stringify(config, null, 2)}\n`);
  writeDoc(ws, 'docs/a.md', refDoc('Plain governed text.\n'));
  writeDoc(ws, 'docs/index.md', refDoc('Plain governed text for the self-governed declared view.\n'));
  const result = runCheckEnv(dir, ws, ['--changed-path', 'docs/a.md'], extraEnv);
  const out = jsonOut(result);
  const entry = unsupportedEntries(out).find(item => item.path === 'docs/index.md' && item.applicability === 'self-governed');
  if (!entry) throw new Error(`no self-governed entry for docs/index.md: ${truncate(JSON.stringify(unsupportedEntries(out)))}`);
}

{
  const id = appendMsg() + 'case-d17:removed-declaration-reported-exit-unchanged';
  assertPerLeg(id, leg => caseD17Body(leg.dir));
}

{
  const id = appendMsg() + 'case-d18:renamed-declaration-reports-both-paths';
  assertPerLeg(id, leg => caseD18Body(leg.dir));
}

{
  const id = appendMsg() + 'case-d19:config-change-without-base-flagged';
  assertPerLeg(id, leg => caseD19Body(leg.dir));
}

{
  const id = appendMsg() + 'case-d20:glob-declaration-glob-unsupported';
  assertPerLeg(id, leg => caseD20Body(leg.dir));
}

{
  const id = appendMsg() + 'case-d21:fifo-candidate-exit-2-no-hang';
  for (const leg of LEGS) {
    if (!fs.existsSync(path.join(leg.dir, MODULE))) { record('FAIL', id, leg.name, `module-missing: ${path.relative(ROOT, path.join(leg.dir, MODULE))}`); continue; }
    if (process.platform === 'win32') { record('SKIP', id, leg.name, 'win32: mkfifo unavailable'); continue; }
    const dir = candidateDir();
    const fifo = path.join(dir, 'candidate.fifo');
    const mk = spawnSync('mkfifo', [fifo], { encoding: 'utf8' });
    if (mk.status !== 0) { record('SKIP', id, leg.name, `mkfifo unavailable: ${truncate((mk.stderr || '').trim() || mk.error)}`); continue; }
    try { caseD21Body(leg.dir, fifo); record('PASS', id, leg.name); } catch (error) { record('FAIL', id, leg.name, error.message.split('\n')[0]); }
  }
}

{
  const id = appendMsg() + 'case-d22:target-symlink-escape-exit-2';
  for (const leg of LEGS) {
    if (!fs.existsSync(path.join(leg.dir, MODULE))) { record('FAIL', id, leg.name, `module-missing: ${path.relative(ROOT, path.join(leg.dir, MODULE))}`); continue; }
    if (process.platform === 'win32') { record('SKIP', id, leg.name, 'win32: symlink dev mode'); continue; }
    try { caseD22Body(leg.dir); record('PASS', id, leg.name); } catch (error) { record('FAIL', id, leg.name, error.message.split('\n')[0]); }
  }
}

{
  const id = appendMsg() + 'case-d23:declared-and-governed-self-governed';
  assertPerLeg(id, leg => caseD23Body(leg.dir));
}

// ---- F3-T3 mutation probes (also run with --mutation-probes) --------------------------------------------------------
// Same contract as mp1–mp3 above: a probe PASSES when the case assertion throws on the mutant (mutation detected).
// The mutants are env-gated hook injections right after `const fs = require('fs');` — before any later destructuring —
// so they apply regardless of how the F3-W3 fix is shaped. Inert without F3_MP4/F3_MP5/F3_MP6.

function injectProbeHooks(dir) {
  const file = path.join(dir, MODULE);
  const original = fs.readFileSync(file, 'utf8');
  const needle = `const fs = require('fs');`;
  const occurrences = original.split(needle).length - 1;
  if (occurrences !== 1) throw new ProbeApplyError(`hook injection point matched ${occurrences} occurrences; probe did not apply`);
  // mp4: every `git show` behaves as if the base config read produced nothing usable — the base-config comparison is
  // effectively dropped. D17 must then fail on the mutant.
  // mp5: every sync stat hook reports a regular file (and never a FIFO), so a FIFO candidate passes any isFile gate;
  // the subsequent unguarded read blocks forever → timeout kill → D21 must fail on the mutant.
  // mp6: realpathSync becomes the identity, so the symlink-escape guard can no longer resolve paths out of the
  // workspace; the escaped target is then compared in place → D22 must fail on the mutant.
  const hooks = `
// F3-T3 mutation hooks: inert without F3_MP4 / F3_MP5 / F3_MP6.
if (process.env.F3_MP4) { const cp = require('child_process'); const prev = cp.spawnSync; cp.spawnSync = function () { const cmd = arguments[0]; const args = arguments[1]; if (cmd === 'git' && Array.isArray(args) && args[0] === 'show') return { pid: 0, output: ['', ''], stdout: '', stderr: '', status: 0, signal: null, error: null }; return prev.apply(cp, arguments); }; const prevExec = cp.execFileSync; cp.execFileSync = function () { const cmd = arguments[0]; const args = arguments[1]; if (cmd === 'git' && Array.isArray(args) && args[0] === 'show') return ''; return prevExec.apply(cp, arguments); }; }
if (process.env.F3_MP5) { ['lstatSync', 'statSync', 'fstatSync'].forEach(function (name) { const orig = fs[name]; if (typeof orig !== 'function') return; fs[name] = function () { const st = orig.apply(fs, arguments); return new Proxy(st, { get: (t, k) => (k === 'isFile' ? () => true : k === 'isFIFO' ? () => false : Reflect.get(t, k, t)) }); }; }); }
if (process.env.F3_MP6) { fs.realpathSync = (p) => p; fs.realpathSync.native = fs.realpathSync; }
`;
  fs.writeFileSync(file, original.replace(needle, `${needle}${hooks}`));
}

if (process.argv.includes('--mutation-probes')) {
  // mp5's FIFO must exist before the case body runs (win32 and non-unix skip the probe).
  let fifo = null;
  if (process.platform !== 'win32') {
    const dir = candidateDir();
    const fifoPath = path.join(dir, 'candidate.fifo');
    if (spawnSync('mkfifo', [fifoPath], { encoding: 'utf8' }).status === 0) fifo = fifoPath;
  }

  for (const [id, envKey, caseFn] of [
    [appendMsg() + 'mp4:base-config-comparison-dropped-detected-by-d17', 'F3_MP4', (dir) => caseD17Body(dir, { F3_MP4: '1' })],
    [appendMsg() + 'mp5:regular-file-check-dropped-detected-by-d21', 'F3_MP5', (dir) => caseD21Body(dir, fifo, { F3_MP5: '1' })],
    [appendMsg() + 'mp6:symlink-escape-guard-dropped-detected-by-d22', 'F3_MP6', (dir) => caseD22Body(dir, { F3_MP6: '1' })]
  ]) {
    if (envKey === 'F3_MP5' && !fifo) { record('SKIP', id, 'source', 'mkfifo unavailable'); continue; }
    let dir;
    try { dir = scriptCopy('f3 t3 probes '); injectProbeHooks(dir); } catch (error) {
      if (error instanceof ProbeApplyError) record('FAIL', id, 'source', `probe did not apply: ${error.message.split('\n')[0]}`);
      else record('FAIL', id, 'source', `apply error: ${error.message.split('\n')[0]}`);
      continue;
    }
    try { caseFn(dir); record('FAIL', id, 'source', 'mutation survived — the case passed on the mutant'); } catch (error) {
      record('PASS', id, 'source', `mutation detected: ${error.message.split('\n')[0]}`);
    }
  }
}

// ---- Final summary (authoritative totals incl. the appended block) ---------------------------------------------------

console.log(`\nF3 derived-views summary: ${passed} PASS, ${failed} FAIL, ${skipped} SKIP${failed ? `\nFAILED assertions (${failures.length}):\n  ${failures.join('\n  ')}` : ''}${failed === 0 && skipped > 0 ? ' (skips are environment-gated cases only)' : ''}`);

for (const dir of tmpDirs.splice(0)) {
  try { removeTree(dir); } catch { /* tmp leftovers are harmless */ }
}

process.exitCode = failed > 0 ? 1 : 0;
