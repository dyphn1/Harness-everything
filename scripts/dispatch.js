#!/usr/bin/env node
'use strict';

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPORT_WRITER = path.join(__dirname, 'report-writer.js');
const USAGE = 'Usage: dispatch --runner <codex|opencode|agy> --model <id> --packet <path> --worktree <path> --scratch <absolute-path> --report <path> [--effort <low|medium|high|xhigh>] [--assignment <path>] [--admission-policy <path>] [--dry-run] [--json] [--help]';
const VALUE_OPTIONS = new Set(['--runner', '--model', '--packet', '--worktree', '--scratch', '--report', '--effort', '--assignment', '--admission-policy']);
const POOL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const SUPPORTED_RUNNERS = new Set(['codex', 'opencode', 'agy']);
const CODEX_EFFORTS = new Set(['low', 'medium', 'high', 'xhigh']);
const AGY_SETTINGS = '{"permissions":{"allow":["command(*)","read_file(*)"]}}';
const READINESS_TIMEOUT_MS = 120000;
const EXECUTION_TIMEOUT_MS = 2700000;
const AGY_QUOTA_LINE = /^(?:(?:Error|jetski):\s*)?429 RESOURCE_EXHAUSTED\b.+\bResets in [0-9A-Za-z][0-9A-Za-z :.,-]*$/;

// #466 D-gate. Managed mode is entered only by --assignment <sidecar JSON>. C8 owns admission
// (one runner-profile decision + this registry); the assignment owns which actor runs each gate.
// `unsandboxed` gates need a loopback-capable profile; `any` gates are worker-compatible everywhere.
const GATE_REGISTRY = new Map([
  ['verify:all', 'unsandboxed'],
  ['verify:all --fast', 'unsandboxed'],
  ['npm run test:consistency', 'any'],
  ['npm run test:references', 'any'],
  ['npm run test:portability', 'any'],
]);
const FOCUSED_NODE_TEST_PREFIX = 'node --test ';
const FOCUSED_NODE_TEST_SEGMENT = /^[A-Za-z0-9_.-]+$/;
const GATE_ACTORS = new Set(['worker', 'coordinator']);

function isFocusedNodeTest(id) {
  if (!id.startsWith(FOCUSED_NODE_TEST_PREFIX)) return false;
  const operand = id.slice(FOCUSED_NODE_TEST_PREFIX.length);
  if (!operand.endsWith('.js') || operand.startsWith('/')) return false;
  const segments = operand.split('/');
  if (segments.some(seg => !seg || seg === '.' || seg === '..' || !FOCUSED_NODE_TEST_SEGMENT.test(seg))) return false;
  return segments.at(-1).length > 3;
}

// The single runner-profile decision: codex runs `-s workspace-write` and agy requests `--sandbox`
// (not treated as an unsandboxed loopback-capable profile). Only opencode is unsandboxed.
function runnerProfile(runner) {
  return { sandboxed: runner === 'codex' || runner === 'agy' };
}

