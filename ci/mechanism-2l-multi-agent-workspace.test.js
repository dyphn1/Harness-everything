const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const helper = require('./test-helper');

console.log('\n[2l] Multi-agent workspace integration...');

const root = path.resolve(__dirname, '..');
const scaffold = path.join(root, 'multi-agent-workspace', 'scripts', 'scaffold.js');
const indexer = path.join(root, 'multi-agent-workspace', 'scripts', 'index_memory.js');
const { getRuntimeRoot, resolveProjectDocs } = require('../multi-agent-workspace/scripts/project-docs-resolver');
const fixture = path.join(__dirname, 'fixtures', 'agency-agents');
const stateHome = helper.tempDir('.mechanism-test-multi-agent-state');
fs.mkdirSync(stateHome, { recursive: true });
process.env.HARNESS_STATE_HOME = stateHome;

const workspaceSkill = fs.readFileSync(path.join(root, 'multi-agent-workspace', 'SKILL.md'), 'utf8');
const grillPlaybook = fs.readFileSync(path.join(root, 'grill-with-docs', 'references', 'session-playbook.md'), 'utf8');
helper.check(
  '2l. skill contract names global runtime and resolved document writes',
  workspaceSkill.includes('| **State Mutations** |') && workspaceSkill.includes('global workspace-keyed Harness state home') &&
    workspaceSkill.includes('resolver-selected committable repository paths'),
  workspaceSkill
);
helper.check(
  '2l. grill fallback names committable document paths',
  grillPlaybook.includes('**Committable fallback**') && grillPlaybook.includes('`docs/adr/`') &&
    !grillPlaybook.includes('.github/harness-everything/adr/'),
  grillPlaybook
);

function run(target, args) {
  return spawnSync(process.execPath, [scaffold, '--workspace', target, ...args], {
    cwd: root,
    env: { ...process.env, HARNESS_STATE_HOME: stateHome },
    encoding: 'utf8'
  });
}

function manifestAt(target) {
  return JSON.parse(fs.readFileSync(path.join(getRuntimeRoot(target), 'manifest.json'), 'utf8'));
}

const fallback = helper.tempDir('.mechanism-test-multi-agent-fallback');
fs.mkdirSync(fallback, { recursive: true });
const fallbackRun = run(fallback, []);
const fallbackManifest = manifestAt(fallback);
helper.check(
  '2l. missing agency source is explicit and still scaffolds core workspace',
  fallbackRun.status === 0 && fallbackManifest.agency.status === 'unavailable' && fallbackManifest.zones.length === 6 &&
    fallbackManifest.documentationZones.length === 3 &&
    fallbackManifest.paths.decision.source === 'fallback' && fallbackManifest.paths.decision.relativePath === 'docs/adr' &&
    fallbackManifest.paths.domain.source === 'fallback' && fallbackManifest.paths.domain.relativePath === 'docs/domain' &&
    fallbackManifest.paths.architecture.source === 'fallback' && fallbackManifest.paths.architecture.relativePath === 'docs/architecture' &&
    fs.existsSync(path.join(getRuntimeRoot(fallback), 'memory-index.md')) &&
    !fs.existsSync(path.join(fallback, '.harness')),
  fallbackRun.stderr || fallbackRun.stdout
);

const mapped = helper.tempDir('.mechanism-test-multi-agent-context-map');
fs.mkdirSync(path.join(mapped, 'src', 'ordering'), { recursive: true });
fs.mkdirSync(path.join(mapped, 'src', 'billing'), { recursive: true });
fs.writeFileSync(path.join(mapped, 'src', 'ordering', 'CONTEXT.md'), '# Ordering\n');
fs.writeFileSync(path.join(mapped, 'src', 'billing', 'CONTEXT.md'), '# Billing\n');
fs.writeFileSync(path.join(mapped, 'CONTEXT-MAP.md'), [
  '# Context Map', '',
  '- [Ordering](./src/ordering/CONTEXT.md)',
  '- [Billing](./src/billing/CONTEXT.md)'
].join('\n'));
fs.mkdirSync(path.join(mapped, '.claude', 'harness-everything'), { recursive: true });
fs.writeFileSync(path.join(mapped, '.claude', 'harness-everything', 'manifest.json'), JSON.stringify({ projectDocs: {
  decisionLocation: 'records/decisions', domainLocation: 'records/domain', architectureLocation: 'records/architecture'
} }));
const mappedResolution = resolveProjectDocs(mapped);
helper.check(
  '2l. root CONTEXT-MAP takes precedence for every document zone',
  mappedResolution.paths.decision.resolution === 'explicit' && mappedResolution.paths.decision.source === 'context-map' &&
    mappedResolution.paths.domain.resolution === 'explicit' && mappedResolution.paths.domain.source === 'context-map' &&
    mappedResolution.paths.architecture.resolution === 'explicit' && mappedResolution.paths.architecture.source === 'context-map' &&
    mappedResolution.paths.decision.path === path.join(mapped, 'src') &&
    mappedResolution.paths.domain.path === path.join(mapped, 'src') &&
    mappedResolution.paths.architecture.path === path.join(mapped, 'src'),
  JSON.stringify(mappedResolution.paths)
);

