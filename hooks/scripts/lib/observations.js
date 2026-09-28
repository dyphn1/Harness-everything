'use strict';
// System One turn observations (docs/system-one-observations.md).
// Local-only, fail-open collection of one record per turn: the prompt and the
// previous assistant message (private text store), the router's proposal,
// behavior counters, and the agent's own harness-label line. Telemetry stays
// content-free; this is a separate channel that never leaves the machine.

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const INTENTS = ['explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor', 'review', 'test', 'docs', 'plan', 'investigate'];
const TIERS = ['tier1', 'tier2', 'tier3'];
const VALIDITY = ['actionable', 'invalid'];
const STRATEGIES = ['direct-single', 'iterative-single', 'fable-staged', 'fable-parallel', 'fable-multi-agent-workspace'];
const RETENTION_MS = 180 * 24 * 60 * 60 * 1000;
const PREVIOUS_BYTES = 2048;
const TRANSCRIPT_TAIL_BYTES = 512 * 1024;
const LABEL_RE = /<!--\s*harness-label\s+(\{[\s\S]*?\})\s*-->/g;
// A final label line whose closing --> was dropped (seen live on Codex).
const OPEN_LABEL_RE = /<!--\s*harness-label\s+(\{[^\n]*\})\s*$/;
const WRITE_TOOLS = new Set(['Edit', 'MultiEdit', 'Write', 'NotebookEdit']);
const SHELL_TOOLS = new Set(['Bash', 'PowerShell', 'shell', 'exec_command', 'local_shell', 'container.exec']);

function enabled(env = process.env) {
  const value = String(env.HARNESS_OBSERVATIONS || 'on').toLowerCase();
  return !['0', 'off', 'false', 'disabled', 'none'].includes(value);
}

function storeRoot(env = process.env) {
  return env.HARNESS_OBSERVATIONS_DIR || path.join(os.homedir(), '.agents', 'harness-everything', 'system-one', 'observations');
}

