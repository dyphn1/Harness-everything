#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const H = require('./fixtures/doc-obligations/reconciliation-s2a/harness.js');
const RUN13_REQUIREMENTS = require('./fixtures/doc-obligations/reconciliation-s2a/run13-workflow-requirements.json');

const PRODUCER = 'doc-reconciliation-producer.js';
const EVENTS = 'doc-reconciliation-events.js';
const CORE = 'doc-reconciliation-core.js';
const RESOLVER = 'project-docs-resolver.js';
const LIFECYCLE = 'doc-lifecycle.js';
const EXPECTED_ROOTS = ['.husky/_', 'node_modules'];
const primaryRedOnly = process.env.E1_DEP_SCOPE_PRIMARY_ONLY === '1';
const failures = [];

const REQUIREMENTS = {
  producer: { where: 'lib', file: PRODUCER, exports: ['produceDocSnapshot'] },
  events: { where: 'lib', file: EVENTS, exports: ['acceptDocEvents'] },
  core: { where: 'lib', file: CORE, exports: ['checkAcceptedDocEvidence'] },
  resolver: { where: 'scripts', file: RESOLVER, exports: ['validateDocsConfig'] },
  lifecycle: { where: 'scripts', file: LIFECYCLE, exports: ['convertWorkspaceFiles'] }
};

function artifactConfig(roots = EXPECTED_ROOTS) {
  return { ...H.clone(H.DERIVE_CONFIG), inventory: { dependencyArtifactRoots: roots.slice() } };
}

function withRepo(options, fn) {
  const vectors = options.vectors || H.vectorFiles('normative');
  const config = options.config === undefined ? H.DERIVE_CONFIG : options.config;
  const repo = H.makeRepo({
    ...vectors.base,
    ...options.baseFiles,
    [H.CONFIG_REL]: `${JSON.stringify(config, null, 2)}\n`
  });
  try {
    H.writeFiles(repo.root, vectors.candidate);
    H.writeFiles(repo.root, options.candidateFiles || {});
    if (options.install !== false) writeInstalledTree(repo.root);
    fn(repo, vectors);
  } finally {
    H.removeRepo(repo.root);
  }
}

function writeInstalledTree(root) {
  const installedPackage = path.join(H.ROOT, 'node_modules', 'husky');
  const installedHooks = path.join(H.ROOT, '.husky', '_');
  assert(fs.statSync(installedPackage).isDirectory(), 'npm-installed Husky package must exist before the witness runs');
  assert(fs.statSync(installedHooks).isDirectory(), 'npm-generated .husky/_ tree must exist before the witness runs');
  const packageDir = path.join(root, 'node_modules', 'husky');
  const binDir = path.join(root, 'node_modules', '.bin');
  fs.mkdirSync(packageDir, { recursive: true });
  fs.mkdirSync(binDir, { recursive: true });
  for (const file of ['bin.js', 'package.json']) fs.copyFileSync(path.join(installedPackage, file), path.join(packageDir, file));
  fs.symlinkSync('../husky/bin.js', path.join(binDir, 'husky'));
  fs.cpSync(installedHooks, path.join(root, '.husky', '_'), { recursive: true, dereference: false });
  assert(fs.statSync(path.join(packageDir, 'bin.js')).isFile(), 'installed package witness must be real Husky JavaScript');
  assert(fs.lstatSync(path.join(binDir, 'husky')).isSymbolicLink(), 'installed .bin witness must be a real symlink');
  assert(fs.statSync(path.join(root, '.husky', '_', 'husky.sh')).isFile(), 'generated Husky witness must come from the installed tree');
}

function writeRegularArtifacts(root) {
  fs.mkdirSync(path.join(root, 'node_modules', 'fixture-package'), { recursive: true });
  fs.mkdirSync(path.join(root, '.husky', '_'), { recursive: true });
  fs.writeFileSync(path.join(root, 'node_modules', 'fixture-package', 'index.js'), 'module.exports = "host-config control";\n');
  fs.writeFileSync(path.join(root, '.husky', '_', 'husky.sh'), '# generated hook artifact\n');
}

function removeProjectConfigFromBaseline(repo, vectors) {
  for (const [key, value] of Object.entries({ 'user.name': 'e1-fixture', 'user.email': 'e1-fixture@invalid', 'commit.gpgsign': 'false' })) {
    H.git(repo.root, ['config', key, value]);
  }
  H.git(repo.root, ['checkout', '--', '.']);
  H.git(repo.root, ['rm', '-q', '--', H.CONFIG_REL]);
  H.git(repo.root, ['commit', '-q', '-m', 'baseline without project docs config']);
  repo.commit = H.git(repo.root, ['rev-parse', 'HEAD']).trim();
  H.writeFiles(repo.root, vectors.candidate);
}

function produce(mods, repo, overrides = {}) {
  const origin = new H.FakeOrigin({ context: H.fakeContext({}, repo) });
  return { result: mods[PRODUCER].produceDocSnapshot(H.producerInput(repo, overrides), { originProvider: origin }), origin };
}

