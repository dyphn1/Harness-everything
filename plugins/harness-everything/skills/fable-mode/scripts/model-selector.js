#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const MATRIX_PATH = path.join(__dirname, '..', 'model-matrix.json');
const SESSION_REGISTRY_DIR = 'session-workspaces';
const SESSION_REGISTRY_VERSION = 1;
const UNBOUND_WORKSPACE_KEY = 'unbound-workspace';
const HOST_CONTEXT_KEYS = ['host_id', 'hostId', 'agent_id', 'agentId', 'client_id', 'clientId', 'machine_id', 'machineId', 'runtime_id', 'runtimeId'];

// This script ships standalone (copied whole into every install target,
// e.g. .claude/skills/fable-mode/scripts/), so it can't require the source
// repo's scripts/lib/workspace.js. The audit log is genuine runtime state
// though - not a project artifact - so it needs to land in the same global,
// workspace-keyed root that hooks/scripts/lib/harness-state.js resolves to,
// not scattered under cwd (issue #42). Duplicated here, algorithm-for-
// algorithm, same as opencode-plugin/index.mjs's own inlined copy.
function findWorkspaceRoot(startPath, allowNonGit = false) {
  if (typeof startPath !== 'string' || !startPath.trim()) return null;
  let dir = path.resolve(startPath);
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return canonicalPath(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return allowNonGit ? canonicalPath(startPath) : null;
}

function canonicalPath(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const resolved = path.resolve(value);
  try { return fs.realpathSync(resolved); } catch (err) { return resolved; }
}

function getSessionId(context) {
  if (!context || typeof context !== 'object') return null;
  return context.session_id || context.sessionId || null;
}

function getHostId(context) {
  if (!context || typeof context !== 'object') return process.env.FABLE_HOST_ID || process.env.HARNESS_HOST_ID || null;
  for (const key of HOST_CONTEXT_KEYS) {
    if (typeof context[key] === 'string' && context[key].trim()) return context[key].trim();
  }
  return process.env.FABLE_HOST_ID || process.env.HARNESS_HOST_ID || null;
}

function getSessionRegistryPath(sessionId, hostId) {
  const namespace = hostId ? `${hostId}\0${sessionId}` : String(sessionId);
  const hash = crypto.createHash('sha256').update(namespace).digest('hex');
  const home = process.env.HARNESS_STATE_HOME || path.join(os.homedir(), '.agents', 'harness-everything');
  return path.join(home, SESSION_REGISTRY_DIR, `${hash}.json`);
}

function readRegistryRecord(filePath) {
  try {
    const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return record.version === SESSION_REGISTRY_VERSION && typeof record.workspaceRoot === 'string' ? record : null;
  } catch (err) {
    return null;
  }
}

function getBoundWorkspace(sessionId, context) {
  if (!sessionId) return null;
  const hostId = getHostId(context);
  const records = [];
  const preferred = readRegistryRecord(getSessionRegistryPath(sessionId, hostId));
  if (preferred && (!hostId || !preferred.hostId || preferred.hostId === hostId)) records.push(preferred);
  if (hostId) {
    const unscoped = readRegistryRecord(getSessionRegistryPath(sessionId, null));
    if (unscoped && !unscoped.hostId) records.push(unscoped);
  }
  try {
    const home = process.env.HARNESS_STATE_HOME || path.join(os.homedir(), '.agents', 'harness-everything');
    const dir = path.join(home, SESSION_REGISTRY_DIR);
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
      const record = readRegistryRecord(path.join(dir, entry.name));
      if (record && record.sessionId === sessionId && (!hostId || !record.hostId || record.hostId === hostId)) records.push(record);
    }
  } catch (err) { /* no registry yet */ }
  const unique = [...new Map(records.map(record => [`${record.hostId || ''}\0${record.workspaceRoot}`, record])).values()];
  if (unique.length === 1) return unique[0].workspaceRoot;
  if (unique.length > 1 && new Set(unique.map(record => canonicalPath(record.workspaceRoot))).size === 1) return unique[0].workspaceRoot;
  return null;
}

function getRegistryRecord(sessionId, context) {
  const root = getBoundWorkspace(sessionId, context);
  return root ? { workspaceRoot: root } : null;
}