if (process.platform === 'win32') {
  const caseMapped = helper.tempDir('.mechanism-test-multi-agent-context-map-case');
  fs.mkdirSync(path.join(caseMapped, 'src', 'ordering'), { recursive: true });
  fs.mkdirSync(path.join(caseMapped, 'src', 'billing'), { recursive: true });
  fs.writeFileSync(path.join(caseMapped, 'src', 'ordering', 'CONTEXT.md'), '# Ordering\n');
  fs.writeFileSync(path.join(caseMapped, 'src', 'billing', 'CONTEXT.md'), '# Billing\n');
  fs.writeFileSync(path.join(caseMapped, 'CONTEXT-MAP.md'), [
    '- [Ordering](./src/ordering/CONTEXT.md)',
    '- [Billing](./SRC/billing/CONTEXT.md)'
  ].join('\n'));
  const caseResolution = resolveProjectDocs(caseMapped);
  helper.check(
    '2l. CONTEXT-MAP common paths are case-insensitive on Windows',
    caseResolution.paths.domain.path === path.join(caseMapped, 'src'),
    JSON.stringify(caseResolution.paths)
  );
}

const configured = helper.tempDir('.mechanism-test-multi-agent-project-docs');
fs.mkdirSync(path.join(configured, '.claude', 'harness-everything'), { recursive: true });
fs.writeFileSync(path.join(configured, '.claude', 'harness-everything', 'manifest.json'), JSON.stringify({ projectDocs: {
  decisionLocation: 'records/decisions', domainLocation: 'records/domain', architectureLocation: 'records/architecture'
} }));
const configuredResolution = resolveProjectDocs(configured);
helper.check(
  '2l. projectDocs paths are explicit and do not become inferred paths',
  configuredResolution.paths.decision.resolution === 'explicit' && configuredResolution.paths.domain.resolution === 'explicit' &&
    configuredResolution.paths.architecture.resolution === 'explicit',
  JSON.stringify(configuredResolution.paths)
);

const inferred = helper.tempDir('.mechanism-test-multi-agent-inference');
for (const zone of ['adr', 'domain', 'architecture']) fs.mkdirSync(path.join(inferred, 'docs', zone), { recursive: true });
const inferredResolution = resolveProjectDocs(inferred);
helper.check(
  '2l. existing repository document folders are inferred',
  inferredResolution.paths.decision.resolution === 'inferred' && inferredResolution.paths.domain.resolution === 'inferred' &&
    inferredResolution.paths.architecture.resolution === 'inferred',
  JSON.stringify(inferredResolution.paths)
);

const migrated = helper.tempDir('.mechanism-test-multi-agent-migration');
const migratedLegacy = path.join(migrated, '.harness', 'multi-agent', 'decisions');
fs.mkdirSync(migratedLegacy, { recursive: true });
fs.writeFileSync(path.join(migratedLegacy, 'authored.md'), 'authored decision\n');
fs.writeFileSync(path.join(migrated, '.harness', 'multi-agent', 'manifest.json'), '{}');
const migratedRun = run(migrated, []);
helper.check(
  '2l. legacy authored records migrate to the resolved repository path',
  migratedRun.status === 0 && fs.readFileSync(path.join(migrated, 'docs', 'adr', 'authored.md'), 'utf8') === 'authored decision\n' &&
    !fs.existsSync(path.join(migrated, '.harness')),
  migratedRun.stderr || migratedRun.stdout
);