function realTaskPin(repo) {
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), 'e1-dep-scope-state-'));
  const sessionId = `e1-dep-scope-${process.pid}-${Date.now()}`;
  const requirements = [
    { id: 'dep-scope-change', stepType: 'doc-change', summary: 'Change dependency artifact scope.', acceptance: 'The pinned task can capture the installed dependency tree.' },
    { id: 'dep-scope-verify', stepType: 'verification', summary: 'Verify dependency artifact scope.', acceptance: 'The pinned task and selector overlap guards are verified.' }
  ];
  const env = { ...process.env, HARNESS_STATE_HOME: stateHome, HARNESS_WORKSPACE_ROOT: repo.root,
    HARNESS_DOC_RECONCILIATION_PILOT: '1' };
  const run = (script, args, input) => {
    const child = spawnSync(process.execPath, [script, ...args], { cwd: repo.root, env, encoding: 'utf8', input });
    assert.strictEqual(child.status, 0, `${path.basename(script)} ${args[0] || ''}: ${child.stderr || child.stdout}`);
  };
  try {
    run(path.join(H.ROOT, 'harness-everything/scripts/kernel-router.js'), [], JSON.stringify({
      session_id: sessionId, cwd: repo.root,
      prompt: 'Implement a bounded software behavior change, write a focused test, and run integration verification for the dependency artifact scope.'
    }));
    const controller = path.join(H.ROOT, 'hooks/scripts/workflow-disposition.js');
    run(controller, ['plan', '--session-id', sessionId, '--strategy', 'iterative-single', '--evidence', 'real task pin regression witness',
      '--requirements-json', JSON.stringify(requirements)]);
    run(controller, ['start', '--session-id', sessionId]);

    const previousStateHome = process.env.HARNESS_STATE_HOME;
    process.env.HARNESS_STATE_HOME = stateHome;
    let sessionDir;
    try { sessionDir = require(path.join(H.ROOT, 'hooks/scripts/lib/harness-state.js')).getSessionDir(repo.root, sessionId); }
    finally {
      if (previousStateHome === undefined) delete process.env.HARNESS_STATE_HOME;
      else process.env.HARNESS_STATE_HOME = previousStateHome;
    }
    const workflow = JSON.parse(fs.readFileSync(path.join(sessionDir, 'workflow-run.json'), 'utf8'));
    assert.strictEqual(workflow.docReconciliationTask?.taskId, 'task-dep-scope-change+dep-scope-verify',
      'shipped plan/start must produce the task pin used by the consumer-positive');
    assert.strictEqual(workflow.docReconciliationTask?.baselineRoot, repo.root, 'real task pin carries its absolute baseline identity');
    return { workflow, task: { ...workflow.docReconciliationTask, requirements } };
  } finally {
    fs.rmSync(stateHome, { recursive: true, force: true });
  }
}

function produceWithRealTaskPin(mods, repo, pin) {
  const workflow = {
    workflowId: pin.workflow.workflowId,
    sessionId: pin.workflow.sessionId,
    workflowRevision: pin.workflow.revision
  };
  const activeHost = { hostId: 'fake-host' };
  const origin = new H.FakeOrigin({ context: H.fakeContext({ ...workflow, taskId: pin.task.taskId, activeHost }, repo) });
  const input = H.producerInput(repo, { task: pin.task, workflow });
  return { result: mods[PRODUCER].produceDocSnapshot(input, { originProvider: origin }), origin };
}

function ready(result, label) {
  assert.strictEqual(result.state, 'ready', `${label}: expected ready, got ${JSON.stringify(H.codesOf(result))}`);
  assert(result.snapshot, `${label}: ready result must contain a snapshot`);
  return result.snapshot;
}

function unavailable(result, label, reasonCode) {
  assert.strictEqual(result.state, 'unavailable', `${label}: expected unavailable, got ${result.state}`);
  assert.strictEqual(result.snapshot, null, `${label}: unavailable capture must not expose a snapshot`);
  if (reasonCode) assert.strictEqual(result.diagnostics[0]?.reasonCode, reasonCode, `${label}: reason code`);
}

function runCase(name, required, fn) {
  if (primaryRedOnly && name !== 'primary-installed-tree-and-truthful-coverage') return;
  for (const leg of H.LEGS) {
    const modules = {};
    let missing = null;
    for (const item of required) {
      const loaded = H.loadModule(leg, item.where, item.file);
      if (loaded.error) { missing = loaded.error; break; }
      for (const name of item.exports || []) {
        if (typeof loaded.mod[name] !== 'function') { missing = `${item.file} export ${name} missing`; break; }
      }
      if (missing) break;
      modules[item.file] = loaded.mod;
    }
    if (missing) {
      failures.push(`${name} [${leg.name}]`);
      console.error(`FAIL ${name} [${leg.name}]: ${missing}`);
      continue;
    }
    try {
      fn(modules, leg);
      console.log(`PASS ${name} [${leg.name}]`);
    } catch (error) {
      if (error instanceof H.UncheckedError) console.log(`UNCHECKED ${name} [${leg.name}]: ${error.message}`);
      else {
        failures.push(`${name} [${leg.name}]`);
        console.error(`FAIL ${name} [${leg.name}]: ${error.message}`);
      }
    }
  }
}

