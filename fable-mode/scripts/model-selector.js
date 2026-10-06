#!/usr/bin/env node

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

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
const PROFILE_MATRIX_PATH = path.join(__dirname, '..', 'behavior-profile-matrix.json');
const RUNTIME_FLOOR_PATH = path.join(__dirname, '..', 'runtime-model-floor-matrix.json');
const EFFORT_ORDER = ['low', 'medium', 'high', 'xhigh', 'max'];

function loadBehaviorMatrix() {
  return JSON.parse(fs.readFileSync(PROFILE_MATRIX_PATH, 'utf8'));
}

function loadRuntimeFloors() {
  return JSON.parse(fs.readFileSync(RUNTIME_FLOOR_PATH, 'utf8'));
}

function normalizeProfile(value, matrix = loadBehaviorMatrix()) {
  const input = String(value || '').trim().toLowerCase();
  for (const [profile, definition] of Object.entries(matrix.profiles)) {
    if (profile === input || definition.aliases.includes(input)) return { profile, alias: input, definition };
  }
  return null;
}

function normalizeHost(value) {
  const input = String(value || '').trim().toLowerCase();
  if (input === 'claude' || input === 'claude-code' || input === 'claude code') return 'claude';
  if (input === 'codex' || input === 'openai-codex' || input === 'openai codex') return 'codex';
  return input || 'unknown';
}

function normalizeEffort(value) {
  const input = String(value || '').trim().toLowerCase().replace(/[_ -]/g, '');
  if (!input) return null;
  if (input === 'extrahigh' || input === 'xhigh') return 'xhigh';
  return input;
}

function claudeVersion(model, family) {
  const text = String(model || '').toLowerCase();
  const match = text.match(new RegExp(family + '[^0-9]*(\\d+)(?:[.-](\\d+))?'));
  if (!match) return null;
  return Number(match[1] + '.' + (match[2] || '0'));
}

function codexGeneration(model) {
  const match = String(model || '').toLowerCase().match(/\bgpt-(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : null;
}

function evaluateRuntimeFloor(profile, input, floors = loadRuntimeFloors()) {
  const host = normalizeHost(input.host);
  const floor = floors.hosts[host] && floors.hosts[host][profile] ? floors.hosts[host][profile] : null;
  const runtimeModel = String(input.runtimeModel || input.hostModel || '').trim() || null;
  const runtimeEffort = normalizeEffort(input.runtimeEffort || input.effort);
  if (!floor) return { host, runtimeModel, runtimeEffort, floor: null, status: 'not-configured', reason: 'no runtime floor configured for host ' + host };
  if (!runtimeModel) return { host, runtimeModel, runtimeEffort, floor, status: 'unknown', reason: 'runtime model was not reported by the host' };

  const lower = runtimeModel.toLowerCase();
  if (!lower.includes(floor.family)) return { host, runtimeModel, runtimeEffort, floor, status: 'unknown', reason: 'runtime model family is not comparable to recommended ' + floor.family };

  if (floor.minVersion) {
    const actual = claudeVersion(runtimeModel, floor.family);
    if (actual === null) return { host, runtimeModel, runtimeEffort, floor, status: 'unknown', reason: 'runtime model version could not be parsed' };
    if (actual < Number(floor.minVersion)) return { host, runtimeModel, runtimeEffort, floor, status: 'below-recommended', reason: 'runtime model version ' + actual + ' is below ' + floor.minVersion };
  }

  if (floor.minGeneration) {
    const actual = codexGeneration(runtimeModel);
    if (actual === null) return { host, runtimeModel, runtimeEffort, floor, status: 'unknown', reason: 'runtime model generation could not be parsed' };
    if (actual < Number(floor.minGeneration)) return { host, runtimeModel, runtimeEffort, floor, status: 'below-recommended', reason: 'runtime model generation ' + actual + ' is below ' + floor.minGeneration };
  }

  if (floor.minEffort) {
    if (!runtimeEffort) return { host, runtimeModel, runtimeEffort, floor, status: 'unknown', reason: 'runtime reasoning effort was not reported by the host' };
    const actualRank = EFFORT_ORDER.indexOf(runtimeEffort);
    const floorRank = EFFORT_ORDER.indexOf(normalizeEffort(floor.minEffort));
    if (actualRank < 0 || floorRank < 0) return { host, runtimeModel, runtimeEffort, floor, status: 'unknown', reason: 'runtime effort is not comparable to configured floor' };
    if (actualRank < floorRank) return { host, runtimeModel, runtimeEffort, floor, status: 'below-recommended', reason: 'runtime effort ' + runtimeEffort + ' is below ' + floor.minEffort };
  }

  return { host, runtimeModel, runtimeEffort, floor, status: 'meets-recommended', reason: 'runtime meets the configured advisory floor' };
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === '--help' || token === '-h') return { help: true };
    if (!token.startsWith('--')) throw new Error('unknown argument: ' + token);
    const key = token.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
    const value = argv[i + 1];
    if (typeof value === 'undefined' || value.startsWith('--')) throw new Error('missing value for --' + key);
    args[key] = value;
    i += 1;
  }
  return args;
}

