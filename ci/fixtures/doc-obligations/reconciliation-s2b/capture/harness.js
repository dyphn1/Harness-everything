'use strict';

// Shared harness for the R2c-1 S2b capture/origin-provider RED suite.
// Test-only fixture helper: simulated Claude hook payloads (see ./*.json), a
// two-leg module loader that reports missing S2b modules as structured FAIL
// instead of crashing, and a driver that runs the real state-persist.js script
// per leg with an isolated HARNESS_STATE_HOME.
// Nothing here is production code; nothing here grants origin, credit or
// trust. Fixtures simulate payloads; retained live evidence (doc section
// "Retained live-capture gate") is a different evidence layer.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HERE = __dirname;
const ROOT = path.resolve(HERE, '..', '..', '..', '..', '..');
// The retained live-capture evidence directory the doc names. It is a FUTURE
// artifact: no packet in this commit creates it, so the production-path
// qualification check must report unmet today.
const RETAINED_LIVE_DIR_REL = 'benchmarks/results/live-host/claude-325-3b-s2b';

const LEGS = [
  {
    name: 'source',
    hooksScripts: path.join(ROOT, 'hooks', 'scripts'),
    hooksManifest: path.join(ROOT, 'hooks', 'hooks.json'),
    lib: path.join(ROOT, 'hooks', 'scripts', 'lib'),
  },
  {
    name: 'packaged',
    hooksScripts: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts'),
    hooksManifest: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'hooks.json'),
    lib: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'lib'),
  },
];

class InfraError extends Error {}

// ---- Declared capture vocabulary (RED contract of this suite) --------------------

// Field names are the doc's own vocabulary (docs/doc-workflow-reconciliation.md
// S2b capture table): the event name, exact command, cwd, tool_use_id,
// session_id, prompt_id when supplied, agent_id/agent_type when supplied,
// duration_ms, success interrupted or failure is_interrupt, failure
// disposition, and a response digest/reference. Absent input fields stay
// absent in the retained record, never invented.
const CAPTURE_EVENT_NAMES = ['PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop'];
const CAPTURE_BASE_REQUIRED = ['event', 'command', 'cwd', 'tool_use_id', 'session_id', 'responseDigest', 'responseRef'];
const HEX64 = /^[0-9a-f]{64}$/;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(text) {
  // An absent value digests as the literal token "undefined" (stable(undefined) is not a string).
  return crypto.createHash('sha256').update(String(typeof text === 'string' ? text : stable(text))).digest('hex');
}

function payload(name) {
  return JSON.parse(fs.readFileSync(path.join(HERE, name), 'utf8'));
}

function golden() {
  return JSON.parse(fs.readFileSync(path.join(HERE, 'off-handoff-golden.json'), 'utf8'));
}

// ---- Two-leg module loading (never crash on missing S2b modules) ----------------

const moduleCache = new Map();
function loadModule(leg, file) {
  const key = `${leg.name}:${file}`;
  if (moduleCache.has(key)) return moduleCache.get(key);
  const abs = path.join(leg.lib, file);
  const rel = path.relative(ROOT, abs);
  let result;
  if (!fs.existsSync(abs)) {
    result = { error: `module-missing: ${rel} does not exist` };
  } else {
    try {
      result = { mod: require(abs) };
    } catch (error) {
      result = { error: `load-error: ${rel}: ${String(error && error.message).split('\n')[0]}` };
    }
  }
  moduleCache.set(key, result);
  return result;
}

// requirements: [{ file, exports: [names] }]; fn(mods, leg) throws on failure.
// Missing module/exports surface as FAIL with the reason, never a crash.
function requirementsMet(leg, requirements) {
  const mods = {};
  for (const req of requirements || []) {
    const loaded = loadModule(leg, req.file);
    if (loaded.error) return { error: loaded.error };
    for (const name of req.exports || []) {
      if (typeof loaded.mod[name] !== 'function') {
        return { error: `export-missing: ${req.file} does not export ${name}` };
      }
    }
    mods[req.file] = loaded.mod;
  }
  return { mods };
}

