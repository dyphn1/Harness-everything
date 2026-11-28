#!/usr/bin/env node
'use strict';

// PR-A conflict-check CLI contract (T2-C #553: decoupled from E1 pilot/provider/adapter;
// runs all surviving CLI, lifecycle collection, and 3a evidence waiver controls on both
// source and packaged legs).
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const LEGS = [
  { name: 'source', dir: path.join(ROOT, 'harness-everything', 'scripts') },
  { name: 'packaged', dir: path.join(ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts') },
];
const CONFIG = '.agents/harness-everything/project-docs.json';
const CONFIG_TEXT = JSON.stringify({
  governed: [{ path: 'docs/current/**', role: 'reference' }],
  legacy: ['docs/legacy/**'],
  domains: ['GRPH', 'LEG'],
}, null, 2) + '\n';

const roots = [];
function write(root, relative, text) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
function git(root, args) {
  const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1' };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return execFileSync('git', ['-C', root, ...args], { env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}
function reference(id, extra = '') {
  return `---\nrole: reference\nstatus: active\nid: ${id}\n${extra}---\n\n# ${id}\n\nA governed document.\n`;
}
function workspace(files, configText = CONFIG_TEXT) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'pra-conflict-check-')));
  roots.push(root);
  write(root, CONFIG, configText);
  for (const [relative, contents] of Object.entries(files)) write(root, relative, contents);
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=Harness Test', '-c', 'user.email=harness@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'baseline']);
  return { root, base: git(root, ['rev-parse', 'HEAD']) };
}
function runCheck(leg, root, base, changed = ['docs/current/a.md'], extra = []) {
  return spawnSync(process.execPath, [path.join(leg.dir, 'doc-check.js'), 'check', '--workspace', root, '--config', CONFIG,
    ...changed.flatMap(item => ['--changed-path', item]), '--base', base, ...extra],
  { cwd: root, encoding: 'utf8' });
}
function report(result) {
  try { return JSON.parse(result.stdout); } catch { return null; }
}
function sha(text) { return crypto.createHash('sha256').update(text).digest('hex'); }

let passed = 0;
let failed = 0;
function check(id, fn) {
  try { fn(); passed += 1; console.log(`PASS ${id}`); }
  catch (error) { failed += 1; console.error(`FAIL ${id} — ${error.message.split('\n')[0]}`); }
}
function checkPerLeg(id, fn) {
  for (const leg of LEGS) check(`${id} [${leg.name}]`, () => fn(leg));
}