function sha(value, length = 64) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, length);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function redact(text) {
  let out = String(text || '');
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '<email>');
  const home = os.homedir();
  if (home && home.length > 1) out = out.replace(new RegExp(escapeRegExp(home), 'g'), '<home>');
  out = out.replace(/[A-Za-z]:\\+Users\\+[^\\\s"'<>|]+/gi, '<home>');
  out = out.replace(/\/(?:Users|home)\/[^/\s"'<>|]+/g, '<home>');
  return out;
}

function tailBytes(text, bytes) {
  const buffer = Buffer.from(String(text || ''), 'utf8');
  if (buffer.length <= bytes) return buffer.toString('utf8');
  return buffer.subarray(buffer.length - bytes).toString('utf8').replace(/^�+/, '');
}

function validLabel(raw) {
  if (!raw || typeof raw !== 'object' || raw.v !== 1) return false;
  if (!VALIDITY.includes(raw.validity) || typeof raw.contextDependent !== 'boolean') return false;
  if (!(raw.tier === null || TIERS.includes(raw.tier))) return false;
  if (!Array.isArray(raw.intents) || raw.intents.length > 6 || !raw.intents.every(i => typeof i === 'string')) return false;
  const known = raw.intents.filter(i => INTENTS.includes(i));
  if (known.length > 3 || new Set(known).size !== known.length) return false;
  if (!(raw.workflow === null || STRATEGIES.includes(raw.workflow))) return false;
  if (!Array.isArray(raw.skills) || raw.skills.length > 12
      || !raw.skills.every(s => typeof s === 'string' && /^[A-Za-z0-9:_.-]{1,80}$/.test(s))) return false;
  return true;
}

function parseLabelLine(text) {
  const body = String(text || '');
  const matches = [...body.matchAll(LABEL_RE)];
  const open = matches.length ? null : body.trimEnd().match(OPEN_LABEL_RE);
  if (!matches.length && !open) return { label: null, reason: 'label-missing' };
  let raw;
  try { raw = JSON.parse(open ? open[1] : matches[matches.length - 1][1]); } catch (_) { return { label: null, reason: 'label-unparseable' }; }
  if (!validLabel(raw)) return { label: null, reason: 'label-invalid' };
  // Unknown intent ids are dropped, not fatal: the rest of the label is still the agent's judgement.
  const unknownIntents = raw.intents.filter(i => !INTENTS.includes(i));
  const label = { v: 1, validity: raw.validity, contextDependent: raw.contextDependent, tier: raw.tier,
    intents: raw.intents.filter(i => INTENTS.includes(i)), workflow: raw.workflow, skills: raw.skills.map(skillName) };
  if (unknownIntents.length) label.unknownIntents = unknownIntents;
  return { label, reason: null };
}

function stripLabels(text) {
  return String(text || '').replace(LABEL_RE, '').trimEnd().replace(OPEN_LABEL_RE, '').trim();
}

function skillName(value) {
  const name = String(value || '').trim();
  return name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;
}

const COMMAND_CLASSES = [
  ['git', /^git$/],
  ['gh', /^gh$/],
  ['test', /^(pytest|py\.test|unittest|jest|vitest|mocha|tox|nox|phpunit|rspec)$/],
];

// Runner prefixes that execute another command: classify what they run.
function unwrapRunner(tokens) {
  const [cmd, sub] = tokens;
  if (/^python(3(\.\d+)?)?$/.test(cmd || '') && sub === '-m' && tokens[2]) return tokens.slice(2);
  if (/^(npx|bunx|uvx|pipx)$/.test(cmd || '')) {
    const rest = tokens.slice(1);
    while (rest.length && rest[0].startsWith('-')) rest.shift();
    if (rest.length) return rest;
  }
  if (/^(uv|poetry|pdm|hatch)$/.test(cmd || '') && sub === 'run' && tokens[2]) return tokens.slice(2);
  if (/^(pnpm|yarn|bun)$/.test(cmd || '') && (sub === 'exec' || sub === 'dlx' || sub === 'x') && tokens[2]) return tokens.slice(2);
  return tokens;
}

function classifySegment(tokens) {
  for (let i = 0; i < 3; i++) {
    const next = unwrapRunner(tokens);
    if (next === tokens) break;
    tokens = next;
  }
  const [cmd, sub, third] = tokens;
  if (!cmd) return null;
  for (const [name, re] of COMMAND_CLASSES) if (re.test(cmd)) return name;
  if (/^(npm|pnpm|yarn|bun)$/.test(cmd)) {
    if (sub === 'test' || sub === 't' || (sub === 'run' && /^test/.test(third || ''))) return 'test';
    if (sub === 'run' && /^(build|compile)/.test(third || '')) return 'build';
    if (/^(install|i|ci|add|remove|uninstall|update|upgrade)$/.test(sub || '')) return 'package';
    return 'shell';
  }
  if (/^(go|cargo|dotnet)$/.test(cmd)) {
    if (sub === 'test') return 'test';
    if (sub === 'build') return 'build';
    if (/^(add|get|install|restore)$/.test(sub || '')) return 'package';
  }
  if (/^(make|msbuild|msbuild\.exe|tsc|gradle|mvn|cmake|ninja)$/i.test(cmd)) return 'build';
  if (/^(pip|pip3|uv|poetry|brew|apt|apt-get|choco|winget|conda)$/.test(cmd)) return 'package';
  if (cmd === 'node' && /(^|\/)(ci|test|tests)\//.test(sub || '') && /test/.test(sub || '')) return 'test';
  return 'shell';
}

function classifyCommand(command) {
  const text = Array.isArray(command) ? command.join(' ') : String(command || '');
  const segments = text.split(/&&|\|\||;|\|/).map(s => s.trim()).filter(Boolean);
  let fallback = null;
  for (const segment of segments) {
    const tokens = segment.split(/\s+/).filter(t => !/^[A-Z_][A-Z0-9_]*=/.test(t));
    while (tokens[0] === 'sudo' || tokens[0] === 'env' || tokens[0] === 'time') tokens.shift();
    if (!tokens.length || tokens[0] === 'cd' || tokens[0] === 'pushd') continue;
    const kind = classifySegment(tokens);
    if (kind && kind !== 'shell') return kind;
    fallback = fallback || kind;
  }
  return fallback || 'shell';
}

// The tier label is the agent's own judgement; the owner's review overrides it.
// There is no file-count rule (docs/system-one-observations.md#labels-and-how-much-to-trust-them).
function labelTier(self, owner) {
  if (owner && TIERS.includes(owner.tier)) return { tier: owner.tier, source: 'owner' };
  if (self && TIERS.includes(self.tier)) return { tier: self.tier, source: 'self-report' };
  return { tier: null, source: null };
}

// Behavior is evidence, not a label: it only flags records that contradict themselves.
function contradictions(self, behavior) {
  const out = [];
  if (self && self.validity === 'actionable' && self.tier === 'tier1' && behavior && behavior.filesWritten > 0) {
    out.push('tier1-with-writes');
  }
  return out;
}

// Mirrors normalizeTerms in multi-agent-workspace/scripts/index_memory.js.
function normalizeTerms(value) {
  const stop = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'into', 'when', 'then', 'before', 'after', 'always', 'never', 'should', 'must', 'use', 'using', 'verify', 'check']);
  const matches = String(value || '').toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}._-]{1,}/gu) || [];
  return [...new Set(matches.filter(term => !stop.has(term) && !term.startsWith('<')))].slice(0, 64);
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return fallback; }
}