function gateRequirement(id) {
  if (GATE_REGISTRY.has(id)) return GATE_REGISTRY.get(id);
  return isFocusedNodeTest(id) ? 'any' : null;
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function assignmentInvalid(message) {
  fail(19, 'GATE_ASSIGNMENT_INVALID', 'gate', message);
}

function loadGateAssignment(file, worktree, runner) {
  const resolved = pathFrom(worktree, file);
  let parsed;
  try {
    if (!fs.statSync(resolved).isFile()) assignmentInvalid('--assignment must name an existing file');
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (cause) {
    if (cause instanceof DispatchFailure) throw cause;
    assignmentInvalid(`--assignment is unreadable or not JSON: ${cause.code || 'parse error'}`);
  }
  if (!isPlainObject(parsed) || Object.keys(parsed).sort().join() !== 'gates,schemaVersion') {
    assignmentInvalid('assignment must be an object with exactly schemaVersion and gates');
  }
  if (parsed.schemaVersion !== 1) assignmentInvalid('assignment schemaVersion must be 1');
  if (!Array.isArray(parsed.gates)) assignmentInvalid('assignment gates must be an array');
  const seen = new Set();
  const gates = { worker: [], coordinator: [] };
  const entries = [];
  for (const gate of parsed.gates) {
    if (!isPlainObject(gate) || Object.keys(gate).sort().join() !== 'actor,id') assignmentInvalid('each gate must be an object with exactly id and actor');
    if (typeof gate.id !== 'string' || !GATE_ACTORS.has(gate.actor)) assignmentInvalid('gate id must be a string and actor must be worker or coordinator');
    if (seen.has(gate.id)) assignmentInvalid(`duplicate gate id: ${gate.id}`);
    seen.add(gate.id);
    if (!gateRequirement(gate.id)) assignmentInvalid(`unknown gate id: ${gate.id}`);
    entries.push(gate);
  }
  // Admission is decided only after the whole assignment validates, so a bad entry is never masked by a refusal.
  for (const gate of entries) {
    if (gate.actor === 'worker' && gateRequirement(gate.id) === 'unsandboxed' && runnerProfile(runner).sandboxed) {
      const reason = runner === 'agy'
        ? 'agy requests --sandbox and is not treated as an unsandboxed loopback-capable profile'
        : `${runner} runs sandboxed`;
      fail(18, 'GATE_REFUSED', 'gate', `worker gate "${gate.id}" needs an unsandboxed profile; ${reason}. Assign it to the coordinator.`);
    }
    gates[gate.actor].push(gate.id);
  }
  return gates;
}
let evidencePaths = {};

class DispatchFailure extends Error {
  constructor(exitCode, code, phase, message) {
    super(message);
    this.exitCode = exitCode;
    this.code = code;
    this.phase = phase;
  }
}

function fail(exitCode, code, phase, message) {
  throw new DispatchFailure(exitCode, code, phase, message);
}

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === '--json' || flag === '--dry-run' || flag === '--help') {
      if (options[flag]) fail(10, 'INVALID_INPUT', 'input', `duplicate option: ${flag}`);
      options[flag] = true;
    } else if (VALUE_OPTIONS.has(flag)) {
      if (options[flag] !== undefined) fail(10, 'INVALID_INPUT', 'input', `duplicate option: ${flag}`);
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) fail(10, 'INVALID_INPUT', 'input', `missing value for ${flag}`);
      options[flag] = value;
      index += 1;
    } else {
      fail(10, 'INVALID_INPUT', 'input', `unknown option: ${flag}`);
    }
  }
  return options;
}

function realPath(file) {
  try { return fs.realpathSync.native(file); } catch { return null; }
}

function hasGitMetadata(directory) {
  try {
    return fs.statSync(path.join(directory, 'HEAD')).isFile()
      && fs.statSync(path.join(directory, 'objects')).isDirectory()
      && fs.statSync(path.join(directory, 'refs')).isDirectory()
      && fs.statSync(path.join(directory, 'config')).isFile();
  } catch { return false; }
}

function isGitRoot(directory) {
  const marker = path.join(directory, '.git');
  try {
    const stat = fs.statSync(marker);
    if (stat.isDirectory()) return hasGitMetadata(marker);
    if (stat.isFile()) {
      const match = /^gitdir:\s*(.+)\s*$/i.exec(fs.readFileSync(marker, 'utf8'));
      if (!match) return false;
      const gitdir = path.resolve(directory, match[1]);
      const commonFile = path.join(gitdir, 'commondir');
      const commonDir = fs.existsSync(commonFile) ? path.resolve(gitdir, fs.readFileSync(commonFile, 'utf8').trim()) : gitdir;
      return hasGitMetadata(commonDir);
    }
  } catch {}
  return hasGitMetadata(directory);
}

function canonicalFuturePath(file) {
  let ancestor = path.resolve(file);
  const suffix = [];
  while (true) {
    try {
      fs.lstatSync(ancestor);
    } catch (cause) {
      if (cause?.code === 'ENOENT') {
        const parent = path.dirname(ancestor);
        if (parent === ancestor) break;
        suffix.unshift(path.basename(ancestor));
        ancestor = parent;
        continue;
      }
      return null;
    }
    const canonicalAncestor = realPath(ancestor);
    if (!canonicalAncestor) return null;
    return path.resolve(canonicalAncestor, ...suffix);
  }
  const canonicalRoot = realPath(ancestor);
  return canonicalRoot ? path.resolve(canonicalRoot, ...suffix) : path.resolve(file);
}

