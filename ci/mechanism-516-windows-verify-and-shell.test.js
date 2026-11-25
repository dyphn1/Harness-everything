'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VERIFY = path.join(ROOT, 'harness-everything', 'scripts', 'verify-gate.js');
const PACKAGED_POST_TOOL = path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'agy-post-tool.js');
const PACKAGED_STOP = path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'agy-stop.js');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-516-win-'));
const stateHome = path.join(temp, 'state-home');
const originalStateHome = process.env.HARNESS_STATE_HOME;
fs.mkdirSync(stateHome, { recursive: true });
process.env.HARNESS_STATE_HOME = stateHome;

const { isVerificationCommand, detectRoot } = require('../scripts/lib/verification-contract');
const { classifyShell } = require('../hooks/scripts/lib/workflow-isolation');
const { getSessionDir } = require('../plugins/harness-everything/hooks/scripts/lib/harness-state');

function git(cwd, args) {
  const res = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 20000 });
  assert.ifError(res.error);
  assert.strictEqual(res.status, 0, `git ${args.join(' ')} failed: ${res.stderr}`);
  return res.stdout.trim();
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Harness Test']);
  git(dir, ['config', 'user.email', 'harness@example.test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'seed\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'seed']);
  return fs.realpathSync.native(dir);
}

function runScript(scriptPath, payload) {
  const env = { ...process.env, HARNESS_STATE_HOME: stateHome };
  delete env.HARNESS_REQUIRE_VERIFICATION;
  const res = spawnSync(process.execPath, [scriptPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env,
    timeout: 20000,
  });
  assert.ifError(res.error);
  assert.strictEqual(res.status, 0, `${path.basename(scriptPath)} failed: ${res.stderr}`);
  return JSON.parse(res.stdout.trim());
}