function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function sessionFile(root, sessionId) {
  return path.join(root, 'sessions', `${sha(sessionId || 'unknown', 32)}.json`);
}

function repoRoot(file, cache) {
  let dir = path.dirname(path.resolve(file));
  for (let i = 0; i < 40; i++) {
    if (cache[dir] !== undefined) return cache[dir];
    if (fs.existsSync(path.join(dir, '.git'))) { cache[dir] = dir; return dir; }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return path.dirname(path.resolve(file));
}

function emptyBehavior() {
  return { filesWritten: 0, reposWritten: 0, filesCreated: 0, commands: { git: 0, gh: 0, test: 0, build: 0, package: 0, shell: 0 },
    skills: [], subagents: 0, toolCalls: 0, toolFailures: 0, failedWrites: 0, failedSkillLoads: 0, _files: [], _repos: [], _created: [] };
}

// Adds one tool event's counters into a turn's behavior; sets are unioned.
function mergeBehavior(into, delta) {
  for (const key of ['toolCalls', 'toolFailures', 'failedWrites', 'failedSkillLoads', 'subagents']) into[key] += delta[key] || 0;
  for (const key of Object.keys(into.commands)) into.commands[key] += (delta.commands || {})[key] || 0;
  for (const key of ['_files', '_repos', '_created', 'skills']) {
    for (const value of delta[key] || []) if (!into[key].includes(value)) into[key].push(value);
  }
  if (delta._codex) into._codex = true;
  into.filesWritten = into._files.length;
  into.reposWritten = into._repos.length;
  into.filesCreated = into._created.length;
  return into;
}

// Claude Code reports failures as PostToolUseFailure; Codex reports them in the tool response.
function toolFailed(payload, event) {
  if (event === 'PostToolUseFailure' || payload.error) return true;
  const response = payload.tool_response ?? payload.toolResponse;
  if (typeof response === 'string') return /^\s*(error|failed|failure|apply_patch verification failed)\b/i.test(response);
  if (!response || typeof response !== 'object') return false;
  if (response.is_error === true || response.isError === true || response.success === false || response.ok === false) return true;
  const code = response.exitCode ?? response.exit_code;
  return typeof code === 'number' && code !== 0;
}

function patchFiles(text) {
  const out = [];
  for (const match of String(text || '').matchAll(/^\*\*\* (Add|Update|Delete) File: (.+)$/gm)) out.push({ op: match[1], file: match[2].trim() });
  return out;
}

function noteFile(behavior, file, created, cwd, cache) {
  if (!file) return;
  const absolute = path.isAbsolute(file) ? file : path.resolve(cwd || process.cwd(), file);
  const fileKey = sha(absolute, 16);
  const repoKey = sha(repoRoot(absolute, cache), 16);
  if (!behavior._files.includes(fileKey)) behavior._files.push(fileKey);
  if (!behavior._repos.includes(repoKey)) behavior._repos.push(repoKey);
  if (created && !behavior._created.includes(fileKey)) behavior._created.push(fileKey);
  behavior.filesWritten = behavior._files.length;
  behavior.reposWritten = behavior._repos.length;
  behavior.filesCreated = behavior._created.length;
}

function recordTool(behavior, payload, failed) {
  const tool = String(payload.tool_name || payload.toolName || '');
  const input = payload.tool_input || payload.toolInput || {};
  const cwd = payload.cwd;
  const cache = {};
  behavior.toolCalls++;
  if (failed) behavior.toolFailures++;
  // A failed attempt is counted, but it is never evidence of a write or a load.
  const write = (file, created) => { if (failed) behavior.failedWrites++; else noteFile(behavior, file, created, cwd, cache); };
  const skill = name => {
    if (!name) return;
    if (failed) behavior.failedSkillLoads++;
    else if (!behavior.skills.includes(name)) behavior.skills.push(name);
  };
  if (WRITE_TOOLS.has(tool)) {
    const created = tool === 'Write' && payload.tool_response && payload.tool_response.type === 'create';
    write(input.file_path || input.notebook_path || input.path, created);
  } else if (tool === 'apply_patch' || tool === 'ApplyPatch') {
    const text = typeof input === 'string' ? input : (input.command || input.input || input.patch || '');
    for (const { op, file } of patchFiles(Array.isArray(text) ? text.join('\n') : text)) write(file, op === 'Add');
  } else if (SHELL_TOOLS.has(tool)) {
    const command = typeof input === 'string' ? input : (input.command || input.cmd || '');
    const patched = patchFiles(Array.isArray(command) ? command.join('\n') : command);
    if (patched.length) for (const { op, file } of patched) write(file, op === 'Add');
    else behavior.commands[classifyCommand(command)]++;
  } else if (tool === 'Skill') {
    skill(skillName(input.skill || input.name || input.command));
  } else if (tool === 'Read') {
    const file = String(input.file_path || '');
    if (/[\\/]SKILL\.md$/.test(file)) skill(path.basename(path.dirname(file)));
  } else if (tool === 'Task' || tool === 'Agent') {
    behavior.subagents++;
  }
}

// A Claude user entry that starts a turn: a typed prompt, not a tool result or a meta note.
function claudePrompt(row) {
  if (row.type !== 'user' || row.isMeta || !row.message) return false;
  const content = row.message.content;
  if (typeof content === 'string') return true;
  return Array.isArray(content) && content.some(c => c && c.type === 'text') && !content.some(c => c && c.type === 'tool_result');
}

// The current turn's final message from a transcript tail. The reverse scan
// stops at the start of the current turn, so an earlier turn's answer (and its
// label) is never returned; a Codex task_complete must match turnId when both are known.
function transcriptMessage(file, turnId) {
  if (!file || !fs.existsSync(file)) return { text: null, codex: false };
  let text;
  try {
    const size = fs.statSync(file).size;
    const fd = fs.openSync(file, 'r');
    const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, size - length);
    fs.closeSync(fd);
    text = buffer.toString('utf8');
  } catch (_) { return { text: null, codex: false }; }
  const lines = text.split('\n').filter(Boolean).reverse();
  let codex = false;
  let fallback = null;
  for (const line of lines) {
    let row;
    try { row = JSON.parse(line); } catch (_) { continue; }
    if (row.type === 'event_msg' || row.type === 'response_item' || row.type === 'turn_context') codex = true;
    const payload = row.payload || {};
    const otherTurn = Boolean(turnId && payload.turn_id && payload.turn_id !== turnId);
    if (row.type === 'event_msg' && payload.type === 'task_complete') {
      if (otherTurn) break;
      if (typeof payload.last_agent_message === 'string') return { text: payload.last_agent_message, codex: true };
      continue;
    }
    if (row.type === 'event_msg' && (payload.type === 'task_started' || payload.type === 'user_message')) break;
    if (row.type === 'response_item' && payload.type === 'message' && payload.role === 'user') break;
    if (row.type === 'turn_context' && otherTurn) break;
    if (claudePrompt(row)) break;
    if (!fallback && row.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant'
        && payload.phase !== 'commentary') {
      fallback = (payload.content || []).map(c => c.text || '').join('\n').trim() || null;
    }
    if (!fallback && row.type === 'assistant' && row.message && Array.isArray(row.message.content)) {
      const parts = row.message.content.filter(c => c.type === 'text').map(c => c.text);
      if (parts.length) fallback = parts.join('\n');
    }
  }
  return { text: fallback, codex };
}