function createRunner(label) {
  const rows = [];
  const counts = { PASS: 0, FAIL: 0, INFRA: 0 };
  function emit(status, id, leg, detail) {
    counts[status] += 1;
    rows.push({ status, id, leg, detail: detail || '' });
    console.log(`  ${status} ${id}${leg ? ` [${leg}]` : ''}${detail ? ` — ${detail}` : ''}`);
  }
  function run(id, requirements, fn) {
    for (const leg of LEGS) {
      const met = requirementsMet(leg, requirements);
      if (met.error) { emit('FAIL', id, leg.name, met.error); continue; }
      try {
        fn(met.mods, leg);
        emit('PASS', id, leg.name);
      } catch (error) {
        if (error instanceof InfraError) emit('INFRA', id, leg.name, String(error && error.message).split('\n')[0]);
        else emit('FAIL', id, leg.name, String(error && error.message).split('\n')[0]);
      }
    }
  }
  function summary() {
    console.log(`\n${label} summary: ${counts.PASS} PASS, ${counts.FAIL} FAIL, ${counts.INFRA} INFRA across ${rows.length} assertion-legs`);
    return counts;
  }
  return { run, summary, counts, rows, emit };
}

// ---- Real state-persist driver (one temp state home per drive) --------------------

function sessionDirectoryNameSafe(sessionId) {
  return String(sessionId || 'default').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^\.+/, '');
}

function snapshotSessionTree(stateHome, sessionId) {
  const dirName = sessionDirectoryNameSafe(sessionId);
  const hits = [];
  (function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (abs.split(path.sep).includes(dirName)) hits.push(abs);
    }
  })(stateHome);
  const files = {};
  for (const abs of hits) files[path.relative(stateHome, abs).replace(/\\/g, '/')] = fs.readFileSync(abs, 'utf8');
  return files;
}

// Deep-clones the fixture payload, binds cwd/workflow to this drive's temp
// workspace (state-persist resolution keys off cwd and HARNESS_WORKSPACE_ROOT),
// then runs the leg's state-persist.js with an isolated HARNESS_STATE_HOME.
// Returns { code, stdout, stderr, files } covering the session subtree only.
function driveStatePersist(leg, baseName, overrides = {}, options = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'r2c1-drive-'));
  const wsRoot = path.join(home, 'ws');
  fs.mkdirSync(wsRoot, { recursive: true });
  const stateHome = path.join(home, 'state-home');
  fs.mkdirSync(stateHome, { recursive: true });
  const driven = JSON.parse(JSON.stringify(payload(baseName)));
  for (const [k, v] of Object.entries(overrides)) {
    if (v === undefined) delete driven[k];
    else driven[k] = v;
  }
  driven.cwd = wsRoot;
  const env = {
    ...process.env,
    CLAUDE: '1',
    HARNESS_STATE_HOME: stateHome,
    HARNESS_WORKSPACE_ROOT: wsRoot,
    ...(options.env || {}),
  };
  let result;
  try {
    result = spawnSync('node', [path.join(leg.hooksScripts, 'state-persist.js')], {
      input: JSON.stringify(driven),
      encoding: 'utf8',
      env,
      timeout: 30000,
    });
  } catch (error) {
    throw new InfraError(`state-persist subprocess could not be started: ${error.message}`);
  }
  if (result.error) throw new InfraError(`state-persist subprocess error: ${String(result.error.message || result.error)}`);
  const out = {
    code: result.status,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    files: snapshotSessionTree(stateHome, driven.session_id),
    filesRoot: stateHome,
    wsRoot,
    // The payload actually sent to the hook (cwd rebound to wsRoot); capture records are compared to it.
    payload: driven,
  };
  try { fs.rmSync(home, { recursive: true, force: true }); } catch { /* best effort */ }
  return out;
}

// ---- Capture-record discovery and shape validation --------------------------------

function deepScan(value, visit) {
  if (value && typeof value === 'object') {
    visit(value);
    if (Array.isArray(value)) for (const item of value) deepScan(item, visit);
    else for (const key of Object.keys(value)) deepScan(value[key], visit);
  }
}

// Finds any object inside any driven-file content that carries the full
// required capture vocabulary, whatever filename it was written to.
function findCaptureRecords(files) {
  const found = [];
  for (const content of Object.values(files)) {
    let parsed;
    try { parsed = JSON.parse(content); } catch { continue; }
    deepScan(parsed, node => {
      if (node && CAPTURE_EVENT_NAMES.includes(node.event)
        && CAPTURE_BASE_REQUIRED.every(k => Object.prototype.hasOwnProperty.call(node, k))) {
        found.push(node);
      }
    });
  }
  return found;
}

