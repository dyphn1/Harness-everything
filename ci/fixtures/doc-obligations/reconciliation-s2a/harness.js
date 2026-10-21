'use strict';

// Shared harness for the S2a RED suites. Test-only: fake origin providers, temporary Git repositories and event builders
// live here (a fixture file). Nothing here is production code, and nothing here grants origin, credit or trust.
// Every module under test is loaded per leg (canonical and packaged) and missing modules are reported per assertion.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const FIXTURE_DIR = __dirname;
const VECTORS = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, 'vectors.json'), 'utf8'));
const LEGS = [
  {
    name: 'source',
    lib: path.join(ROOT, 'hooks', 'scripts', 'lib'),
    scripts: path.join(ROOT, 'harness-everything', 'scripts')
  },
  {
    name: 'packaged',
    lib: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'lib'),
    scripts: path.join(ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts')
  }
];
const DERIVE_CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, VECTORS.deriveConfig), 'utf8'));
const CONFIG_REL = '.agents/harness-everything/project-docs.json';
const PRINCIPALS = VECTORS.principals;
const FIXED_TASK = VECTORS.fixedTask;
const FIXED_WORKFLOW = VECTORS.fixedWorkflow;
const ZERO_DIGEST = '0'.repeat(64);

class InfraError extends Error {}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function sameStable(actual, expected, label) {
  const a = stable(actual);
  const e = stable(expected);
  if (a !== e) throw new Error(`${label}: got ${a.slice(0, 240)} expected ${e.slice(0, 240)}`);
}

// ---- Module loading per leg -------------------------------------------------------------------------------------

const cache = new Map();
function loadModule(leg, where, file) {
  const abs = path.join(leg[where], file);
  const rel = path.relative(ROOT, abs);
  if (!fs.existsSync(abs)) return { error: `module-missing: ${rel} does not exist` };
  if (!cache.has(abs)) {
    try {
      cache.set(abs, { mod: require(abs) });
    } catch (error) {
      cache.set(abs, { error: `module-load: ${rel}: ${error.message.split('\n')[0]}` });
    }
  }
  return cache.get(abs);
}

// Loads a fresh copy of a module after recording wrappers are installed, so destructured references in the module
// (for example const { execFileSync } = require('child_process')) bind to the recording wrappers.
function freshModule(abs) {
  delete require.cache[require.resolve(abs)];
  return require(abs);
}

// Records file writes, spawned commands and network connects while fn runs. Spawned commands are forwarded to the real
// implementation so Git-backed capture still works; every other command is recorded and refused.
function recordingIo(fn) {
  const childProcessModule = require('child_process');
  const netModule = require('net');
  const log = { writes: [], spawns: [], net: [] };
  const original = {
    writeFileSync: fs.writeFileSync,
    appendFileSync: fs.appendFileSync,
    mkdirSync: fs.mkdirSync,
    rmSync: fs.rmSync,
    renameSync: fs.renameSync,
    unlinkSync: fs.unlinkSync,
    execFileSync: childProcessModule.execFileSync,
    spawnSync: childProcessModule.spawnSync,
    execSync: childProcessModule.execSync,
    connect: netModule.connect
  };
  for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'renameSync', 'unlinkSync']) {
    fs[name] = (...args) => { log.writes.push(name); throw new Error(`forbidden file write ${name}`); };
  }
  childProcessModule.execFileSync = (file, args, options) => {
    log.spawns.push(file);
    if (file !== 'git') throw new Error(`forbidden spawn ${file}`);
    return original.execFileSync(file, args, options);
  };
  childProcessModule.spawnSync = (file, args, options) => {
    log.spawns.push(file);
    if (file !== 'git') throw new Error(`forbidden spawn ${file}`);
    return original.spawnSync(file, args, options);
  };
  childProcessModule.execSync = (command) => { log.spawns.push(String(command).split(' ')[0]); throw new Error('forbidden execSync'); };
  netModule.connect = () => { log.net.push('connect'); throw new Error('forbidden network connect'); };
  try {
    return fn(log);
  } finally {
    for (const name of ['writeFileSync', 'appendFileSync', 'mkdirSync', 'rmSync', 'renameSync', 'unlinkSync']) fs[name] = original[name];
    childProcessModule.execFileSync = original.execFileSync;
    childProcessModule.spawnSync = original.spawnSync;
    childProcessModule.execSync = original.execSync;
    netModule.connect = original.connect;
  }
}