function detectHost(payload, hints) {
  const direct = String(payload.host || payload.runtime || '').toLowerCase();
  if (['claude', 'codex'].includes(direct)) return direct;
  if (hints.codex || payload.turn_id || payload.last_agent_message) return 'codex';
  if (process.env.CLAUDE_PLUGIN_ROOT || process.env.CLAUDECODE || process.env.CLAUDE_CODE_ENTRYPOINT || process.env.CLAUDE) return 'claude';
  if (process.env.CODEX_HOME || process.env.CODEX_THREAD_ID) return 'codex';
  return 'unknown';
}

function routerState(payload) {
  try {
    const state = require('./harness-state');
    const root = state.getWorkspaceRoot(payload);
    const dir = state.getSessionDir(root, state.getSessionId(payload), payload);
    const file = path.join(dir, 'workflow-run.json');
    if (!fs.existsSync(file)) return null;
    const run = readJson(file, null);
    if (!run) return null;
    const plan = run.workflowPlan && typeof run.workflowPlan === 'object' ? run.workflowPlan : run;
    return { tier: plan.tier || run.tier || null, strategy: plan.strategy || run.strategy || null,
      strategySelection: plan.strategySelection || run.strategySelection || null,
      suggestedSkills: Array.isArray(plan.suggestedSkills) ? plan.suggestedSkills.slice(0, 12) : [] };
  } catch (_) {
    return null;
  }
}

