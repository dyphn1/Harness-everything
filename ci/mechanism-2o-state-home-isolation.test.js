const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const helper = require('./test-helper');

console.log('\n[2o] State-home isolation: runtime state never scatters into cwd (issue #42)...');

const repoRoot = helper.root;
let failures = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`✅ ${name}`);
  } else {
    console.error(`❌ ${name}`);
    if (detail) console.error(`   ${detail}`);
    failures++;
  }
}

// Everything below runs with HOME/USERPROFILE redirected to a throwaway
// fake home, so this test can never touch (or be polluted by) the real
// developer's ~/.agents/harness-everything - same isolation approach as
// mechanism-2n-opencode-plugin.test.js.
const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2o-home-'));
const stateHome = path.join(fakeHome, '.agents', 'harness-everything');
const baseEnv = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };
delete baseEnv.HARNESS_STATE_HOME;
delete baseEnv.CLAUDE; // let platform detection run its own course - irrelevant post-#42

function listFilesRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFilesRecursive(p));
    else out.push(p);
  }
  return out;
}

function listAllRecursive(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    out.push(p);
    if (entry.isDirectory()) out.push(...listAllRecursive(p));
  }
  return out;
}

function run(cwd, args, env) {
  return spawnSync(process.execPath, args, { cwd, env: env || baseEnv, encoding: 'utf8' });
}

// --- Fixture A: a directory with NO .git ancestor anywhere - the exact
// repro from the issue (a test fixture / scratch dir a script gets `cd`ed
// into). Runtime state must land under the global home, never here, git
// repo or not.
const noGitFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2o-nogit-'));
const nestedNoGit = path.join(noGitFixture, 'fixtures', 'some-test-dir');
fs.mkdirSync(nestedNoGit, { recursive: true });

{
  const inline = `
    const { getSessionDir } = require(${JSON.stringify(path.join(repoRoot, 'hooks', 'scripts', 'lib', 'harness-state.js'))});
    getSessionDir(undefined, 'issue42-repro-session');
  `;
  const res = run(nestedNoGit, ['-e', inline]);
  check(
    '2o. harness-state.js creates zero files in a non-git nested dir',
    res.status === 0 && listFilesRecursive(nestedNoGit).length === 0,
    `exit=${res.status} stderr=${res.stderr} files=${JSON.stringify(listFilesRecursive(nestedNoGit))}`
  );
  check(
    '2o. ...and the session dir lands under the global state home instead',
    fs.existsSync(path.join(stateHome, 'workspaces')) &&
      listAllRecursive(stateHome).some(f => f.includes('issue42-repro-session')),
    `nothing under ${stateHome}: ${JSON.stringify(listAllRecursive(stateHome))}`
  );
}

{
  const modelSelector = path.join(repoRoot, 'fable-mode', 'scripts', 'model-selector.js');
  const res = run(nestedNoGit, [
    modelSelector, '--requested', 'haiku', '--available', 'haiku,sonnet',
    '--available-agents', 'fable-worker-haiku', '--stage-brief', 'x', '--pass-condition', 'y',
    '--verification-command', 'npm test', '--verifier-result', 'pending'
  ]);
  check(
    '2o. model-selector.js (zero-walk before the fix) creates zero files in a non-git nested dir',
    res.status === 0 && listFilesRecursive(nestedNoGit).length === 0,
    `exit=${res.status} stderr=${res.stderr} files=${JSON.stringify(listFilesRecursive(nestedNoGit))}`
  );
  check(
    '2o. ...and its audit log lands under the same global state/ stream as harness-state.js',
    listFilesRecursive(stateHome).some(f => f.endsWith(path.join('fable-mode', 'audit.jsonl'))),
    `no fable-mode/audit.jsonl under ${stateHome}`
  );
}

fs.rmSync(noGitFixture, { recursive: true, force: true });

// --- Fixture B: a real git repo with a nested subdirectory that has no
// .git of its own. Scripts that stay in-repo by design (multi-agent-
// workspace) must still resolve to the REPO ROOT when invoked from the
// nested dir without an explicit --workspace, not scatter into the nested
// dir itself.
const gitFixture = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2o-git-'));
spawnSync('git', ['init', '--quiet'], { cwd: gitFixture });
const nestedInGit = path.join(gitFixture, 'packages', 'nested');
fs.mkdirSync(nestedInGit, { recursive: true });

{
  const scaffold = path.join(repoRoot, 'multi-agent-workspace', 'scripts', 'scaffold.js');
  const res = run(nestedInGit, [scaffold]);
  check(
    '2o. scaffold.js with no --workspace resolves to the repo root from a nested dir',
    res.status === 0 && fs.existsSync(path.join(gitFixture, '.harness', 'multi-agent', 'manifest.json')),
    `exit=${res.status} stderr=${res.stderr}`
  );
  check(
    '2o. ...and does not scatter .harness/ into the nested invocation directory',
    !fs.existsSync(path.join(nestedInGit, '.harness')),
    `.harness/ was created inside ${nestedInGit}`
  );
}

{
  const inline = `
    const { getStateRoot, getWorkspaceRoot } = require(${JSON.stringify(path.join(repoRoot, 'hooks', 'scripts', 'lib', 'harness-state.js'))});
    console.log(JSON.stringify({ workspaceRoot: getWorkspaceRoot(), stateRoot: getStateRoot() }));
  `;
  const res = run(nestedInGit, ['-e', inline]);
  let parsed = null;
  try { parsed = JSON.parse(res.stdout); } catch (e) { /* left null */ }
  check(
    '2o. harness-state.js walks up to the repo root from a nested in-repo dir, not the nested dir',
    !!parsed && path.resolve(parsed.workspaceRoot) === path.resolve(gitFixture),
    `got ${res.stdout || res.stderr}`
  );
  check(
    '2o. ...and its state dir is under the global home, not under the git fixture at all',
    !!parsed && !path.resolve(parsed.stateRoot).startsWith(path.resolve(gitFixture)),
    `stateRoot=${parsed && parsed.stateRoot}`
  );
}

// --- Migration: state a pre-#42 install already scattered into a
// workspace gets moved into the new global location, once, and the old
// location is removed afterward.
{
  const legacyDir = path.join(gitFixture, '.claude', 'harness-everything', 'state');
  fs.mkdirSync(path.join(legacyDir, 'sessions', 'legacy-session'), { recursive: true });
  fs.writeFileSync(path.join(legacyDir, 'sessions', 'legacy-session', 'handoff-state.json'), '{"status":"idle"}');

  const inline = `
    const { getStateRoot } = require(${JSON.stringify(path.join(repoRoot, 'hooks', 'scripts', 'lib', 'harness-state.js'))});
    console.log(getStateRoot());
  `;
  const res = run(gitFixture, ['-e', inline], { ...baseEnv, CLAUDE: '1' });
  const newStateRoot = (res.stdout || '').trim();

  check(
    '2o. pre-existing scattered state migrates into the new global location',
    newStateRoot &&
      fs.existsSync(path.join(newStateRoot, 'sessions', 'legacy-session', 'handoff-state.json')) &&
      fs.existsSync(path.join(newStateRoot, '.migrated-from')),
    `exit=${res.status} stderr=${res.stderr} newStateRoot=${newStateRoot}`
  );
  check(
    '2o. ...and the old in-repo location is gone afterward',
    !fs.existsSync(legacyDir),
    `${legacyDir} still exists`
  );
}

fs.rmSync(gitFixture, { recursive: true, force: true });
fs.rmSync(fakeHome, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
process.exit(0);
