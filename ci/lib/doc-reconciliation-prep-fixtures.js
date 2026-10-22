'use strict';

// #325 Phase 3b preparation: isolated replay helper for the document-reconciliation RED corpus.
//
// Each replay creates a fresh workspace and state home, runs ordered actions through one explicitly
// selected distribution, and returns a replay root with the L1 shape:
//   { actions: { [actionId]: { exitCode, signal, error, errorCode, stdout, stderr, json, state, pilot } }, state, pilot, pilotReportOrigin }.
// Nothing here is production code. The pilot switch is passed to children through their environment; the S1
// runtime reads it and, when ON, runs the fail-closed no-credit gate. Fixture operations
// (provideEvidence, mutateIdentity, timestampHints) write simulated records only inside the replay's own
// temporary directories. They are contract fixtures, not production commands; no S1 runtime reads them.
// seedState writes one allowlisted session file (workflow-stages.json) into the replay's own state home, so a case can
// reach a correlated Fable stage contract. It is test-only; no production code reads or writes through it.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const PILOT_SWITCH = 'HARNESS_DOC_RECONCILIATION_PILOT';
// Session-directory file the S1 runtime writes its pilot report to. Read-only here; only a report carrying
// reportOrigin: runtime is accepted.
const PILOT_REPORT_FILE = 'doc-reconciliation-pilot.json';
const BASELINE_AUTHOR = Object.freeze({ name: 'doc-recon-replay', email: 'doc-recon-replay@invalid' });
const BASELINE_DATE = '2026-01-01T00:00:00Z';
const FIXTURE_OPS = new Set(['provideEvidence', 'mutateIdentity', 'timestampHints', 'seedState', 'gitCommit', 'editJournal', 'editDocCheck']);
const CONTROLLER_OPS = new Set(['plan', 'start', 'binding', 'stageBinding', 'step', 'obligation']);
// Host-transport ops (F4): hostRun executes a registered command the way the host would; hookDeliver sends one raw
// host payload through the real hook entry (state-persist.js). Neither writes a journal or accepted record itself.
const HOST_OPS = new Set(['hostRun', 'hookDeliver']);
const ALL_OPS = new Set(['route', 'stop', 'stopGeneric', ...CONTROLLER_OPS, ...FIXTURE_OPS, ...HOST_OPS]);
// CI-only qualification preloader. Passed as `node --require <file>` to every child of a replay that asks for it.
const QUALIFICATION_PRELOAD = path.join(__dirname, 'doc-reconciliation-qualification-preload.js');
const CAPTURE_JOURNAL_FILE = 'doc-reconciliation-capture.json';
// The only session files a case may seed, and only inside its own temporary state home.
const SEEDABLE_FILES = new Set(['workflow-stages.json']);