try {
  checkPerLeg('F1 full clean corpus emits a bound conflict-check projection', leg => {
    const docs = {
      'docs/current/a.md': reference('GRPH-001'),
      'docs/current/b.md': reference('GRPH-002'),
      'docs/legacy/LEG-001.md': reference('LEG-001'),
    };
    const { root, base } = workspace(docs);
    const result = runCheck(leg, root, base, ['docs/current/a.md'], ['--conflict-assessment']);
    const out = report(result);
    assert.equal(result.status, 0, `expected clean assessment exit 0, got ${result.status}: ${out?.lint?.error || result.stderr}`);
    assert.equal(out.mode, 'conflict-assessment');
    assert.equal(out.capabilities['conflict-check'].state, 'pass');
    assert.deepEqual(out.capabilities['conflict-check'].checkedPaths, ['docs/current/a.md']);
    assert.deepEqual(out.capabilities['conflict-check'].corpus.paths, Object.keys(docs).sort());
    assert.deepEqual(out.capabilities['conflict-check'].corpus.digests, Object.fromEntries(Object.entries(docs).map(([p, text]) => [p, sha(text)])));
    assert.equal(out.capabilities['conflict-check'].corpus.config.path, CONFIG);
    assert.equal(out.capabilities['conflict-check'].corpus.config.digest, sha(fs.readFileSync(path.join(root, CONFIG))));
    assert.equal(out.capabilities['conflict-check'].corpus.baseCommit, base);
  });

  checkPerLeg('F2 plain changed-path check cannot produce conflict-check credit for unchanged conflicts', leg => {
    const { root, base } = workspace({
      'docs/current/a.md': reference('GRPH-001', 'conflicts_with: [GRPH-002]\n'),
      'docs/current/b.md': reference('GRPH-002'),
      'docs/current/probe.md': reference('GRPH-003'),
    });
    const result = runCheck(leg, root, base, ['docs/current/probe.md']);
    const out = report(result);
    assert.equal(result.status, 0, `unchanged conflict must stay a warning in plain check, got ${result.status}`);
    assert.equal(out.capabilities['doc-lint'].state, 'pass');
    assert.equal(out.capabilities['link-check'].state, 'pass');
    assert.equal(out.capabilities['conflict-check'], undefined);
  });

  checkPerLeg('F3 full assessment rejects recorded conflicts on unchanged files', leg => {
    const { root, base } = workspace({
      'docs/current/a.md': reference('GRPH-001', 'conflicts_with: [GRPH-002]\n'),
      'docs/current/b.md': reference('GRPH-002'),
      'docs/current/probe.md': reference('GRPH-003'),
    });
    const result = runCheck(leg, root, base, ['docs/current/probe.md'], ['--conflict-assessment']);
    const out = report(result);
    assert.equal(result.status, 1, `full lint should reject recorded conflict, got ${result.status}`);
    assert.ok(out.lint.diagnostics.some(item => item.code === 'recorded-conflict'));
    assert.notEqual(out.capabilities?.['conflict-check']?.state, 'pass');
  });

  checkPerLeg('duplicate assessment flag is rejected as a duplicate', leg => {
    const { root, base } = workspace({ 'docs/current/a.md': reference('GRPH-001') });
    const result = runCheck(leg, root, base, ['docs/current/a.md'], ['--conflict-assessment', '--conflict-assessment']);
    const out = report(result);
    assert.equal(result.status, 2);
    assert.match(out.lint.error, /repeated argument: --conflict-assessment/);
  });

  checkPerLeg('assessment mode requires its baseline pin', leg => {
    const { root, base } = workspace({ 'docs/current/a.md': reference('GRPH-001') });
    const args = [path.join(leg.dir, 'doc-check.js'), 'check', '--workspace', root, '--config', CONFIG, '--changed-path', 'docs/current/a.md', '--conflict-assessment'];
    const result = spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(report(result).lint.error, /--conflict-assessment requires --base/);
    const unpinned = runCheck(leg, root, 'HEAD', ['docs/current/a.md'], ['--conflict-assessment']);
    assert.equal(report(unpinned).conflictAssessment.state, 'unavailable');
    assert.equal(report(unpinned).conflictAssessment.reason, 'base-not-pinned');
    assert.ok(base);
  });

  checkPerLeg('F4 full graph resolves cross-domain legacy targets and rejects unresolved references', leg => {
    const crossDomain = workspace({
      'docs/current/a.md': reference('GRPH-001', 'conflicts_with: [legacy:LEG-001]\n'),
      'docs/legacy/LEG-001.md': reference('LEG-001'),
      'docs/current/probe.md': reference('GRPH-003'),
    });
    const crossResult = runCheck(leg, crossDomain.root, crossDomain.base, ['docs/current/probe.md'], ['--conflict-assessment']);
    const crossOut = report(crossResult);
    assert.equal(crossResult.status, 1);
    assert.ok(crossOut.lint.diagnostics.some(item => item.code === 'recorded-conflict' && item.path === 'docs/current/a.md'), JSON.stringify(crossOut.lint.diagnostics));
    assert.notEqual(crossOut.capabilities?.['conflict-check']?.state, 'pass');

    const unresolved = workspace({
      'docs/current/a.md': reference('GRPH-001', 'conflicts_with: [LEG-404]\n'),
      'docs/current/probe.md': reference('GRPH-003'),
    });
    const unresolvedResult = runCheck(leg, unresolved.root, unresolved.base, ['docs/current/probe.md'], ['--conflict-assessment']);
    const unresolvedOut = report(unresolvedResult);
    assert.equal(unresolvedResult.status, 1);
    assert.ok(unresolvedOut.lint.diagnostics.some(item => item.code === 'unresolved-ref'), JSON.stringify(unresolvedOut.lint.diagnostics));
    assert.notEqual(unresolvedOut.capabilities?.['conflict-check']?.state, 'pass');
  });

  checkPerLeg('omitted corpus and stale base stay unavailable', leg => {
    const config = JSON.stringify({ governed: [
      { path: 'docs/current/a.md', role: 'reference' },
      { path: 'docs/current/missing.md', role: 'reference' },
    ], legacy: [], domains: ['GRPH'] }, null, 2) + '\n';
    const omitted = workspace({ 'docs/current/a.md': reference('GRPH-001') }, config);
    const incomplete = report(runCheck(leg, omitted.root, omitted.base, ['docs/current/a.md'], ['--conflict-assessment']));
    assert.equal(incomplete.conflictAssessment.state, 'unavailable');
    assert.equal(incomplete.conflictAssessment.reason, 'corpus-incomplete');
    assert.notEqual(incomplete.capabilities?.['conflict-check']?.state, 'pass');

    const clean = workspace({ 'docs/current/a.md': reference('GRPH-001') });
    const stale = report(runCheck(leg, clean.root, 'deadbeef', ['docs/current/a.md'], ['--conflict-assessment']));
    assert.notEqual(stale?.capabilities?.['conflict-check']?.state, 'pass');
  });

  checkPerLeg('symlink skips and unreadable corpus files mark the full collection incomplete', leg => {
    const lifecycle = require(path.join(leg.dir, 'doc-lifecycle.js'));
    const { root } = workspace({ 'docs/current/a.md': reference('GRPH-001') });
    const external = path.join(os.tmpdir(), `pra-outside-${process.pid}-${leg.name}.md`);
    write(root, 'docs/current/skipped.md', reference('GRPH-002'));
    fs.writeFileSync(external, reference('GRPH-003'));
    let linked = false;
    try {
      fs.rmSync(path.join(root, 'docs/current/skipped.md'));
      fs.symlinkSync(external, path.join(root, 'docs/current/skipped.md'));
      linked = true;
    } catch (error) {
      if (process.platform !== 'win32' || !['EPERM', 'EACCES', 'ENOSYS'].includes(error.code)) throw error;
    }
    try {
      if (linked) {
        const result = report(runCheck(leg, root, git(root, ['rev-parse', 'HEAD']), ['docs/current/a.md'], ['--conflict-assessment']));
        assert.equal(result.conflictAssessment.state, 'unavailable');
        assert.equal(result.conflictAssessment.reason, 'corpus-incomplete');
      }
    } finally {
      fs.rmSync(external, { force: true });
    }

    const target = path.join(root, 'docs/current/a.md');
    const originalRead = fs.readFileSync;
    const coverage = {};
    fs.readFileSync = function (file, ...args) {
      if (typeof file === 'string' && path.resolve(file) === target) {
        const error = new Error('fixture unreadable');
        error.code = 'EACCES';
        throw error;
      }
      return originalRead.call(this, file, ...args);
    };
    try {
      lifecycle.collectDocs(root, { governed: [{ path: 'docs/current/**', role: 'reference' }], legacy: [] }, coverage);
    } finally { fs.readFileSync = originalRead; }
    assert.equal(coverage.complete, false);
    assert.ok(coverage.skipped.some(item => item.path === 'docs/current/a.md' && item.reason === 'unreadable-file'));
  });

  checkPerLeg('a waiver without a successful complete assessment cannot PASS conflict-check', leg => {
    const evidence = require(path.join(leg.dir, 'doc-evidence.js'));
    const scope = ['docs/current/a.md'];
    const digest = 'a'.repeat(64);
    const baselineDigest = 'b'.repeat(64);
    const output = evidence.checkDocObligations({
      obligations: [{ id: 'conflict-check', capability: 'conflict-check', strength: 'MUST', applicability: 'applicable', scope: { paths: scope } }],
      artifacts: { [scope[0]]: { digest } }, baseline: { digest: baselineDigest, artifacts: {} }, executionRecords: [],
      reviewRecords: [{ id: 'waiver-1', obligationId: 'conflict-check', kind: 'waiver', reason: 'assessment was complete',
        citedRecordIds: ['missing-assessment'], paths: scope, artifactDigests: { [scope[0]]: digest }, baseDigest: baselineDigest }],
    });
    const result = output.results.find(item => item.obligationId === 'conflict-check');
    assert.ok(result);
    assert.notEqual(result.outcome, 'pass');
    assert.ok(output.diagnostics.some(item => item.code === 'unsupported-waiver'));
  });
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}

console.log(`\nPR-A conflict-check summary: ${passed}/${passed + failed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