const conflictTarget = helper.tempDir('.mechanism-test-multi-agent-migration-conflict');
const conflictLegacy = path.join(conflictTarget, '.harness', 'multi-agent', 'decisions');
fs.mkdirSync(conflictLegacy, { recursive: true });
fs.writeFileSync(path.join(conflictLegacy, 'authored.md'), 'old\n');
fs.mkdirSync(path.join(conflictTarget, 'docs', 'adr'), { recursive: true });
fs.writeFileSync(path.join(conflictTarget, 'docs', 'adr', 'authored.md'), 'new\n');
const conflictRun = run(conflictTarget, []);
helper.check(
  '2l. migration conflicts preserve both existing files and legacy source',
  conflictRun.status !== 0 && (conflictRun.stderr + conflictRun.stdout).includes('migration conflict') &&
    fs.readFileSync(path.join(conflictTarget, 'docs', 'adr', 'authored.md'), 'utf8') === 'new\n' &&
    fs.existsSync(path.join(conflictTarget, '.harness', 'multi-agent', 'decisions', 'authored.md')),
  conflictRun.stderr || conflictRun.stdout
);

const collidingTarget = helper.tempDir('.mechanism-test-multi-agent-migration-collision');
const collidingLegacy = path.join(collidingTarget, '.harness', 'multi-agent');
for (const zone of ['decisions', 'domain', 'architecture']) {
  fs.mkdirSync(path.join(collidingLegacy, zone), { recursive: true });
  fs.writeFileSync(path.join(collidingLegacy, zone, 'same.md'), `${zone}\n`);
}
fs.mkdirSync(path.join(collidingTarget, '.claude', 'harness-everything'), { recursive: true });
fs.writeFileSync(path.join(collidingTarget, '.claude', 'harness-everything', 'manifest.json'), JSON.stringify({ projectDocs: {
  decisionLocation: 'records', domainLocation: 'records', architectureLocation: 'records'
} }));
const collidingRun = run(collidingTarget, []);
helper.check(
  '2l. migration rejects duplicate destinations before copying or deleting records',
  collidingRun.status !== 0 && (collidingRun.stderr + collidingRun.stdout).includes('migration conflict') &&
    !fs.existsSync(path.join(collidingTarget, 'records', 'same.md')) &&
    fs.readFileSync(path.join(collidingLegacy, 'decisions', 'same.md'), 'utf8') === 'decisions\n' &&
    fs.readFileSync(path.join(collidingLegacy, 'domain', 'same.md'), 'utf8') === 'domain\n' &&
    fs.readFileSync(path.join(collidingLegacy, 'architecture', 'same.md'), 'utf8') === 'architecture\n',
  collidingRun.stderr || collidingRun.stdout
);

const junctionTarget = helper.tempDir('.mechanism-test-multi-agent-junction');
const junctionOutside = helper.tempDir('.mechanism-test-multi-agent-junction-outside');
fs.mkdirSync(junctionOutside, { recursive: true });
fs.mkdirSync(path.join(junctionTarget, 'linked-docs'), { recursive: true });
fs.rmdirSync(path.join(junctionTarget, 'linked-docs'));
fs.symlinkSync(junctionOutside, path.join(junctionTarget, 'linked-docs'), 'junction');
fs.mkdirSync(path.join(junctionTarget, '.claude', 'harness-everything'), { recursive: true });
fs.writeFileSync(path.join(junctionTarget, '.claude', 'harness-everything', 'manifest.json'), JSON.stringify({ projectDocs: {
  architectureLocation: 'linked-docs/architecture'
} }));
const junctionRun = run(junctionTarget, []);
helper.check(
  '2l. document paths reject junction escapes from the workspace',
  junctionRun.status !== 0 && (junctionRun.stderr + junctionRun.stdout).includes('must stay inside workspace') &&
    !fs.existsSync(path.join(junctionOutside, 'architecture')),
  junctionRun.stderr || junctionRun.stdout
);

