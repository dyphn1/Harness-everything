#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  getWorkspaceRoot,
  getSessionDir,
} = require('./lib/harness-state');

const RULES_PATH = process.env.HARNESS_ACTION_GATE_RULES_PATH || path.join(__dirname, 'action-gate-rules.json');
const ASK_CAPABLE_HOSTS = new Set(['claude']);
const VALID_SCOPES = new Set(['always', 'outside-scratch']);

// Fail-safe defaults are used only when the configured table is missing or
// invalid. A valid-but-empty table stays empty so CI can catch policy erasure.
const BUILTIN_RULES = [
  ['git-force-push', ['Bash', 'PowerShell'], '\\bgit\\s+push\\b[\\s\\S]*(?:--force(?:-with-lease)?|(?:^|\\s)-f(?:\\s|$))', 'i', 'Force-pushing can rewrite remote history.', 'always'],
  ['git-reset-hard', ['Bash', 'PowerShell'], '\\bgit\\s+reset\\s+--hard\\b', 'i', 'git reset --hard can discard local work.', 'always'],
  ['git-clean-force-delete', ['Bash', 'PowerShell'], '\\bgit\\s+clean\\b(?=[^\\r\\n]*\\s-(?:[^\\s]*f|f\\b))(?=[^\\r\\n]*\\s-(?:[^\\s]*d|d\\b))', 'i', 'git clean with force and directory deletion can remove untracked work.', 'always'],
  ['recursive-delete', ['Bash'], '(?:^|[;&|\\n]\\s*)rm\\s+(?=[^\\r\\n;&|]*-(?:[^\\s]*r|r\\b))(?=[^\\r\\n;&|]*-(?:[^\\s]*f|f\\b))', 'i', 'Recursive forced deletion outside approved scratch space is destructive.', 'outside-scratch'],
  ['powershell-recursive-force-delete', ['Bash', 'PowerShell'], '\\bRemove-Item\\b(?=[^\\r\\n;|]*-(?:Recurse|r)\\b)(?=[^\\r\\n;|]*-(?:Force|fo)\\b)', 'i', 'PowerShell recursive forced deletion outside approved scratch space is destructive.', 'outside-scratch'],
  ['sql-destructive-ddl', ['Bash', 'PowerShell'], '\\b(?:DROP\\s+(?:TABLE|DATABASE|SCHEMA)|TRUNCATE(?:\\s+TABLE)?)\\b', 'i', 'Destructive SQL DDL can irreversibly remove production data or schema state.', 'always'],
  ['package-publish', ['Bash', 'PowerShell'], '\\b(?:npm|pnpm|yarn|cargo|twine)\\s+publish\\b', 'i', 'Publishing creates an external package/release side effect.', 'always'],
  ['github-release-create', ['Bash', 'PowerShell'], '\\bgh\\s+release\\s+create\\b', 'i', 'Creating a GitHub release is an external irreversible publication action.', 'always'],
  ['production-deploy', ['Bash', 'PowerShell'], '\\b(?:kubectl\\s+apply|helm\\s+(?:upgrade|install)|terraform\\s+apply|vercel\\s+deploy|fly\\s+deploy|gcloud\\s+run\\s+deploy|(?:npm|pnpm|yarn)\\s+(?:run\\s+)?deploy|deploy\\s+to\\s+(?:prod|production|live))\\b', 'i', 'Deployment changes an external environment and requires explicit approval.', 'always'],
].map(([id, tools, pattern, flags, reason, scope]) => ({ id, tools, pattern, flags, reason, scope }));