function bindWorkspace(sessionId, root, context) {
  if (!sessionId) return;
  if (!root) return;
  const hostId = getHostId(context);
  const target = getSessionRegistryPath(sessionId, hostId);
  const record = { version: SESSION_REGISTRY_VERSION, sessionId, hostId: hostId || undefined, workspaceRoot: root, updatedAt: new Date().toISOString() };
  let temporary;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(temporary, JSON.stringify(record, null, 2), 'utf8');
    if (fs.existsSync(target)) fs.unlinkSync(temporary);
    else fs.renameSync(temporary, target);
  } catch (err) {
    try { if (temporary && fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (cleanupErr) { /* ignore */ }
  }
}

function getWorkspaceRoot(context) {
  const sessionId = getSessionId(context);
  const bound = getRegistryRecord(sessionId, context);
  if (bound) return bound.workspaceRoot;
  const explicit = context && (context.workspace_root || context.workspaceRoot || context.cwd);
  const hostRoot = explicit || process.env.HARNESS_WORKSPACE_ROOT || process.env.FABLE_WORKSPACE_ROOT;
  const root = findWorkspaceRoot(hostRoot || process.cwd(), Boolean(hostRoot));
  if (sessionId) bindWorkspace(sessionId, root, context);
  return root;
}

function getWorkspaceStateDir(root) {
  const home = process.env.HARNESS_STATE_HOME || path.join(os.homedir(), '.agents', 'harness-everything');
  if (!root) return path.join(home, 'workspaces', UNBOUND_WORKSPACE_KEY);
  let real = path.resolve(root);
  try { real = fs.realpathSync(real); } catch (err) { /* path may not exist yet */ }
  const slug = path.basename(real).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const hashInput = process.platform === 'win32' ? real.toLowerCase() : real;
  const hash = crypto.createHash('sha1').update(hashInput).digest('hex').slice(0, 12);
  return path.join(home, 'workspaces', `${slug}-${hash}`);
}
const REQUIRED = ['stageBrief', 'passCondition', 'verificationCommand', 'verifierResult'];
const VALID_VERIFIER_RESULTS = new Set(['pending', 'pass', 'fail', 'not-run', 'blocked']);

function loadMatrix() {
  return JSON.parse(fs.readFileSync(MATRIX_PATH, 'utf8'));
}

function normalizeModel(value, matrix) {
  const input = String(value || '').trim().toLowerCase();
  for (const [model, definition] of Object.entries(matrix.modes)) {
    if (definition.aliases.includes(input)) return model;
  }
  return null;
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') return { help: true };
    if (!token.startsWith('--')) throw new Error(`unknown argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[i + 1];
    if (typeof value === 'undefined' || value.startsWith('--')) throw new Error(`missing value for --${key}`);
    args[key] = value;
    i += 1;
  }
  return args;
}

function resolveMode(input, matrix = loadMatrix()) {
  const requestedModel = normalizeModel(input.requested, matrix);
  if (!requestedModel) throw new Error('requested model must be one of haiku, sonnet, sonnect, or opus');

  const availableModels = String(input.available || '')
    .split(/[\s,]+/)
    .map(model => normalizeModel(model, matrix))
    .filter(Boolean);
  const availableAgents = String(input.availableAgents || '')
    .split(/[\s,]+/)
    .map(agent => agent.trim())
    .filter(Boolean);
  const fallback = input.fallback || 'stop';
  if (!Object.prototype.hasOwnProperty.call(matrix.fallbacks, fallback)) {
    throw new Error('fallback must be inline or stop');
  }

  for (const field of REQUIRED) {
    if (!String(input[field] || '').trim()) throw new Error(`${field} is required for an auditable stage`);
  }
  if (!VALID_VERIFIER_RESULTS.has(input.verifierResult)) {
    throw new Error(`verifierResult must be one of ${[...VALID_VERIFIER_RESULTS].join(', ')}`);
  }

  const requestedAgent = matrix.modes[requestedModel].agent;
  const modelAvailable = availableModels.includes(requestedModel);
  const agentAvailable = availableAgents.includes(requestedAgent);
  const selected = modelAvailable && agentAvailable;
  const hostModel = String(input.hostModel || 'current-host').trim();
  const fallbackDefinition = matrix.fallbacks[fallback];
  const status = selected ? 'selected' : fallbackDefinition.status;
  const effectiveModel = selected
    ? requestedModel
    : fallback === 'inline'
      ? hostModel
      : fallbackDefinition.effectiveModel;
  const missing = [];
  if (!modelAvailable) missing.push(`${requestedModel} is not in availableModels`);
  if (!agentAvailable) missing.push(`${requestedAgent} is not in availableAgents`);
  const fallbackReason = selected
    ? 'none'
    : `${fallbackDefinition.reason}: ${missing.join('; ')}`;

  return {
    schemaVersion: matrix.schemaVersion,
    status,
    requestedModel,
    requestedInput: String(input.requested).trim(),
    effectiveModel,
    availableModels: [...new Set(availableModels)],
    availableAgents: [...new Set(availableAgents)],
    fallbackPolicy: fallback,
    fallbackReason,
    agent: selected ? requestedAgent : null,
    modelRole: matrix.modes[requestedModel].role,
    stageBrief: String(input.stageBrief).trim(),
    passCondition: String(input.passCondition).trim(),
    verificationCommand: String(input.verificationCommand).trim(),
    verifierResult: input.verifierResult,
    escalationRequired: status === 'blocked'
  };
}

function printHelp() {
  console.log('Usage: node fable-mode/scripts/model-selector.js --requested <haiku|sonnet|sonnect|opus> --available <models> --available-agents <agent names> --stage-brief <text> --pass-condition <text> --verification-command <command> --verifier-result <pending|pass|fail|not-run|blocked> [--fallback <inline|stop>] [--host-model <model>] [--audit-file <path>]');
}

function appendAuditRecord(record, auditFile, context) {
  const target = auditFile || process.env.FABLE_AUDIT_FILE ||
    path.join(getWorkspaceStateDir(getWorkspaceRoot(context)), 'state', 'fable-mode', 'audit.jsonl');
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.appendFileSync(target, `${JSON.stringify(record)}\n`, 'utf8');
}

function main(argv = process.argv.slice(2)) {
  try {
    const input = parseArgs(argv);
    if (input.help) {
      printHelp();
      return 0;
    }
    const record = resolveMode(input);
    appendAuditRecord(record, input.auditFile, input);
    console.log(JSON.stringify(record, null, 2));
    return record.status === 'blocked' ? 2 : 0;
  } catch (error) {
    console.error(`[fable-mode/model-selector] ${error.message}`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { loadMatrix, normalizeModel, parseArgs, resolveMode, main };