runCase('primary-installed-tree-and-truthful-coverage', [REQUIREMENTS.producer], (mods, leg) => {
  withRepo({ config: artifactConfig(), baseFiles: { 'docs/prd/retired.md': 'old baseline file\n' }, candidateFiles: { 'docs/prd/retired.md': null } }, repo => {
    const pin = realTaskPin(repo);
    const snapshot = ready(produceWithRealTaskPin(mods, repo, pin).result, 'installed-tree capture from shipped plan/start task pin');
    const coverage = snapshot.candidate.coverage;
    assert.strictEqual(coverage.kind, 'project-with-dependency-artifact-exclusions');
    assert.strictEqual(coverage.policyVersion, 'dependency-artifact-scope/1');
    assert.deepStrictEqual(coverage.dependencyArtifactRoots, EXPECTED_ROOTS);
    assert.deepStrictEqual(coverage.excluded, ['.git', ...EXPECTED_ROOTS]);
    assert.strictEqual(coverage.policySource.path, H.CONFIG_REL);
    assert.strictEqual(coverage.policySource.baselineCommit, repo.commit);
    assert.match(coverage.policySource.storedBytesDigest, /^[a-f0-9]{64}$/);
    assert.deepStrictEqual(coverage.guardOutcomes.map(item => [item.guard, item.state]), [
      ['baseline-paths', 'clear'], ['index-paths', 'clear'], ['config-sources', 'clear'],
      ['config-selectors', 'clear'], ['task-inputs', 'clear'], ['excluded-root-types', 'clear']
    ]);
    assert.deepStrictEqual(coverage.excludedRootStates, EXPECTED_ROOTS.map(root => ({ path: root, presence: 'present-directory' })));
    assert(!snapshot.candidate.records.some(item => item.path.startsWith('node_modules/') || item.path.startsWith('.husky/_/')),
      'approved artifacts must be absent from candidate records');
    assert(snapshot.candidate.records.some(item => item.path === 'docs/prd/retired.md' && item.presence === 'deleted'),
      'an omitted retained path must remain an explicit deletion tombstone');
    assert.deepStrictEqual(snapshot.obligations.filter(item => item.strength === 'MUST' && item.applicability !== 'N/A')
      .map(item => item.id).sort(), [...H.VECTORS.vectors.normative.expectedMustIds].sort());
    const core = H.loadModule(leg, 'lib', CORE).mod;
    const lifecycle = H.loadModule(leg, 'scripts', LIFECYCLE).mod;
    if (typeof core?._internals?.validateSnapshot === 'function') {
      assert.deepStrictEqual(core._internals.validateSnapshot(snapshot), [], 'core re-derivation must accept the narrowed inventory');
    } else if (!primaryRedOnly) throw new Error('core snapshot validator missing');
    const retained = snapshot.candidate.records.filter(item => item.presence === 'present');
    if (typeof lifecycle?.convertWorkspaceFiles === 'function') {
      const converted = lifecycle.convertWorkspaceFiles(repo.root, retained.map(item => ({
        path: item.path, bytes: fs.readFileSync(path.join(repo.root, item.path))
      })));
      assert.deepStrictEqual(converted.map(item => [item.path, item.bytes]), retained.map(item => [item.path, item.storedBytes]),
        'lifecycle stored-byte conversion must agree on the producer’s explicit retained inventory');
    } else if (!primaryRedOnly) throw new Error('lifecycle explicit-inventory converter missing');
  });
});

runCase('no-authority-candidate-only-and-policy-change-stay-unavailable', [REQUIREMENTS.producer], mods => {
  withRepo({ config: H.DERIVE_CONFIG }, repo => unavailable(produce(mods, repo).result, 'missing opt-in'));
  withRepo({ config: H.DERIVE_CONFIG, candidateFiles: { [H.CONFIG_REL]: `${JSON.stringify(artifactConfig(), null, 2)}\n` } }, repo => {
    unavailable(produce(mods, repo).result, 'candidate-only opt-in', 'dependency-artifact-policy-changed-or-unpinned');
  });
  withRepo({ config: artifactConfig(), candidateFiles: { [H.CONFIG_REL]: `${JSON.stringify(artifactConfig(['node_modules']), null, 2)}\n` } }, repo => {
    unavailable(produce(mods, repo).result, 'changed baseline policy', 'dependency-artifact-policy-changed-or-unpinned');
  });
  withRepo({ config: { ...H.DERIVE_CONFIG, inventory: { dependencyArtifactRoots: ['vendor'] } } }, repo => {
    unavailable(produce(mods, repo).result, 'invalid baseline policy');
  });
  withRepo({ config: artifactConfig(), candidateFiles: { [H.CONFIG_REL]: `${JSON.stringify(artifactConfig(['node_modules', '.husky/_']), null, 2)}\n` } }, repo => {
    const snapshot = ready(produce(mods, repo).result, 'canonical root-order match');
    assert.deepStrictEqual(snapshot.candidate.coverage.dependencyArtifactRoots, EXPECTED_ROOTS,
      'policy roots are canonically ordered independent of the config array order');
  });
  withRepo({ config: H.DERIVE_CONFIG, install: false }, (repo, vectors) => {
    removeProjectConfigFromBaseline(repo, vectors);
    H.writeFiles(repo.root, { [H.CONFIG_REL]: `${JSON.stringify(artifactConfig(), null, 2)}\n` });
    writeInstalledTree(repo.root);
    unavailable(produce(mods, repo).result, 'candidate policy without baseline project config', 'dependency-artifact-policy-changed-or-unpinned');
  });
});