// Declared capture contract: doc field names; absent input fields stay absent;
// success records keep the success interrupted flag and no failure fields;
// failure records keep is_interrupt plus a nonempty failureDisposition.
function assertCaptureRecordShape(record, sourcePayload) {
  const missing = CAPTURE_BASE_REQUIRED.filter(k => !(k in record));
  if (missing.length) throw new Error(`capture record missing required keys: ${missing.join(',')}`);
  if (record.event !== sourcePayload.hook_event_name) throw new Error(`capture event mismatch: ${record.event}`);
  if (record.command !== sourcePayload.tool_input.command) throw new Error('capture command mismatch');
  if (record.tool_use_id !== sourcePayload.tool_use_id) throw new Error('capture tool_use_id mismatch');
  if (record.session_id !== sourcePayload.session_id) throw new Error('capture session_id mismatch');
  if (record.cwd !== sourcePayload.cwd) throw new Error('capture cwd mismatch');
  if (!HEX64.test(String(record.responseDigest))) throw new Error(`capture responseDigest is not sha256 hex`);
  if (!String(record.responseRef).length) throw new Error('capture responseRef is empty');
  if (sourcePayload.prompt_id === undefined) {
    if ('prompt_id' in record) throw new Error('capture invented prompt_id for absent input');
  } else if (record.prompt_id !== sourcePayload.prompt_id) {
    throw new Error('capture prompt_id mismatch');
  }
  for (const key of ['agent_id', 'agent_type']) {
    if (sourcePayload[key] === undefined) {
      if (key in record) throw new Error(`capture invented ${key} for absent input`);
    } else if (record[key] !== sourcePayload[key]) {
      throw new Error(`capture ${key} mismatch`);
    }
  }
  if (sourcePayload.duration_ms === undefined) {
    if ('duration_ms' in record) throw new Error('capture invented duration_ms for absent input');
  } else if (record.duration_ms !== sourcePayload.duration_ms) {
    throw new Error('capture duration_ms mismatch');
  }
  if (record.event === 'PostToolUse') {
    if (typeof record.interrupted !== 'boolean') throw new Error('capture interrupted is not boolean');
    const expected = Boolean(sourcePayload.tool_response && sourcePayload.tool_response.interrupted);
    if (record.interrupted !== expected) throw new Error('capture interrupted mismatch');
    if ('is_interrupt' in record) throw new Error('capture success record invented is_interrupt');
    if ('failureDisposition' in record) throw new Error('capture success record invented failureDisposition');
  } else if (record.event === 'PostToolUseFailure') {
    if (typeof record.failureDisposition !== 'string' || !record.failureDisposition.length) {
      throw new Error('capture failureDisposition missing');
    }
    if (typeof record.is_interrupt !== 'boolean') throw new Error('capture is_interrupt is not boolean');
    if (sourcePayload.is_interrupt === undefined) throw new Error('fixture error: failure payload must supply is_interrupt');
    if (record.is_interrupt !== sourcePayload.is_interrupt) throw new Error('capture is_interrupt mismatch');
  }
  return record;
}

// ---- Provider input builders -------------------------------------------------------

const FIXED = {
  sessionId: 'r2c1-sess-a',
  workflowId: 'wf-r2c1',
  workflowRevision: 0,
  taskId: 'task-r2c1',
  workspaceRoot: '/tmp/r2c1-provider-ws',
};

// The labelled verdict line of a final review artifact. Mirrors the capture vocabulary only, so the fixture
// carries the same explicit verdict a real reviewer must state. Free text such as `REJECT: ...` carries none.
const REVIEW_VERDICT_LINE = /^\s*Review verdict:\s*(approve|reject)\b[.:]?\s*(.*)$/im;
function reviewVerdictOf(message) {
  const text = String(message || '');
  const match = REVIEW_VERDICT_LINE.exec(text);
  if (!match) return { reviewVerdict: null, reviewSummary: null };
  const summary = [match[2], text.slice(match.index + match[0].length)].join('\n').trim();
  return { reviewVerdict: match[1].toLowerCase(), reviewSummary: summary };
}

