const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const WORKSPACE_CONTEXT_KEYS = [
  'workspace_root', 'workspaceRoot', 'project_root', 'projectRoot',
  'working_directory', 'workingDirectory', 'cwd', 'root'
];
const SESSION_CONTEXT_KEYS = ['session_id', 'sessionId'];
const HOST_CONTEXT_KEYS = [
  'host_id', 'hostId', 'agent_id', 'agentId', 'client_id', 'clientId',
  'machine_id', 'machineId', 'runtime_id', 'runtimeId'
];
const SESSION_REGISTRY_DIR = 'session-workspaces';
const SESSION_REGISTRY_VERSION = 1;

function findWorkspaceRoot(startPath) {
  let dir = path.resolve(startPath || process.cwd());
  while (true) {
    if (fs.existsSync(path.join(dir, '.git'))) return canonicalPath(dir);
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return canonicalPath(startPath || process.cwd());
}

function canonicalPath(value) {
  const resolved = path.resolve(value || process.cwd());
  try { return fs.realpathSync(resolved); } catch (err) { return resolved; }
}

function getSessionId(context) {
  if (!context || typeof context !== 'object') return null;
  for (const key of SESSION_CONTEXT_KEYS) {
    if (typeof context[key] === 'string' && context[key].trim()) {
      return context[key].trim();
    }
  }
  for (const key of ['session', 'metadata', 'context']) {
    if (context[key] && typeof context[key] === 'object') {
      const nested = getSessionId(context[key]);
      if (nested) return nested;
    }
  }
  return null;
}

function getHostId(context) {
  if (!context || typeof context !== 'object') return null;
  for (const key of HOST_CONTEXT_KEYS) {
    if (typeof context[key] === 'string' && context[key].trim()) return context[key].trim();
  }
  if (typeof context.host === 'string' && context.host.trim()) return context.host.trim();
  if (context.host && typeof context.host === 'object') return getHostId(context.host);
  for (const key of ['agent', 'client', 'machine', 'runtime', 'metadata', 'context']) {
    if (context[key] && typeof context[key] === 'object') {
      const nested = getHostId(context[key]);
      if (nested) return nested;
    }
  }
  return null;
}

function contextPath(context, depth = 0) {
  if (typeof context === 'string' && context.trim()) return context.trim();
  if (!context || typeof context !== 'object' || depth > 2) return null;

  for (const key of WORKSPACE_CONTEXT_KEYS) {
    const value = context[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (value && typeof value === 'object') {
      const nested = contextPath(value, depth + 1);
      if (nested) return nested;
    }
  }

  for (const key of ['workspace', 'project', 'host', 'context']) {
    const nested = contextPath(context[key], depth + 1);
    if (nested) return nested;
  }
  return null;
}

function sessionRegistryPath(sessionId, hostId) {
  const namespace = hostId ? `${hostId}\0${sessionId}` : String(sessionId);
  const hash = crypto.createHash('sha256').update(namespace).digest('hex');
  return path.join(getStateHome(), SESSION_REGISTRY_DIR, `${hash}.json`);
}

function readRegistryRecord(filePath) {
  try {
    const record = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (record.version !== SESSION_REGISTRY_VERSION || typeof record.workspaceRoot !== 'string') return null;
    return record;
  } catch (err) {
    return null;
  }
}

function findSessionRecords(sessionId) {
  const registryDir = path.join(getStateHome(), SESSION_REGISTRY_DIR);
  try {
    return fs.readdirSync(registryDir, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.json'))
      .map(entry => readRegistryRecord(path.join(registryDir, entry.name)))
      .filter(record => record && record.sessionId === sessionId);
  } catch (err) {
    return [];
  }
}

function readWorkspaceSession(sessionId, context) {
  if (!sessionId) return null;
  const hostId = getHostId(context);
  const records = [];
  const preferred = readRegistryRecord(sessionRegistryPath(sessionId, hostId));
  if (preferred && (!hostId || !preferred.hostId || preferred.hostId === hostId)) records.push(preferred);
  if (hostId) {
    // A session may have been first observed by a caller that did not expose
    // host metadata. Reuse that unscoped binding rather than forking state.
    const unscoped = readRegistryRecord(sessionRegistryPath(sessionId, null));
    if (unscoped && !unscoped.hostId) records.push(unscoped);
  } else {
    records.push(...findSessionRecords(sessionId));
  }

  const unique = [...new Map(records.map(record => [
    `${record.hostId || ''}\0${record.workspaceRoot}`,
    record
  ])).values()];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) {
    // Hostless payloads are safe only when all known host bindings agree on
    // the same workspace. Otherwise select nothing and require context.
    const roots = new Set(unique.map(record => canonicalPath(record.workspaceRoot)));
    if (roots.size === 1) return unique[0];
  }
  return null;
}

function bindWorkspaceSession(sessionId, workspaceRoot, context, force = false) {
  if (!sessionId) return null;
  const root = findWorkspaceRoot(workspaceRoot);
  const hostId = getHostId(context);
  const target = sessionRegistryPath(sessionId, hostId);
  const record = {
    version: SESSION_REGISTRY_VERSION,
    sessionId,
    hostId: hostId || undefined,
    workspaceRoot: root,
    workspaceKey: getWorkspaceKey(root),
    updatedAt: new Date().toISOString()
  };
  const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(temporary, JSON.stringify(record, null, 2), 'utf8');
    // Keep the first successful binding when two hooks initialize together.
    if (fs.existsSync(target)) {
      if (readRegistryRecord(target) && !force) fs.unlinkSync(temporary);
      else {
        fs.unlinkSync(target);
        fs.renameSync(temporary, target);
      }
    } else fs.renameSync(temporary, target);
  } catch (err) {
    // Identity persistence is best effort. The caller still receives the
    // resolved root and the next invocation can retry the binding.
    try { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); } catch (cleanupErr) { /* ignore */ }
  }
  return root;
}

