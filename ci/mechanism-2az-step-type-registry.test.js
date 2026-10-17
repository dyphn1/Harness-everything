#!/usr/bin/env node
'use strict';

// Stage A: the registry is declarative; this test exercises the CLI/filesystem
// boundaries and the source-free packaged hook runtime.
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-step-type-registry-'));
const stateHome = path.join(tempRoot, 'state');
const fakeHome = path.join(tempRoot, 'home');
fs.mkdirSync(stateHome, { recursive: true });
fs.mkdirSync(fakeHome, { recursive: true });
process.env.HARNESS_STATE_HOME = stateHome;
process.env.HARNESS_WORKSPACE_ROOT = ROOT;
process.env.HOME = fakeHome;
process.env.USERPROFILE = fakeHome;
delete process.env.CLAUDE_PLUGIN_ROOT;
delete process.env.PLUGIN_ROOT;

const kernel = path.join(ROOT, 'harness-everything/scripts/kernel-router.js');
const controller = path.join(ROOT, 'hooks/scripts/workflow-disposition.js');
const codexPromptAdapter = path.join(ROOT, 'hooks/scripts/codex-user-prompt.js');
const sourceRegistryFile = path.join(ROOT, 'hooks/scripts/lib/step-types.json');
const packageRoot = path.join(ROOT, 'plugins/harness-everything');
const packageRegistryFile = path.join(packageRoot, 'hooks/scripts/lib/step-types.json');
const workflowObligations = require(path.join(ROOT, 'hooks/scripts/lib/workflow-obligations.js'));
const { getSessionDir } = require(path.join(ROOT, 'hooks/scripts/lib/harness-state.js'));
const compat = require(path.join(ROOT, 'scripts/codex-hooks-compat.js'));

const EXPECTED_IDS = ['behavior-change', 'commit', 'doc-change', 'review', 'verification'];
const LEGACY_2AN_SHA256 = 'fa80a318bcb7e31cde7a05f5a6193656b86ed28976961fe3ea89e3fc6db75cb1';
const LEGACY_2AR_SHA256 = '45ccb96cd04c7eae38113ee21c634326bdbedbc76a8611d78c1a92d017424120';
const FIX_PROMPT = 'Fix this checkout bug and add a regression test.';
let failed = 0;

function check(condition, message) {
  if (condition) console.log('  PASS ' + message);
  else { console.error('  FAIL ' + message); failed++; }
}

function checkCase(name, runCase) {
  try { runCase(); check(true, name); }
  catch (error) { check(false, `${name}: ${error && error.message ? error.message : String(error)}`); }
}

function run(script, args = [], workspace = ROOT, input = null) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: workspace,
    encoding: 'utf8',
    input: input === null ? undefined : JSON.stringify(input),
    env: { ...process.env, HARNESS_STATE_HOME: stateHome, HARNESS_WORKSPACE_ROOT: workspace, HOME: fakeHome, USERPROFILE: fakeHome },
  });
}

function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }

function routeSession(sessionId, prompt = FIX_PROMPT, workspace = ROOT, runtimeRoot = ROOT) {
  const payload = { session_id: sessionId, cwd: workspace, prompt };
  const routed = run(path.join(runtimeRoot, 'harness-everything/scripts/kernel-router.js'), [], workspace, payload);
  const sessionDir = getSessionDir(workspace, sessionId, payload);
  return {
    payload,
    sessionDir,
    workflowFile: path.join(sessionDir, 'workflow-run.json'),
    obligationsFile: path.join(sessionDir, 'workflow-obligations.json'),
    routed,
  };
}

function planSession(sessionId, requirements, strategy = 'iterative-single', workspace = ROOT, prompt = FIX_PROMPT, evidence = 'author-declared plan for the registry integration fixture', runtimeRoot = ROOT) {
  const session = routeSession(sessionId, prompt, workspace, runtimeRoot);
  const planned = run(path.join(runtimeRoot, 'hooks/scripts/workflow-disposition.js'), [
    'plan', '--session-id', sessionId,
    '--requirements-json', JSON.stringify(requirements),
    '--strategy', strategy,
    '--evidence', evidence,
  ], workspace);
  return { ...session, planned };
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function normalizedPath(value, workspace) {
  const roots = [
    { root: workspace, label: '/workspace' },
    { root: path.join(ROOT, 'plugins/harness-everything/skills'), label: '/plugin-skills' },
    { root: path.join(ROOT, 'plugins/harness-everything'), label: '/plugin' },
    { root: path.join(ROOT, 'skills'), label: '/source-skills' },
    { root: ROOT, label: '/source' },
  ];
  const absolute = path.resolve(value);
  for (const candidate of roots) {
    const root = path.resolve(candidate.root);
    const relative = path.relative(root, absolute);
    if (relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))) {
      const portableRelative = relative.split(/[\\/]+/).filter(Boolean).join('/');
      return portableRelative ? `${candidate.label}/${portableRelative}` : candidate.label;
    }
  }
  return absolute.split(/[\\/]+/).join('/');
}

