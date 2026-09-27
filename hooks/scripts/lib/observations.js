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
  if (!Array.isArray(raw.intents) || raw.intents.length > 3 || new Set(raw.intents).size !== raw.intents.length
      || !raw.intents.every(i => INTENTS.includes(i))) return false;
  if (!(raw.workflow === null || STRATEGIES.includes(raw.workflow))) return false;
  if (!Array.isArray(raw.skills) || raw.skills.length > 12
      || !raw.skills.every(s => typeof s === 'string' && /^[A-Za-z0-9:_.-]{1,80}$/.test(s))) return false;
  return true;
}

function parseLabelLine(text) {
  const matches = [...String(text || '').matchAll(LABEL_RE)];
  if (!matches.length) return { label: null, reason: 'label-missing' };
  let raw;
  try { raw = JSON.parse(matches[matches.length - 1][1]); } catch (_) { return { label: null, reason: 'label-unparseable' }; }
  if (!validLabel(raw)) return { label: null, reason: 'label-invalid' };
  return {
    label: { v: 1, validity: raw.validity, contextDependent: raw.contextDependent, tier: raw.tier,
      intents: raw.intents.slice(), workflow: raw.workflow, skills: raw.skills.map(skillName) },
    reason: null,
  };
}

function skillName(value) {
  const name = String(value || '').trim();
  return name.includes(':') ? name.slice(name.lastIndexOf(':') + 1) : name;
}

const COMMAND_CLASSES = [
  ['git', /^git$/],
  ['gh', /^gh$/],
  ['test', /^(pytest|jest|vitest|mocha|tox|phpunit|rspec)$/],
];

function classifySegment(tokens) {
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

function breadthTier(behavior) {
  const files = Number(behavior && behavior.filesWritten) || 0;
  const repos = Number(behavior && behavior.reposWritten) || 0;
  if (files === 0) return 'tier1';
  if (repos >= 2 || files > 5) return 'tier3';
  return 'tier2';
}

function deriveTier(breadth, self) {
  if (self && TIERS.includes(self) && TIERS.indexOf(self) > TIERS.indexOf(breadth)) return { tier: self, source: 'self-report' };
  return { tier: breadth, source: 'behavior' };
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
    skills: [], subagents: 0, toolCalls: 0, toolFailures: 0, _files: [], _repos: [] };
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
  if (created) behavior.filesCreated++;
  behavior.filesWritten = behavior._files.length;
  behavior.reposWritten = behavior._repos.length;
}

function recordTool(behavior, payload, failed) {
  const tool = String(payload.tool_name || payload.toolName || '');
  const input = payload.tool_input || payload.toolInput || {};
  const cwd = payload.cwd;
  const cache = {};
  behavior.toolCalls++;
  if (failed) behavior.toolFailures++;
  if (WRITE_TOOLS.has(tool)) {
    const created = tool === 'Write' && payload.tool_response && payload.tool_response.type === 'create';
    noteFile(behavior, input.file_path || input.notebook_path || input.path, created && !failed, cwd, cache);
  } else if (tool === 'apply_patch' || tool === 'ApplyPatch') {
    const text = typeof input === 'string' ? input : (input.command || input.input || input.patch || '');
    for (const { op, file } of patchFiles(Array.isArray(text) ? text.join('\n') : text)) noteFile(behavior, file, op === 'Add', cwd, cache);
  } else if (SHELL_TOOLS.has(tool)) {
    const command = typeof input === 'string' ? input : (input.command || input.cmd || '');
    const patched = patchFiles(Array.isArray(command) ? command.join('\n') : command);
    if (patched.length) for (const { op, file } of patched) noteFile(behavior, file, op === 'Add', cwd, cache);
    else behavior.commands[classifyCommand(command)]++;
  } else if (tool === 'Skill') {
    const name = skillName(input.skill || input.name || input.command);
    if (name && !behavior.skills.includes(name)) behavior.skills.push(name);
  } else if (tool === 'Read') {
    const file = String(input.file_path || '');
    if (/[\\/]SKILL\.md$/.test(file)) {
      const name = path.basename(path.dirname(file));
      if (!behavior.skills.includes(name)) behavior.skills.push(name);
    }
  } else if (tool === 'Task' || tool === 'Agent') {
    behavior.subagents++;
  }
}