function hashExact(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function toolNameOf(payload) {
  return String((payload && (payload.tool_name || payload.toolName)) || '');
}

function toolInputOf(payload) {
  return (payload && (payload.tool_input || payload.toolInput || payload.input)) || {};
}

function exactPayloadText(payload) {
  const input = toolInputOf(payload);
  const tool = toolNameOf(payload);
  if (tool === 'Bash' || tool === 'PowerShell') return String(input.command || '');
  if (tool === 'apply_patch') return String(input.patch || input.command || input.content || '');
  return JSON.stringify(input);
}

function validateRule(rule) {
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) throw new Error('rule must be an object');
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(String(rule.id || ''))) throw new Error('rule id is invalid');
  if (!Array.isArray(rule.tools) || rule.tools.length === 0 || rule.tools.some(tool => typeof tool !== 'string' || !tool)) throw new Error(`${rule.id}: tools must be a non-empty string array`);
  if (typeof rule.pattern !== 'string' || !rule.pattern) throw new Error(`${rule.id}: pattern is required`);
  if (typeof rule.reason !== 'string' || !rule.reason.trim()) throw new Error(`${rule.id}: reason is required`);
  if (!VALID_SCOPES.has(rule.scope || 'always')) throw new Error(`${rule.id}: invalid scope`);
  new RegExp(rule.pattern, rule.flags || '');
  return { ...rule, scope: rule.scope || 'always', flags: rule.flags || '' };
}

function validateRuleTable(table) {
  if (!table || typeof table !== 'object' || Array.isArray(table)) throw new Error('rule table must be an object');
  if (table.schemaVersion !== 1) throw new Error('unsupported action-gate rule schemaVersion');
  if (!Array.isArray(table.rules)) throw new Error('rules must be an array');
  const seen = new Set();
  const rules = table.rules.map(validateRule);
  for (const rule of rules) {
    if (seen.has(rule.id)) throw new Error(`duplicate rule id: ${rule.id}`);
    seen.add(rule.id);
  }
  return rules;
}

function loadRuleTable(filePath = RULES_PATH) {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return {
      rules: validateRuleTable(parsed),
      source: filePath,
      degraded: false,
      degradationReason: null,
    };
  } catch (err) {
    return {
      rules: BUILTIN_RULES.map(validateRule),
      source: 'builtin-fallback',
      degraded: true,
      degradationReason: `configured-rule-table-unavailable:${err.message}`,
    };
  }
}

function detectHost(payload, override) {
  if (override) return override;
  if (process.env.HARNESS_ACTION_GATE_HOST) return String(process.env.HARNESS_ACTION_GATE_HOST).toLowerCase();
  const declared = payload && (payload.host || payload.platform || (payload.harness && payload.harness.host));
  if (declared) return String(declared).toLowerCase();

  const env = process.env;
  if (env.CLAUDE_PROJECT_DIR || env.CLAUDECODE === '1' || env.CLAUDE_CODE_ENTRYPOINT || env.CLAUDE_CODE === 'true' || env.CLAUDE === '1') return 'claude';
  if (env.CODEX_HOME || env.CODEX === '1' || env.OPENAI_CODEX === '1' || env.PLUGIN_ROOT) return 'codex';

  try {
    const root = getWorkspaceRoot(payload);
    if (fs.existsSync(path.join(root, '.claude', 'settings.json'))) return 'claude';
    if (fs.existsSync(path.join(root, 'AGENTS.md'))) return 'codex';
  } catch (_) {
  }
  return 'unknown';
}

function hostSupportsAsk(host) {
  return ASK_CAPABLE_HOSTS.has(String(host || '').toLowerCase());
}

function shellWords(text) {
  const matches = String(text || '').match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s]+/g) || [];
  return matches.map(token => {
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) return token.slice(1, -1);
    return token;
  });
}

function deleteTargets(command, ruleId) {
  let tail = '';
  if (ruleId === 'recursive-delete') {
    const match = String(command).match(/(?:^|[;&|\n]\s*)rm\s+([^;&|\n]+)/i);
    tail = match ? match[1] : '';
  } else if (ruleId === 'powershell-recursive-force-delete') {
    const match = String(command).match(/\bRemove-Item\b([^;|\n]+)/i);
    tail = match ? match[1] : '';
  }
  if (!tail) return [];
  return shellWords(tail)
    .filter(token => token && !token.startsWith('-') && !/^(?:--|&&|\|\||[;&|])$/.test(token));
}