function frozenObligation(value, workspace) {
  if (Array.isArray(value)) return value.map(item => frozenObligation(item, workspace));
  if (!value || typeof value !== 'object') return value;
  const result = {};
  for (const [key, item] of Object.entries(value)) {
    if (['createdAt', 'updatedAt', 'confirmedAt'].includes(key)) result[key] = '2026-01-01T00:00:00.000Z';
    else if (key === 'sessionId') result[key] = 'fixed-session';
    else if (key === 'workflowId') result[key] = 'fixed-workflow';
    else if (key === 'revision') result[key] = 1;
    else if (key === 'resolvedPath' && typeof item === 'string') result[key] = normalizedPath(item, workspace);
    else result[key] = frozenObligation(item, workspace);
  }
  return result;
}

function createRuntimeFixture(name) {
  const root = path.join(tempRoot, name);
  fs.mkdirSync(root, { recursive: true });
  for (const directory of ['hooks', 'harness-everything', 'scripts']) {
    fs.cpSync(path.join(ROOT, directory), path.join(root, directory), { recursive: true });
  }
  for (const skill of ['git-commit', 'security-review', 'tdd', 'verification-loop']) {
    const source = path.join(ROOT, skill);
    if (fs.existsSync(source)) fs.cpSync(source, path.join(root, skill), { recursive: true });
  }
  const workspace = path.join(tempRoot, `${name}-workspace`);
  fs.mkdirSync(workspace, { recursive: true });
  return {
    root,
    workspace,
    registryFile: path.join(root, 'hooks/scripts/lib/step-types.json'),
    kernel: path.join(root, 'harness-everything/scripts/kernel-router.js'),
    controller: path.join(root, 'hooks/scripts/workflow-disposition.js'),
    stopGate: path.join(root, 'hooks/scripts/workflow-stop-gate.js'),
    codexAdapter: path.join(root, 'hooks/scripts/codex-user-prompt.js'),
  };
}

function sessionFiles(fixture, sessionId, prompt = FIX_PROMPT) {
  const payload = { session_id: sessionId, cwd: fixture.workspace, prompt };
  const sessionDir = getSessionDir(fixture.workspace, sessionId, payload);
  return {
    payload,
    sessionDir,
    workflowFile: path.join(sessionDir, 'workflow-run.json'),
    obligationsFile: path.join(sessionDir, 'workflow-obligations.json'),
  };
}

function semanticRegistryError(result, registryFile) {
  const output = `${result.stdout || ''}\n${result.stderr || ''}`;
  assert.ok(output.includes(registryFile), `diagnostic must name ${registryFile}: ${output}`);
  assert.match(output, /step-type registry/i, output);
  assert.match(output, /Repair action: reinstall or update the Harness plugin so this file is restored; in a Harness source checkout, restore it and run npm run plugin:sync\./, output);
  assert.doesNotMatch(output, /workflow-obligations\.js:\d+|at loadStepTypeRegistry/, output);
}

function frozenObligationHash(file, workspace) {
  const normalized = JSON.stringify(frozenObligation(readJson(file), workspace), null, 2) + '\n';
  return crypto.createHash('sha256').update(normalized).digest('hex');
}

function snapshotTree(root) {
  const entries = [];
  function visit(directory) {
    for (const item of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const fullPath = path.join(directory, item.name);
      if (item.isDirectory()) visit(fullPath);
      else if (item.isFile()) entries.push([path.relative(root, fullPath).split(path.sep).join('/'), fs.readFileSync(fullPath).toString('hex')]);
    }
  }
  visit(root);
  return JSON.stringify(entries);
}