function transcriptMessage(file) {
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
    if (row.type === 'event_msg' && payload.type === 'task_complete' && typeof payload.last_agent_message === 'string') {
      return { text: payload.last_agent_message, codex: true };
    }
    if (!fallback && row.type === 'response_item' && payload.type === 'message' && payload.role === 'assistant') {
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
  const deadline = Date.now() + 400;
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

function appendRecord(root, record, text) {
  const textDir = path.join(root, 'text');
  fs.mkdirSync(textDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(textDir, `${record.contentSha256}.json`), JSON.stringify(text), { mode: 0o600 });
  return withLock(root, () => {
    const file = path.join(root, 'observations-index.json');
    const index = readJson(file, null) || { schemaVersion: 1, kind: 'system-one-observations', records: [] };
    const now = Date.now();
    for (const r of index.records) {
      if (!r.textDeleted && r.validUntil && Date.parse(r.validUntil) <= now) {
        try { fs.unlinkSync(path.join(textDir, `${r.contentSha256}.json`)); } catch (_) { /* already gone */ }
        r.textDeleted = true;
        r.status = 'expired';
      }
    }
    index.records.push(record);
    writeJsonAtomic(file, index);
  });
}

function startTurn(payload, root) {
  const file = sessionFile(root, payload.session_id);
  const session = readJson(file, null) || { turn: 0, lastFinal: '', pending: null };
  if (session.pending) finishPending(session, payload, root, { text: null, reason: 'stop-missing' });
  session.turn++;
  session.pending = {
    turn: session.turn,
    startedAt: new Date().toISOString(),
    prompt: redact(typeof payload.prompt === 'string' ? payload.prompt : ''),
    previous: session.lastFinal || '',
    cwd: payload.cwd ? sha(payload.cwd, 16) : null,
    behavior: emptyBehavior(),
  };
  writeJsonAtomic(file, session);
}

function toolTurn(payload, root, failed) {
  const file = sessionFile(root, payload.session_id);
  const session = readJson(file, null);
  if (!session || !session.pending) return;
  recordTool(session.pending.behavior, payload, failed);
  writeJsonAtomic(file, session);
}

function finishPending(session, payload, root, final) {
  const pending = session.pending;
  const { label, reason } = final.text === null && final.reason ? { label: null, reason: final.reason } : parseLabelLine(final.text);
  const behavior = { ...pending.behavior };
  delete behavior._files;
  delete behavior._repos;
  const text = { prompt: pending.prompt, previous: pending.previous };
  const contentSha256 = sha(JSON.stringify(text));
  const observedAt = new Date().toISOString();
  const record = {
    id: sha(`${payload.session_id || 'unknown'}:${pending.turn}:${pending.startedAt}`, 24),
    source: 'observation',
    status: 'active',
    observedAt,
    validUntil: new Date(Date.parse(observedAt) + RETENTION_MS).toISOString(),
    contentSha256,
    host: detectHost(payload, { codex: final.codex || pending.behavior._codex }),
    turn: pending.turn,
    writer: { sessionId: String(payload.session_id || 'unknown') },
    scope: { taskTerms: normalizeTerms(pending.prompt), requirementTerms: [], roles: [] },
    promptBytes: Buffer.byteLength(pending.prompt, 'utf8'),
    router: routerState(payload),
    behavior,
    selfReport: label,
    selfReportReason: reason,
  };
  appendRecord(root, record, text);
  session.lastFinal = final.text ? redact(tailBytes(final.text.replace(LABEL_RE, '').trim(), PREVIOUS_BYTES)) : '';
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
    const found = transcriptMessage(payload.transcript_path);
    message = found.text;
    codex = codex || found.codex;
  } else if (payload.transcript_path) {
    codex = codex || transcriptMessage(payload.transcript_path).codex;
  }
  if (session.pending.behavior && session.pending.behavior._codex) codex = true;
  finishPending(session, payload, root, { text: message, codex, reason: message === null ? 'final-message-unavailable' : null });
  writeJsonAtomic(file, session);
}

function handle(payload, env = process.env) {
  if (!enabled(env) || !payload || typeof payload !== 'object') return;
  const root = storeRoot(env);
  const event = String(payload.hook_event_name || payload.hookEventName || '');
  if (event === 'UserPromptSubmit') startTurn(payload, root);
  else if (event === 'PostToolUse' || event === 'PostToolUseFailure') {
    const tool = String(payload.tool_name || '');
    toolTurn(payload, root, event === 'PostToolUseFailure');
    if (tool === 'apply_patch') markCodex(payload, root);
  } else if (event === 'Stop') stopTurn(payload, root);
}

function markCodex(payload, root) {
  const file = sessionFile(root, payload.session_id);
  const session = readJson(file, null);
  if (!session || !session.pending) return;
  session.pending.behavior._codex = true;
  writeJsonAtomic(file, session);
}

module.exports = {
  INTENTS, TIERS, STRATEGIES, enabled, storeRoot, redact, parseLabelLine, classifyCommand, breadthTier, deriveTier,
  normalizeTerms, transcriptMessage, recordTool, emptyBehavior, handle, readJson,
};