function pathApiFor(value) {
  return /^[A-Za-z]:[\\/]/.test(String(value || '')) ? path.win32 : path;
}

function absoluteTarget(target, cwd) {
  const text = String(target || '');
  if (!text) return null;
  const api = pathApiFor(text) === path.win32 || pathApiFor(cwd) === path.win32 ? path.win32 : path;
  return api.isAbsolute(text) ? api.normalize(text) : api.resolve(cwd || process.cwd(), text);
}

function isWithin(target, root) {
  if (!target || !root) return false;
  const api = pathApiFor(target) === path.win32 || pathApiFor(root) === path.win32 ? path.win32 : path;
  const resolvedTarget = api.resolve(target);
  const resolvedRoot = api.resolve(root);
  const relative = api.relative(resolvedRoot, resolvedTarget);
  if (!relative) return true;
  return relative !== '..' && !relative.startsWith(`..${api.sep}`) && !api.isAbsolute(relative);
}

function scratchRoots(payload, sessionDir) {
  const roots = [os.tmpdir(), path.join(sessionDir, 'scratch')];
  const declared = payload && (payload.scratchpad_path || payload.scratchpadPath || (payload.harness && payload.harness.scratchpadPath));
  if (declared) roots.push(declared);
  if (process.env.HARNESS_SCRATCH_DIR) roots.push(process.env.HARNESS_SCRATCH_DIR);
  return roots.filter(Boolean);
}

function outsideScratchMatchApplies(rule, command, payload, sessionDir) {
  const targets = deleteTargets(command, rule.id);
  if (targets.length === 0) return true;
  const cwd = (payload && payload.cwd) || process.cwd();
  const roots = scratchRoots(payload, sessionDir);
  return !targets.every(target => {
    const absolute = absoluteTarget(target, cwd);
    return roots.some(root => isWithin(absolute, root));
  });
}

function classify(payload, rules, sessionDir) {
  const tool = toolNameOf(payload);
  const exact = exactPayloadText(payload);
  if (!exact) return null;
  for (const rule of rules) {
    if (!rule.tools.includes(tool)) continue;
    const regex = new RegExp(rule.pattern, rule.flags || '');
    if (!regex.test(exact)) continue;
    if (rule.scope === 'outside-scratch' && !outsideScratchMatchApplies(rule, exact, payload, sessionDir)) continue;
    return rule;
  }
  return null;
}

function routerActionGateHint(payload) {
  const candidates = [
    payload && payload.actionGate,
    payload && payload.workflowPlan && payload.workflowPlan.actionGate,
    payload && payload.routerContract && payload.routerContract.workflowPlan && payload.routerContract.workflowPlan.actionGate,
    payload && payload.harness && payload.harness.workflowPlan && payload.harness.workflowPlan.actionGate,
  ];
  const gate = candidates.find(candidate => candidate && typeof candidate === 'object');
  if (!gate) return null;
  return {
    required: Boolean(gate.required),
    reasonCodes: Array.isArray(gate.reasonCodes) ? gate.reasonCodes.map(String) : [],
    disposition: gate.disposition || null,
  };
}

function sessionContext(payload, overrideSessionDir) {
  if (overrideSessionDir) return { root: path.dirname(path.dirname(overrideSessionDir)), sessionDir: overrideSessionDir };
  const root = getWorkspaceRoot(payload);
  const sessionId = payload && (payload.session_id || payload.sessionId);
  return { root, sessionDir: getSessionDir(root, sessionId, payload) };
}

function auditDirectory(payload, options = {}) {
  const context = sessionContext(payload, options.sessionDir);
  const dir = path.join(context.sessionDir, 'action-gate');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeRecordId(payload, commandHash) {
  const toolUseId = String((payload && (payload.tool_use_id || payload.toolUseId)) || '').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 160);
  return toolUseId || commandHash.slice(0, 32);
}

function atomicWriteJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