// Explicit distributions. Every entry point is named by absolute path; no module is reused across legs.
const DISTRIBUTIONS = Object.freeze({
  source: {
    root: REPO_ROOT,
    controller: path.join(REPO_ROOT, 'hooks', 'scripts', 'workflow-disposition.js'),
    stopGate: path.join(REPO_ROOT, 'hooks', 'scripts', 'workflow-stop-gate.js'),
    kernel: path.join(REPO_ROOT, 'harness-everything', 'scripts', 'kernel-router.js'),
    genericStopGate: path.join(REPO_ROOT, 'hooks', 'scripts', 'stop-gate.js'),
    stateHook: path.join(REPO_ROOT, 'hooks', 'scripts', 'state-persist.js'),
    docCheck: path.join(REPO_ROOT, 'harness-everything', 'scripts', 'doc-check.js')
  },
  packaged: {
    root: path.join(REPO_ROOT, 'plugins', 'harness-everything'),
    controller: path.join(REPO_ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'workflow-disposition.js'),
    stopGate: path.join(REPO_ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'workflow-stop-gate.js'),
    kernel: path.join(REPO_ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts', 'kernel-router.js'),
    genericStopGate: path.join(REPO_ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'stop-gate.js'),
    stateHook: path.join(REPO_ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'state-persist.js'),
    docCheck: path.join(REPO_ROOT, 'plugins', 'harness-everything', 'skills', 'harness-everything', 'scripts', 'doc-check.js')
  }
});

// Child-process limits for every replay subprocess: a deadline, an output bound and an uncatchable kill. The deadline
// is about 150x the slowest real action measured on the corpus (65 ms over 440 spawns), so it keeps headroom on slow
// CI hosts. A test copy of the corpus may shorten it per case and substitute one fixture script for one operation
// (see limitsFor). The committed corpus carries neither, and the production CLI never reads an environment switch.
const CHILD_LIMITS = Object.freeze({ timeoutMs: 10000, maxBuffer: 4 * 1024 * 1024, killSignal: 'SIGKILL' });
const FIXTURE_DIR = path.join(__dirname, '..', 'fixtures', 'doc-obligations', 'reconciliation-prep');
const SUBSTITUTABLE_OPS = new Set(['route', 'stop', ...CONTROLLER_OPS]);
const LIMIT_KEYS = new Set(['timeoutMs', 'substitutes']);

function limitsFor(caseDef) {
  const override = caseDef.childLimits;
  if (override === undefined) return { ...CHILD_LIMITS, substitutes: {} };
  if (!override || typeof override !== 'object' || Array.isArray(override)) throw new Error(`${caseDef.id} childLimits must be an object`);
  for (const key of Object.keys(override)) {
    if (!LIMIT_KEYS.has(key)) throw new Error(`${caseDef.id} childLimits has unknown key ${key}`);
  }
  const timeoutMs = override.timeoutMs === undefined ? CHILD_LIMITS.timeoutMs : override.timeoutMs;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > CHILD_LIMITS.timeoutMs) {
    throw new Error(`${caseDef.id} childLimits.timeoutMs may only shorten the ${CHILD_LIMITS.timeoutMs} ms deadline`);
  }
  const substitutes = override.substitutes === undefined ? {} : override.substitutes;
  for (const [op, file] of Object.entries(substitutes)) {
    if (!SUBSTITUTABLE_OPS.has(op)) throw new Error(`${caseDef.id} childLimits.substitutes names unsupported op ${op}`);
    if (typeof file !== 'string' || !/^[a-z0-9-]+\.js$/.test(file) || !fs.existsSync(path.join(FIXTURE_DIR, file))) {
      throw new Error(`${caseDef.id} childLimits.substitutes.${op} must name a script in the prep fixture directory`);
    }
  }
  return { ...CHILD_LIMITS, timeoutMs, substitutes: { ...substitutes } };
}

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

// A distribution is a named one above, or an explicit set of entry paths (F4-T2: a test runs the real entries from its own
// staged tree, with its own export). Either way every entry point is an absolute path.
const DISTRIBUTION_KEYS = ['controller', 'stopGate', 'kernel', 'genericStopGate', 'stateHook', 'docCheck'];
function resolveDistribution(distribution) {
  if (typeof distribution === 'string') {
    if (!DISTRIBUTIONS[distribution]) throw new Error(`unknown distribution ${distribution}`);
    return DISTRIBUTIONS[distribution];
  }
  if (distribution && typeof distribution === 'object' && DISTRIBUTION_KEYS.every(key => typeof distribution[key] === 'string')) return distribution;
  throw new Error('unknown distribution');
}

