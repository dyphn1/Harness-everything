const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const helper = require('./test-helper');

console.log('\n[2l] Multi-agent workspace integration...');

const root = path.resolve(__dirname, '..');
const scaffold = path.join(root, 'multi-agent-workspace', 'scripts', 'scaffold.js');
const fixture = path.join(__dirname, 'fixtures', 'agency-agents');

function run(target, args) {
  return spawnSync(process.execPath, [scaffold, '--workspace', target, ...args], {
    cwd: root,
    encoding: 'utf8'
  });
}

function manifestAt(target) {
  return JSON.parse(fs.readFileSync(path.join(target, '.harness', 'multi-agent', 'manifest.json'), 'utf8'));
}

const fallback = helper.tempDir('.mechanism-test-multi-agent-fallback');
fs.mkdirSync(fallback, { recursive: true });
const fallbackRun = run(fallback, []);
const fallbackManifest = manifestAt(fallback);
helper.check(
  '2l. missing agency source is explicit and still scaffolds core workspace',
  fallbackRun.status === 0 && fallbackManifest.agency.status === 'unavailable' && fallbackManifest.zones.length === 6 &&
    fs.existsSync(path.join(fallback, '.harness', 'multi-agent', 'memory-index.md')),
  fallbackRun.stderr || fallbackRun.stdout
);

const missingSourceTarget = helper.tempDir('.mechanism-test-multi-agent-missing-source');
fs.mkdirSync(missingSourceTarget, { recursive: true });
const missingSource = run(missingSourceTarget, ['--agency-source', path.join(missingSourceTarget, 'does-not-exist')]);
helper.check('2l. an explicitly missing agency source fails clearly', missingSource.status !== 0 && (missingSource.stderr + missingSource.stdout).includes('agency source not found'), missingSource.stderr + missingSource.stdout);

const sourced = helper.tempDir('.mechanism-test-multi-agent-source');
fs.mkdirSync(sourced, { recursive: true });
const sourcedRun = run(sourced, ['--agency-source', fixture, '--division', 'engineering', '--platform', 'codex']);
const sourcedManifest = manifestAt(sourced);
const sourcedRoot = path.join(sourced, '.harness', 'multi-agent');
const catalog = JSON.parse(fs.readFileSync(path.join(sourcedRoot, 'roles', 'agency-catalog.json'), 'utf8'));
const handoff = JSON.parse(fs.readFileSync(path.join(sourcedRoot, 'handoff.json'), 'utf8'));
helper.check(
  '2l. fixture source selects metadata and records a verified handoff',
  sourcedRun.status === 0 && sourcedManifest.agency.status === 'available' && sourcedManifest.agency.agentCount === 2 &&
    sourcedManifest.selectedAgents.length === 1 && catalog.source.agentCount === 2 && handoff.verification.indexer === 'passed',
  sourcedRun.stderr || sourcedRun.stdout
);

const secondRun = run(sourced, ['--agency-source', fixture, '--division', 'engineering', '--platform', 'codex']);
helper.check('2l. repeated scaffold is idempotent', secondRun.status === 0, secondRun.stderr || secondRun.stdout);

const generatedIndexer = spawnSync(process.execPath, [path.join(sourcedRoot, 'index_memory.js'), '--root', sourced, '--output', path.join(sourcedRoot, 'memory-index.md')], { encoding: 'utf8' });
const index = fs.readFileSync(path.join(sourcedRoot, 'memory-index.md'), 'utf8');
helper.check('2l. generated indexer runs independently and lists selected specialist', generatedIndexer.status === 0 && index.includes('Code Reviewer'), generatedIndexer.stderr || generatedIndexer.stdout);

const unsupported = run(helper.tempDir('.mechanism-test-multi-agent-unsupported'), ['--platform', 'unknown']);
helper.check('2l. unsupported platform fails explicitly', unsupported.status !== 0 && (unsupported.stderr + unsupported.stdout).includes('unsupported platform'), unsupported.stderr + unsupported.stdout);

