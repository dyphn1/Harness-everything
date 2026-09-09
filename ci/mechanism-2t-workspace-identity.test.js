const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
let failures = 0;

console.log('\n[2t] Session-stable workspace identity and standalone fable audit...');

function check(name, condition, detail) {
  if (condition) console.log(`  PASS ${name}`);
  else {
    console.error(`  FAIL ${name}`);
    if (detail) console.error(`       ${detail}`);
    failures += 1;
  }
}

function run(cwd, script, env) {
  return spawnSync(process.execPath, ['-e', script], {
    cwd,
    env,
    encoding: 'utf8'
  });
}

function nodeRequire(file) {
  return JSON.stringify(file.replace(/\\/g, '/'));
}

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2t-identity-'));
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2t-home-'));
const stateHome = path.join(fakeHome, '.agents', 'harness-everything');
const outer = path.join(fixture, 'outer-repo');
const nested = path.join(outer, 'packages', 'nested');
const nestedRepo = path.join(outer, 'embedded-repo');
const scratch = path.join(fixture, 'scratch');
for (const dir of [outer, nested, nestedRepo, scratch]) fs.mkdirSync(dir, { recursive: true });
spawnSync('git', ['init', '--quiet'], { cwd: outer });
spawnSync('git', ['init', '--quiet'], { cwd: nestedRepo });

const baseEnv = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome, HARNESS_STATE_HOME: stateHome };
const workspaceModule = path.join(root, 'scripts', 'lib', 'workspace.js');
const stateModule = path.join(root, 'hooks', 'scripts', 'lib', 'harness-state.js');

function identityScript(context) {
  return `
    const { getWorkspaceRoot, resolveWorkspaceIdentity } = require(${nodeRequire(workspaceModule)});
    const context = ${JSON.stringify(context)};
    console.log(JSON.stringify({ root: getWorkspaceRoot(context), identity: resolveWorkspaceIdentity(context) }));
  `;
}

const session = 'issue-42-stable-session';
let result = run(outer, identityScript({ session_id: session, hook_event_name: 'SessionStart', cwd: outer }), baseEnv);
let parsed = JSON.parse(result.stdout);
check('SessionStart binds the repository root', result.status === 0 && path.resolve(parsed.root) === path.resolve(outer), result.stderr);

for (const [label, cwd] of [['nested directory', nested], ['scratch directory', scratch], ['nested repository', nestedRepo]]) {
  result = run(cwd, identityScript({ session_id: session, cwd }), baseEnv);
  parsed = JSON.parse(result.stdout);
  check(`same session stays bound after entering a ${label}`, result.status === 0 && path.resolve(parsed.root) === path.resolve(outer), result.stderr || result.stdout);
}

result = run(scratch, identityScript({
  session_id: 'explicit-context-session', cwd: scratch, workspace_root: outer
}), { ...baseEnv, HARNESS_WORKSPACE_ROOT: nestedRepo });
parsed = JSON.parse(result.stdout);
check('explicit workspace context outranks inherited workspace environment', result.status === 0 && path.resolve(parsed.root) === path.resolve(outer), result.stderr || result.stdout);

result = run(nestedRepo, identityScript({
  session_id: session, hook_event_name: 'SessionStart', cwd: nestedRepo
}), baseEnv);
parsed = JSON.parse(result.stdout);
check('resume SessionStart keeps the existing binding', result.status === 0 && path.resolve(parsed.root) === path.resolve(outer), result.stderr || result.stdout);

result = run(nestedRepo, identityScript({
  session_id: session, workspace_identity_reset: true, cwd: nestedRepo
}), baseEnv);
parsed = JSON.parse(result.stdout);
check('explicit identity reset permits a deliberate rebind', result.status === 0 && path.resolve(parsed.root) === path.resolve(nestedRepo), result.stderr || result.stdout);
result = run(scratch, identityScript({ session_id: session, cwd: scratch }), baseEnv);
parsed = JSON.parse(result.stdout);
check('identity reset persists the new binding for later cwd changes', result.status === 0 && path.resolve(parsed.root) === path.resolve(nestedRepo), result.stderr || result.stdout);

result = run(outer, identityScript({ session_id: 'issue-42-host-session', host_id: 'host-a', cwd: outer }), baseEnv);
parsed = JSON.parse(result.stdout);
check('host/session identity binds the first host workspace', result.status === 0 && path.resolve(parsed.root) === path.resolve(outer), result.stderr || result.stdout);
result = run(nestedRepo, identityScript({ session_id: 'issue-42-host-session', host_id: 'host-a', cwd: nestedRepo }), baseEnv);
parsed = JSON.parse(result.stdout);
check('same host/session stays bound after a nested-repository cwd change', result.status === 0 && path.resolve(parsed.root) === path.resolve(outer), result.stderr || result.stdout);
result = run(scratch, identityScript({ session_id: 'issue-42-host-session', cwd: scratch }), baseEnv);
parsed = JSON.parse(result.stdout);
check('hostless follow-up reuses an unambiguous host/session binding', result.status === 0 && path.resolve(parsed.root) === path.resolve(outer), result.stderr || result.stdout);
result = run(nestedRepo, identityScript({ session_id: 'issue-42-host-session', host_id: 'host-b', cwd: nestedRepo }), baseEnv);
parsed = JSON.parse(result.stdout);
check('different hosts may bind the same session id independently', result.status === 0 && path.resolve(parsed.root) === path.resolve(nestedRepo), result.stderr || result.stdout);
result = run(scratch, identityScript({ session_id: 'issue-42-host-session', cwd: scratch }), baseEnv);
parsed = JSON.parse(result.stdout);
check('ambiguous hostless identity falls back to explicit context', result.status === 0 && path.resolve(parsed.root) === path.resolve(scratch), result.stderr || result.stdout);