function withLock(root, fn) {
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  const lock = path.join(root, '.index.lock');
  const deadline = Date.now() + 2000;
  let fd = null;
  while (fd === null) {
    try { fd = fs.openSync(lock, 'wx'); } catch (_) {
      try { if (Date.now() - fs.statSync(lock).mtimeMs > 5000) fs.unlinkSync(lock); } catch (__) { /* raced */ }
      if (Date.now() > deadline) return false;
      const until = Date.now() + 10;
      while (Date.now() < until) { /* short spin; hooks are short-lived */ }
    }
  }
  try { fn(); return true; } finally { fs.closeSync(fd); try { fs.unlinkSync(lock); } catch (_) { /* gone */ } }
}

function expired(record, now = Date.now()) {
  return Boolean(record.textDeleted || (record.validUntil && Date.parse(record.validUntil) <= now));
}

// Text of a record that is still inside its retention window, else null.
function recordText(root, record, now = Date.now()) {
  if (expired(record, now)) return null;
  return readJson(path.join(root, 'text', `${record.contentSha256}.json`), null);
}

// Retention sweep; the caller holds the lock. Text blobs are content-addressed,
// so a blob is deleted only when no active record references it. Session files
// (previous-message tail, unfinished prompt) older than the window are deleted.
function sweepLocked(root, index, now) {
  const textDir = path.join(root, 'text');
  let changed = false;
  for (const r of index.records) {
    if (r.status !== 'expired' && expired(r, now)) { r.textDeleted = true; r.status = 'expired'; changed = true; }
  }
  const active = new Set(index.records.filter(r => !expired(r, now)).map(r => r.contentSha256));
  for (const r of index.records) {
    if (r.textDeleted && !active.has(r.contentSha256)) {
      try { fs.unlinkSync(path.join(textDir, `${r.contentSha256}.json`)); } catch (_) { /* already gone */ }
    }
  }
  const sessions = path.join(root, 'sessions');
  let entries = [];
  try { entries = fs.readdirSync(sessions); } catch (_) { /* none yet */ }
  for (const name of entries) {
    const file = path.join(sessions, name);
    try {
      if (now - fs.statSync(file).mtimeMs > RETENTION_MS) fs.rmSync(file, { recursive: true, force: true });
    } catch (_) { /* raced */ }
  }
  return changed;
}

