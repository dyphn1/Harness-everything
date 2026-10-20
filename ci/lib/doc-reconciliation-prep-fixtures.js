'use strict';

// #325 Phase 3b preparation: isolated replay helper for the document-reconciliation RED corpus.
//
// Each replay creates a fresh workspace and state home, runs ordered actions through one explicitly
// selected distribution, and returns a replay root with the L1 shape:
//   { actions: { [actionId]: { exitCode, signal, stdout, stderr, json, state, pilot } }, state, pilot, pilotReportOrigin }.
// Nothing here is production code. The pilot switch is passed to children only as a request; no reader for
// it exists in this preparation slice, so ON replays run the legacy code path. Fixture operations
// (provideEvidence, mutateIdentity, timestampHints) write simulated records only inside the replay's own
// temporary directories. They are contract fixtures, not production commands, and nothing reads them yet.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PILOT_SWITCH = 'HARNESS_DOC_RECONCILIATION_PILOT';
const FIXTURE_OPS = new Set(['provideEvidence', 'mutateIdentity', 'timestampHints']);
const CONTROLLER_OPS = new Set(['plan', 'start', 'binding', 'step', 'obligation']);
const ALL_OPS = new Set(['route', 'stop', ...CONTROLLER_OPS, ...FIXTURE_OPS]);

// Explicit distributions. Every entry point is named by absolute path; no module is reused across legs.
const DISTRIBUTIONS = Object.freeze({
  source: {
    root: REPO_ROOT,
    controller: path.join(REPO_ROOT, 'hooks', 'scripts', 'workflow-disposition.js'),
    stopGate: path.join(REPO_ROOT, 'hooks', 'scripts', 'workflow-stop-gate.js'),
    kernel: path.join(REPO_ROOT, 'harness-everything', 'scripts', 'kernel-router.js')
  },
  packaged: {
    root: path.join(REPO_ROOT, 'plugins', 'harness-everything'),
    controller: path.join(REPO_ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'workflow-disposition.js'),
    stopGate: path.join(REPO_ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'workflow-stop-gate.js'),
    kernel: path.join(REPO_ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts', 'kernel-router.js')
  }
});

// Environment for every child. Caller-provided HARNESS_* state is removed, and only the pilot switch
// explicitly requested is set. Any other inherited switch cannot change the replay.
function childEnv(workspace, stateHome, pilot) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('HARNESS_')) delete env[key];
  }
  delete env.CLAUDE_PLUGIN_ROOT;
  delete env.PLUGIN_ROOT;
  env.HARNESS_STATE_HOME = stateHome;
  env.HARNESS_WORKSPACE_ROOT = workspace;
  if (pilot !== undefined) env[PILOT_SWITCH] = pilot;
  return env;
}

function createSession(distribution, caseId, pilot) {
  if (!DISTRIBUTIONS[distribution]) throw new Error(`unknown distribution ${distribution}`);
  const token = crypto.randomBytes(4).toString('hex');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `doc-recon-${caseId}-${distribution}-ws-${token}-`));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), `doc-recon-${caseId}-${distribution}-state-${token}-`));
  return {
    distribution,
    caseId,
    pilot,
    workspace,
    stateHome,
    sessionId: `${caseId.toLowerCase()}-session`
  };
}

function disposeSession(handle) {
  fs.rmSync(handle.workspace, { recursive: true, force: true });
  fs.rmSync(handle.stateHome, { recursive: true, force: true });
}

function runScript(handle, script, args, stdin, pilot) {
  return spawnSync(process.execPath, [script, ...args], {
    cwd: handle.workspace,
    encoding: 'utf8',
    input: stdin === undefined ? undefined : JSON.stringify(stdin),
    env: childEnv(handle.workspace, handle.stateHome, pilot)
  });
}

// The session directory is the only workflow-run.json under the fresh state home (one session per replay).
function sessionDirOf(handle) {
  const found = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name === 'workflow-run.json') found.push(dir);
    }
  };
  if (fs.existsSync(handle.stateHome)) walk(handle.stateHome);
  if (found.length === 0) return null;
  if (found.length > 1) throw new Error(`expected one session directory under ${handle.stateHome}, found ${found.length}`);
  return found[0];
}

