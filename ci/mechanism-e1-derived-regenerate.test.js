#!/usr/bin/env node
'use strict';

// Deterministic mechanism evidence: exercises the surviving doc-check.js and doc-lifecycle.js
// CLI paths for --derived-view generation, comparison, and plain-check firebreak.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(process.env.E1_TEST_ROOT || path.join(__dirname, '..'));
const CHECK = path.join(ROOT, 'harness-everything/scripts/doc-check.js');
const LIFECYCLE = path.join(ROOT, 'harness-everything/scripts/doc-lifecycle.js');
const CONFIG = '.agents/harness-everything/project-docs.json';
const SOURCE = 'docs/adr/EVID-001-verify-all-evidence.md';
const VIEW = 'docs/governed-index.md';
const GENERATOR = 'node harness-everything/scripts/doc-lifecycle.js index --workspace . --config ' + CONFIG + ' --all';
const roots = [];
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function write(root, relative, bytes) {
  const file = path.join(root, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, bytes);
}

function fixture(generator = GENERATOR) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e1-derived-regenerate-')));
  roots.push(root);
  const config = {
    governed: [{ path: 'docs/adr/*.md', role: 'adr' }],
    domains: ['EVID'],
    derived: [{ path: VIEW, generator }],
  };
  write(root, CONFIG, JSON.stringify(config, null, 2) + '\n');
  write(root, SOURCE, '---\nid: EVID-001\nrole: adr\nstatus: proposed\n---\n\n# EVID-001\n\n## Decision\n\nRetain evidence identities for generated views.\n');
  fs.mkdirSync(path.join(root, 'harness-everything/scripts'), { recursive: true });
  fs.copyFileSync(LIFECYCLE, path.join(root, 'harness-everything/scripts/doc-lifecycle.js'));
  fs.copyFileSync(path.join(ROOT, 'harness-everything/scripts/project-docs-resolver.js'), path.join(root, 'harness-everything/scripts/project-docs-resolver.js'));
  const generated = spawnSync(process.execPath, [path.join(root, 'harness-everything/scripts/doc-lifecycle.js'), 'index', '--workspace', root, '--config', CONFIG, '--all'], { cwd: root, encoding: 'utf8' });
  assert.equal(generated.status, 0, generated.stderr);
  write(root, VIEW, generated.stdout);
  return root;
}

function runCheck(root, withView = true) {
  const args = [CHECK, 'check', '--workspace', root, '--config', CONFIG, '--changed-path', SOURCE];
  if (withView) args.push('--derived-view', VIEW);
  return spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8' });
}

function getReport(result) {
  assert.ok(result.stdout, result.stderr);
  return JSON.parse(result.stdout);
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, 'temporary Git fixture setup must succeed');
  return result.stdout.trim();
}

function generateIndex(root) {
  const result = spawnSync(process.execPath, [path.join(root, 'harness-everything/scripts/doc-lifecycle.js'),
    'index', '--workspace', root, '--config', CONFIG, '--all'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, 'real lifecycle index generation must succeed');
  write(root, VIEW, result.stdout);
}

function wholeSeamFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e1-derived-whole-seam-')));
  roots.push(root);
  const config = {
    governed: [{ path: 'docs/adr/*.md', role: 'adr' }],
    domains: ['EVID'],
    derived: [{ path: VIEW, generator: GENERATOR }],
  };
  const source = (status, text) => `---\nid: EVID-001\nrole: adr\nstatus: ${status}\n---\n\n# EVID-001\n\n## Decision\n\n${text}\n`;
  write(root, CONFIG, JSON.stringify(config, null, 2) + '\n');
  write(root, SOURCE, source('proposed', 'Baseline evidence identity.'));
  fs.mkdirSync(path.join(root, 'harness-everything/scripts'), { recursive: true });
  fs.copyFileSync(LIFECYCLE, path.join(root, 'harness-everything/scripts/doc-lifecycle.js'));
  fs.copyFileSync(path.join(ROOT, 'harness-everything/scripts/project-docs-resolver.js'), path.join(root, 'harness-everything/scripts/project-docs-resolver.js'));
  generateIndex(root);
  git(root, ['init', '-q']);
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=e1-fixture', '-c', 'user.email=e1-fixture@invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'baseline']);
  const baselineCommit = git(root, ['rev-parse', 'HEAD']);
  const baselineTree = git(root, ['rev-parse', 'HEAD^{tree}']);
  write(root, SOURCE, source('accepted', 'Candidate evidence identity.'));
  generateIndex(root);
  return { root, baselineCommit, baselineTree };
}