function sweep(root, now = Date.now()) {
  const file = path.join(root, 'observations-index.json');
  if (!fs.existsSync(file)) return false;
  return withLock(root, () => {
    const index = readJson(file, null);
    if (index && Array.isArray(index.records) && sweepLocked(root, index, now)) writeJsonAtomic(file, index);
  });
}

function appendRecord(root, record, text) {
  return withLock(root, () => {
    // The blob is written under the lock, so a concurrent sweep cannot remove it before its record lands.
    const textDir = path.join(root, 'text');
    fs.mkdirSync(textDir, { recursive: true, mode: 0o700 });
    if (text) fs.writeFileSync(path.join(textDir, `${record.contentSha256}.json`), JSON.stringify(text), { mode: 0o600 });
    const file = path.join(root, 'observations-index.json');
    const index = readJson(file, null) || { schemaVersion: 1, kind: 'system-one-observations', records: [] };
    index.records.push(record);
    sweepLocked(root, index, Date.now());
    writeJsonAtomic(file, index);
  });
}

// Tool events are immutable files, one per event, so parallel hooks never
// overwrite each other; Stop adds them up.
function eventsDir(root, sessionId, turn) {
  return path.join(root, 'sessions', `${sha(sessionId || 'unknown', 32)}.events`, String(turn));
}

function writeEvent(root, sessionId, turn, delta) {
  const dir = eventsDir(root, sessionId, turn);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const name = `${process.pid}-${process.hrtime.bigint()}-${crypto.randomBytes(4).toString('hex')}`;
  const tmp = path.join(dir, `.${name}.tmp`);
  fs.writeFileSync(tmp, JSON.stringify(delta), { mode: 0o600 });
  fs.renameSync(tmp, path.join(dir, `${name}.json`));
}

function collectEvents(root, sessionId, turn) {
  const dir = eventsDir(root, sessionId, turn);
  const behavior = emptyBehavior();
  let names = [];
  try { names = fs.readdirSync(dir); } catch (_) { return behavior; }
  for (const name of names) {
    if (!name.endsWith('.json') || name.startsWith('.')) continue;
    const delta = readJson(path.join(dir, name), null);
    if (delta) mergeBehavior(behavior, delta);
  }
  return behavior;
}

function startTurn(payload, root) {
  const file = sessionFile(root, payload.session_id);
  const session = readJson(file, null) || { turn: 0, lastFinal: '', pending: null };
  if (session.pending) finishPending(session, payload, root, { text: null, reason: 'stop-missing' });
  if (!session.lastFinalAt || Date.now() - Date.parse(session.lastFinalAt) > RETENTION_MS) session.lastFinal = '';
  // Events left from an earlier turn arrived after its Stop; they belong to no record.
  fs.rmSync(path.dirname(eventsDir(root, payload.session_id, 0)), { recursive: true, force: true });
  session.turn++;
  session.pending = {
    turn: session.turn,
    startedAt: new Date().toISOString(),
    prompt: redact(typeof payload.prompt === 'string' ? payload.prompt : ''),
    previous: session.lastFinal || '',
    previousAt: session.lastFinal ? session.lastFinalAt : null,
    cwd: payload.cwd ? sha(payload.cwd, 16) : null,
  };
  writeJsonAtomic(file, session);
}