function isIdentityReset(context) {
  if (!context || typeof context !== 'object') return false;
  return context.workspace_identity_reset === true ||
    context.workspaceIdentityReset === true ||
    context.new_session === true ||
    context.newSession === true;
}

function getWorkspaceRoot(context) {
  const sessionId = getSessionId(context);
  const existing = readWorkspaceSession(sessionId, context);
  const explicit = contextPath(context);

  // SessionStart is the host's authoritative opportunity to establish (or
  // re-establish) the project identity. All later hook invocations keep that
  // binding even if the agent changes cwd or reports a nested repository.
  if (existing && !isIdentityReset(context)) return existing.workspaceRoot;

  const candidate = explicit || process.env.HARNESS_WORKSPACE_ROOT ||
    process.env.CLAUDE_PROJECT_DIR || process.env.CODEX_PROJECT_DIR || process.cwd();
  const root = findWorkspaceRoot(candidate);
  if (sessionId) bindWorkspaceSession(sessionId, root, context, isIdentityReset(context));
  return root;
}

// Single global root for ALL Harness runtime state (session counters,
// circuit-breaker trips, audit logs, handoff timestamps, ...). Never
// cwd-derived, so a script invoked from a fixture dir, worktree, submodule,
// or any other nested non-git directory can never scatter files there
// (issue #42). `$HARNESS_STATE_HOME` matches the env var the opencode
// plugin already used for its own (differently-rooted) global state.
function getStateHome() {
  return process.env.HARNESS_STATE_HOME || path.join(os.homedir(), '.agents', 'harness-everything');
}

// Keys runtime state per real workspace instead of per invocation cwd, so
// two different repos (or a repo and a stray subdirectory someone `cd`ed
// into) never collide or fork the same state stream. Uses the resolved real
// path (symlinks collapsed) hashed short, prefixed with a readable slug
// purely so `~/.agents/harness-everything/workspaces/` stays eyeballable.
function getWorkspaceKey(root) {
  const resolved = path.resolve(typeof root === 'string' ? root : getWorkspaceRoot(root));
  let real = resolved;
  try { real = fs.realpathSync(resolved); } catch (err) { /* path may not exist yet (tests) */ }
  const slug = path.basename(real).toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'workspace';
  const hash = crypto.createHash('sha1').update(real).digest('hex').slice(0, 12);
  return `${slug}-${hash}`;
}

function getWorkspaceStateDir(root) {
  return path.join(getStateHome(), 'workspaces', getWorkspaceKey(root));
}

function resolveWorkspaceIdentity(context) {
  const workspaceRoot = getWorkspaceRoot(context);
  return {
    workspaceRoot,
    workspaceKey: getWorkspaceKey(workspaceRoot),
    stateDir: getWorkspaceStateDir(workspaceRoot),
    sessionId: getSessionId(context)
  };
}

function getUserPromptsDir() {
  if (process.env.VSCODE_USER_PROMPTS_FOLDER) {
    return process.env.VSCODE_USER_PROMPTS_FOLDER;
  }
  const home = os.homedir();
  if (process.platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'Code', 'User', 'prompts');
  } else if (process.platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'Code', 'User', 'prompts');
  } else {
    return path.join(home, '.config', 'Code', 'User', 'prompts');
  }
}

// The harness repo must never be "repaired" into carrying its own generated
// advisory files. Identify it by repo identity, not by comparing the caller's
// __dirname: when harness runs from an npx/global install against its own
// source checkout, the installed path and the workspace path differ and a
// path-based guard silently fails open (issue #40).
const HARNESS_PACKAGE_NAME = 'harness-everything';

function isHarnessRepo(workspaceRoot) {
  try {
    const pkgPath = path.join(workspaceRoot, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    return pkg.name === HARNESS_PACKAGE_NAME;
  } catch (err) {
    return false;
  }
}

module.exports = {
  getWorkspaceRoot,
  resolveWorkspaceIdentity,
  bindWorkspaceSession,
  readWorkspaceSession,
  getSessionId,
  getHostId,
  getStateHome,
  getWorkspaceKey,
  getWorkspaceStateDir,
  getUserPromptsDir,
  isHarnessRepo,
  HARNESS_PACKAGE_NAME,
};