function writeAuditRecord(payload, record, options = {}) {
  const dir = auditDirectory(payload, options);
  const file = path.join(dir, `${safeRecordId(payload, record.commandHash)}.json`);
  atomicWriteJson(file, record);
  return file;
}

function readAuditRecord(payload, commandHash, options = {}) {
  const dir = auditDirectory(payload, options);
  const file = path.join(dir, `${safeRecordId(payload, commandHash)}.json`);
  if (!fs.existsSync(file)) return { file, record: null };
  try { return { file, record: JSON.parse(fs.readFileSync(file, 'utf8')) }; } catch (_) { return { file, record: null }; }
}

function decisionReason(rule, table) {
  const degradation = table.degraded ? ` Rule table degraded; built-in defaults active (${table.degradationReason}).` : '';
  return `[Harness actionGate:${rule.id}] ${rule.reason}${degradation}`;
}

function askOutput(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'ask',
      permissionDecisionReason: reason,
    },
  };
}

function recordDecision(payload, rule, table, host, disposition, options = {}, extra = {}) {
  const exact = exactPayloadText(payload);
  const commandHash = hashExact(exact);
  const now = new Date().toISOString();
  const record = {
    schemaVersion: 1,
    toolName: toolNameOf(payload),
    toolUseId: (payload && (payload.tool_use_id || payload.toolUseId)) || null,
    commandHash,
    matchedRule: rule.id,
    ruleReason: rule.reason,
    disposition,
    host,
    permissionMode: (payload && (payload.permission_mode || payload.permissionMode)) || null,
    routerActionGate: routerActionGateHint(payload),
    ruleTableSource: table.source,
    degradedRuleTable: table.degraded,
    degradationReason: table.degradationReason,
    createdAt: now,
    updatedAt: now,
    ...extra,
  };
  try { writeAuditRecord(payload, record, options); } catch (_) { }
  return record;
}

function evaluatePreToolUse(payload, options = {}) {
  const context = sessionContext(payload, options.sessionDir);
  const table = options.ruleTable || loadRuleTable(options.rulePath || RULES_PATH);
  const rule = classify(payload, table.rules, context.sessionDir);
  if (!rule) {
    return {
      kind: 'allow',
      exitCode: 0,
      stdout: null,
      stderr: table.degraded ? `[Harness actionGate] ${table.degradationReason}; built-in defaults active.` : null,
      rule: null,
      table,
    };
  }

  const host = detectHost(payload, options.host);
  const reason = decisionReason(rule, table);
  if (hostSupportsAsk(host)) {
    const record = recordDecision(payload, rule, table, host, 'pending-approval', { ...options, sessionDir: context.sessionDir });
    return { kind: 'ask', exitCode: 0, stdout: askOutput(reason), stderr: null, rule, table, record };
  }

  const record = recordDecision(payload, rule, table, host, 'rejected', { ...options, sessionDir: context.sessionDir }, {
    rejectionReason: 'host-ask-decision-unverified-or-unsupported',
  });
  return {
    kind: 'block',
    exitCode: 2,
    stdout: null,
    stderr: `${reason} Host '${host}' has no Harness-verified ask-style decision path, so the action is blocked.`,
    rule,
    table,
    record,
  };
}

function finalizeExecution(payload, outcome, options = {}) {
  const exact = exactPayloadText(payload);
  const commandHash = hashExact(exact);
  const found = readAuditRecord(payload, commandHash, options);
  if (!found.record) return { kind: 'noop', exitCode: 0 };

  const record = found.record;
  if (record.commandHash !== commandHash) {
    record.disposition = 'integrity-violation';
    record.integrityViolation = 'executed-payload-hash-differs-from-approved-payload';
  } else {
    record.disposition = 'executed';
    record.executionOutcome = outcome;
  }
  record.updatedAt = new Date().toISOString();
  if (outcome === 'failure') record.executionFailure = true;
  atomicWriteJson(found.file, record);
  return { kind: 'audit', exitCode: 0, record };
}