// Tool hooks only read the session file; they never rewrite it.
function toolTurn(payload, root, failed, codex) {
  const session = readJson(sessionFile(root, payload.session_id), null);
  if (!session || !session.pending) return;
  const delta = emptyBehavior();
  recordTool(delta, payload, failed);
  if (codex) delta._codex = true;
  writeEvent(root, payload.session_id, session.pending.turn, delta);
}

function finishPending(session, payload, root, final) {
  const pending = session.pending;
  const { label, reason } = final.text === null && final.reason ? { label: null, reason: final.reason } : parseLabelLine(final.text);
  const collected = collectEvents(root, payload.session_id, pending.turn);
  const behavior = { ...collected };
  delete behavior._files;
  delete behavior._repos;
  delete behavior._created;
  delete behavior._codex;
  const text = { prompt: pending.prompt, previous: pending.previous };
  const contentSha256 = sha(JSON.stringify(text));
  const now = Date.now();
  const observedAt = new Date(now).toISOString();
  // Retention counts from when the text was captured; finishing an old turn never renews it.
  const captured = [pending.startedAt, pending.previous ? (pending.previousAt || pending.startedAt) : null]
    .map(t => Date.parse(t)).filter(Number.isFinite);
  const validUntil = (captured.length ? Math.min(...captured) : now) + RETENTION_MS;
  const textExpired = validUntil <= now;
  const record = {
    id: sha(`${payload.session_id || 'unknown'}:${pending.turn}:${pending.startedAt}`, 24),
    source: 'observation',
    status: textExpired ? 'expired' : 'active',
    ...(textExpired ? { textDeleted: true } : {}),
    observedAt,
    validUntil: new Date(validUntil).toISOString(),
    contentSha256,
    host: detectHost(payload, { codex: final.codex || collected._codex }),
    turn: pending.turn,
    writer: { sessionId: String(payload.session_id || 'unknown') },
    scope: { taskTerms: normalizeTerms(pending.prompt), requirementTerms: [], roles: [] },
    promptBytes: Buffer.byteLength(pending.prompt, 'utf8'),
    router: routerState(payload),
    behavior,
    selfReport: label,
    selfReportReason: reason,
  };
  appendRecord(root, record, textExpired ? null : text);
  fs.rmSync(eventsDir(root, payload.session_id, pending.turn), { recursive: true, force: true });
  session.lastFinal = final.text ? redact(tailBytes(stripLabels(final.text), PREVIOUS_BYTES)) : '';
  session.lastFinalAt = observedAt;
  session.pending = null;
}

function stopTurn(payload, root) {
  const file = sessionFile(root, payload.session_id);
  const session = readJson(file, null);
  if (!session || !session.pending) return;
  let message = typeof payload.last_assistant_message === 'string' ? payload.last_assistant_message
    : (typeof payload.last_agent_message === 'string' ? payload.last_agent_message : null);
  let codex = Boolean(payload.last_agent_message);
  if (message === null) {
    const found = transcriptMessage(payload.transcript_path, payload.turn_id);
    message = found.text;
    codex = codex || found.codex;
  } else if (payload.transcript_path) {
    codex = codex || transcriptMessage(payload.transcript_path, payload.turn_id).codex;
  }
  finishPending(session, payload, root, { text: message, codex, reason: message === null ? 'final-message-unavailable' : null });
  writeJsonAtomic(file, session);
}

function handle(payload, env = process.env) {
  if (!enabled(env) || !payload || typeof payload !== 'object') return;
  const root = storeRoot(env);
  const event = String(payload.hook_event_name || payload.hookEventName || '');
  if (event === 'UserPromptSubmit') startTurn(payload, root);
  else if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
    toolTurn(payload, root, toolFailed(payload, event), String(payload.tool_name || '') === 'apply_patch');
  } else if (event === 'Stop') stopTurn(payload, root);
}

module.exports = {
  INTENTS, TIERS, STRATEGIES, enabled, storeRoot, redact, parseLabelLine, classifyCommand, labelTier, contradictions,
  normalizeTerms, transcriptMessage, recordTool, emptyBehavior, mergeBehavior, toolFailed, handle, readJson,
  expired, recordText, sweep,
};