// ---- Runner: one line per assertion and leg; INFRA is distinct from FAIL -----------------------------------------

function createRunner(label) {
  const rows = [];
  const counts = { PASS: 0, FAIL: 0, INFRA: 0 };
  function emit(status, id, leg, detail) {
    counts[status] += 1;
    rows.push({ status, id, leg, detail: detail || '' });
    console.log(`  ${status} ${id}${leg ? ` [${leg}]` : ''}${detail ? ` — ${detail}` : ''}`);
  }
  // requirements: [{ where: 'lib' | 'scripts', file, exports: [names] }]. fn(mods, leg) throws on failure.
  function run(id, requirements, fn) {
    for (const leg of LEGS) {
      const mods = {};
      let error = null;
      for (const req of requirements) {
        const loaded = loadModule(leg, req.where, req.file);
        if (loaded.error) { error = loaded.error; break; }
        for (const name of req.exports || []) {
          if (typeof loaded.mod[name] !== 'function') { error = `export-missing: ${req.file} does not export ${name}`; break; }
        }
        if (error) break;
        mods[req.file] = loaded.mod;
      }
      if (error) { emit('FAIL', id, leg.name, error); continue; }
      try {
        fn(mods, leg);
        emit('PASS', id, leg.name);
      } catch (error) {
        if (error instanceof InfraError) emit('INFRA', id, leg.name, error.message.split('\n')[0]);
        else emit('FAIL', id, leg.name, error.message.split('\n')[0]);
      }
    }
  }
  // One assertion over both legs at once (parity or cross-leg). Any missing leg reports its own reason.
  function pair(id, requirements, fn) {
    const mods = {};
    for (const leg of LEGS) {
      let error = null;
      for (const req of requirements) {
        const loaded = loadModule(leg, req.where, req.file);
        if (loaded.error) { error = loaded.error; break; }
        mods[`${leg.name}:${req.file}`] = loaded.mod;
      }
      if (error) {
        for (const other of LEGS) emit('FAIL', id, other.name, error);
        return;
      }
    }
    try {
      fn(mods);
      emit('PASS', id, 'both');
    } catch (error) {
      if (error instanceof InfraError) emit('INFRA', id, 'both', error.message.split('\n')[0]);
      else emit('FAIL', id, 'both', error.message.split('\n')[0]);
    }
  }
  function summary() {
    const reasons = new Map();
    for (const row of rows) {
      if (row.status !== 'FAIL') continue;
      const key = row.detail.replace(/ \(.*$/, '').split(' — ')[0].slice(0, 120);
      reasons.set(key, (reasons.get(key) || 0) + 1);
    }
    console.log(`\n${label} summary: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.INFRA} INFRA across ${rows.length} assertion-legs`);
    if (reasons.size) {
      console.log('FAIL reason classes:');
      for (const [reason, count] of [...reasons.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${count} × ${reason}`);
    }
    return counts;
  }
  return { run, pair, summary, counts, rows };
}

// ---- Temporary Git repositories ---------------------------------------------------------------------------------

const GIT_DATE = '2026-01-01T00:00:00Z';
function git(cwd, args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  env.GIT_AUTHOR_DATE = GIT_DATE;
  env.GIT_COMMITTER_DATE = GIT_DATE;
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env, timeout: 20000, maxBuffer: 16 * 1024 * 1024 });
  if (result.error || result.status !== 0) {
    throw new InfraError(`git ${args[0]} failed in fixture repository: ${result.error ? result.error.message : String(result.stderr || '').split('\n')[0]}`);
  }
  return result.stdout;
}

function writeFiles(root, files) {
  for (const [rel, content] of Object.entries(files)) {
    if (path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) throw new InfraError(`fixture path must be relative: ${rel}`);
    const target = path.join(root, rel);
    if (content === null) { fs.rmSync(target, { force: true }); continue; }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
}

function makeRepo(baseFiles) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'doc-s2a-')));
  git(root, ['init', '-q']);
  writeFiles(root, { [CONFIG_REL]: JSON.stringify(DERIVE_CONFIG, null, 2) + '\n', ...baseFiles });
  git(root, ['add', '-A']);
  git(root, ['-c', 'user.name=s2a-fixture', '-c', 'user.email=s2a-fixture@invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', 'baseline']);
  const commit = git(root, ['rev-parse', 'HEAD']).trim();
  return { root, commit };
}

function removeRepo(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

function readTree(root) {
  const files = {};
  if (!fs.existsSync(root)) return files;
  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[path.relative(root, full).split(path.sep).join('/')] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return files;
}

// Base and candidate file maps for a named vector (derive fixture directory or inline files).
function vectorFiles(key) {
  const vec = VECTORS.vectors[key];
  if (!vec) throw new InfraError(`unknown vector ${key}`);
  if (vec.deriveCase) {
    const dir = path.join(ROOT, 'ci', 'fixtures', 'doc-obligations', 'derive', vec.deriveCase);
    return { base: readTree(path.join(dir, 'base')), candidate: readTree(path.join(dir, 'candidate')) };
  }
  return { base: clone(vec.files.base), candidate: clone(vec.files.candidate) };
}

// Per-path SHA256 of the file bytes actually present in the working tree (the stored bytes for the candidate).
function fileDigest(root, rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  return sha256(fs.readFileSync(abs));
}

// PRD-set digest as the checker envelope defines it: SHA256 of sorted [path, artifactDigest] pairs under docs/prd/.
function prdSetDigest(root) {
  const files = readTree(root);
  const pairs = Object.keys(files).filter(p => p.startsWith('docs/prd/')).sort().map(p => [p, fileDigest(root, p)]);
  return sha256(JSON.stringify(pairs));
}

// ---- Fake origin provider (test-only; explicitly not production attestation) -----------------------------------

class FakeOrigin {
  constructor({ context, mode = 'accept' }) {
    this.context = clone(context);
    this.mode = mode;
    this.refs = new Map();
    this.issued = new Set();
    this.contextCalls = 0;
    this.contextAt = null;
  }

  issueEvent(reference, event) {
    this.refs.set(reference, clone(event));
    this.issued.add(reference);
  }

  resolveContext() {
    this.contextCalls += 1;
    if (this.mode === 'missing') return { status: 'unavailable', diagnostics: [{ code: 'origin-unavailable', message: 'no host context is correlated for this workspace' }] };
    if (this.mode === 'expired') return { status: 'unavailable', diagnostics: [{ code: 'origin-unavailable', message: 'the host context has expired' }] };
    const context = this.contextAt ? this.contextAt(this.contextCalls) : this.context;
    return { status: 'accepted', context: clone(context), originRef: 'fake-origin:context' };
  }

  resolveEvent({ reference }) {
    if (this.mode === 'missing' || this.mode === 'expired') {
      return { status: 'unavailable', diagnostics: [{ code: 'origin-unavailable', message: 'origin support is unavailable for this reference' }] };
    }
    if (!this.issued.has(reference)) {
      return { status: 'rejected', diagnostics: [{ code: 'origin-untrusted', message: 'reference was not issued by the current provider' }] };
    }
    const event = clone(this.refs.get(reference));
    if (event.providerStatus === 'stale') {
      return { status: 'rejected', diagnostics: [{ code: 'event-stale', message: 'the provider reports this event as stale' }] };
    }
    return { status: 'accepted', event, originRef: event.originRef, correlation: { toolCorrelationId: event.toolCorrelationId || null } };
  }
}

function fakeContext(extra = {}) {
  return {
    workspaceId: 'fake-workspace',
    sessionId: FIXED_WORKFLOW.sessionId,
    workflowId: FIXED_WORKFLOW.workflowId,
    workflowRevision: FIXED_WORKFLOW.workflowRevision,
    taskId: FIXED_TASK.taskId,
    principals: { author: PRINCIPALS.author, executors: [PRINCIPALS.executor] },
    activeHost: { hostId: 'fake-host' },
    baselineReference: 'fake-origin:workflow-start-baseline',
    ...extra
  };
}

function workflowInput(overrides = {}) {
  return { workflowId: FIXED_WORKFLOW.workflowId, workflowRevision: FIXED_WORKFLOW.workflowRevision, sessionId: FIXED_WORKFLOW.sessionId, ...overrides };
}

function taskInput(overrides = {}) {
  return clone({ taskId: FIXED_TASK.taskId, requirements: FIXED_TASK.requirements, ...overrides });
}

// Positional producer input: the shape the S2a design names (baseline pin, workflow, task, scope, active host, PRD root).
function producerInput(repo, overrides = {}) {
  return {
    workspaceRoot: repo.root,
    baseline: { root: repo.root, commit: repo.commit },
    workflow: workflowInput(overrides.workflow),
    task: taskInput(overrides.task),
    scope: { prdRoot: 'docs/prd/' },
    activeHost: { hostId: 'fake-host' },
    prdRoot: 'docs/prd/',
    ...overrides.top
  };
}

// Builds accepted-event payloads for every expected MUST of a vector from a captured snapshot. Digests are computed from
// the working-tree bytes (the stored bytes), not from snapshot field names.
function buildEvents(snapshot, repo, vec) {
  const events = {};
  const artifactDigests = {};
  for (const obligation of snapshot.obligations || []) {
    for (const rel of (obligation.scope && obligation.scope.paths) || []) {
      artifactDigests[rel] = fileDigest(repo.root, rel);
    }
  }
  const paths = mustId => (snapshot.obligations || []).find(item => item.id === mustId)?.scope?.paths || [];
  for (const mustId of vec.expectedMustIds) {
    const kind = (vec.eventKindByMust || {})[mustId];
    if (!kind) continue;
    const capability = mustId.replace(/^doc-change:/, '');
    const ref = `ref-${capability}`;
    const common = {
      eventId: `evt-${capability}`,
      producerId: 'fake-producer',
      identity: clone(snapshot.identity),
      paths: paths(mustId),
      provenance: 'fake-origin:fixture',
      capability,
      originRef: `fake-origin:event:${ref}`
    };
    if (kind === 'execution') {
      events[ref] = {
        ...common,
        kind: 'execution',
        principalId: PRINCIPALS.executor,
        command: `fixture-check ${capability}`,
        argv: ['fixture-check', capability],
        cwd: '.',
        exitCode: 0,
        signal: null,
        toolCorrelationId: `tool-${capability}`,
        startIdentity: clone(snapshot.identity),
        endIdentity: clone(snapshot.identity),
        resultRef: `result-${capability}`,
        artifactDigests: clone(artifactDigests)
      };
    } else {
      events[ref] = {
        ...common,
        kind: 'review',
        principalId: PRINCIPALS.reviewer,
        verdict: 'approve',
        summary: `fixture review for ${capability}: approve`,
        reviewedArtifactDigests: clone(artifactDigests),
        independentOf: [PRINCIPALS.author, PRINCIPALS.executor]
      };
    }
  }
  return events;
}

// Reason codes found anywhere in a decision or acceptance result (diagnostics, rejections, unsatisfied reasons).
function codesOf(...results) {
  const codes = new Set();
  for (const result of results) {
    if (!result || typeof result !== 'object') continue;
    for (const item of [...(result.diagnostics || []), ...(result.rejected || []), ...(result.unsatisfied || [])]) {
      if (item && typeof item.code === 'string') codes.add(item.code);
      if (item && typeof item.reasonCode === 'string') codes.add(item.reasonCode);
    }
  }
  return [...codes].sort();
}

function expectCodes(actualCodes, expected, label) {
  const hit = expected.some(code => actualCodes.includes(code));
  if (!hit) throw new Error(`${label}: expected one of ${JSON.stringify(expected)} in ${JSON.stringify(actualCodes)}`);
}

module.exports = {
  ROOT,
  FIXTURE_DIR,
  VECTORS,
  LEGS,
  DERIVE_CONFIG,
  CONFIG_REL,
  PRINCIPALS,
  ZERO_DIGEST,
  InfraError,
  stable,
  sha256,
  clone,
  sameStable,
  createRunner,
  loadModule,
  freshModule,
  recordingIo,
  git,
  writeFiles,
  makeRepo,
  removeRepo,
  readTree,
  vectorFiles,
  fileDigest,
  prdSetDigest,
  FakeOrigin,
  fakeContext,
  workflowInput,
  taskInput,
  producerInput,
  buildEvents,
  codesOf,
  expectCodes
};