runCase('host-config-opt-in-cannot-prune-dependency-artifacts', [REQUIREMENTS.producer], mods => {
  withRepo({ config: H.DERIVE_CONFIG, install: false }, (repo, vectors) => {
    removeProjectConfigFromBaseline(repo, vectors);
    H.writeFiles(repo.root, { '.claude/harness-everything/manifest.json': `${JSON.stringify({ projectDocs: artifactConfig() }, null, 2)}\n` });
    writeRegularArtifacts(repo.root);
    const origin = new H.FakeOrigin({ context: H.fakeContext({ activeHost: 'claude' }, repo) });
    const result = mods[PRODUCER].produceDocSnapshot(H.producerInput(repo, { top: { activeHost: 'claude' } }), { originProvider: origin });
    const snapshot = ready(result, 'host-config control');
    assert.strictEqual(snapshot.candidate.coverage.kind, 'whole-project', 'host policy must not create dependency exclusions');
    assert(snapshot.candidate.records.some(item => item.path === 'node_modules/fixture-package/index.js' && item.presence === 'present'));
    assert(snapshot.candidate.records.some(item => item.path === '.husky/_/husky.sh' && item.presence === 'present'));
  });
});

runCase('run13-external-absolute-binding-path-allows-narrowed-snapshot', [REQUIREMENTS.producer], mods => {
  withRepo({ config: artifactConfig() }, repo => {
    const pin = realTaskPin(repo);
    const task = { ...pin.task, requirements: RUN13_REQUIREMENTS };
    const snapshot = ready(produceWithRealTaskPin(mods, repo, { ...pin, task }).result,
      'real run13 requirements with an outside-workspace absolute binding path');
    assert.deepStrictEqual(snapshot.candidate.coverage.dependencyArtifactRoots, EXPECTED_ROOTS,
      'the explicit baseline policy still produces the narrowed snapshot');
  });
});

runCase('outside-absolute-path-containing-root-segment-remains-disjoint', [REQUIREMENTS.producer], mods => {
  withRepo({ config: artifactConfig() }, repo => {
    const pin = realTaskPin(repo);
    const requirements = JSON.parse(JSON.stringify(RUN13_REQUIREMENTS));
    requirements[1].requiredBindings[0].resolvedPath = path.join(os.tmpdir(), 'node_modules', 'external-binding', 'SKILL.md');
    const task = { ...pin.task, requirements };
    const snapshot = ready(produceWithRealTaskPin(mods, repo, { ...pin, task }).result,
      'outside-workspace absolute path mentioning node_modules');
    assert.deepStrictEqual(snapshot.candidate.coverage.dependencyArtifactRoots, EXPECTED_ROOTS);
  });
});

runCase('task-pin-identity-containing-root-name-is-not-a-path-selector', [REQUIREMENTS.producer], mods => {
  withRepo({ config: artifactConfig() }, repo => {
    const pin = realTaskPin(repo);
    const task = { ...pin.task, taskId: 'node_modules' };
    const snapshot = ready(produceWithRealTaskPin(mods, repo, { ...pin, task }).result,
      'task identity equal to an approved-root name');
    assert.deepStrictEqual(snapshot.candidate.coverage.dependencyArtifactRoots, EXPECTED_ROOTS);
  });
});

runCase('config-validator-accepts-only-the-two-exact-optional-roots', [REQUIREMENTS.resolver], mods => {
  for (const roots of [[], ['node_modules'], ['.husky/_'], EXPECTED_ROOTS]) {
    assert.strictEqual(mods[RESOLVER].validateDocsConfig({ inventory: { dependencyArtifactRoots: roots } }).valid, true,
      `valid roots: ${JSON.stringify(roots)}`);
  }
  for (const roots of [['vendor'], ['node_modules', 'node_modules'], ['node_modules/child'], ['../node_modules'], ['/node_modules'], ['node_modules/']]) {
    assert.strictEqual(mods[RESOLVER].validateDocsConfig({ inventory: { dependencyArtifactRoots: roots } }).valid, false,
      `invalid roots: ${JSON.stringify(roots)}`);
  }
  assert.strictEqual(mods[RESOLVER].validateDocsConfig({ inventory: { dependencyArtifactRoots: ['node_modules'], exclusions: ['tmp'] } }).valid, false,
    'the narrow policy rejects extra exclusion controls');
});