const routerPath = path.join(root, 'multi-agent-workspace', 'templates', 'AGENTS.md');
const runtimeRouter = path.join(getRuntimeRoot(fallback), 'AGENTS.md');
const router = fs.existsSync(runtimeRouter) ? fs.readFileSync(runtimeRouter, 'utf8') : '';
helper.check(
  '2l. installed router template resolves paths into global runtime',
  fs.existsSync(routerPath) && fs.existsSync(runtimeRouter) &&
    router.includes(`Write working state to \`${fallbackManifest.runtime.state}\``) &&
    router.includes(`decision records at \`${fallbackManifest.paths.decision.path}\``) &&
    router.includes(`architecture records at \`${fallbackManifest.paths.architecture.path}\``) &&
    !router.includes('.harness/multi-agent'),
  router
);

const missingSourceTarget = helper.tempDir('.mechanism-test-multi-agent-missing-source');
fs.mkdirSync(missingSourceTarget, { recursive: true });
const missingSource = run(missingSourceTarget, ['--agency-source', path.join(missingSourceTarget, 'does-not-exist')]);
helper.check('2l. an explicitly missing agency source fails clearly', missingSource.status !== 0 && (missingSource.stderr + missingSource.stdout).includes('agency source not found'), missingSource.stderr + missingSource.stdout);

const sourced = helper.tempDir('.mechanism-test-multi-agent-source');
fs.mkdirSync(sourced, { recursive: true });
const sourcedRun = run(sourced, ['--agency-source', fixture, '--division', 'engineering', '--platform', 'codex']);
const sourcedManifest = manifestAt(sourced);
const sourcedRoot = getRuntimeRoot(sourced);
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

const generatedIndexer = spawnSync(process.execPath, [indexer, '--workspace', sourced, '--manifest', path.join(sourcedRoot, 'manifest.json'), '--output', path.join(sourcedRoot, 'memory-index.md')], { encoding: 'utf8', env: { ...process.env, HARNESS_STATE_HOME: stateHome } });
const index = fs.readFileSync(path.join(sourcedRoot, 'memory-index.md'), 'utf8');
helper.check('2l. installed indexer runs independently and lists selected specialist', generatedIndexer.status === 0 && index.includes('Code Reviewer') && !fs.existsSync(path.join(sourcedRoot, 'index_memory.js')) && !fs.existsSync(path.join(sourced, 'AGENTS.md')), generatedIndexer.stderr || generatedIndexer.stdout);

const deepOutput = path.join(sourced, 'scratch', 'deep', 'memory.md');
const deepIndexer = spawnSync(process.execPath, [indexer, '--workspace', sourced, '--manifest', path.join(sourcedRoot, 'manifest.json'), '--output', deepOutput], { encoding: 'utf8', env: { ...process.env, HARNESS_STATE_HOME: stateHome } });
helper.check('2l. indexer uses explicit manifest/output paths without depth inference', deepIndexer.status === 0 && fs.readFileSync(deepOutput, 'utf8').includes('Code Reviewer'), deepIndexer.stderr || deepIndexer.stdout);

const missingManifestIndexer = spawnSync(process.execPath, [indexer, '--workspace', sourced, '--manifest', path.join(sourced, 'does-not-exist.json'), '--output', path.join(sourced, 'missing.md')], { encoding: 'utf8', env: { ...process.env, HARNESS_STATE_HOME: stateHome } });
helper.check('2l. indexer fails clearly when its manifest is missing', missingManifestIndexer.status !== 0 && (missingManifestIndexer.stderr + missingManifestIndexer.stdout).includes('manifest not found'), missingManifestIndexer.stderr || missingManifestIndexer.stdout);

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
const driftManifestPath = path.join(getRuntimeRoot(driftTarget), 'manifest.json');
const driftManifest = JSON.parse(fs.readFileSync(driftManifestPath, 'utf8'));
driftManifest.agency.sourceRevision = 'previous-source-revision';
fs.writeFileSync(driftManifestPath, JSON.stringify(driftManifest, null, 2));
const drift = run(driftTarget, ['--agency-source', fixture]);
const allowedDrift = run(driftTarget, ['--agency-source', fixture, '--allow-source-drift']);
helper.check('2l. source revision drift requires an explicit override', initial.status === 0 && drift.status !== 0 && allowedDrift.status === 0, drift.stderr + drift.stdout);

helper.finish();