const stateScript = `
  const { getWorkspaceRoot, getSessionDir } = require(${nodeRequire(stateModule)});
  const payload = ${JSON.stringify({ session_id: 'issue-42-state-session', cwd: outer })};
  const root = getWorkspaceRoot(payload);
  console.log(JSON.stringify({ root, dir: getSessionDir(root, payload.session_id) }));
`;
result = run(scratch, stateScript, baseEnv);
parsed = JSON.parse(result.stdout);
const stateDir = path.resolve(parsed.dir);
check('hooks can resolve state from a bound session after cwd changes', result.status === 0 && stateDir.startsWith(path.resolve(stateHome)) && !stateDir.startsWith(path.resolve(fixture)), result.stderr || result.stdout);

// The fable script is copied as a standalone skill at install time. Keeping a
// second copy here catches accidental imports of repo-only helpers and checks
// that its audit uses the same session registry/state stream.
const installed = path.join(fixture, 'installed', 'fable-mode', 'scripts');
fs.mkdirSync(installed, { recursive: true });
fs.copyFileSync(path.join(root, 'fable-mode', 'scripts', 'model-selector.js'), path.join(installed, 'model-selector.js'));
fs.copyFileSync(path.join(root, 'fable-mode', 'model-matrix.json'), path.join(installed, '..', 'model-matrix.json'));
const fable = path.join(installed, 'model-selector.js');
const fableArgs = ['--requested', 'haiku', '--available', 'haiku', '--available-agents', 'fable-worker-haiku', '--stage-brief', 'identity', '--pass-condition', 'audit', '--verification-command', 'node test', '--verifier-result', 'pass', '--session-id', 'issue-42-fable-session'];
result = spawnSync(process.execPath, [fable, ...fableArgs], { cwd: outer, env: baseEnv, encoding: 'utf8' });
check('standalone fable audit runs after install', result.status === 0, result.stderr || result.stdout);
result = spawnSync(process.execPath, [fable, ...fableArgs], { cwd: scratch, env: baseEnv, encoding: 'utf8' });
check('standalone fable audit follows its session binding across cwd changes', result.status === 0 && fs.existsSync(path.join(stateHome, 'workspaces')), result.stderr || result.stdout);

// Migration merges every platform source into an already-used destination,
// preserves conflicting/unsupported entries, and succeeds on a later retry
// after the user resolves the conflict.
const migrationScript = `
  const fs = require('fs');
  const path = require('path');
  const { getWorkspaceStateDir } = require(${nodeRequire(workspaceModule)});
  const { migrateLegacyState } = require(${nodeRequire(stateModule)});
  const workspace = ${JSON.stringify(outer)};
  const destination = path.join(getWorkspaceStateDir(workspace), 'state');
  const claude = path.join(workspace, '.claude', 'harness-everything', 'state');
  const cursor = path.join(workspace, '.cursor', 'harness-everything', 'state');
  const conflict = path.join('sessions', 'migration-conflict.json');
  fs.mkdirSync(path.join(claude, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(cursor, 'sessions'), { recursive: true });
  fs.mkdirSync(path.join(destination, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(claude, conflict), 'legacy');
  fs.writeFileSync(path.join(cursor, 'sessions', 'cursor-only.json'), 'cursor');
  fs.writeFileSync(path.join(destination, conflict), 'newer');
  let symlink = false;
  try {
    fs.writeFileSync(path.join(claude, 'sessions', 'symlink-target.txt'), 'target');
    fs.symlinkSync('symlink-target.txt', path.join(claude, 'sessions', 'unsupported-link'), 'file');
    symlink = true;
  } catch (err) {}
  const first = migrateLegacyState(workspace, destination);
  const firstState = {
    first,
    claudeExists: fs.existsSync(claude),
    cursorExists: fs.existsSync(cursor),
    conflict: fs.readFileSync(path.join(destination, conflict), 'utf8'),
    cursorOnly: fs.readFileSync(path.join(destination, 'sessions', 'cursor-only.json'), 'utf8'),
    symlinkCopied: fs.existsSync(path.join(destination, 'sessions', 'unsupported-link')),
    symlink
  };
  if (symlink) fs.unlinkSync(path.join(claude, 'sessions', 'unsupported-link'));
  fs.rmSync(path.join(destination, conflict), { force: true });
  const second = migrateLegacyState(workspace, destination);
  console.log(JSON.stringify({ firstState, second, claudeExistsAfterRetry: fs.existsSync(claude), conflictAfterRetry: fs.readFileSync(path.join(destination, conflict), 'utf8') }));
`;
result = run(scratch, migrationScript, baseEnv);
parsed = JSON.parse(result.stdout);
check('migration keeps conflicting sources available for recovery', result.status === 0 && parsed.firstState.claudeExists && parsed.firstState.conflict === 'newer', result.stderr || result.stdout);
check('migration merges independent platform sources even when one conflicts', result.status === 0 && !parsed.firstState.cursorExists && parsed.firstState.cursorOnly === 'cursor', result.stderr || result.stdout);
check('migration preserves unsupported symlink entries', result.status === 0 && (!parsed.firstState.symlink || !parsed.firstState.symlinkCopied), result.stderr || result.stdout);
check('migration retry completes after the conflict is resolved', result.status === 0 && !parsed.claudeExistsAfterRetry && parsed.conflictAfterRetry === 'legacy', result.stderr || result.stdout);

fs.rmSync(fixture, { recursive: true, force: true });
fs.rmSync(fakeHome, { recursive: true, force: true });

if (failures > 0) process.exit(1);