runCase('baseline-index-and-index-removed-paths-block-pruning', [REQUIREMENTS.producer], mods => {
  withRepo({ config: artifactConfig(), baseFiles: { 'node_modules/tracked.js': 'tracked at B\n' } }, repo => {
    unavailable(produce(mods, repo).result, 'baseline tracked path', 'baseline-path-overlap');
  });
  withRepo({ config: artifactConfig() }, repo => {
    const indexed = path.join(repo.root, 'node_modules', 'staged.js');
    fs.mkdirSync(path.dirname(indexed), { recursive: true });
    fs.writeFileSync(indexed, 'staged in current index\n');
    H.git(repo.root, ['add', '-f', 'node_modules/staged.js']);
    unavailable(produce(mods, repo).result, 'current index path', 'index-path-overlap');
  });
  withRepo({ config: artifactConfig(), baseFiles: { 'node_modules/index-removed.js': 'retained in worktree\n' } }, repo => {
    H.git(repo.root, ['rm', '--cached', '-f', '-q', '--', 'node_modules/index-removed.js']);
    assert(fs.existsSync(path.join(repo.root, 'node_modules/index-removed.js')), 'index-removed witness must remain on disk');
    unavailable(produce(mods, repo).result, 'index-removed baseline path', 'baseline-path-overlap');
  });
});

runCase('governed-derived-broad-and-task-input-overlaps-block-pruning', [REQUIREMENTS.producer], mods => {
  const cases = [
    { label: 'governed selector', config: { governed: [{ path: 'node_modules/**', role: 'reference' }] }, reason: 'config-selector-overlap' },
    { label: 'ambiguous broad selector', config: { legacy: ['**'] }, reason: 'config-selector-overlap' },
    { label: 'single-segment broad selector', config: { legacy: ['*'] }, reason: 'config-selector-overlap' },
    { label: 'derived output', config: { derived: [{ path: 'node_modules/generated.js', generator: 'node scripts/gen.js' }] }, reason: 'config-selector-overlap' },
    { label: 'derived source', config: { derived: [{ path: 'docs/generated.md', generator: 'node node_modules/generate.js' }] }, reason: 'config-selector-overlap' },
    { label: 'relative explicit requirement input', makeTask: () => {
      const task = H.taskInput(); task.requirements[0].inputPath = 'node_modules/fixture-package/index.js'; return task;
    }, reason: 'task-input-overlap' },
    { label: 'empty broad task selector', makeTask: () => {
      const task = H.taskInput(); task.requirements[0].inputPath = ''; return task;
    }, reason: 'task-input-overlap' },
    { label: 'absolute explicit requirement input', makeTask: root => {
      const task = H.taskInput(); task.requirements[0].inputPath = path.join(root, 'node_modules/fixture-package/index.js'); return task;
    }, reason: 'task-input-overlap' },
    { label: 'case-alias absolute requirement input', makeTask: root => {
      const task = H.taskInput(); task.requirements[0].inputPath = path.join(root.toUpperCase(), 'node_modules/fixture-package/index.js'); return task;
    }, reason: 'task-input-overlap' },
    { label: 'relative scope selector', makeScope: () => ({ prdRoot: 'docs/prd/', paths: ['node_modules/fixture-package/index.js'] }), reason: 'task-input-overlap' },
    { label: 'absolute scope selector', makeScope: root => ({ prdRoot: 'docs/prd/', paths: [path.join(root, 'node_modules/fixture-package/index.js')] }), reason: 'task-input-overlap' }
  ];
  for (const item of cases) {
    const config = { ...artifactConfig(), ...item.config };
    withRepo({ config }, repo => {
      const overrides = {};
      if (item.makeTask) overrides.task = item.makeTask(repo.root);
      if (item.makeScope) overrides.top = { scope: item.makeScope(repo.root) };
      unavailable(produce(mods, repo, overrides).result, item.label, item.reason);
    });
  }
});

if (process.platform !== 'win32') runCase('unresolved-windows-drive-path-stays-conservative', [REQUIREMENTS.producer], mods => {
  withRepo({ config: artifactConfig() }, repo => {
    const task = H.taskInput();
    task.requirements[0].inputPath = 'C:\\workspace\\node_modules\\fixture-package\\index.js';
    unavailable(produce(mods, repo, { task }).result, 'unresolved Windows drive path', 'task-input-overlap');
  });
});