function rejectPendingAtStop(payload, options = {}) {
  let dir;
  try { dir = auditDirectory(payload, options); } catch (_) { return { kind: 'noop', exitCode: 0, rejected: 0 }; }
  let rejected = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const file = path.join(dir, entry.name);
    let record;
    try { record = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { continue; }
    if (record.disposition !== 'pending-approval') continue;
    record.disposition = 'rejected';
    record.rejectionReason = 'approval-not-executed-before-stop';
    record.updatedAt = new Date().toISOString();
    atomicWriteJson(file, record);
    rejected++;
  }
  return { kind: 'audit', exitCode: 0, rejected };
}

function internalErrorDecision(payload, err, options = {}) {
  let host = 'unknown';
  try { host = detectHost(payload, options.host); } catch (_) { host = 'unknown'; }
  const exact = exactPayloadText(payload);
  const pseudoRule = { id: 'internal-error', reason: `Action-gate internal error: ${err.message}` };
  const table = { source: 'internal-error', degraded: true, degradationReason: err.message };
  try {
    recordDecision(payload, pseudoRule, table, host, hostSupportsAsk(host) ? 'pending-approval' : 'rejected', options, {
      internalError: true,
      rejectionReason: hostSupportsAsk(host) ? null : 'internal-error-on-host-without-verified-ask',
      commandHash: hashExact(exact),
    });
  } catch (_) { }
  const reason = `[Harness actionGate:internal-error] ${err.message}. Fail-closed policy requires explicit approval.`;
  if (hostSupportsAsk(host)) return { kind: 'ask', exitCode: 0, stdout: askOutput(reason), stderr: null };
  return { kind: 'block', exitCode: 2, stdout: null, stderr: `${reason} Host '${host}' cannot be trusted to surface ask; blocking instead.` };
}

function processEvent(payload, options = {}) {
  const event = String((payload && (payload.hook_event_name || payload.hookEventName)) || 'PreToolUse');
  if (event === 'PreToolUse') return evaluatePreToolUse(payload, options);
  if (event === 'PostToolUse') return finalizeExecution(payload, 'success', options);
  if (event === 'PostToolUseFailure') return finalizeExecution(payload, 'failure', options);
  if (event === 'Stop') return rejectPendingAtStop(payload, options);
  return { kind: 'noop', exitCode: 0 };
}

function emitResult(result) {
  if (result.stderr) console.error(result.stderr);
  if (result.stdout) process.stdout.write(`${JSON.stringify(result.stdout)}\n`);
  return result.exitCode || 0;
}

function runPayload(payload) {
  try {
    return emitResult(processEvent(payload));
  } catch (err) {
    return emitResult(internalErrorDecision(payload, err));
  }
}

function readStdinAndRun() {
  if (process.stdin.isTTY) return runPayload(null);
  let raw = '';
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    let payload = {};
    try { payload = JSON.parse(raw || '{}'); } catch (err) {
      return emitResult(internalErrorDecision({}, new Error(`invalid hook JSON: ${err.message}`)));
    }
    return runPayload(payload);
  };
  const timer = setTimeout(finish, 500);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { raw += chunk; });
  process.stdin.on('end', () => { clearTimeout(timer); process.exitCode = finish(); });
  process.stdin.on('error', err => { clearTimeout(timer); process.exitCode = emitResult(internalErrorDecision({}, err)); });
  return 0;
}

if (require.main === module) {
  process.exitCode = readStdinAndRun();
}

module.exports = {
  BUILTIN_RULES,
  RULES_PATH,
  absoluteTarget,
  classify,
  deleteTargets,
  detectHost,
  evaluatePreToolUse,
  exactPayloadText,
  finalizeExecution,
  hashExact,
  hostSupportsAsk,
  internalErrorDecision,
  isWithin,
  loadRuleTable,
  processEvent,
  rejectPendingAtStop,
  routerActionGateHint,
  scratchRoots,
  validateRuleTable,
};
