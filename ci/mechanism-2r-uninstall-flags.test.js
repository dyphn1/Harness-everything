const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const helper = require('./test-helper');

console.log('\n[2r] Uninstall CLI flag handling: no silent no-op, combined local+global (issue #48)...');

const repoRoot = path.resolve(__dirname, '..');
const installerPath = path.join(repoRoot, 'scripts', 'installer.js');

function freshWorkspace(prefix) {
  const ws = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  fs.mkdirSync(path.join(ws, '.git')); // pins getWorkspaceRoot() deterministically
  return ws;
}

function run(cwd, args, env) {
  // spawnSync with stdio 'pipe' has no attached TTY - process.stdin.isTTY is
  // undefined, exactly like a piped/non-interactive invocation (npx in CI,
  // some shells, etc.) - the scenario issue #48 is about.
  return spawnSync(process.execPath, [installerPath, ...args], { cwd, env, encoding: 'utf8' });
}

function seedLocalInstall(ws, skillId) {
  fs.mkdirSync(path.join(ws, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(ws, '.claude', 'settings.json'), '{}', 'utf8');
  if (skillId) {
    const skillDir = path.join(ws, '.claude', 'skills', skillId);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: x\nauthor: Miya Daniel\n---\n', 'utf8');
    const manifest = require('../scripts/lib/manifest');
    manifest.recordSkillInstall(manifest.getManifestPath(path.join(ws, '.claude')), require('../package.json').version, skillId, skillDir);
  }
}

function seedGlobalInstall(fakeHome, skillId) {
  fs.mkdirSync(path.join(fakeHome, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(fakeHome, '.claude', 'settings.json'), '{}', 'utf8');
  if (skillId) {
    const skillDir = path.join(fakeHome, '.claude', 'skills', skillId);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.writeFileSync(path.join(skillDir, 'SKILL.md'), '---\nname: x\nauthor: Miya Daniel\n---\n', 'utf8');
    const manifest = require('../scripts/lib/manifest');
    manifest.recordSkillInstall(manifest.getManifestPath(path.join(fakeHome, '.claude')), require('../package.json').version, skillId, skillDir);
  }
}

// --- 1. Bare `uninstall`, no flags, no TTY: must fail loudly, not silently
// claim success while removing nothing. ---
{
  const ws = freshWorkspace('harness-2r-noop-');
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2r-noop-home-'));
  seedLocalInstall(ws, 'dummy-skill');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };

  const res = run(ws, ['uninstall'], env);

  helper.check('2r. bare uninstall with no TTY exits non-zero instead of silently succeeding', res.status !== 0, `status=${res.status} stdout=${res.stdout} stderr=${res.stderr}`);
  helper.check('2r. ...and prints a hint about the flags to pass', /--local|--skills|--global/.test(res.stderr), `stderr=${res.stderr}`);
  helper.check(
    '2r. ...and actually removed nothing (settings.json + skill both still present)',
    fs.existsSync(path.join(ws, '.claude', 'settings.json')) && fs.existsSync(path.join(ws, '.claude', 'skills', 'dummy-skill')),
    'local install was modified despite no flags being passed'
  );

  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
}

// --- 2. `uninstall --local --skills` (no -y): removes exactly local config +
// local skills, in one non-interactive run, no menu. ---
{
  const ws = freshWorkspace('harness-2r-local-');
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2r-local-home-'));
  seedLocalInstall(ws, 'dummy-skill');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };

  const res = run(ws, ['uninstall', '--local', '--skills'], env);

  helper.check('2r. `uninstall --local --skills` exits 0', res.status === 0, `status=${res.status} stdout=${res.stdout} stderr=${res.stderr}`);
  helper.check(
    '2r. ...and actually removed the local skill',
    !fs.existsSync(path.join(ws, '.claude', 'skills', 'dummy-skill')),
    `skill dir still exists, stdout=${res.stdout}`
  );

  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
}

// --- 3. `uninstall --local --global --skills` in ONE run removes both
// scopes together (issue #48 point 3) - no need for two separate invocations. ---
{
  const ws = freshWorkspace('harness-2r-both-');
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2r-both-home-'));
  seedLocalInstall(ws, 'local-skill');
  seedGlobalInstall(fakeHome, 'global-skill');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };

  const res = run(ws, ['uninstall', '--local', '--global', '--skills'], env);

  helper.check('2r. `uninstall --local --global --skills` exits 0', res.status === 0, `status=${res.status} stdout=${res.stdout} stderr=${res.stderr}`);
  helper.check(
    '2r. ...local skill removed',
    !fs.existsSync(path.join(ws, '.claude', 'skills', 'local-skill')),
    `local skill still exists, stdout=${res.stdout}`
  );
  helper.check(
    '2r. ...AND global skill removed in the SAME run',
    !fs.existsSync(path.join(fakeHome, '.claude', 'skills', 'global-skill')),
    `global skill still exists, stdout=${res.stdout}`
  );

  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
}

// --- 4. Point 2 regression: a second bare `uninstall --local` after a first
// run that intentionally left skills in place still finds and can remove
// them (was previously masked by the same no-op bug as scenario 1). ---
{
  const ws = freshWorkspace('harness-2r-second-run-');
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-2r-second-run-home-'));
  seedLocalInstall(ws, 'dummy-skill');
  const env = { ...process.env, HOME: fakeHome, USERPROFILE: fakeHome };

  const first = run(ws, ['uninstall', '--local'], env); // config only, skills intentionally kept
  helper.check('2r. first run (--local only) exits 0', first.status === 0, `status=${first.status} stdout=${first.stdout}`);
  helper.check(
    '2r. ...and leaves the skill in place as requested',
    fs.existsSync(path.join(ws, '.claude', 'skills', 'dummy-skill')),
    'skill was removed even though --skills was not passed'
  );

  const second = run(ws, ['uninstall', '--skills'], env);
  helper.check('2r. second run (--skills) exits 0', second.status === 0, `status=${second.status} stdout=${second.stdout} stderr=${second.stderr}`);
  helper.check(
    '2r. ...and this time removes the skill left over from the first run',
    !fs.existsSync(path.join(ws, '.claude', 'skills', 'dummy-skill')),
    `skill still exists after second run, stdout=${second.stdout}`
  );

  fs.rmSync(ws, { recursive: true, force: true });
  fs.rmSync(fakeHome, { recursive: true, force: true });
}

helper.finish();