runCase('captured-config-source-overlap-blocks-pruning', [REQUIREMENTS.producer], (_mods, leg) => {
  const resolverPath = path.join(leg.scripts, RESOLVER);
  const producerPath = path.join(leg.lib, PRODUCER);
  const resolver = require(resolverPath);
  const originalResolve = resolver.resolveDocsConfigCaptured;
  delete require.cache[require.resolve(producerPath)];
  resolver.resolveDocsConfigCaptured = (...args) => {
    const result = originalResolve(...args);
    result.capture.sources.push({ path: 'node_modules/project-docs.json', presence: 'present', bytes: Buffer.from('{}'), digest: '0'.repeat(64) });
    return result;
  };
  try {
    const producer = require(producerPath);
    withRepo({ config: artifactConfig() }, repo => {
      unavailable(producer.produceDocSnapshot(H.producerInput(repo), {
        originProvider: new H.FakeOrigin({ context: H.fakeContext({}, repo) })
      }), 'captured config source under artifact root', 'config-source-overlap');
    });
  } finally {
    resolver.resolveDocsConfigCaptured = originalResolve;
    delete require.cache[require.resolve(producerPath)];
  }
});

runCase('F4-ignored-rename-and-ignore-rule-change-remain-in-inventory', [REQUIREMENTS.producer], mods => {
  withRepo({
    config: artifactConfig(),
    baseFiles: { '.gitignore': '', 'docs/prd/old.md': 'old path\n' },
    candidateFiles: {
      '.gitignore': 'docs/prd/renamed.md\n',
      'docs/prd/old.md': null,
      'docs/prd/renamed.md': 'ignored rename destination\n'
    }
  }, repo => {
    const snapshot = ready(produce(mods, repo).result, 'ignored rename');
    assert(snapshot.candidate.records.some(item => item.path === 'docs/prd/renamed.md' && item.presence === 'present'),
      'ignored rename destination must be included');
    assert(snapshot.candidate.records.some(item => item.path === 'docs/prd/old.md' && item.presence === 'deleted'),
      'rename source tombstone must be retained');
  });
  withRepo({ config: artifactConfig(), baseFiles: { '.gitignore': 'tmp/\n' }, candidateFiles: { 'tmp/ignored.log': 'outside approved roots\n' } }, repo => {
    const snapshot = ready(produce(mods, repo).result, 'unrelated ignored content');
    assert(snapshot.candidate.records.some(item => item.path === 'tmp/ignored.log' && item.presence === 'present'),
      'unrelated ignored content must remain captured');
  });
});

runCase('optional-root-selection-keeps-the-other-root-included', [REQUIREMENTS.producer], mods => {
  withRepo({ config: artifactConfig(['node_modules']) }, repo => {
    const snapshot = ready(produce(mods, repo).result, 'single-root opt-in');
    assert(snapshot.candidate.records.some(item => item.path === '.husky/_/husky.sh' && item.presence === 'present'),
      '.husky/_ must remain included when not approved');
    assert(!snapshot.candidate.records.some(item => item.path.startsWith('node_modules/')),
      'only the individually approved root may be pruned');
  });
});

runCase('excluded-root-and-retained-path-symlinks-fail-closed', [REQUIREMENTS.producer], mods => {
  withRepo({ config: artifactConfig(), install: false }, repo => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-scope-root-link-'));
    try {
      fs.writeFileSync(path.join(external, 'installed.js'), 'outside\n');
      try { fs.symlinkSync(external, path.join(repo.root, 'node_modules'), 'dir'); }
      catch (error) { throw new H.UncheckedError(`directory symlink unavailable: ${error.code}`); }
      unavailable(produce(mods, repo).result, 'excluded root symlink', 'dependency-root-not-plain-directory');
    } finally { fs.rmSync(external, { recursive: true, force: true }); }
  });
  withRepo({ config: artifactConfig(), install: false }, repo => {
    const external = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-scope-parent-link-'));
    try {
      fs.mkdirSync(path.join(external, '_'));
      try { fs.symlinkSync(external, path.join(repo.root, '.husky'), 'dir'); }
      catch (error) { throw new H.UncheckedError(`directory symlink unavailable: ${error.code}`); }
      unavailable(produce(mods, repo).result, 'excluded-root ancestor symlink', 'dependency-root-not-plain-directory');
    } finally { fs.rmSync(external, { recursive: true, force: true }); }
  });
  withRepo({ config: artifactConfig(), install: false }, repo => {
    const target = path.join(repo.root, 'docs/prd/graph.md');
    const source = path.join(repo.root, 'docs/prd/retained.md');
    fs.writeFileSync(source, 'retained target\n');
    fs.rmSync(target, { force: true });
    try { fs.symlinkSync(source, target); }
    catch (error) { throw new H.UncheckedError(`file symlink unavailable: ${error.code}`); }
    unavailable(produce(mods, repo).result, 'retained path symlink');
  });
});