try {
  const repo = initRepo(path.join(temp, 'repo'));
  const outside = fs.realpathSync.native(fs.mkdtempSync(path.join(temp, 'outside-')));
  fs.mkdirSync(path.join(repo, 'pkg'), { recursive: true });

  // 1. Windows .cmd wrappers and Node/Docs verifiers
  for (const cmd of [
    'npm.cmd test',
    'npm.cmd run test',
    'npm.cmd run test:consistency',
    'npm.cmd run verify:all',
    'pnpm.cmd test',
    'yarn.cmd lint',
    'bun.cmd run check',
    'node --test ci/mechanism-516-agy-post-tool-exit.test.js',
    'mkdocs build --strict',
    'poetry run mkdocs build --strict',
    'uv run mkdocs build --strict',
    '.venv\\Scripts\\mkdocs build --strict',
    '.venv/bin/mkdocs build --strict',
    'sphinx-build -W docs build',
  ]) {
    assert.strictEqual(isVerificationCommand(cmd, { cwd: repo, root: repo }), true, `must recognize verifier: ${cmd}`);
  }

  for (const cmd of [
    'mkdocs serve',
    'node -e "console.log(1)"',
    'npm.cmd install',
    'npm.cmd run build && rm -rf out',
    'npm.cmd run test:consistency; Remove-Item -Recurse .',
  ]) {
    assert.strictEqual(isVerificationCommand(cmd, { cwd: repo, root: repo }), false, `must reject non-verifier: ${cmd}`);
  }

  // Declared contract matches npm.cmd equivalent only in declared cwd
  fs.mkdirSync(path.join(repo, '.harness'), { recursive: true });
  fs.writeFileSync(path.join(repo, '.harness', 'verify.json'), JSON.stringify({
    version: 1,
    checks: [{ id: 'root-test', run: 'npm test', cwd: '.' }],
  }));
  assert.strictEqual(isVerificationCommand('npm.cmd test', { cwd: repo, root: repo }), true, 'declared npm test matches npm.cmd test');
  assert.strictEqual(isVerificationCommand('npm.cmd test', { cwd: path.join(repo, 'pkg'), root: repo }), false, 'declared npm.cmd test must still respect cwd');
  fs.rmSync(path.join(repo, '.harness'), { recursive: true, force: true });

  // 2. mkdocs.yml detection
  const docsRepo = initRepo(path.join(temp, 'mkdocs-repo'));
  fs.writeFileSync(path.join(docsRepo, 'mkdocs.yml'), 'site_name: Demo\n');
  fs.writeFileSync(path.join(docsRepo, 'pyproject.toml'), '[tool.poetry]\nname = "demo"\n');
  const detected = detectRoot(docsRepo);
  const runs = detected.candidates.map(c => c.run);
  assert.ok(runs.includes('mkdocs build --strict'), `missing mkdocs candidate: ${JSON.stringify(runs)}`);
  assert.ok(runs.includes('poetry run mkdocs build --strict'), `missing poetry mkdocs candidate: ${JSON.stringify(runs)}`);

  const gateOut = spawnSync(process.execPath, [VERIFY, '--json'], { cwd: docsRepo, encoding: 'utf8', timeout: 20000 });
  assert.strictEqual(gateOut.status, 0);
  const gateReport = JSON.parse(gateOut.stdout);
  assert.strictEqual(gateReport.status, 'UNCHECKED_DISCOVERED');
  assert.ok(gateReport.candidates.some(c => c.run === 'mkdocs build --strict'));

  // 3. PowerShell Set-Location prelude
  const posixRepo = repo.replace(/\\/g, '/');
  for (const cmd of [
    `Set-Location "${repo}"; npm.cmd test`,
    `Set-Location '${repo}'; mkdocs build --strict`,
    `Set-Location -Path "${repo}"; npm.cmd run test:consistency`,
    `Set-Location '${posixRepo}'; npm.cmd test`,
    'Set-Location ./pkg; npm.cmd test',
    'Set-Location .; npm.cmd test',
  ]) {
    assert.strictEqual(isVerificationCommand(cmd, { cwd: repo, root: repo }), true, `must unwrap Set-Location prelude: ${cmd}`);
  }
  if (process.platform === 'win32') {
    assert.strictEqual(isVerificationCommand('Set-Location .\\pkg; npm.cmd test', { cwd: repo, root: repo }), true, 'must unwrap Windows relative Set-Location');
  }

  for (const cmd of [
    `Set-Location "${outside}"; npm.cmd test`,
    `Set-Location "${repo}"; npm.cmd test; rm -rf build`,
    `Set-Location "${repo}"; npm.cmd test && rm -rf build`,
    'Set-Location pkg; npm.cmd test',
    'Set-Location "$env:TEMP"; npm.cmd test',
  ]) {
    assert.strictEqual(isVerificationCommand(cmd, { cwd: repo, root: repo }), false, `must reject unsafe Set-Location prelude: ${cmd}`);
  }

  // 4. Read-only PowerShell cmdlets & agy CLI read commands
  for (const cmd of [
    'Get-Command agy',
    'Get-FileHash hooks/scripts/agy-stop.js',
    'Get-ChildItem | Select-Object Name',
    'Get-ChildItem | Sort-Object LastWriteTime | Format-Table Name',
    'agy --version',
    'agy plugin list --json',
    'agy plugin validate --json ./plugins/harness-everything',
  ]) {
    assert.strictEqual(classifyShell(cmd), 'read-only', `must classify as read-only: ${cmd}`);
  }

  assert.strictEqual(classifyShell('Get-ChildItem | ForEach-Object { Remove-Item $_.FullName }'), 'untrusted');
  assert.notStrictEqual(classifyShell('Set-Location C:\\outside; git status'), 'read-only');
  assert.strictEqual(classifyShell('Get-Content a.txt > b.txt'), 'untrusted');

  // 5. End-to-end packaged AGY hooks: read-only PowerShell doesn't trigger false Stop;
  //    Set-Location + npm.cmd verification advances lastVerifyAt and allows Stop.
  const convReadOnly = 'win-readonly-' + Date.now();
  runScript(PACKAGED_POST_TOOL, {
    conversationId: convReadOnly,
    workspacePaths: [repo],
    toolCall: { name: 'run_command', args: { CommandLine: 'Get-ChildItem | Select-Object Name', Cwd: repo } },
  });
  runScript(PACKAGED_POST_TOOL, {
    conversationId: convReadOnly,
    workspacePaths: [repo],
    toolCall: { name: 'run_command', args: { CommandLine: 'agy plugin list --json', Cwd: repo } },
  });
  const handoffReadOnly = JSON.parse(fs.readFileSync(path.join(getSessionDir(repo, convReadOnly), 'handoff-state.json'), 'utf8'));
  assert.ok(!handoffReadOnly.lastEditAt, `read-only PowerShell/agy commands must not set lastEditAt: ${JSON.stringify(handoffReadOnly)}`);
  assert.deepStrictEqual(
    runScript(PACKAGED_STOP, { conversationId: convReadOnly, workspacePaths: [repo], terminationReason: 'NO_TOOL_CALL' }),
    { decision: 'allow' }
  );

  const convEditVerify = 'win-edit-verify-' + Date.now();
  const target = path.join(repo, 'README.md');
  fs.writeFileSync(target, 'edited\n');
  runScript(PACKAGED_POST_TOOL, {
    conversationId: convEditVerify,
    workspacePaths: [repo],
    toolCall: { name: 'write_file', args: { Path: target, Content: 'edited\n' } },
  });
  const afterEdit = JSON.parse(fs.readFileSync(path.join(getSessionDir(repo, convEditVerify), 'handoff-state.json'), 'utf8'));
  // Unconfirmed exitCode on Set-Location + npm.cmd must not bump lastEditAt
  runScript(PACKAGED_POST_TOOL, {
    conversationId: convEditVerify,
    workspacePaths: [repo],
    toolCall: { name: 'run_command', args: { CommandLine: `Set-Location "${repo}"; npm.cmd run test:consistency`, Cwd: repo } },
  });
  const afterUnknown = JSON.parse(fs.readFileSync(path.join(getSessionDir(repo, convEditVerify), 'handoff-state.json'), 'utf8'));
  assert.strictEqual(afterUnknown.lastEditAt, afterEdit.lastEditAt, 'recognized Set-Location + npm.cmd without exitCode must not bump lastEditAt');

  // Confirmed exitCode: 0 advances lastVerifyAt and allows Stop
  runScript(PACKAGED_POST_TOOL, {
    conversationId: convEditVerify,
    workspacePaths: [repo],
    toolCall: { name: 'run_command', args: { CommandLine: `Set-Location "${repo}"; npm.cmd run test:consistency`, Cwd: repo } },
    exitCode: 0,
  });
  const afterPass = JSON.parse(fs.readFileSync(path.join(getSessionDir(repo, convEditVerify), 'handoff-state.json'), 'utf8'));
  assert.ok(afterPass.lastVerifyAt >= afterEdit.lastEditAt, 'exitCode: 0 on Set-Location + npm.cmd must advance lastVerifyAt');
  assert.deepStrictEqual(
    runScript(PACKAGED_STOP, { conversationId: convEditVerify, workspacePaths: [repo], terminationReason: 'NO_TOOL_CALL' }),
    { decision: 'allow' }
  );

  console.log('Windows verification-contract, PowerShell read-only classification, and packaged AGY hook flow verified.');
} finally {
  if (originalStateHome === undefined) delete process.env.HARNESS_STATE_HOME;
  else process.env.HARNESS_STATE_HOME = originalStateHome;
  fs.rmSync(temp, { recursive: true, force: true });
}