// Simulated capture journal entry built directly from a payload fixture, using
// the declared capture schema; the digest binds payload.tool_response bytes.
// opts: { ref, agentId, sessionId, interrupted, toolUseId, trusted }
function simulateCapture(name, opts = {}) {
  const source = payload(name);
  const sessionId = opts.sessionId || FIXED.sessionId;
  const record = {
    captureId: `${name}:${opts.ref || 'primary'}`,
    ref: opts.ref,
    event: source.hook_event_name,
    command: source.tool_input && typeof source.tool_input === 'object' ? source.tool_input.command : '',
    cwd: source.cwd,
    tool_use_id: opts.toolUseId || source.tool_use_id,
    session_id: opts.sessionId || source.session_id,
    responseDigest: sha256(stable(source.tool_response)),
    responseRef: `payload/${name}`,
  };
  if (source.prompt_id !== undefined) record.prompt_id = source.prompt_id;
  // Mirrors the capture builder: the launch tool name separates the Agent/Task result surface (F4/F5).
  if (typeof source.tool_name === 'string') record.tool_name = source.tool_name;
  const agentId = opts.agentId || source.agent_id;
  if (agentId !== undefined) {
    record.agent_id = agentId;
    record.agent_type = source.agent_type;
  }
  if (source.duration_ms !== undefined) record.duration_ms = source.duration_ms;
  if (source.hook_event_name === 'PostToolUse') {
    // An absent interrupted field stays absent: unknown, not false (A3 section 1, same rule as the capture builder).
    const hostInterrupted = source.tool_response && typeof source.tool_response.interrupted === 'boolean' ? source.tool_response.interrupted : undefined;
    const interrupted = opts.interrupted !== undefined ? Boolean(opts.interrupted) : hostInterrupted;
    if (interrupted !== undefined) record.interrupted = interrupted;
  } else if (source.hook_event_name === 'PostToolUseFailure') {
    record.is_interrupt = Boolean(source.is_interrupt);
    record.failureDisposition = /Exit code (\d+)/.exec(String(source.error || '')) ? 'nonzero-exit' : 'host-failure-error';
  } else if (source.hook_event_name === 'SubagentStop') {
    record.reviewDigest = sha256(source.last_assistant_message || '');
    // The explicit structured verdict is part of the capture record (S2b vocabulary): a labelled
    // `Review verdict: approve|reject` line in the final review artifact. Free text carries none.
    Object.assign(record, reviewVerdictOf(source.last_assistant_message));
  }
  if (opts.trusted !== undefined) record.trusted = opts.trusted;
  return record;
}

// Explicitly fake qualification for dependency injection only. The production
// path passes no qualification and must resolve the retained live dir instead.
function fakeQualification(ref) {
  return { source: 'fake-test-fixture', faked: true, ref, toolUseIdPopulated: true, agentIdPopulated: true };
}

function providerInput(overrides = {}) {
  const executors = overrides.executorPrincipals || [];
  return {
    hostId: 'claude-code',
    sessionId: FIXED.sessionId,
    workspaceRoot: FIXED.workspaceRoot,
    taskId: FIXED.taskId,
    workflowId: FIXED.workflowId,
    workflowRevision: FIXED.workflowRevision,
    principals: { author: FIXED.sessionId, executors },
    captures: [],
    ...overrides,
    principals: { author: FIXED.sessionId, executors },
  };
}

// Minimal S2a-shaped identity for provider event assertions; integration with
// the full adapter identityset is a later packet's contract.
function providerIdentity() {
  return {
    sessionId: FIXED.sessionId,
    workflowId: FIXED.workflowId,
    workflowRevision: FIXED.workflowRevision,
    taskId: FIXED.taskId,
    prdRoot: 'docs/prd/',
  };
}

module.exports = {
  ROOT,
  RETAINED_LIVE_DIR_REL,
  LEGS,
  InfraError,
  CAPTURE_EVENT_NAMES,
  CAPTURE_BASE_REQUIRED,
  FIXED,
  stable,
  sha256,
  payload,
  golden,
  createRunner,
  requirementsMet,
  driveStatePersist,
  findCaptureRecords,
  assertCaptureRecordShape,
  simulateCapture,
  fakeQualification,
  providerInput,
  providerIdentity,
};