runCase('retained-unreadable-and-byte-limit-controls-remain', [REQUIREMENTS.producer], mods => {
  if (process.platform === 'win32') throw new H.UncheckedError('win32 does not expose POSIX unreadable mode bits');
  withRepo({ config: artifactConfig(), install: false }, repo => {
    const unreadable = path.join(repo.root, 'zzz-unreadable.txt');
    fs.writeFileSync(unreadable, 'permission witness\n');
    fs.chmodSync(unreadable, 0);
    try { unavailable(produce(mods, repo).result, 'retained unreadable path'); }
    finally { fs.chmodSync(unreadable, 0o600); }
  });
  withRepo({ config: artifactConfig(), install: false }, repo => {
    const big = path.join(repo.root, 'zzzz-over-limit.bin');
    const fd = fs.openSync(big, 'w');
    try { fs.ftruncateSync(fd, 64 * 1024 * 1024 + 1); } finally { fs.closeSync(fd); }
    unavailable(produce(mods, repo).result, 'retained byte-limit control');
  });
});

runCase('excluded-byte-mutation-preserves-scoped-identity', [REQUIREMENTS.producer], mods => {
  withRepo({ config: artifactConfig() }, repo => {
    const first = ready(produce(mods, repo).result, 'before excluded mutation');
    fs.writeFileSync(path.join(repo.root, 'node_modules/husky/bin.js'), 'changed install artifact bytes\n');
    fs.writeFileSync(path.join(repo.root, '.husky/_/husky.sh'), '# changed generated hook\n');
    const second = ready(produce(mods, repo).result, 'after excluded mutation');
    assert.strictEqual(second.identity.candidateDigest, first.identity.candidateDigest);
    assert.strictEqual(second.identity.taskScopeDigest, first.identity.taskScopeDigest);
    assert.strictEqual(second.candidate.coverage.policySource.storedBytesDigest, first.candidate.coverage.policySource.storedBytesDigest);
  });
});

runCase('included-source-or-config-mutation-during-capture-is-unavailable', [REQUIREMENTS.producer], mods => {
  for (const relative of ['docs/prd/graph.md', H.CONFIG_REL]) {
    withRepo({ config: artifactConfig() }, repo => {
      const target = path.join(repo.root, relative);
      const originalRead = fs.readFileSync;
      let mutated = false;
      fs.readFileSync = function(file, ...args) {
        const result = originalRead.call(this, file, ...args);
        if (!mutated && path.resolve(String(file)) === target) {
          mutated = true;
          originalRead.call(fs, target);
          fs.writeFileSync(target, `${result.toString('utf8')}\nmid-capture mutation\n`);
        }
        return result;
      };
      let result;
      try { result = produce(mods, repo).result; }
      finally { fs.readFileSync = originalRead; }
      assert(mutated, `${relative} must be read during capture`);
      unavailable(result, `${relative} changed during capture`);
    });
  }
});