function gitAncestor(directory) {
  let current = directory;
  while (true) {
    if (isGitRoot(current)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function isPathInsideOrEqual(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
}

function validateExternalDir(value, onFail, label) {
  if (typeof value !== 'string' || !value.trim() || !path.isAbsolute(value)) {
    onFail(`${label} must be an absolute path outside every Git repository or worktree`);
  }
  const canonical = canonicalFuturePath(value);
  if (!canonical) {
    onFail(`${label} cannot be resolved (dangling symlink or unresolved symlink chain)`);
  }
  if (fs.existsSync(value) && !fs.statSync(value).isDirectory()) {
    onFail(`${label} must be a directory outside every Git repository or worktree`);
  }
  const repository = gitAncestor(canonical);
  if (repository) onFail(`${label} is inside a Git repository or worktree: ${repository}`);
  return { resolved: path.resolve(value), canonical };
}

function validateScratch(value) {
  return validateExternalDir(value, message => fail(11, 'UNSAFE_SCRATCH', 'validation', message), 'scratch').resolved;
}

// #466 D-admission. Managed mode requires --admission-policy <path>, mapping opaque pool ids to
// positive integer caps and (runner, model) routes to a pool id, plus one shared external dir.
function admissionInvalid(message) {
  fail(21, 'ADMISSION_POLICY_INVALID', 'admission', message);
}

function loadAdmissionPolicy(file, worktree, scratch, runner, model) {
  if (file === undefined) admissionInvalid('managed mode requires --admission-policy <path>');
  const resolved = pathFrom(worktree, file);
  let parsed;
  try {
    if (!fs.statSync(resolved).isFile()) admissionInvalid('--admission-policy must name an existing file');
    parsed = JSON.parse(fs.readFileSync(resolved, 'utf8'));
  } catch (cause) {
    if (cause instanceof DispatchFailure) throw cause;
    admissionInvalid(`--admission-policy is unreadable or not JSON: ${cause.code || 'parse error'}`);
  }
  if (!isPlainObject(parsed) || Object.keys(parsed).sort().join() !== 'dir,pools,routes,schemaVersion') {
    admissionInvalid('admission policy must be an object with exactly schemaVersion, dir, pools, and routes');
  }
  if (parsed.schemaVersion !== 1) admissionInvalid('admission policy schemaVersion must be 1');
  const dirInfo = validateExternalDir(parsed.dir, admissionInvalid, 'admission dir');
  const scratchCanonical = canonicalFuturePath(scratch);
  if (isPathInsideOrEqual(scratchCanonical, dirInfo.canonical) || isPathInsideOrEqual(dirInfo.canonical, scratchCanonical)) {
    admissionInvalid('admission dir must be outside --scratch so per-run cleanup cannot touch reservations');
  }
  if (!isPlainObject(parsed.pools) || Object.keys(parsed.pools).length === 0) {
    admissionInvalid('admission policy pools must be a non-empty object');
  }
  const pools = new Map();
  for (const [poolId, spec] of Object.entries(parsed.pools)) {
    if (!POOL_ID_PATTERN.test(poolId)) admissionInvalid(`invalid opaque pool id: ${poolId}`);
    if (!isPlainObject(spec) || Object.keys(spec).join() !== 'cap' || !Number.isSafeInteger(spec.cap) || spec.cap < 1) {
      admissionInvalid(`pool "${poolId}" must be an object with positive integer cap`);
    }
    pools.set(poolId, spec.cap);
  }
  if (!Array.isArray(parsed.routes)) admissionInvalid('admission policy routes must be an array');
  const routeMap = new Map();
  for (const route of parsed.routes) {
    if (!isPlainObject(route) || Object.keys(route).sort().join() !== 'model,pool,runner') {
      admissionInvalid('each admission route must be an object with exactly runner, model, and pool');
    }
    if (!SUPPORTED_RUNNERS.has(route.runner)) admissionInvalid(`unknown runner in admission route: ${route.runner}`);
    if (typeof route.model !== 'string' || !route.model.trim()) admissionInvalid('admission route model must be a non-empty string');
    if (typeof route.pool !== 'string' || !pools.has(route.pool)) admissionInvalid(`admission route references unknown pool: ${route.pool}`);
    const routeKey = `${route.runner}\0${route.model.trim()}`;
    if (routeMap.has(routeKey)) admissionInvalid(`duplicate admission route for ${route.runner} model "${route.model.trim()}"`);
    routeMap.set(routeKey, route.pool);
  }
  const selectedPool = routeMap.get(`${runner}\0${model}`);
  if (!selectedPool) admissionInvalid(`no admission pool configured for ${runner} model "${model}"`);
  return { dir: dirInfo.resolved, pool: selectedPool, cap: pools.get(selectedPool) };
}

function createSlotFile(slotPath, pool, slot) {
  const record = {
    schemaVersion: 1,
    pool,
    slot,
    holderPid: process.pid,
    childPid: null,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(slotPath, `${JSON.stringify(record)}\n`, { flag: 'wx' });
  return { ...record, slotPath, released: false };
}

// #466 F1: automatic stale-slot reclamation is disabled for the pilot. Any existing slot file
// (live, abandoned, corrupt, or indeterminate) counts as occupied until the normal owner releases
// it or the coordinator clears it with the pool quiesced and holder/child confirmed absent.
function acquireAdmissionSlot(admission) {
  const poolDir = path.join(admission.dir, admission.pool);
  fs.mkdirSync(poolDir, { recursive: true });
  const resolvedPoolDir = realPath(poolDir);
  const repository = resolvedPoolDir && gitAncestor(resolvedPoolDir);
  if (!resolvedPoolDir || repository) {
    admissionInvalid(`admission dir resolves inside a Git repository or worktree: ${repository || poolDir}`);
  }
  for (let slot = 0; slot < admission.cap; slot += 1) {
    const slotPath = path.join(poolDir, `slot-${slot}.json`);
    try {
      return createSlotFile(slotPath, admission.pool, slot);
    } catch (cause) {
      if (cause?.code !== 'EEXIST') throw cause;
    }
  }
  fail(22, 'ADMISSION_CAP_REACHED', 'admission', `admission pool "${admission.pool}" is at cap ${admission.cap}; refusing before spawn`);
}

function updateReservationChild(reservation, childPid) {
  if (!reservation || reservation.released) return;
  reservation.childPid = childPid;
  const payload = `${JSON.stringify({
    schemaVersion: 1,
    pool: reservation.pool,
    slot: reservation.slot,
    holderPid: reservation.holderPid,
    childPid: reservation.childPid,
    startedAt: reservation.startedAt,
  })}\n`;
  const tmpPath = `${reservation.slotPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    fs.writeFileSync(tmpPath, payload);
    fs.renameSync(tmpPath, reservation.slotPath);
  } catch {
    try { fs.unlinkSync(tmpPath); } catch {}
    try { fs.writeFileSync(reservation.slotPath, payload); } catch {}
  }
}

function releaseAdmissionSlot(reservation) {
  if (!reservation || reservation.released) return;
  reservation.released = true;
  try {
    const parsed = JSON.parse(fs.readFileSync(reservation.slotPath, 'utf8'));
    if (parsed.holderPid === reservation.holderPid && parsed.startedAt === reservation.startedAt) {
      fs.unlinkSync(reservation.slotPath);
    }
  } catch {}
}

function pathFrom(base, value) {
  return path.resolve(base, value);
}

function existsOrSymlink(file) {
  try { fs.lstatSync(file); return true; } catch { return false; }
}

function worktreeRelativePath(worktree, target, label) {
  const canonical = canonicalFuturePath(target);
  if (!canonical) fail(10, 'INVALID_INPUT', 'input', `${label} cannot be resolved inside --worktree for agy`);
  const rel = path.relative(worktree, canonical);
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) {
    fail(10, 'INVALID_INPUT', 'input', `${label} must be inside --worktree for agy`);
  }
  return rel.replace(/\\/g, '/');
}

function validateInput(options) {
  const runner = options['--runner'];
  const model = options['--model'];
  if (!['codex', 'opencode', 'agy'].includes(runner)) fail(10, 'INVALID_INPUT', 'input', '--runner must be codex, opencode, or agy');
  if (!model || !model.trim()) fail(10, 'INVALID_INPUT', 'input', '--model must be a nonempty id');
  const effort = options['--effort'];
  if (effort !== undefined && runner !== 'codex') fail(10, 'INVALID_INPUT', 'input', '--effort is only supported for codex');
  if (effort !== undefined && !CODEX_EFFORTS.has(effort)) fail(10, 'INVALID_INPUT', 'input', '--effort must be low, medium, high, or xhigh');
  for (const flag of ['--packet', '--worktree', '--scratch', '--report']) {
    if (!options[flag]) fail(10, 'INVALID_INPUT', 'input', `missing required option: ${flag}`);
  }

  const requestedWorktree = path.resolve(options['--worktree']);
  const worktree = realPath(requestedWorktree);
  if (!worktree || !fs.statSync(worktree).isDirectory() || !isGitRoot(worktree)) {
    fail(10, 'INVALID_INPUT', 'input', '--worktree must name an existing Git repository or worktree root');
  }
  const packet = pathFrom(worktree, options['--packet']);
  if (!fs.existsSync(packet) || !fs.statSync(packet).isFile()) fail(10, 'INVALID_INPUT', 'input', '--packet must name an existing file');
  const report = pathFrom(worktree, options['--report']);
  if (!fs.existsSync(path.dirname(report)) || !fs.statSync(path.dirname(report)).isDirectory()) {
    fail(10, 'INVALID_INPUT', 'input', '--report parent directory must already exist');
  }
  if (existsOrSymlink(report)) fail(10, 'INVALID_INPUT', 'input', '--report already exists; choose a fresh report path');
  const packetRelative = runner === 'agy' ? worktreeRelativePath(worktree, packet, '--packet') : undefined;
  const reportRelative = runner === 'agy' ? worktreeRelativePath(worktree, report, '--report') : undefined;
  const scratch = validateScratch(options['--scratch']);
  const trimmedModel = model.trim();
  const managed = options['--assignment'] !== undefined;
  if (!managed && options['--admission-policy'] !== undefined) {
    fail(10, 'INVALID_INPUT', 'input', '--admission-policy is only supported in managed mode (--assignment)');
  }
  const gates = managed ? loadGateAssignment(options['--assignment'], worktree, runner) : undefined;
  const admission = managed ? loadAdmissionPolicy(options['--admission-policy'], worktree, scratch, runner, trimmedModel) : undefined;
  return { runner, model: trimmedModel, effort, packet, packetRelative, worktree, scratch, report, reportRelative, gates, admission };
}

function response(options, outcome, evidence = evidencePaths, input) {
  const message = String(outcome.message || '').slice(0, 1000);
  const result = {
    ok: outcome.exitCode === 0,
    code: outcome.code,
    phase: outcome.phase,
    message,
  };
  const runner = input?.runner ?? options['--runner'];
  const model = input?.model ?? options['--model'];
  if (runner === 'codex' || runner === 'opencode' || runner === 'agy') result.runner = runner;
  if (model) result.model = model;
  if (input?.effort) result.effort = input.effort;
  if (runner === 'agy') result.sandbox = 'requested';
  if (input?.gates) result.gates = input.gates;
  if (input?.admission) {
    result.admission = input.admission.slot !== undefined
      ? { pool: input.admission.pool, cap: input.admission.cap, slot: input.admission.slot }
      : { pool: input.admission.pool, cap: input.admission.cap };
  }
  if (outcome.argv) result.argv = outcome.argv;
  if (outcome.cwd) result.cwd = outcome.cwd;
  const paths = Object.fromEntries(Object.entries(evidence).filter(([, value]) => value && fs.existsSync(value)));
  if (Object.keys(paths).length) result.evidence = paths;
  if (options['--json']) process.stdout.write(`${JSON.stringify(result)}\n`);
  else if (outcome.exitCode === 0) process.stdout.write(`${message}\n`);
  else process.stderr.write(`dispatch: ${message}\n`);
  process.exitCode = outcome.exitCode;
}

function childTimeout(timeout) {
  // Keep fixture timeout cases bounded while production retains its fixed limits.
  const testTimeout = Number(process.env.DISPATCH_TEST_TIMEOUT_MS);
  return process.env.NODE_ENV === 'test' && Number.isSafeInteger(testTimeout) && testTimeout > 0
    ? Math.min(timeout, testTimeout)
    : timeout;
}

function runChild(command, args, worktree, scratch, logPath, timeout, appendLog = false, reservation = null) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timedOut = false;
    let childError;
    const stdoutChunks = [];
    const stderrChunks = [];
    let stdoutBytes = 0;
    let stderrBytes = 0;
    const maxBuffer = 16 * 1024 * 1024;

    const child = spawn(command, args, {
      cwd: worktree,
      env: { ...process.env, TMPDIR: scratch },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    if (reservation && Number.isSafeInteger(child.pid) && child.pid > 0) {
      updateReservationChild(reservation, child.pid);
    }

    const limit = childTimeout(timeout);
    let killTimer = null;
    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill('SIGTERM'); } catch {}
      killTimer = setTimeout(() => {
        try { child.kill('SIGKILL'); } catch {}
      }, 100);
      killTimer.unref();
    }, limit);
    timer.unref();

    function finish(status, signal) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (reservation) updateReservationChild(reservation, null);
      try {
        const stdout = Buffer.concat(stdoutChunks).toString('utf8');
        const stderr = Buffer.concat(stderrChunks).toString('utf8');
        const log = `${stdout}${stderr ? `${stdout ? '\n' : ''}[stderr]\n${stderr}` : ''}`;
        if (appendLog) fs.appendFileSync(logPath, log);
        else fs.writeFileSync(logPath, log);
        const error = timedOut
          ? Object.assign(new Error(`spawn ${command} ETIMEDOUT`), { code: 'ETIMEDOUT' })
          : childError;
        resolve({ status: timedOut ? null : status, signal, error, stdout, stderr });
      } catch (cause) {
        reject(cause);
      }
    }

    child.stdout?.on('data', chunk => {
      if (stdoutBytes < maxBuffer) {
        stdoutChunks.push(chunk);
        stdoutBytes += chunk.length;
      }
    });
    child.stderr?.on('data', chunk => {
      if (stderrBytes < maxBuffer) {
        stderrChunks.push(chunk);
        stderrBytes += chunk.length;
      }
    });
    child.on('error', err => {
      childError = err;
      finish(null, null);
    });
    child.on('close', (status, signal) => {
      finish(status, signal);
    });
  });
}

function runnerArgs(input, prompt, outputPath, timeoutMs = EXECUTION_TIMEOUT_MS) {
  if (input.runner === 'codex') {
    return ['exec', '-m', input.model, ...(input.effort ? ['-c', `model_reasoning_effort="${input.effort}"`] : []), '-s', 'workspace-write', '-C', input.worktree, '-o', outputPath, prompt];
  }
  if (input.runner === 'agy') {
    return ['-p', prompt, '--model', input.model, '--mode', 'accept-edits', '--sandbox', '--settings', AGY_SETTINGS, '--print-timeout', `${Math.ceil(timeoutMs / 1000)}s`];
  }
  return ['run', '--auto', '-m', input.model, prompt];
}

const READINESS_DIAGNOSTICS = {
  codex: [
    { line: 'ERROR: Provider request failed with HTTP 429: {"status":429,"title":"Too Many Requests"}', code: 'RUNNER_RATE_LIMITED', message: 'Reduce concurrency on the affected key or retry later.' },
    { line: 'ERROR: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go', code: 'RUNNER_QUOTA', message: 'Select an authorized runner or model with available quota.' },
  ],
  opencode: [
    { line: 'Error: Provider request failed with HTTP 429: {"status":429,"title":"Too Many Requests"}', code: 'RUNNER_RATE_LIMITED', message: 'Reduce concurrency on the affected key or retry later.' },
    { line: 'Error: Free usage limit reached. Free models work in OpenCode (https://opencode.ai); subscribe to OpenCode Go to keep going: https://opencode.ai/go', code: 'RUNNER_QUOTA', message: 'Select an authorized runner or model with available quota.' },
  ],
};

// A Harness host appends one hidden turn-label line to every final message (docs/routing.md).
function withoutHostLabel(text) {
  const lines = text.split(/\r?\n/);
  const last = lines[lines.length - 1];
  const match = /^<!-- harness-label (\{.*\}) -->$/.exec(last);
  if (!match || lines.length < 2) return text;
  try {
    const value = JSON.parse(match[1]);
    if (!value || typeof value !== 'object' || Array.isArray(value)) return text;
  } catch {
    return text;
  }
  return lines.slice(0, -1).join('\n').trim();
}

function stripAnsi(text) {
  return text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
}

function agyQuotaDiagnostic(result) {
  if (result.status !== 3 || result.signal || result.error) return null;
  const lines = stripAnsi(result.stderr).split(/\r?\n/);
  return lines.some(line => AGY_QUOTA_LINE.test(line))
    ? { code: 'RUNNER_QUOTA', message: 'Select an authorized runner or model with available quota.' }
    : null;
}

function readinessDiagnostic(runner, result) {
  if (runner === 'agy') return agyQuotaDiagnostic(result);
  const output = stripAnsi(result.stderr);
  const lines = output.split(/\r?\n/);
  const matches = READINESS_DIAGNOSTICS[runner].filter(diagnostic => lines.includes(diagnostic.line));
  return matches.length === 1 ? matches[0] : null;
}

async function readiness(input, paths, reservation = null) {
  const outputPath = input.runner === 'codex' ? paths.readinessOutput : null;
  const prompt = 'Reply with the single word READY';
  const result = await runChild(input.runner, runnerArgs(input, prompt, outputPath, READINESS_TIMEOUT_MS), input.worktree, input.scratch, paths.readinessLog, READINESS_TIMEOUT_MS, false, reservation);
  if (result.status !== 0) {
    const diagnostic = Number.isInteger(result.status) && result.status !== 0 && !result.signal && !result.error
      ? readinessDiagnostic(input.runner, result)
      : null;
    if (diagnostic) fail(13, diagnostic.code, 'readiness', diagnostic.message);
    fail(12, 'NOT_READY', 'readiness', 'Readiness failed. Keep the available child evidence.');
  }
  const answer = input.runner === 'codex'
    ? (fs.existsSync(outputPath) ? fs.readFileSync(outputPath, 'utf8').trim() : '')
    : result.stdout.trim();
  const reply = withoutHostLabel(answer);
  if (reply !== 'READY' && reply !== 'READY.') fail(12, 'NOT_READY', 'readiness', 'Readiness failed. Keep the available child evidence.');
}

function reportedStatus(raw) {
  const lines = raw.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  if (lines.at(-1)?.startsWith('<!-- harness-label ')) {
    lines.pop();
    while (lines.length && lines.at(-1).trim() === '') lines.pop(); // live codex -o: blank line before the label
  }
  const line = (lines.at(-1) || '').replace(/[ \t]+$/, '');
  if (line === 'STATUS: DONE') return { status: 'DONE' };
  const blocked = /^STATUS: BLOCKED: (.+)$/.exec(line);
  if (blocked && blocked[1] === blocked[1].trim() && blocked[1]) return { status: 'BLOCKED', reason: blocked[1] };
  fail(16, 'REPORT_INVALID', 'report', 'Codex output must end with STATUS: DONE or STATUS: BLOCKED: <reason>');
}

async function reportWriter(input, paths, command, args) {
  const result = await runChild(process.execPath, [REPORT_WRITER, ...args], input.worktree, input.scratch, paths.writerLog, 120000, true);
  if (result.status !== 0) fail(16, 'REPORT_INVALID', 'report', result.stderr.trim() || `${command} rejected the report`);
  return result;
}

function executionPrompt(input) {
  if (input.runner === 'codex') {
    return `Execute the packet at ${input.packet} and return the complete report body.`;
  }
  if (input.runner === 'agy') {
    return `Execute the packet at ${input.packetRelative} and write the complete report to ${input.reportRelative}. Use only paths relative to the current directory.`;
  }
  return `Execute the packet at ${input.packet} and write the complete report to ${input.report}.`;
}

// #466 D-scratch. In managed mode --scratch is the canonical external ROOT; every attempt gets its own
// unique directory below it (the child TMPDIR). The root was validated outside every repository, and the
// created directory is re-checked after realpath so a swapped symlink cannot redirect it into one.
function createAttemptDir(input) {
  fs.mkdirSync(input.scratch, { recursive: true });
  const attempt = fs.mkdtempSync(path.join(input.scratch, 'attempt-'));
  const resolved = realPath(attempt);
  const repository = resolved && gitAncestor(resolved);
  if (!resolved || repository) {
    try { fs.rmSync(attempt, { recursive: true, force: true }); } catch {}
    fail(11, 'UNSAFE_SCRATCH', 'validation', `attempt directory resolves inside a Git repository or worktree: ${repository || attempt}`);
  }
  return attempt;
}

// A checked DONE copies its evidence to <root>/retained/<attempt>/ (outside the disposable run dir), verifies
// every copy, and only then removes its own attempt dir. Any failure keeps the run dir and its evidence.
function retainAndClean(input, attempt, paths) {
  const retained = path.join(input.scratchRoot, 'retained', path.basename(attempt));
  try {
    fs.mkdirSync(retained, { recursive: true });
    const moved = {};
    for (const [key, source] of Object.entries(evidencePaths)) {
      if (!source || source === input.report || !fs.existsSync(source)) continue;
      const target = path.join(retained, path.basename(source));
      fs.copyFileSync(source, target);
      if (fs.statSync(target).size !== fs.statSync(source).size) throw new Error(`copy of ${path.basename(source)} is incomplete`);
      moved[key] = target;
    }
    fs.rmSync(attempt, { recursive: true, force: true });
    evidencePaths = { ...evidencePaths, ...moved };
  } catch (cause) {
    fail(20, 'EVIDENCE_RETENTION_FAILED', 'retention', `evidence retention failed; the attempt directory and its evidence were kept: ${cause.message}`);
  }
}

async function execute(input, options) {
  const managed = input.gates !== undefined;
  let reservation = null;
  if (managed) {
    reservation = acquireAdmissionSlot(input.admission);
    input = { ...input, admission: { ...input.admission, slot: reservation.slot } };
  }
  let attempt = null;
  try {
    if (managed) {
      attempt = createAttemptDir(input);
      input = { ...input, scratchRoot: input.scratch, scratch: attempt };
    } else fs.mkdirSync(input.scratch, { recursive: true });
    const runId = `${process.pid}-${Date.now()}`;
    const paths = {
      readinessOutput: path.join(input.scratch, `${runId}.readiness.txt`),
      readinessLog: path.join(input.scratch, `${runId}.readiness.log`),
      rawOutput: path.join(input.scratch, `${runId}.raw.txt`),
      runLog: path.join(input.scratch, `${runId}.run.log`),
      writerLog: path.join(input.scratch, `${runId}.report-writer.log`),
    };
    evidencePaths = {
      readinessOutput: input.runner === 'codex' ? paths.readinessOutput : null,
      readinessLog: paths.readinessLog,
      rawOutput: input.runner === 'codex' ? paths.rawOutput : null,
      runLog: paths.runLog,
      reportWriterLog: paths.writerLog,
      report: input.report,
    };

    await readiness(input, paths, reservation);
    if (existsOrSymlink(input.report)) fail(16, 'REPORT_INVALID', 'report', 'report path was populated before execution; refusing stale delivery');
    const prompt = executionPrompt(input);
    const outputPath = input.runner === 'codex' ? paths.rawOutput : null;
    const run = await runChild(input.runner, runnerArgs(input, prompt, outputPath, EXECUTION_TIMEOUT_MS), input.worktree, input.scratch, paths.runLog, EXECUTION_TIMEOUT_MS, false, reservation);
    if (run.status !== 0) {
      if (input.runner === 'agy' && !existsOrSymlink(input.report)) {
        const diagnostic = agyQuotaDiagnostic(run);
        if (diagnostic) fail(13, diagnostic.code, 'execution', diagnostic.message);
      }
      const timedOut = run.error?.code === 'ETIMEDOUT';
      fail(15, timedOut ? 'RUN_TIMEOUT' : 'RUN_FAILED', 'execution', timedOut ? 'runner execution timed out' : `runner execution failed${run.error ? `: ${run.error.message}` : ''}`);
    }

    if (input.runner === 'codex') {
      if (!fs.existsSync(paths.rawOutput) || existsOrSymlink(input.report)) fail(16, 'REPORT_INVALID', 'report', 'fresh Codex output or report path is missing');
      const status = reportedStatus(fs.readFileSync(paths.rawOutput, 'utf8'));
      const writeArgs = ['write', '--from-codex-output', paths.rawOutput, '--output', input.report, '--status', status.status];
      if (status.reason) writeArgs.push('--reason', status.reason);
      await reportWriter(input, paths, 'write', writeArgs);
    } else if (!existsOrSymlink(input.report) || !fs.lstatSync(input.report).isFile()) {
      fail(16, 'REPORT_INVALID', 'report', 'runner did not create a fresh report');
    }

    const checked = await reportWriter(input, paths, 'check', ['check', '--file', input.report]);
    if (/valid \(STATUS: BLOCKED: (.+)\)/.test(checked.stdout)) {
      const reason = /valid \(STATUS: BLOCKED: (.+)\)/.exec(checked.stdout)[1];
      fail(17, 'WORKER_BLOCKED', 'report', `worker delivered a valid BLOCKED report: ${reason}`);
    }
    if (managed) retainAndClean(input, attempt, paths);
  } finally {
    releaseAdmissionSlot(reservation);
  }
  response(options, {
    exitCode: 0,
    code: 'DONE',
    phase: 'report',
    message: `Dispatch completed and the report is valid: ${input.report}`,
  }, evidencePaths, input);
}

async function main() {
  const argv = process.argv.slice(2);
  const jsonRequested = argv.includes('--json');
  let options = { '--json': jsonRequested };
  let input;
  evidencePaths = {};
  try {
    if (argv.includes('--help')) {
      if (argv.some(arg => !['--help', '--json'].includes(arg))) fail(10, 'INVALID_INPUT', 'input', 'help cannot be combined with dispatch options');
      options = { '--json': jsonRequested };
      response(options, { exitCode: 0, code: 'HELP', phase: 'help', message: USAGE });
      return;
    }
    options = parseArgs(argv);
    input = validateInput(options);
    if (options['--dry-run']) {
      const outputPath = input.runner === 'codex' ? path.join(input.scratch, '<run-id>.raw.txt') : null;
      response(options, {
        exitCode: 0,
        code: 'DRY_RUN_OK',
        phase: 'dry-run',
        message: `Validated ${input.runner} model ${input.model} for packet ${input.packet} in ${input.worktree}; scratch ${input.scratch}; report ${input.report}`,
        argv: [input.runner, ...runnerArgs(input, executionPrompt(input), outputPath)],
        cwd: input.worktree,
      }, evidencePaths, input);
      return;
    }
    await execute(input, options);
  } catch (cause) {
    if (cause instanceof DispatchFailure) {
      response(options, cause, evidencePaths, input);
      return;
    }
    response(options, new DispatchFailure(1, 'INTERNAL_ERROR', 'application', cause.message || 'unexpected dispatch error'), evidencePaths, input);
  }
}

main();