function wholeSeam() {
  const project = wholeSeamFixture();
  const plain = runCheck(project.root, false);
  assert.equal(plain.status, 0, 'plain-check positive control must pass on the Git fixture');
  getReport(plain);

  const checked = runCheck(project.root);
  assert.equal(checked.status, 0, 'registered --derived-view check must produce a successful report');
  const report = getReport(checked);
  const projection = report.capabilities['derived-regenerate'];
  assert.equal(projection.state, 'pass');
  assert.deepEqual(projection.checkedPaths, [VIEW]);
}

try {
  if (process.env.E1_BASELINE_RED === '1') {
    const project = wholeSeamFixture();
    const plain = runCheck(project.root, false);
    assert.equal(plain.status, 0, 'pre-repair fixture plain-check positive control must pass');
    getReport(plain);
    const derived = runCheck(project.root);
    const legacyReport = JSON.parse(derived.stdout);
    assert.match(legacyReport.lint?.error || '', /unknown or incomplete argument: --derived-view/,
      'pre-repair compatibility control must identify the unsupported derived-view flag');
    assert.equal(derived.status, 0,
      `pre-repair primary RED: registered --derived-view check must reach the passing derived obligation; legacy parser rejected the flag (child exit ${derived.status})`);
    const projection = getReport(derived).capabilities['derived-regenerate'];
    assert.equal(projection?.state, 'pass', 'pre-repair primary RED: derived result must reach the passing obligation assertion');
  } else {
    const matching = fixture();
    const matchingBytes = fs.readFileSync(path.join(matching, VIEW));
    const matchingRun = runCheck(matching);
    assert.equal(matchingRun.status, 0, matchingRun.stderr);
    const matchingReport = getReport(matchingRun);
    const positive = matchingReport.capabilities['derived-regenerate'];
    assert.equal(positive.state, 'pass');
    assert.deepEqual(positive.checkedPaths, [VIEW]);
    assert.equal(positive.binding.generation.state, 'pass');
    assert.equal(positive.binding.comparison.state, 'equal');
    assert.equal(positive.binding.generation.outputDigest, sha(matchingBytes));
    assert.equal(positive.binding.comparison.targetDigest, sha(matchingBytes));
    assert.equal(positive.binding.sourceCorpus.complete, true);
    assert.deepEqual(positive.binding.sourceCorpus.paths, [SOURCE]);
    assert.equal(positive.binding.config.digest, sha(fs.readFileSync(path.join(matching, CONFIG))));
    assert.equal(matchingReport.coverage.unsupported.some(item => item.path === VIEW), false);

    const stale = fixture();
    const staleTarget = path.join(stale, VIEW);
    fs.appendFileSync(staleTarget, '\nmanual stale edit\n');
    const staleBefore = fs.readFileSync(staleTarget);
    const staleRun = runCheck(stale);
    assert.equal(staleRun.status, 0, staleRun.stderr);
    const staleProjection = getReport(staleRun).capabilities['derived-regenerate'];
    assert.equal(staleProjection.state, 'stale');
    assert.equal(staleProjection.binding.generation.state, 'pass');
    assert.equal(staleProjection.binding.comparison.state, 'stale');
    assert.deepEqual(fs.readFileSync(staleTarget), staleBefore, 'stale target must not be rewritten');

    const unsupportedMarker = 'GENERATOR_MUST_NOT_RUN';
    const unsupportedGenerator = 'node -e ' + JSON.stringify('require("fs").writeFileSync("' + unsupportedMarker + '","ran")');
    const unsupported = fixture(unsupportedGenerator);
    const unsupportedRun = runCheck(unsupported);
    const unsupportedProjection = getReport(unsupportedRun).capabilities['derived-regenerate'];
    assert.equal(unsupportedProjection.state, 'unsupported');
    assert.equal(fs.existsSync(path.join(unsupported, unsupportedMarker)), false, 'configured text must never be executed');

    const plain = runCheck(matching, false);
    assert.equal(plain.status, 0, plain.stderr);
    assert.equal(getReport(plain).capabilities['derived-regenerate'], undefined);

    wholeSeam();
    console.log('PASS E1 derived-regenerate CLI bound generation, stale/unsupported negatives, Git fixture plain/derived controls, and plain-check firebreak (deterministic mechanism evidence)');
  }
} finally {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
}