function createSession(distribution, caseId, pilot) {
  const dist = resolveDistribution(distribution);
  const token = crypto.randomBytes(4).toString('hex');
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), `doc-recon-${caseId}-${distribution}-ws-${token}-`));
  const stateHome = fs.mkdtempSync(path.join(os.tmpdir(), `doc-recon-${caseId}-${distribution}-state-${token}-`));
  return {
    dist,
    distribution: typeof distribution === 'string' ? distribution : 'custom',
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

// The preloader is a test-driver argument only: a replay with `preload: true` adds it to every child it launches.
function runScript(handle, script, args, stdin, pilot) {
  const preload = handle.preload ? ['--require', QUALIFICATION_PRELOAD] : [];
  // Test-only extra arguments (for example a file-access spy). They come before the preloader, so the spy sees everything.
  return spawnSync(process.execPath, [...(handle.nodeArgs || []), ...preload, script, ...args], {
    cwd: handle.workspace,
    encoding: 'utf8',
    input: stdin === undefined ? undefined : JSON.stringify(stdin),
    env: childEnv(handle.workspace, handle.stateHome, pilot),
    timeout: handle.limits.timeoutMs,
    maxBuffer: handle.limits.maxBuffer,
    killSignal: handle.limits.killSignal
  });
}

// A test copy of the corpus may substitute one fixture script for an operation; otherwise the distribution's entry runs.
function scriptFor(handle, op, fallback) {
  const name = handle.limits.substitutes[op];
  return name === undefined ? fallback : path.join(FIXTURE_DIR, name);
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
  // The capture journal is included only when a hook actually wrote it, so legacy replays keep their shape.
  const capture = readJsonOrNull(path.join(dir, CAPTURE_JOURNAL_FILE));
  return {
    workflow: readJsonOrNull(path.join(dir, 'workflow-run.json')),
    obligations: readJsonOrNull(path.join(dir, 'workflow-obligations.json')),
    handoff: readJsonOrNull(path.join(dir, 'handoff-state.json')),
    ...(capture ? { capture } : {})
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
    error: null,
    errorCode: null,
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
  if (action.op === 'editDocCheck') {
    // Appends to the leg's installed doc-check file after a capture (F4-T6: the assessment-time digest check). Only a staged
    // copy may change: the target must sit outside the repository.
    if (typeof p.append !== 'string') throw new Error('editDocCheck needs an append string');
    const target = handle.dist.docCheck;
    if (path.basename(target) !== 'doc-check.js' || target.startsWith(REPO_ROOT + path.sep)) throw new Error('editDocCheck may only edit a staged doc-check copy');
    fs.appendFileSync(target, p.append, 'utf8');
    return fixtureResult(handle, pilot, { op: 'editDocCheck' });
  }
  if (action.op === 'gitCommit') {
    // Commits the replay workspace's current tree into HEAD mid-workflow. The baseline recorded at plan is not moved by
    // this fixture: the case exists to show that scope is still assessed against that recorded baseline. A clean tree
    // makes `git commit` fail, so a misused op is an infrastructure fault, not a silent no-op.
    if (typeof p.message !== 'string' || !p.message.trim()) throw new Error('gitCommit needs a message');
    git(handle.workspace, ['add', '-A']);
    git(handle.workspace, [
      '-c', `user.name=${BASELINE_AUTHOR.name}`, '-c', `user.email=${BASELINE_AUTHOR.email}`, '-c', 'commit.gpgsign=false',
      'commit', '-q', '--no-verify', '-m', p.message
    ]);
    return fixtureResult(handle, pilot, { op: 'gitCommit' });
  }
  if (action.op === 'seedState') {
    // Writes one allowlisted session file into the replay's own state home. The session must already exist, so the
    // seeded file lands where the runtime reads it; nothing outside the replay's state home is reachable.
    if (!SEEDABLE_FILES.has(p.file)) throw new Error(`seedState may only write ${[...SEEDABLE_FILES].join(', ')}`);
    const dir = sessionDirOf(handle);
    if (!dir) throw new Error('seedState needs an existing session');
    const target = path.join(dir, p.file);
    if (!target.startsWith(handle.stateHome + path.sep)) throw new Error('seedState target escaped the replay state home');
    fs.writeFileSync(target, JSON.stringify(p.json, null, 2), 'utf8');
    return fixtureResult(handle, pilot, { op: 'seedState', file: p.file });
  }
  if (action.op === 'editJournal') {
    // Rewrites one retained field of the replay's own capture journal, as an edited payload or result would appear on disk.
    const dir = sessionDirOf(handle);
    if (!dir) throw new Error('editJournal needs an existing session');
    const file = path.join(dir, CAPTURE_JOURNAL_FILE);
    const doc = readJsonOrNull(file);
    if (!doc || !Array.isArray(doc.records) || !doc.records[p.index]) throw new Error('editJournal needs an existing journal record');
    doc.records[p.index][p.key] = p.value;
    fs.writeFileSync(file, JSON.stringify(doc, null, 2), 'utf8');
    return fixtureResult(handle, pilot, { op: 'editJournal', key: p.key });
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

function resultOf(handle, result, pilot) {
  return {
    exitCode: result.status,
    signal: result.signal,
    error: result.error ? result.error.message : null,
    errorCode: result.error ? result.error.code || null : null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    json: parseJsonOrNull(result.stdout || ''),
    state: snapshot(handle),
    pilot
  };
}

const DOC_CHECK_TOKEN = '{{DOC_CHECK}}';
const CAPTURE_HOOK_EVENTS = new Set(['PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop']);

// Host-transport ops (F4). hostRun executes the distribution's registered doc-check entry by argv, with no shell, the
// way the host runs a registered command. hookDeliver sends one raw host payload to the real state-persist hook, with
// the session and workspace fields the host would send. Payload content is declared by the case and then the entry
// itself records it; the replay never writes a journal record or accepted event directly.
function runHostOp(handle, action, pilot) {
  const dist = handle.dist;
  const p = action.payload || {};
  if (action.op === 'hostRun') {
    if (p.command !== 'doc-check' || !Array.isArray(p.args) || !p.args.every(arg => typeof arg === 'string')) {
      throw new Error('hostRun needs command "doc-check" and string args');
    }
    return resultOf(handle, runScript(handle, scriptFor(handle, 'docCheck', dist.docCheck), p.args, undefined, pilot), pilot);
  }
  if (!CAPTURE_HOOK_EVENTS.has(p.event)) throw new Error(`hookDeliver event ${p.event} is not a capture event`);
  const body = {
    session_id: p.sessionId === undefined ? handle.sessionId : p.sessionId,
    cwd: handle.workspace,
    hook_event_name: p.event
  };
  if (p.event === 'PostToolUse' || p.event === 'PostToolUseFailure') {
    if (typeof p.command !== 'string' || typeof p.toolUseId !== 'string') throw new Error('hookDeliver tool events need command and toolUseId');
    body.tool_name = p.toolName === undefined ? 'Bash' : p.toolName;
    // {{DOC_CHECK}} is the installed doc-check path of the leg under test, so a positive fixture invokes the path the
    // host would really run; a relative spelling stays a literal negative case.
    body.tool_input = { command: p.command.split(DOC_CHECK_TOKEN).join(dist.docCheck) };
    body.tool_use_id = p.toolUseId;
    // A subagent's own tool call carries its host agent_id at the top level (F4 executor identity).
    if (p.agentId !== undefined) body.agent_id = p.agentId;
  }
  if (p.event === 'PostToolUse') {
    if (p.fromRun !== undefined) {
      const run = handle.actions[p.fromRun];
      if (!run) throw new Error(`hookDeliver fromRun ${p.fromRun} names no earlier action`);
      body.tool_response = { stdout: run.stdout, stderr: '', interrupted: false };
    } else {
      body.tool_response = p.response;
    }
    if (p.interrupted !== undefined) body.tool_response.interrupted = p.interrupted;
    if (p.omitInterrupted === true) delete body.tool_response.interrupted;
  } else if (p.event === 'PostToolUseFailure') {
    body.error = p.error;
    body.is_interrupt = p.isInterrupt === true;
  } else {
    body.agent_id = p.agentId;
    body.agent_type = p.agentType;
    if (p.event === 'SubagentStop') body.last_assistant_message = p.lastAssistantMessage;
  }
  // The hook is fail-open and prints nothing, so only its exit status and the journal it writes are observable.
  return resultOf(handle, runScript(handle, scriptFor(handle, 'hookDeliver', dist.stateHook), [], body, pilot), pilot);
}

// Actions are the only way replay state changes. Each controller/stop op maps to the existing public entry point.
function runAction(handle, action, pilot) {
  const dist = handle.dist;
  const sid = handle.sessionId;
  const p = action.payload || {};
  if (!ALL_OPS.has(action.op)) throw new Error(`unsupported replay op ${action.op}`);
  if (FIXTURE_OPS.has(action.op)) return runFixture(handle, action, pilot);
  if (HOST_OPS.has(action.op)) return runHostOp(handle, action, pilot);
  let result;
  if (action.op === 'route') {
    result = runScript(handle, scriptFor(handle, 'route', dist.kernel), [], { session_id: sid, cwd: handle.workspace, prompt: p.prompt }, pilot);
  } else if (action.op === 'stop') {
    result = runScript(handle, scriptFor(handle, 'stop', dist.stopGate), [], { session_id: sid, cwd: handle.workspace, hook_event_name: 'Stop' }, pilot);
  } else if (action.op === 'stopGeneric') {
    // The second Stop surface (verification reminder). It must exit 0 in every case, like the workflow surface.
    result = runScript(handle, scriptFor(handle, 'stopGeneric', dist.genericStopGate), [], { session_id: sid, cwd: handle.workspace, hook_event_name: 'Stop' }, pilot);
  } else if (action.op === 'plan') {
    result = runScript(handle, scriptFor(handle, 'plan', dist.controller), [
      'plan', '--session-id', sid, '--requirements-json', JSON.stringify(p.requirements),
      '--strategy', p.strategy, '--evidence', p.evidence
    ], undefined, pilot);
  } else if (action.op === 'start') {
    result = runScript(handle, scriptFor(handle, 'start', dist.controller), ['start', '--session-id', sid], undefined, pilot);
  } else if (action.op === 'binding') {
    result = runScript(handle, scriptFor(handle, 'binding', dist.controller), [
      'binding', '--session-id', sid, '--step-id', p.stepId, '--binding-id', p.bindingId,
      '--disposition', p.disposition, '--evidence', p.evidence
    ], undefined, pilot);
  } else if (action.op === 'stageBinding') {
    // Correlated Fable stage binding (the stage-binding command). Generic binding refuses Fable workflows.
    result = runScript(handle, scriptFor(handle, 'stageBinding', dist.controller), [
      'stage-binding', '--session-id', sid, '--stage-id', p.stageId, '--binding-id', p.bindingId,
      '--disposition', p.disposition, '--evidence', p.evidence
    ], undefined, pilot);
  } else if (action.op === 'step') {
    result = runScript(handle, scriptFor(handle, 'step', dist.controller), [
      'step', '--session-id', sid, '--step-id', p.stepId, '--disposition', p.disposition, '--evidence', p.evidence
    ], undefined, pilot);
  } else if (action.op === 'obligation') {
    const args = [
      'obligation', '--session-id', sid, '--obligation-id', p.obligationId,
      '--disposition', p.disposition, '--evidence', p.evidence
    ];
    if (p.reasonCode) args.push('--reason-code', p.reasonCode);
    if (p.scope) args.push('--scope', p.scope);
    result = runScript(handle, scriptFor(handle, 'obligation', dist.controller), args, undefined, pilot);
  }
  return {
    exitCode: result.status,
    signal: result.signal,
    error: result.error ? result.error.message : null,
    errorCode: result.error ? result.error.code || null : null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    json: parseJsonOrNull(result.stdout || ''),
    state: snapshot(handle),
    pilot
  };
}

// The effective switch for one action. An OFF replay (no replay-level request) stays OFF for every action, so a
// per-action override can only exist inside an ON replay. Inside an ON replay an explicit per-action value wins.
function effectivePilot(action, replayPilot) {
  if (replayPilot === undefined) return undefined;
  return Object.prototype.hasOwnProperty.call(action, 'pilot') ? action.pilot : replayPilot;
}

// Runs git in a replay workspace. Inherited GIT_* variables are removed, so a hook or CI environment cannot point git
// at another repository. Commit dates are fixed so identical inputs give the same baseline commit on both legs.
function git(cwd, args) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) {
    if (key.startsWith('GIT_')) delete env[key];
  }
  env.GIT_AUTHOR_DATE = BASELINE_DATE;
  env.GIT_COMMITTER_DATE = BASELINE_DATE;
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', env, timeout: CHILD_LIMITS.timeoutMs, maxBuffer: CHILD_LIMITS.maxBuffer });
  if (result.error || result.status !== 0) {
    const detail = result.error ? result.error.message : String(result.stderr || '').split('\n')[0];
    throw new Error(`git failed in the replay workspace: ${detail}`);
  }
  return result.stdout;
}

function writeWorkspaceFiles(workspace, files) {
  for (const [rel, content] of Object.entries(files)) {
    if (typeof rel !== 'string' || path.isAbsolute(rel) || rel.split(/[\\/]/).includes('..')) {
      throw new Error(`input path must be workspace-relative: ${rel}`);
    }
    const target = path.join(workspace, rel);
    if (content === null) {
      fs.rmSync(target, { force: true });
      continue;
    }
    if (typeof content !== 'string') throw new Error(`input file ${rel} must be a string or null`);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, 'utf8');
  }
}

// Materialises a case's declared file inputs before any action runs. Non-empty baseFiles become a committed Git
// baseline, so `plan` records a real HEAD. candidateFiles then become the working tree, and a null value deletes a
// baseline file. Without baseFiles the workspace stays non-Git, so its baseline is unavailable. Fixture maps alone are
// not runtime authority; the runtime collects scope itself.
function materialiseInput(handle, input) {
  const base = (input && input.baseFiles) || {};
  const candidate = (input && input.candidateFiles) || {};
  if (Object.keys(base).length) {
    git(handle.workspace, ['init', '-q']);
    writeWorkspaceFiles(handle.workspace, base);
    git(handle.workspace, ['add', '-A']);
    git(handle.workspace, [
      '-c', `user.name=${BASELINE_AUTHOR.name}`, '-c', `user.email=${BASELINE_AUTHOR.email}`, '-c', 'commit.gpgsign=false',
      'commit', '-q', '--no-verify', '-m', 'baseline'
    ]);
  }
  writeWorkspaceFiles(handle.workspace, candidate);
}

// Read-only extraction of a runtime pilot report from the session directory. Only a report that carries
// reportOrigin: runtime is accepted. Otherwise the replay reports no pilot with origin harness; nothing is synthesized.
function runtimePilotOf(handle) {
  const dir = sessionDirOf(handle);
  const report = dir ? readJsonOrNull(path.join(dir, PILOT_REPORT_FILE)) : null;
  if (report && typeof report === 'object' && !Array.isArray(report) && report.reportOrigin === 'runtime') {
    return { pilot: report, pilotReportOrigin: 'runtime' };
  }
  return { pilot: null, pilotReportOrigin: 'harness' };
}

// Replays one case through one distribution. Actions run in order and the replay stops at its first infrastructure
// fault: the faulted action is recorded, no later action runs, and the temporary directories are still removed.
// A crash is recorded, not hidden.
// `options.preload: true` adds the CI-only qualification preloader to every child (F4 test transport). Production
// replays never set it, so the production gate stays unmet.
function replayCase(caseDef, distribution, options = {}) {
  const limits = limitsFor(caseDef);
  const mode = options.pilot === undefined ? 'off' : 'on';
  const handle = { ...createSession(distribution, caseDef.id, options.pilot), limits, preload: options.preload === true, nodeArgs: Array.isArray(options.nodeArgs) ? options.nodeArgs : [] };
  try {
    materialiseInput(handle, caseDef.input);
    const actions = {};
    handle.actions = actions;
    for (const action of caseDef.actions) {
      if (Object.prototype.hasOwnProperty.call(actions, action.id)) throw new Error(`duplicate action id ${action.id}`);
      const payload = action.payload && action.payload.requirements === '$requirements'
        ? { ...action.payload, requirements: caseDef.requirements }
        : action.payload;
      actions[action.id] = runAction(handle, { ...action, payload }, effectivePilot(action, options.pilot));
      if (actionFaults(action, actions[action.id], mode).length) break;
    }
    return {
      actions,
      state: snapshot(handle),
      ...runtimePilotOf(handle)
    };
  } finally {
    disposeSession(handle);
  }
}

// Per-action expected-exit policy. `expectExit` is optional and per mode: { off, on }, each an integer or a
// non-empty array of integers. A mode it omits permits exit 0 only. The policy names what the process may do
// without being an infrastructure failure. It does not name the desired outcome: an ON assertion that wants exit 2
// while the process exits 0 stays a qualified gap, not a policy violation.
const DEFAULT_EXIT = Object.freeze([0]);
const EXIT_POLICY_MODES = new Set(['off', 'on']);

function exitPolicy(action, mode) {
  if (action.expectExit === undefined) return DEFAULT_EXIT;
  const policy = action.expectExit;
  if (!policy || typeof policy !== 'object' || Array.isArray(policy)) throw new Error(`${action.id} expectExit must be {off, on}`);
  for (const key of Object.keys(policy)) {
    if (!EXIT_POLICY_MODES.has(key)) throw new Error(`${action.id} expectExit has unknown mode ${key}`);
  }
  if (policy[mode] === undefined) return DEFAULT_EXIT;
  const codes = Array.isArray(policy[mode]) ? policy[mode] : [policy[mode]];
  if (codes.length === 0 || !codes.every(code => Number.isInteger(code) && code >= 0 && code <= 255)) {
    throw new Error(`${action.id} expectExit.${mode} must be an exit code or a non-empty array of exit codes`);
  }
  return codes;
}

// Required output of an accepted (exit 0) action. Routing must print its checkpoint, and controller ops must print
// the JSON envelope with a string state. Stop and fixture ops have no required output here.
const ROUTE_CHECKPOINT = /^\[Tier Routing Pre-check\][\s\S]*RECOMMENDED TIER:/;

function missingRequiredOutput(action, result) {
  if (action.op === 'route') return !ROUTE_CHECKPOINT.test(result.stdout);
  if (CONTROLLER_OPS.has(action.op)) {
    return !(result.json !== null && typeof result.json === 'object' && !Array.isArray(result.json) && typeof result.json.state === 'string');
  }
  return false;
}

// The one fault predicate. Fault messages for one action's result: a child deadline or output bound hit, a spawn
// error, a signal (the forced kill included), no exit status, an exit outside the action's policy, or missing required
// output on an accepted exit. replayCase stops on it, and infrastructureFaults classifies with it.
function actionFaults(action, result, mode) {
  const faults = [];
  if (result.errorCode === 'ETIMEDOUT') faults.push('timed out at the child deadline (ETIMEDOUT)');
  else if (result.errorCode === 'ENOBUFS') faults.push('child output exceeded maxBuffer (ENOBUFS)');
  else if (result.error) faults.push(`spawn error ${result.error}`);
  if (result.signal) faults.push(`terminated by signal ${result.signal}`);
  if (result.exitCode === null) return [...faults, 'no exit status'];
  const policy = exitPolicy(action, mode);
  if (!policy.includes(result.exitCode)) return [...faults, `exit ${result.exitCode} outside policy [${policy.join(', ')}]`];
  if (result.exitCode === 0 && missingRequiredOutput(action, result)) faults.push('malformed required output');
  return faults;
}

// Infrastructure faults of one replay, as { actionId, message }. Only actions that ran are judged, so a replay that
// stopped at its first fault is classified by the same predicate that stopped it. Any fault makes the case an
// infrastructure failure, decided before registry matching or parity, so a faulted replay never qualifies as an
// expected RED gap.
function infrastructureFaults(caseDef, root, mode) {
  return caseDef.actions
    .filter(action => Object.prototype.hasOwnProperty.call(root.actions, action.id))
    .flatMap(action => actionFaults(action, root.actions[action.id], mode).map(message => ({ actionId: action.id, message })));
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

// Separators are folded before any marker is applied, so Windows-shaped and POSIX-shaped paths meet the same
// patterns. Folding happens on the text, not on the marker set, so no marker depends on the host separator.
function posixForm(value) {
  return String(value).replace(/\\/g, '/');
}

// Replaces each maximal run of characters outside [\s'"] that contains `needle`. This matches what
// /[^\s'"]*needle[^\s'"]*/g replaces, but in linear time: that regex backtracks quadratically on one long token,
// and a flooded child stdout is exactly such a token (a 4 MB run took minutes; the scan takes milliseconds).
function replaceTokensContaining(text, needle, replacement) {
  return text.split(/([\s'"]+)/).map((part, index) => (index % 2 === 1 || !part.includes(needle) ? part : replacement)).join('');
}

let defaultRoots = null;
// Roots of this checkout and of the temporary directory, both as the host reports them and as realpath resolves
// them (macOS /var is a symlink to /private/var; Windows short and long names can differ).
function scrubRoots() {
  if (defaultRoots === null) {
    const tmp = [os.tmpdir()];
    try {
      tmp.push(fs.realpathSync(os.tmpdir()));
    } catch (_) {
      // The unresolved directory above still scrubs its own prefix.
    }
    defaultRoots = { repo: REPO_ROOT, tmp };
  }
  return defaultRoots;
}

// Case-insensitive, because Windows volumes and tmp names are case-preserving but case-insensitive.
function literalPath(value) {
  return new RegExp(escapeRegExp(posixForm(value)), 'gi');
}

// Replaces this replay's temporary paths, the checkout root and skill locations in raw text.
function scrubText(text, roots = scrubRoots()) {
  let out = replaceTokensContaining(posixForm(text), 'doc-recon-', '<tmp>')
    .replace(/\/(private\/)?var\/folders\/[^\s'"]+/g, '<tmp>')
    .replace(/\/tmp\/[^\s'"]+/g, '<tmp>');
  for (const dir of roots.tmp) out = out.replace(literalPath(dir), '<tmp>');
  out = out.replace(UUID, '<uuid>')
    .replace(literalPath(`${roots.repo}/plugins/harness-everything/`), '<dist>/')
    .replace(literalPath(`${roots.repo}/`), '<dist>/');
  return out.replace(/<dist>\/(?:skills\/)?([a-z0-9-]+)\/SKILL\.md/g, '<skill:$1>');
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
  CHILD_LIMITS,
  FIXTURE_DIR,
  PILOT_SWITCH,
  ALL_OPS,
  replayCase,
  exitPolicy,
  actionFaults,
  infrastructureFaults,
  scrubReplay,
  scrubText,
  normalize,
  evaluateAll,
  evaluateAssertion,
  lookup,
  readCaseCorpus,
  ABSENT
};