const duplicateSource = helper.tempDir('.mechanism-test-multi-agent-duplicate');
fs.cpSync(fixture, duplicateSource, { recursive: true });
const duplicateFile = path.join(duplicateSource, 'testing', 'reality-checker.md');
fs.writeFileSync(duplicateFile, fs.readFileSync(duplicateFile, 'utf8').replace('name: Reality Checker', 'name: Code Reviewer'));
const duplicateTarget = helper.tempDir('.mechanism-test-multi-agent-duplicate-target');
fs.mkdirSync(duplicateTarget, { recursive: true });
const duplicate = run(duplicateTarget, ['--agency-source', duplicateSource]);
helper.check('2l. duplicate agent names fail before writing output', duplicate.status !== 0 && (duplicate.stderr + duplicate.stdout).includes('duplicate agent name'), duplicate.stderr + duplicate.stdout);

const emptySource = helper.tempDir('.mechanism-test-multi-agent-empty');
fs.cpSync(fixture, emptySource, { recursive: true });
const emptyManifestPath = path.join(emptySource, 'divisions.json');
const emptyManifest = JSON.parse(fs.readFileSync(emptyManifestPath, 'utf8'));
emptyManifest.divisions.empty = { label: 'Empty', icon: 'Box', color: '#000000' };
fs.writeFileSync(emptyManifestPath, JSON.stringify(emptyManifest, null, 2));
fs.mkdirSync(path.join(emptySource, 'empty'));
const emptyTarget = helper.tempDir('.mechanism-test-multi-agent-empty-target');
fs.mkdirSync(emptyTarget, { recursive: true });
const empty = run(emptyTarget, ['--agency-source', emptySource]);
helper.check('2l. empty division fails before writing output', empty.status !== 0 && (empty.stderr + empty.stdout).includes('division is empty'), empty.stderr + empty.stdout);

const unsafeSource = helper.tempDir('.mechanism-test-multi-agent-unsafe-id');
fs.cpSync(fixture, unsafeSource, { recursive: true });
const unsafeManifest = JSON.parse(fs.readFileSync(path.join(unsafeSource, 'divisions.json'), 'utf8'));
unsafeManifest.divisions['../outside'] = { label: 'Outside', icon: 'Alert', color: '#000000' };
fs.writeFileSync(path.join(unsafeSource, 'divisions.json'), JSON.stringify(unsafeManifest, null, 2));
const unsafeTarget = helper.tempDir('.mechanism-test-multi-agent-unsafe-target');
fs.mkdirSync(unsafeTarget, { recursive: true });
const unsafe = run(unsafeTarget, ['--agency-source', unsafeSource]);
helper.check('2l. unsafe division path is rejected before reading outside source', unsafe.status !== 0 && (unsafe.stderr + unsafe.stdout).includes('safe path segment'), unsafe.stderr + unsafe.stdout);

const driftTarget = helper.tempDir('.mechanism-test-multi-agent-drift');
fs.mkdirSync(driftTarget, { recursive: true });
const initial = run(driftTarget, ['--agency-source', fixture]);
const driftManifestPath = path.join(driftTarget, '.harness', 'multi-agent', 'manifest.json');
const driftManifest = JSON.parse(fs.readFileSync(driftManifestPath, 'utf8'));
driftManifest.agency.sourceRevision = 'previous-source-revision';
fs.writeFileSync(driftManifestPath, JSON.stringify(driftManifest, null, 2));
const drift = run(driftTarget, ['--agency-source', fixture]);
const allowedDrift = run(driftTarget, ['--agency-source', fixture, '--allow-source-drift']);
helper.check('2l. source revision drift requires an explicit override', initial.status === 0 && drift.status !== 0 && allowedDrift.status === 0, drift.stderr + drift.stdout);

helper.finish();