function git(root, args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, HOME: fakeHome, GIT_CONFIG_NOSYSTEM: '1' } });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.stdout}`);
  return (result.stdout || '').trim();
}

function createTrackedCompatSource() {
  const repo = path.join(tempRoot, 'tracked-codex-source');
  const source = path.join(repo, 'plugins/harness-everything');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.cpSync(packageRoot, source, { recursive: true });
  git(repo, ['init', '--quiet']);
  git(repo, ['add', '--all']);
  git(repo, ['-c', 'user.name=Step Registry Test', '-c', 'user.email=registry@example.invalid', 'commit', '--quiet', '-m', 'fixture tracked plugin source']);
  return { repo, source };
}

console.log('=== Stage A: workflow step-type registry ===');

let registry = null;
try { registry = readJson(sourceRegistryFile); } catch (_) { /* asserted below as RED */ }
checkCase('registry file exists with exactly five declarative step types', () => {
  assert.ok(Array.isArray(registry), 'step-types.json must contain an array');
  assert.deepStrictEqual(registry.map(entry => entry.id).sort(), EXPECTED_IDS);
  for (const entry of registry) assert.deepStrictEqual(Object.keys(entry).sort(), [
    'evidenceHint', 'forbiddenBindings', 'id', 'optionalBindings', 'requiredBindings',
  ]);
});

checkCase('registry defaults preserve the four existing types and leave doc-change binding-free', () => {
  assert.ok(Array.isArray(registry), 'registry is readable');
  assert.strictEqual(typeof workflowObligations.validateStepTypeRegistry, 'function', 'validator is exposed for deterministic contract checks');
  const entries = workflowObligations.validateStepTypeRegistry(registry);
  const byId = new Map(entries.map(entry => [entry.id, entry]));
  assert.deepStrictEqual(byId.get('review').requiredBindings, []);
  assert.deepStrictEqual(byId.get('review').optionalBindings, []);
  assert.deepStrictEqual(byId.get('review').forbiddenBindings, ['tdd']);
  assert.deepStrictEqual(byId.get('behavior-change').requiredBindings, ['tdd']);
  assert.deepStrictEqual(byId.get('behavior-change').optionalBindings, []);
  assert.deepStrictEqual(byId.get('verification').requiredBindings, ['verification-loop']);
  assert.deepStrictEqual(byId.get('commit').requiredBindings, ['git-commit']);
  assert.deepStrictEqual(byId.get('doc-change').requiredBindings, []);
  assert.deepStrictEqual(byId.get('doc-change').optionalBindings, []);
  assert.deepStrictEqual(byId.get('doc-change').forbiddenBindings, []);
  for (const entry of entries) assert.ok(entry.evidenceHint.trim(), `${entry.id} has a non-empty hint`);
});

checkCase('registry validation rejects duplicate IDs deterministically', () => {
  assert.ok(Array.isArray(registry), 'registry is readable');
  const validate = workflowObligations.validateStepTypeRegistry;
  assert.strictEqual(typeof validate, 'function');
  const invalid = [...clone(registry), clone(registry.find(entry => entry.id === 'review'))];
  function errorOf(value) { try { validate(value); return ''; } catch (error) { return error.message; } }
  const first = errorOf(invalid);
  const reversed = errorOf([...invalid].reverse());
  assert.match(first, /duplicate.*review/i);
  assert.strictEqual(reversed, first, 'error is independent of source entry order');
});

checkCase('registry validation rejects malformed binding declarations deterministically', () => {
  assert.ok(Array.isArray(registry), 'registry is readable');
  const validate = workflowObligations.validateStepTypeRegistry;
  assert.strictEqual(typeof validate, 'function');
  const invalid = clone(registry);
  invalid.find(entry => entry.id === 'doc-change').requiredBindings = [null, 'bad id'];
  function errorOf(value) { try { validate(value); return ''; } catch (error) { return error.message; } }
  const first = errorOf(invalid);
  const reversed = errorOf([...invalid].reverse());
  assert.match(first, /doc-change.*requiredBindings/i);
  assert.strictEqual(reversed, first, 'malformed binding error is deterministic');
});

checkCase('registry validation rejects required, optional, and forbidden binding conflicts', () => {
  assert.ok(Array.isArray(registry), 'registry is readable');
  const validate = workflowObligations.validateStepTypeRegistry;
  assert.strictEqual(typeof validate, 'function');
  for (const [left, right] of [
    ['requiredBindings', 'optionalBindings'],
    ['requiredBindings', 'forbiddenBindings'],
    ['optionalBindings', 'forbiddenBindings'],
  ]) {
    const invalid = clone(registry);
    const entry = invalid.find(value => value.id === 'doc-change');
    entry[left] = ['same-binding'];
    entry[right] = ['same-binding'];
    assert.throws(() => validate(invalid), /conflict/i, `${left}/${right} conflict must fail`);
  }
});

checkCase('doc-change is author-declared, needs no default TDD, and remains a pending execution step', () => {
  const session = planSession('registry-doc-change', [
    { id: 'req-docs', stepType: 'doc-change', summary: 'Update the docs', acceptance: 'the contract text is clear' },
    { id: 'req-verify', stepType: 'verification', summary: 'Verify the docs', acceptance: 'links and examples are checked' },
  ], 'iterative-single', ROOT, 'Fix this checkout bug and update its documentation.');
  assert.strictEqual(session.routed.status, 0, session.routed.stderr);
  assert.strictEqual(session.planned.status, 0, session.planned.stderr);
  const state = readJson(session.obligationsFile);
  const docs = state.requirements[0];
  assert.deepStrictEqual(state.requirements.map(item => item.stepType), ['doc-change', 'verification']);
  assert.deepStrictEqual(docs.requiredBindings, []);
  assert.deepStrictEqual(docs.optionalBindings, []);
  assert.strictEqual(docs.status, 'pending');
  assert.strictEqual(docs.evidence, null, 'an evidence hint is not evidence');
  assert.strictEqual(state.schemaVersion, 1);
  const started = run(controller, ['start', '--session-id', 'registry-doc-change']);
  assert.strictEqual(started.status, 0, started.stderr);
  const active = JSON.parse(started.stdout).activeStep;
  assert.strictEqual(active.stepType, 'doc-change');
  const passed = run(controller, [
    'step', '--session-id', 'registry-doc-change', '--step-id', 'req-docs', '--disposition', 'pass', '--evidence', 'doc acceptance checks are complete',
  ]);
  assert.strictEqual(passed.status, 0, passed.stderr);
  const afterPass = readJson(session.obligationsFile);
  const execute = afterPass.obligations.find(item => item.id === 'execute');
  assert.strictEqual(execute.status, 'pass', 'doc-change contributes to the existing execution aggregate');
  assert.match(execute.evidence, /req-docs/);
});

checkCase('doc-change requires verification in non-Fable plans without adding an ordering rule', () => {
  const missingVerify = planSession('registry-doc-change-no-verify', [
    { id: 'req-docs', stepType: 'doc-change', summary: 'Update the docs', acceptance: 'the contract text is clear' },
  ]);
  assert.strictEqual(missingVerify.planned.status, 2);
  assert.match(missingVerify.planned.stderr, /explicit verification step/);
  const reviewOnly = planSession('registry-review-only', [
    { id: 'req-review', stepType: 'review', summary: 'Review the change', acceptance: 'the change is reviewed' },
  ]);
  assert.strictEqual(reviewOnly.planned.status, 2);
  assert.match(reviewOnly.planned.stderr, /explicit verification step/);
  const verifyOnly = planSession('registry-verify-only', [
    { id: 'req-verify', stepType: 'verification', summary: 'Verify existing behavior', acceptance: 'objective checks pass' },
  ]);
  assert.strictEqual(verifyOnly.planned.status, 0, verifyOnly.planned.stderr);
});

checkCase('explicit TDD is legal on doc-change while review continues to forbid it', () => {
  const docChange = planSession('registry-doc-change-explicit-tdd', [
    { id: 'req-docs', stepType: 'doc-change', summary: 'Update docs with a test', acceptance: 'the docs are accurate', optionalBindings: ['tdd'] },
    { id: 'req-verify', stepType: 'verification', summary: 'Verify the docs', acceptance: 'links and examples are checked' },
  ]);
  assert.strictEqual(docChange.planned.status, 0, docChange.planned.stderr);
  const optional = readJson(docChange.obligationsFile).requirements[0].optionalBindings;
  assert.deepStrictEqual(optional.map(binding => binding.id), ['tdd']);
  for (const field of ['requiredBindings', 'optionalBindings']) {
    const declarations = { [field]: ['tdd'] };
    const review = planSession(`registry-review-tdd-${field}`, [
      { id: 'req-review', stepType: 'review', summary: 'Review the change', acceptance: 'the change is reviewed', ...declarations },
      { id: 'req-verify', stepType: 'verification', summary: 'Verify the change', acceptance: 'objective checks pass' },
    ]);
    assert.strictEqual(review.planned.status, 2);
    assert.match(review.planned.stderr, /review steps cannot bind tdd/);
  }
});

checkCase('registry optional defaults precede declarations and suggestions, with required-id deduplication', () => {
  const fixture = createRuntimeFixture('registry-optional-default-fixture');
  const fixtureRegistry = readJson(fixture.registryFile);
  fixtureRegistry.find(entry => entry.id === 'doc-change').optionalBindings = ['review-guidance', 'security-review', 'tdd'];
  fs.writeFileSync(fixture.registryFile, JSON.stringify(fixtureRegistry, null, 2) + '\n');
  const session = planSession('registry-optional-default-fixture', [
    {
      id: 'req-docs', stepType: 'doc-change', summary: 'Update the docs', acceptance: 'the contract text is clear',
      requiredBindings: ['tdd'], optionalBindings: ['security-review'], suggestedSkills: ['review-guidance', 'security-review'],
    },
    { id: 'req-verify', stepType: 'verification', summary: 'Verify the docs', acceptance: 'links and examples are checked' },
  ], 'iterative-single', fixture.workspace, FIX_PROMPT, 'fixture registry tests optional defaults', fixture.root);
  assert.strictEqual(session.routed.status, 0, session.routed.stderr);
  assert.strictEqual(session.planned.status, 0, session.planned.stderr);
  const doc = readJson(session.obligationsFile).requirements[0];
  assert.deepStrictEqual(doc.requiredBindings.map(binding => binding.id), ['tdd']);
  assert.deepStrictEqual(doc.optionalBindings.map(binding => binding.id), ['review-guidance', 'security-review']);
});

for (const registryFault of ['missing', 'malformed']) {
  const fixture = createRuntimeFixture(`registry-${registryFault}-fixture`);
  const retained = planSession(`registry-${registryFault}-retained`, [
    { id: 'req-docs', stepType: 'doc-change', summary: 'Update the docs', acceptance: 'the contract text is clear' },
    { id: 'req-verify', stepType: 'verification', summary: 'Verify the docs', acceptance: 'links and examples are checked' },
  ], 'iterative-single', fixture.workspace, FIX_PROMPT, 'prepare retained registry-fault fixture', fixture.root);
  checkCase(`registry ${registryFault} retained-session precondition`, () => {
    assert.strictEqual(retained.routed.status, 0, retained.routed.stderr);
    assert.strictEqual(retained.planned.status, 0, retained.planned.stderr);
  });
  const beforeWorkflow = fs.readFileSync(retained.workflowFile);
  const beforeObligations = fs.readFileSync(retained.obligationsFile);
  const registryBytes = fs.readFileSync(fixture.registryFile);
  if (registryFault === 'missing') fs.rmSync(fixture.registryFile);
  else fs.writeFileSync(fixture.registryFile, '{broken');

  checkCase(`registry ${registryFault} retained router keeps active-step failure visible and state unchanged`, () => {
    const routed = run(fixture.kernel, [], fixture.workspace, retained.payload);
    assert.strictEqual(routed.status, 0, routed.stderr);
    semanticRegistryError(routed, fixture.registryFile);
    assert.match(routed.stdout, /active[- ]step context unavailable/i);
    assert.deepStrictEqual(fs.readFileSync(retained.workflowFile), beforeWorkflow);
    assert.deepStrictEqual(fs.readFileSync(retained.obligationsFile), beforeObligations);
  });

  checkCase(`registry ${registryFault} retained Codex adapter exposes the actionable context`, () => {
    const result = run(fixture.codexAdapter, [], fixture.workspace, retained.payload);
    assert.strictEqual(result.status, 0, result.stderr);
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    semanticRegistryError({ stdout: context }, fixture.registryFile);
    assert.match(context, /active[- ]step context unavailable/i);
    assert.deepStrictEqual(fs.readFileSync(retained.workflowFile), beforeWorkflow);
    assert.deepStrictEqual(fs.readFileSync(retained.obligationsFile), beforeObligations);
  });

  const fresh = sessionFiles(fixture, `registry-${registryFault}-fresh`);
  const currentSessionFile = path.join(path.dirname(path.dirname(fresh.sessionDir)), 'current-session');
  const currentSessionBefore = fs.existsSync(currentSessionFile) ? fs.readFileSync(currentSessionFile) : null;
  function assertCurrentSessionUnchanged() {
    assert.strictEqual(fs.existsSync(currentSessionFile), currentSessionBefore !== null);
    if (currentSessionBefore !== null) assert.deepStrictEqual(fs.readFileSync(currentSessionFile), currentSessionBefore);
  }
  checkCase(`registry ${registryFault} fresh router reports failure without creating a workflow`, () => {
    const routed = run(fixture.kernel, [], fixture.workspace, fresh.payload);
    assert.strictEqual(routed.status, 0, routed.stderr);
    semanticRegistryError(routed, fixture.registryFile);
    assertCurrentSessionUnchanged();
    assert.ok(!fs.existsSync(fresh.workflowFile), 'a failed fresh route must not persist a default workflow');
    assert.ok(!fs.existsSync(fresh.obligationsFile), 'a failed fresh route must not persist a default obligation plan');
  });

  checkCase(`registry ${registryFault} fresh Codex adapter includes the failure in additionalContext`, () => {
    const result = run(fixture.codexAdapter, [], fixture.workspace, fresh.payload);
    assert.strictEqual(result.status, 0, result.stderr);
    const context = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    semanticRegistryError({ stdout: context }, fixture.registryFile);
    assertCurrentSessionUnchanged();
  });

  checkCase(`registry ${registryFault} Stop hook prints a reminder and preserves its existing exit code/state`, () => {
    const stop = run(fixture.stopGate, [], fixture.workspace, retained.payload);
    assert.strictEqual(stop.status, 0, stop.stderr);
    semanticRegistryError(stop, fixture.registryFile);
    assert.deepStrictEqual(fs.readFileSync(retained.workflowFile), beforeWorkflow);
    assert.deepStrictEqual(fs.readFileSync(retained.obligationsFile), beforeObligations);
  });

  checkCase(`registry ${registryFault} controller catches load failure with its existing error exit code`, () => {
    const result = run(fixture.controller, [
      'plan', '--session-id', retained.payload.session_id,
      '--requirements-json', JSON.stringify([
        { id: 'req-docs', stepType: 'doc-change', summary: 'Update the docs', acceptance: 'the contract text is clear' },
        { id: 'req-verify', stepType: 'verification', summary: 'Verify the docs', acceptance: 'links and examples are checked' },
      ]),
      '--strategy', 'iterative-single', '--evidence', 'exercise controller registry-load failure',
    ], fixture.workspace);
    assert.strictEqual(result.status, 2);
    semanticRegistryError(result, fixture.registryFile);
    assert.deepStrictEqual(fs.readFileSync(retained.workflowFile), beforeWorkflow);
    assert.deepStrictEqual(fs.readFileSync(retained.obligationsFile), beforeObligations);
  });
  if (registryFault === 'malformed') fs.writeFileSync(fixture.registryFile, registryBytes);
}

checkCase('unknown step types list sorted registry IDs and leave state files byte-identical', () => {
  const session = routeSession('registry-unknown-type');
  assert.strictEqual(session.routed.status, 0, session.routed.stderr);
  const before = snapshotTree(stateHome);
  const unknownRequirements = [
    { id: 'req-unknown', stepType: 'unknown-kind', summary: 'Do something', acceptance: 'the result is checked' },
    { id: 'req-verify', stepType: 'verification', summary: 'Verify it', acceptance: 'objective checks pass' },
  ];
  const first = run(controller, [
    'plan', '--session-id', 'registry-unknown-type', '--requirements-json', JSON.stringify(unknownRequirements),
    '--strategy', 'iterative-single', '--evidence', 'exercise deterministic unknown-type failure',
  ]);
  const second = run(controller, [
    'plan', '--session-id', 'registry-unknown-type', '--requirements-json', JSON.stringify(unknownRequirements),
    '--strategy', 'iterative-single', '--evidence', 'exercise deterministic unknown-type failure',
  ]);
  assert.strictEqual(first.status, 2);
  assert.strictEqual(first.stdout, '');
  assert.deepStrictEqual(second.stderr, first.stderr);
  assert.ok(first.stderr.includes(EXPECTED_IDS.join(', ')), first.stderr);
  assert.strictEqual(snapshotTree(stateHome), before, 'workflow, obligation, and state files stay byte-identical');
});

checkCase('a documentation task does not gain an undeclared doc-change step', () => {
  const session = routeSession('registry-no-inference', 'Fix this checkout bug and update its documentation.');
  assert.strictEqual(session.routed.status, 0, session.routed.stderr);
  const initial = readJson(session.obligationsFile);
  assert.deepStrictEqual(initial.requirements, [], 'routing only creates the planning contract');
  const plan = run(controller, [
    'plan', '--session-id', 'registry-no-inference', '--requirements-json', JSON.stringify([
      { id: 'req-review', stepType: 'review', summary: 'Review the docs change', acceptance: 'the change is reviewed' },
      { id: 'req-verify', stepType: 'verification', summary: 'Verify the docs', acceptance: 'the links are valid' },
    ]), '--strategy', 'iterative-single', '--evidence', 'author deliberately declares review and verification only',
  ]);
  assert.strictEqual(plan.status, 0, plan.stderr);
  assert.deepStrictEqual(readJson(session.obligationsFile).requirements.map(item => item.stepType), ['review', 'verification']);
});

function legacyRequirements2an() {
  return [
    { id: 'req-review', stepType: 'review', summary: 'Inspect the existing checkout change', acceptance: 'the relevant diff has been reviewed', optionalBindings: ['security-review', 'review-guidance'] },
    { id: 'req-change', stepType: 'behavior-change', summary: 'Correct the checkout behavior', acceptance: 'the reported behavior is corrected' },
    { id: 'req-verify', stepType: 'verification', summary: 'Verify the checkout change', acceptance: 'objective verification evidence is recorded' },
    { id: 'req-commit', stepType: 'commit', summary: 'Commit the requested change', acceptance: 'the authorized commit is recorded' },
  ];
}

function legacyRequirements2ar() {
  return [
    { id: 'req-change', stepType: 'behavior-change', summary: 'Correct the checkout behavior', acceptance: 'the behavior is corrected', requiredBindings: [{ id: 'domain-reference', path: 'docs/pr303-missing-reference.md' }], optionalBindings: [{ id: 'routing-reference', path: 'docs/routing.md' }] },
    { id: 'req-verify', stepType: 'verification', summary: 'Verify the change', acceptance: 'verification evidence is recorded' },
  ];
}

checkCase('existing 2an four-type obligation bytes match the frozen pre-registry baseline', () => {
  const result = planSession('registry-legacy-2an', legacyRequirements2an(), 'iterative-single', ROOT, FIX_PROMPT,
    'the request contains review, behavior-change, verification, and commit steps');
  assert.strictEqual(result.routed.status, 0, result.routed.stderr);
  assert.strictEqual(result.planned.status, 0, result.planned.stderr);
  assert.strictEqual(frozenObligationHash(result.obligationsFile, ROOT), LEGACY_2AN_SHA256);
});

checkCase('existing 2ar binding obligation bytes match the frozen pre-registry baseline', () => {
  const workspace = path.join(tempRoot, '2ar-empty-workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const result = planSession('registry-legacy-2ar', legacyRequirements2ar(), 'iterative-single', workspace, FIX_PROMPT,
    'behavior change then verification');
  assert.strictEqual(result.routed.status, 0, result.routed.stderr);
  assert.strictEqual(result.planned.status, 0, result.planned.stderr);
  assert.strictEqual(frozenObligationHash(result.obligationsFile, workspace), LEGACY_2AR_SHA256);
});

checkCase('schema v1 persisted plans load without rewriting bytes after volatile fields are frozen', () => {
  const result = planSession('registry-old-plan-load', legacyRequirements2an());
  assert.strictEqual(result.routed.status, 0, result.routed.stderr);
  assert.strictEqual(result.planned.status, 0, result.planned.stderr);
  const workflow = readJson(result.workflowFile);
  const obligations = readJson(result.obligationsFile);
  const stableId = '00000000-0000-4000-8000-000000000326';
  workflow.workflowId = stableId;
  obligations.workflowId = stableId;
  const freeze = value => {
    if (Array.isArray(value)) return value.forEach(freeze);
    if (!value || typeof value !== 'object') return;
    for (const [key, item] of Object.entries(value)) {
      if (['createdAt', 'updatedAt', 'confirmedAt'].includes(key)) value[key] = '2026-01-01T00:00:00.000Z';
      else if (key === 'revision') value[key] = 1;
      else freeze(item);
    }
  };
  freeze(workflow);
  freeze(obligations);
  obligations.revision = workflow.revision;
  fs.writeFileSync(result.workflowFile, JSON.stringify(workflow, null, 2) + '\n');
  fs.writeFileSync(result.obligationsFile, JSON.stringify(obligations, null, 2) + '\n');
  const before = fs.readFileSync(result.obligationsFile);
  const reloaded = run(kernel, [], ROOT, result.payload);
  assert.strictEqual(reloaded.status, 0, reloaded.stderr);
  assert.deepStrictEqual(fs.readFileSync(result.obligationsFile), before);
  assert.strictEqual(readJson(result.obligationsFile).schemaVersion, 1);
});

checkCase('all three Fable strategies preserve typed and untyped plan behavior', () => {
  for (const strategy of ['fable-staged', 'fable-parallel', 'fable-multi-agent-workspace']) {
    const typed = planSession(`registry-${strategy}-typed`, [
      { id: 'req-docs', stepType: 'doc-change', summary: 'Update the docs', acceptance: 'the contract text is clear', optionalBindings: ['tdd'] },
    ], strategy);
    assert.strictEqual(typed.routed.status, 0, typed.routed.stderr);
    assert.strictEqual(typed.planned.status, 0, `${strategy} typed: ${typed.planned.stderr}`);
    const typedState = readJson(typed.obligationsFile);
    assert.strictEqual(typedState.stepBindingsEnabled, false);
    assert.strictEqual(typedState.activeStepId, null);
    assert.deepStrictEqual(typedState.obligations.map(item => item.id), ['decompose', 'compose']);
    assert.deepStrictEqual(typedState.requirements[0].optionalBindings.map(binding => [binding.id, binding.status]), [['tdd', 'pending']]);
    assert.ok(!fs.existsSync(path.join(typed.sessionDir, 'workflow-stages.json')), `${strategy} registry recognition adds no Fable stage`);

    const untyped = planSession(`registry-${strategy}-untyped`, [
      { id: 'req-work', summary: 'Do the work', acceptance: 'the outcome is verified' },
    ], strategy);
    assert.strictEqual(untyped.routed.status, 0, untyped.routed.stderr);
    assert.strictEqual(untyped.planned.status, 0, `${strategy} untyped: ${untyped.planned.stderr}`);
    const untypedState = readJson(untyped.obligationsFile);
    assert.strictEqual(untypedState.stepBindingsEnabled, false);
    assert.strictEqual(untypedState.requirements[0].stepType, undefined);
    assert.deepStrictEqual(untypedState.obligations.map(item => item.id), ['decompose', 'compose']);
  }
});

checkCase('Claude hook copy is byte-identical and a tracked Codex runtime includes the registry', () => {
  assert.ok(fs.existsSync(packageRegistryFile), 'plugin:sync must ship hooks/scripts/lib/step-types.json');
  assert.deepStrictEqual(fs.readFileSync(packageRegistryFile), fs.readFileSync(sourceRegistryFile));
  const { repo, source } = createTrackedCompatSource();
  const tracked = git(repo, ['ls-files', '--', 'plugins/harness-everything/hooks/scripts/lib/step-types.json']);
  assert.strictEqual(tracked, 'plugins/harness-everything/hooks/scripts/lib/step-types.json');
  const codexHome = path.join(tempRoot, 'codex-home');
  const installed = compat.install({ codexHome, sourcePluginRoot: source });
  const runtimeRegistry = path.join(installed.runtimeDir, 'hooks/scripts/lib/step-types.json');
  assert.ok(fs.existsSync(runtimeRegistry), `tracked runtime file list omitted step-types.json: ${installed.runtimeDir}`);
  assert.deepStrictEqual(fs.readFileSync(runtimeRegistry), fs.readFileSync(sourceRegistryFile));
  console.log(`  CODEX_COMPAT_TRACKED_FILE ${tracked}`);
  console.log(`  CODEX_COMPAT_RUNTIME_FILE ${path.relative(installed.runtimeDir, runtimeRegistry).split(path.sep).join('/')}`);
  const runtimeHelp = spawnSync(process.execPath, [path.join(installed.runtimeDir, 'hooks/scripts/workflow-disposition.js'), '--help'], {
    cwd: tempRoot,
    encoding: 'utf8',
    env: { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, HARNESS_STATE_HOME: path.join(tempRoot, 'runtime-state') },
  });
  assert.strictEqual(runtimeHelp.status, 0, runtimeHelp.stderr);
  assert.match(runtimeHelp.stdout, /^Usage: workflow-disposition\.js/);
  compat.uninstall({ codexHome });
});

fs.rmSync(tempRoot, { recursive: true, force: true });
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: Stage A workflow step-type registry (${failed} failures)`);
process.exit(failed === 0 ? 0 : 1);