runCase('row17-six-musts-survive-production-consumer-flow', [REQUIREMENTS.producer, REQUIREMENTS.events, REQUIREMENTS.core], mods => {
  const sixMusts = [
    'doc-change:conflict-check', 'doc-change:doc-lint', 'doc-change:link-check',
    'doc-change:outline-confirmation', 'doc-change:quality-review', 'doc-change:requirement-sync'
  ].sort();
  const fixture = path.join(H.ROOT, 'ci', 'fixtures', 'doc-obligations', 'derive', 'req-revision');
  const vectors = {
    base: H.readTree(path.join(fixture, 'base')),
    candidate: H.readTree(path.join(fixture, 'candidate'))
  };
  const target = 'docs/prd/graph/r002.md';
  const eventsVector = {
    expectedMustIds: sixMusts,
    eventKindByMust: {
      'doc-change:doc-lint': 'execution',
      'doc-change:link-check': 'execution',
      'doc-change:quality-review': 'review',
      'doc-change:conflict-check': 'execution',
      'doc-change:requirement-sync': 'execution'
    }
  };
  withRepo({ vectors, config: artifactConfig(), install: false }, repo => {
    H.git(repo.root, ['config', 'user.name', 'e1-fixture']);
    H.git(repo.root, ['config', 'user.email', 'e1-fixture@invalid']);
    H.git(repo.root, ['config', 'commit.gpgsign', 'false']);
    H.writeFiles(repo.root, { [target]: `---\nid: PRD-GRPH-001\nrevision: 2\nstatus: proposed\n---\n\n# Graph\n\n## Outline\n- Context: TBD\n- Decision: TBD\n` });
    H.git(repo.root, ['add', target]);
    H.git(repo.root, ['commit', '-q', '-m', 'O outline']);
    const outlineCommit = H.git(repo.root, ['rev-parse', 'HEAD']).trim();
    const outlineTree = H.git(repo.root, ['rev-parse', 'HEAD^{tree}']).trim();
    const outlineBytes = Buffer.from(H.git(repo.root, ['show', `${outlineCommit}:${target}`]));
    const outlineBlob = H.git(repo.root, ['rev-parse', `${outlineCommit}:${target}`]).trim();
    H.writeFiles(repo.root, vectors.candidate);
    H.git(repo.root, ['add', '-A']);
    H.git(repo.root, ['commit', '-q', '-m', 'D final requirement revision']);
    const draftCommit = H.git(repo.root, ['rev-parse', 'HEAD']).trim();
    const draftTree = H.git(repo.root, ['rev-parse', 'HEAD^{tree}']).trim();
    writeInstalledTree(repo.root);
    const context = H.fakeContext({ activeHost: 'claude-code' }, repo);
    const origin = new H.FakeOrigin({ context });
    const produced = mods[PRODUCER].produceDocSnapshot(H.producerInput(repo, { top: { activeHost: 'claude-code' } }), { originProvider: origin });
    const snapshot = ready(produced, 'row-17 producer');
    const expected = snapshot.obligations.filter(item => item.strength === 'MUST' && item.applicability !== 'N/A')
      .map(item => item.id).sort();
    assert.deepStrictEqual(expected, sixMusts, 'the six row-17 obligations must remain applicable');
    const events = H.buildEvents(snapshot, repo, eventsVector);
    const outline = snapshot.obligations.find(item => item.capability === 'outline-confirmation');
    const paths = outline.scope.paths.slice().sort();
    assert.deepStrictEqual(paths, [target]);
    const draftDigests = Object.fromEntries(paths.map(file => [file,
      snapshot.candidate.records.find(item => item.path === file && item.presence === 'present').digest]));
    const draftBlobs = Object.fromEntries(paths.map(file => [file, H.git(repo.root, ['rev-parse', `${draftCommit}:${file}`]).trim()]));
    const outlineDigests = Object.fromEntries(paths.map(file => [file, H.sha256(outlineBytes)]));
    const outlineBlobs = Object.fromEntries(paths.map(file => [file, outlineBlob]));
    const inventoryBytes = Buffer.from('deterministic row 17 inventory fixture\n');
    const inventoryDigest = H.sha256(inventoryBytes);
    const inventoryPath = `doc-reconciliation/outline-confirmation/inventory/${inventoryDigest}.md`;
    const evidence = {
      schema: 'harness.outline-confirmation.v1', state: 'validated', taskId: snapshot.identity.taskId, attemptId: 'attempt-row17',
      inventoryRowId: '17', domain: 'GRPH', inventoryPinDigest: inventoryDigest, inventoryArtifactDigest: inventoryDigest,
      baselineCommit: repo.commit, outlineCommit, outlineTree, draftCommit, draftTree, mergedCommit: draftCommit,
      outlineArtifactDigests: outlineDigests, draftArtifactDigests: draftDigests,
      outlineBlobOids: outlineBlobs, draftBlobOids: draftBlobs, targetPaths: paths,
      handoffDigest: H.sha256('handoff'), reviewCaptureDigest: H.sha256('review-capture'), reviewDigest: H.sha256('review'),
      seamDigest: H.sha256('seam'), dispatchInputDigest: H.sha256('dispatch'), writerLeaseDigest: H.sha256('lease'),
      coordinatorPrincipal: H.PRINCIPALS.author, reviewerPrincipal: H.PRINCIPALS.reviewer, workerPrincipal: H.PRINCIPALS.executor,
      dispatchToolUseId: 'outline-dispatch-row17',
      ancestry: 'strict-descendant', mergeCorrespondence: null
    };
    events['ref-outline-confirmation'] = {
      eventId: 'evt-outline-confirmation', producerId: 'fixture', identity: H.clone(snapshot.identity), paths,
      provenance: 'deterministic row-17 host fixture', capability: 'outline-confirmation',
      originRef: 'fake-origin:event:ref-outline-confirmation', kind: 'review', principalId: H.PRINCIPALS.reviewer,
      verdict: 'approve', summary: 'Independent deterministic row 17 outline review.',
      reviewedArtifactDigests: { ...outlineDigests, [inventoryPath]: inventoryDigest },
      draftArtifactDigests: draftDigests, outlineEvidence: evidence, independentOf: [H.PRINCIPALS.author, H.PRINCIPALS.executor]
    };
    for (const [reference, event] of Object.entries(events)) origin.issueEvent(reference, event);
    const accepted = mods[EVENTS].acceptDocEvents({ snapshot, eventRefs: Object.keys(events) }, { originProvider: origin });
    const decision = mods[CORE].checkAcceptedDocEvidence({ snapshot, accepted, mode: 'verification' });
    assert.strictEqual(accepted.state, 'ready', `production adapter must accept deterministic evidence: ${JSON.stringify(H.codesOf(accepted))}`);
    assert.strictEqual(decision.decision, 'eligible', `production reconciliation must pass: ${JSON.stringify(H.codesOf(decision))}`);
    assert.strictEqual(decision.eligible, true);
    assert.deepStrictEqual(decision.expectedMustIds.sort(), sixMusts);
    assert.deepStrictEqual(decision.checkedMustIds.sort(), sixMusts);
    assert.deepStrictEqual(decision.unsatisfied, []);
  });
});

if (failures.length) {
  console.error(`\nDependency-artifact scope: ${failures.length} failing assertion-legs`);
  process.exitCode = 1;
} else {
  console.log('\nDependency-artifact scope: all assertions passed or explicitly unchecked');
}