function resolveMode(input, matrix = loadBehaviorMatrix(), floors = loadRuntimeFloors()) {
  const normalized = normalizeProfile(input.requested, matrix);
  if (!normalized) throw new Error('requested profile must be one of mechanical, reasoning, orchestrator, haiku, sonnet, sonnect, or opus');

  const availableAgents = String(input.availableAgents || '').split(/[\s,]+/).map(agent => agent.trim()).filter(Boolean);
  const fallback = input.fallback || 'stop';
  if (!['inline', 'stop'].includes(fallback)) throw new Error('fallback must be inline or stop');
  for (const field of REQUIRED) {
    if (!String(input[field] || '').trim()) throw new Error(field + ' is required for an auditable stage');
  }
  if (!VALID_VERIFIER_RESULTS.has(input.verifierResult)) throw new Error('verifierResult must be one of ' + [...VALID_VERIFIER_RESULTS].join(', '));

  const requestedProfile = normalized.profile;
  const requestedAgent = normalized.definition.agent;
  const agentAvailable = availableAgents.includes(requestedAgent);
  const status = agentAvailable ? 'selected' : fallback === 'inline' ? 'fallback' : 'blocked';
  const runtime = evaluateRuntimeFloor(requestedProfile, input, floors);
  const fallbackReason = agentAvailable ? 'none' : fallback === 'inline'
    ? requestedAgent + ' is not in availableAgents; execute the same ' + requestedProfile + ' behavior profile inline'
    : requestedAgent + ' is not in availableAgents and inline fallback was not authorized';

  return {
    schemaVersion: matrix.schemaVersion,
    status,
    requestedProfile,
    effectiveProfile: status === 'blocked' ? null : requestedProfile,
    profileAlias: normalized.alias,
    requestedInput: String(input.requested).trim(),
    assignedRole: normalized.definition.role,
    agent: agentAvailable ? requestedAgent : null,
    availableAgents: [...new Set(availableAgents)],
    fallbackPolicy: fallback,
    fallbackReason,
    host: runtime.host,
    runtimeModel: runtime.runtimeModel,
    runtimeEffort: runtime.runtimeEffort,
    recommendedRuntimeFloor: runtime.floor,
    runtimeFloorStatus: runtime.status,
    runtimeFloorReason: runtime.reason,
    stageBrief: String(input.stageBrief).trim(),
    passCondition: String(input.passCondition).trim(),
    verificationCommand: String(input.verificationCommand).trim(),
    verifierResult: input.verifierResult,
    escalationRequired: status === 'blocked'
  };
}

function printHelp() {
  console.log('Usage: node fable-mode/scripts/model-selector.js --requested <mechanical|reasoning|orchestrator|haiku|sonnet|sonnect|opus> --available-agents <agent names> --stage-brief <text> --pass-condition <text> --verification-command <command> --verifier-result <pending|pass|fail|not-run|blocked> [--host <claude|codex>] [--runtime-model <model>] [--runtime-effort <effort>] [--fallback <inline|stop>] [--audit-file <path>]');
}

function appendAuditRecord(record, auditFile, context) {
  const target = auditFile || process.env.FABLE_AUDIT_FILE || path.join(getWorkspaceStateDir(getWorkspaceRoot(context)), 'state', 'fable-mode', 'audit.jsonl');
  fs.mkdirSync(path.dirname(path.resolve(target)), { recursive: true });
  fs.appendFileSync(target, JSON.stringify(record) + '\n', 'utf8');
}

function main(argv = process.argv.slice(2)) {
  try {
    const input = parseArgs(argv);
    if (input.help) { printHelp(); return 0; }
    const record = resolveMode(input);
    appendAuditRecord(record, input.auditFile, input);
    console.log(JSON.stringify(record, null, 2));
    return record.status === 'blocked' ? 2 : 0;
  } catch (error) {
    console.error('[fable-mode/model-selector] ' + error.message);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { loadBehaviorMatrix, loadMatrix: loadBehaviorMatrix, loadRuntimeFloors, normalizeProfile, normalizeModel: normalizeProfile, parseArgs, evaluateRuntimeFloor, resolveMode, main };