function readJsonOrNull(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function snapshot(handle) {
  const dir = sessionDirOf(handle);
  if (!dir) return { workflow: null, obligations: null, handoff: null };
  return {
    workflow: readJsonOrNull(path.join(dir, 'workflow-run.json')),
    obligations: readJsonOrNull(path.join(dir, 'workflow-obligations.json')),
    handoff: readJsonOrNull(path.join(dir, 'handoff-state.json'))
  };
}

function parseJsonOrNull(text) {
  try {
    return JSON.parse(text);
  } catch (_) {
    return null;
  }
}

function fixtureResult(handle, pilot, payloadSummary) {
  return {
    exitCode: 0,
    signal: null,
    stdout: JSON.stringify({ fixture: true, ...payloadSummary }),
    stderr: '',
    json: { fixture: true, ...payloadSummary },
    state: snapshot(handle),
    pilot
  };
}

// Fixture operations write simulated records inside the replay's own temporary directories only.
function runFixture(handle, action, pilot) {
  const p = action.payload || {};
  if (action.op === 'provideEvidence') {
    if (typeof p.id !== 'string' || !/^[a-z0-9-]+$/.test(p.id)) throw new Error('provideEvidence needs a stable id');
    const dir = path.join(handle.stateHome, 'prep-host-events');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${p.id}.json`), JSON.stringify(p.record || {}, null, 2), 'utf8');
    return fixtureResult(handle, pilot, { op: 'provideEvidence', id: p.id });
  }
  if (action.op === 'mutateIdentity') {
    if (typeof p.path !== 'string' || path.isAbsolute(p.path) || p.path.split(/[\\/]/).includes('..')) {
      throw new Error('mutateIdentity path must be workspace-relative');
    }
    const target = path.join(handle.workspace, p.path);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, String(p.content), 'utf8');
    return fixtureResult(handle, pilot, { op: 'mutateIdentity', kind: p.kind, path: p.path });
  }
  if (action.op === 'timestampHints') {
    const dir = sessionDirOf(handle);
    if (!dir) throw new Error('timestampHints needs an existing session');
    const file = path.join(dir, 'handoff-state.json');
    const current = readJsonOrNull(file) || {};
    const next = { ...current };
    if (p.lastEditAt === 'early') next.lastEditAt = 1000;
    if (p.lastVerifyAt === 'now') next.lastVerifyAt = Date.now();
    fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
    return fixtureResult(handle, pilot, { op: 'timestampHints' });
  }
  throw new Error(`unknown fixture op ${action.op}`);
}

// Actions are the only way replay state changes. Each controller/stop op maps to the existing public entry point.
function runAction(handle, action, pilot) {
  const dist = DISTRIBUTIONS[handle.distribution];
  const sid = handle.sessionId;
  const p = action.payload || {};
  if (!ALL_OPS.has(action.op)) throw new Error(`unsupported replay op ${action.op}`);
  if (FIXTURE_OPS.has(action.op)) return runFixture(handle, action, pilot);
  let result;
  if (action.op === 'route') {
    result = runScript(handle, dist.kernel, [], { session_id: sid, cwd: handle.workspace, prompt: p.prompt }, pilot);
  } else if (action.op === 'stop') {
    result = runScript(handle, dist.stopGate, [], { session_id: sid, cwd: handle.workspace, hook_event_name: 'Stop' }, pilot);
  } else if (action.op === 'plan') {
    result = runScript(handle, dist.controller, [
      'plan', '--session-id', sid, '--requirements-json', JSON.stringify(p.requirements),
      '--strategy', p.strategy, '--evidence', p.evidence
    ], undefined, pilot);
  } else if (action.op === 'start') {
    result = runScript(handle, dist.controller, ['start', '--session-id', sid], undefined, pilot);
  } else if (action.op === 'binding') {
    result = runScript(handle, dist.controller, [
      'binding', '--session-id', sid, '--step-id', p.stepId, '--binding-id', p.bindingId,
      '--disposition', p.disposition, '--evidence', p.evidence
    ], undefined, pilot);
  } else if (action.op === 'step') {
    result = runScript(handle, dist.controller, [
      'step', '--session-id', sid, '--step-id', p.stepId, '--disposition', p.disposition, '--evidence', p.evidence
    ], undefined, pilot);
  } else if (action.op === 'obligation') {
    const args = [
      'obligation', '--session-id', sid, '--obligation-id', p.obligationId,
      '--disposition', p.disposition, '--evidence', p.evidence
    ];
    if (p.reasonCode) args.push('--reason-code', p.reasonCode);
    if (p.scope) args.push('--scope', p.scope);
    result = runScript(handle, dist.controller, args, undefined, pilot);
  }
  return {
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    json: parseJsonOrNull(result.stdout || ''),
    state: snapshot(handle),
    pilot
  };
}

// The effective switch for one action: an explicit per-action value wins, otherwise the replay's value.
function effectivePilot(action, replayPilot) {
  return Object.prototype.hasOwnProperty.call(action, 'pilot') ? action.pilot : replayPilot;
}

// Replays one case through one distribution. Actions run in order; a crash is recorded, not hidden.
function replayCase(caseDef, distribution, options = {}) {
  const handle = { ...createSession(distribution, caseDef.id, options.pilot), distribution };
  try {
    const actions = {};
    for (const action of caseDef.actions) {
      if (Object.prototype.hasOwnProperty.call(actions, action.id)) throw new Error(`duplicate action id ${action.id}`);
      const payload = action.payload && action.payload.requirements === '$requirements'
        ? { ...action.payload, requirements: caseDef.requirements }
        : action.payload;
      actions[action.id] = runAction(handle, { ...action, payload }, effectivePilot(action, options.pilot));
    }
    return {
      actions,
      state: snapshot(handle),
      pilot: null,
      pilotReportOrigin: 'harness'
    };
  } finally {
    disposeSession(handle);
  }
}

const VOLATILE_KEYS = new Set([
  'updatedAt', 'recordedAt', 'resolvedAt', 'createdAt', 'lastMutationAt', 'lastEditAt', 'lastVerifyAt',
  'workflowId', 'runId', 'workspaceId', 'startedAt', 'completedAt', 'revision'
]);
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;

// Presence-preserving normalizer for comparing two legs: volatile values become markers, keys stay.
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      const volatile = (VOLATILE_KEYS.has(key) || (/Ms$/.test(key) && typeof item === 'number')) && item !== null;
      out[key] = volatile ? '<volatile>' : normalize(item);
    }
    return out;
  }
  if (typeof value === 'string' && ISO.test(value)) return '<iso>';
  if (typeof value === 'string') return scrubText(value);
  return value;
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Replaces absolute temporary paths, the replay's distribution root and skill locations in raw text.
function scrubText(text) {
  return String(text)
    .replace(/\/(private\/)?var\/folders\/[^\s'"]+/g, '<tmp>')
    .replace(/\/tmp\/[^\s'"]+/g, '<tmp>')
    .replace(UUID, '<uuid>')
    .replace(new RegExp(escapeRegExp(REPO_ROOT + '/plugins/harness-everything/'), 'g'), '<dist>/')
    .replace(new RegExp(escapeRegExp(REPO_ROOT + '/'), 'g'), '<dist>/')
    .replace(/<dist>\/(?:skills\/)?([a-z0-9-]+)\/SKILL\.md/g, '<skill:$1>');
}

function scrubReplay(root) {
  const out = JSON.parse(JSON.stringify(root));
  for (const action of Object.values(out.actions)) {
    action.stdout = scrubText(action.stdout);
    action.stderr = scrubText(action.stderr);
  }
  return out;
}

const ABSENT = Symbol('absent');

// Walks a path of keys and indices. Own-key absence is reported distinctly from a null value.
function lookup(root, pathKeys) {
  let node = root;
  for (const key of pathKeys) {
    if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, key)) return ABSENT;
    node = node[key];
  }
  return node;
}

const sameJson = (left, right) => JSON.stringify(normalize(left)) === JSON.stringify(normalize(right));

// Operators: equals / notEquals (deep JSON equality), includes (array member or substring), absent (own key missing).
function evaluateAssertion(root, assertion) {
  const actual = lookup(root, assertion.path);
  const actualJson = actual === ABSENT ? { kind: 'absent' } : actual;
  let pass;
  if (assertion.operator === 'equals') {
    pass = actual !== ABSENT && sameJson(actual, assertion.expected);
  } else if (assertion.operator === 'notEquals') {
    pass = actual !== ABSENT && !sameJson(actual, assertion.expected);
  } else if (assertion.operator === 'includes') {
    pass = actual !== ABSENT && (
      (Array.isArray(actual) && actual.some(item => sameJson(item, assertion.expected)))
      || (typeof actual === 'string' && typeof assertion.expected === 'string' && actual.includes(assertion.expected))
    );
  } else if (assertion.operator === 'absent') {
    pass = actual === ABSENT;
  } else {
    throw new Error(`unknown operator ${assertion.operator}`);
  }
  return { id: assertion.id, pass, actual: actualJson, expected: assertion.operator === 'absent' ? null : assertion.expected };
}

function evaluateAll(root, assertions) {
  return assertions.map(assertion => evaluateAssertion(root, assertion));
}

function readCaseCorpus(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

module.exports = {
  DISTRIBUTIONS,
  PILOT_SWITCH,
  ALL_OPS,
  replayCase,
  scrubReplay,
  normalize,
  evaluateAll,
  evaluateAssertion,
  lookup,
  readCaseCorpus,
  ABSENT
};
