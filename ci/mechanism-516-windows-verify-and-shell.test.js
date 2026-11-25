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

const { isVerificationCommand, detectRoot, parseCwdPrelude } = require('../scripts/lib/verification-contract');
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

function runPowerShell(cwd, command) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const res = spawnSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', command], {
    cwd,
    encoding: 'utf8',
    env,
    timeout: 20000,
  });
  assert.ifError(res.error);
  return res;
}

function readHandoff(repo, conversationId) {
  return JSON.parse(fs.readFileSync(path.join(getSessionDir(repo, conversationId), 'handoff-state.json'), 'utf8'));
}

function postShell(repo, conversationId, command, exitCode, cwd = repo) {
  runScript(PACKAGED_POST_TOOL, {
    conversationId,
    workspacePaths: [repo],
    toolCall: { name: 'run_command', args: { CommandLine: command, Cwd: cwd } },
    exitCode,
  });
  return readHandoff(repo, conversationId);
}

try {
  const repo = initRepo(path.join(temp, 'repo'));
  const outside = fs.realpathSync.native(fs.mkdtempSync(path.join(temp, 'outside-')));
  fs.mkdirSync(path.join(repo, 'pkg'), { recursive: true });
  fs.mkdirSync(path.join(repo, 'pkg[1]'));
  fs.mkdirSync(path.join(repo, 'pkg1'));
  const infoQueries = [
    'node --test --help',
    'node --test "--version"',
    'node --test -v',
    'mkdocs build --help',
    'poetry run mkdocs build --strict -h',
    'uv run mkdocs build --"help"',
    '.venv\\Scripts\\mkdocs.exe build --help',
    '.venv/bin/mkdocs build --help',
    'sphinx-build --version',
    'sphinx-build -M help docs build',
    '.venv\\Scripts\\sphinx-build.exe -V',
  ];

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
    'node --test --test-name-pattern "mentions --help in a test name"',
    'mkdocs build --strict',
    'poetry run mkdocs build --strict',
    'uv run mkdocs build --strict',
    '.venv\\Scripts\\mkdocs build --strict',
    '.venv/bin/mkdocs build --strict',
    'sphinx-build -W docs build',
    'sphinx-build -v docs build',
    'sphinx-build -M html docs build',
  ]) {
    assert.strictEqual(isVerificationCommand(cmd, { cwd: repo, root: repo }), true, `must recognize verifier: ${cmd}`);
  }

  for (const cmd of [
    ...infoQueries,
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
  for (const prefix of ['mkdocs build --strict', 'poetry run mkdocs build --strict']) {
    assert.strictEqual(isVerificationCommand(prefix, { cwd: docsRepo, root: docsRepo }), true);
    assert.strictEqual(isVerificationCommand(prefix + ' --help', { cwd: docsRepo, root: docsRepo }), false);
    assert.ok(!postShell(docsRepo, 'docs-help', prefix + ' --help', 0).lastVerifyAt);
  }

  const gateOut = spawnSync(process.execPath, [VERIFY, '--json'], { cwd: docsRepo, encoding: 'utf8', timeout: 20000 });
  assert.strictEqual(gateOut.status, 0);
  const gateReport = JSON.parse(gateOut.stdout);
  assert.strictEqual(gateReport.status, 'UNCHECKED_DISCOVERED');
  assert.ok(gateReport.candidates.some(c => c.run === 'mkdocs build --strict'));

  // 3. PowerShell Set-Location prelude
  const changeLocation = dir => `Set-Location -LiteralPath '${dir}' -ErrorAction Stop`;
  const testCommand = 'node --test verify.test.js';
  const verifyInPkg = `${changeLocation('./pkg')} && ${testCommand}`;
  const failedPrelude = `${changeLocation('./missing')} && ${testCommand}`;
  const unconditionalPrelude = `Set-Location -Path './missing'; ${testCommand}`;
  const wildcardPrelude = `Set-Location -Path './pkg[1]' -ErrorAction Stop && ${testCommand}`;
  const literalBracketsPrelude = `${changeLocation('./pkg[1]')} && ${testCommand}`;
  const posixRepo = repo.replace(/\\/g, '/');
  fs.mkdirSync(path.join(repo, '.harness'));
  const pkgContract = JSON.stringify({
    version: 1,
    checks: [{ id: 'pkg-test', run: testCommand, cwd: 'pkg' }],
  });
  const contractPath = path.join(repo, '.harness', 'verify.json');
  fs.writeFileSync(contractPath, pkgContract);
  for (const cmd of [
    verifyInPkg,
    `${changeLocation(path.join(repo, 'pkg'))} && ${testCommand}`,
    `${changeLocation(posixRepo + '/pkg')} && ${testCommand}`,
    `cd ./pkg && ${testCommand}`,
  ]) {
    assert.strictEqual(isVerificationCommand(cmd, { cwd: repo, root: repo }), true, `must unwrap matching prelude: ${cmd}`);
  }
  if (process.platform === 'win32') {
    assert.strictEqual(isVerificationCommand(`${changeLocation('.\\pkg')} && ${testCommand}`, { cwd: repo, root: repo }), true);
  }

  let successfulExit = 0;
  let failedExit = 1;
  let wildcardExit = 0;
  if (process.platform === 'win32' || process.env.HARNESS_TEST_PWSH === '1') {
    fs.writeFileSync(path.join(repo, 'verify.test.js'), 'require("node:test")("root verifier", () => {});\n');
    fs.writeFileSync(path.join(repo, 'pkg', 'verify.test.js'), 'require("node:test")("package verifier", () => {});\n');
    fs.writeFileSync(path.join(repo, 'pkg1', 'verify.test.js'), 'require("node:test")("wildcard verifier", () => {});\n');
    fs.writeFileSync(path.join(repo, 'pkg[1]', 'verify.test.js'), 'require("node:test")("literal verifier", () => {});\n');

    const success = runPowerShell(repo, verifyInPkg);
    assert.strictEqual(success.status, 0, success.stderr);
    assert.match(success.stdout, /package verifier/);
    successfulExit = success.status;

    const failure = runPowerShell(repo, failedPrelude);
    assert.strictEqual(failure.status, 1, failure.stderr);
    assert.doesNotMatch(failure.stdout, /verifier/);
    failedExit = failure.status;

    const unconditional = runPowerShell(repo, unconditionalPrelude);
    assert.strictEqual(unconditional.status, 0, unconditional.stderr);
    assert.match(unconditional.stdout, /root verifier/);

    const wildcard = runPowerShell(repo, wildcardPrelude);
    assert.strictEqual(wildcard.status, 0, wildcard.stderr);
    assert.match(wildcard.stdout, /wildcard verifier/);
    wildcardExit = wildcard.status;

    const literal = runPowerShell(repo, literalBracketsPrelude);
    assert.strictEqual(literal.status, 0, literal.stderr);
    assert.match(literal.stdout, /literal verifier/);
  }

  for (const cmd of [
    failedPrelude,
    unconditionalPrelude,
    `Set-Location -Path './pkg' -ErrorAction Stop && ${testCommand}`,
    `Set-Location -LiteralPath './pkg' && ${testCommand}`,
    `${changeLocation('./pkg')}; ${testCommand}`,
    literalBracketsPrelude,
    wildcardPrelude,
    `${changeLocation('./pkg1')} && ${testCommand}`,
    `${changeLocation('./pkg1/../pkg')} && ${testCommand}`,
    `${changeLocation('FileSystem::./pkg')} && ${testCommand}`,
    `${changeLocation(outside)} && ${testCommand}`,
    `${changeLocation('./pkg')} && ${testCommand} && echo done`,
  ]) {
    assert.strictEqual(isVerificationCommand(cmd, { cwd: repo, root: repo }), false, `must reject unsafe Set-Location prelude: ${cmd}`);
    assert.ok(!postShell(repo, 'rejected-prelude', cmd, 0).lastVerifyAt, `must not credit prelude: ${cmd}`);
  }
  assert.ok(!postShell(repo, 'failed-prelude', failedPrelude, failedExit).lastVerifyAt);
  assert.strictEqual(parseCwdPrelude(`${changeLocation(outside)} && ${testCommand}`, { cwd: repo, root: repo }), null);
  assert.ok(!postShell(repo, 'wrong-tool-cwd', testCommand, 0).lastVerifyAt);
  assert.ok(postShell(repo, 'tool-cwd', testCommand, 0, path.join(repo, 'pkg')).lastVerifyAt);
  // The wildcard fixture is checked against the directory the literal path
  // would credit, so a contract mismatch cannot mask incorrect recognition.
  fs.writeFileSync(contractPath, JSON.stringify({
    version: 1,
    checks: [{ id: 'literal-test', run: testCommand, cwd: 'pkg[1]' }],
  }));
  for (const command of [wildcardPrelude, literalBracketsPrelude]) {
    assert.ok(!postShell(repo, 'wildcard-prelude', command, wildcardExit).lastVerifyAt);
  }
  fs.rmSync(contractPath);
  for (const cmd of infoQueries) {
    assert.ok(!postShell(repo, 'verifier-info', cmd, 0).lastVerifyAt, `must not credit info query: ${cmd}`);
  }
  fs.writeFileSync(contractPath, pkgContract);

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
  //    A successful, contained Set-Location verifier allows Stop.
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
  const afterEdit = readHandoff(repo, convEditVerify);
  for (const exitCode of [undefined, '0']) {
    const unverified = postShell(repo, convEditVerify, verifyInPkg, exitCode);
    assert.strictEqual(unverified.lastEditAt, afterEdit.lastEditAt);
    assert.strictEqual(unverified.lastVerifyAt, afterEdit.lastVerifyAt);
  }
  assert.strictEqual(postShell(repo, convEditVerify, verifyInPkg, 1).lastVerifyAt, afterEdit.lastVerifyAt);
  const afterPass = postShell(repo, convEditVerify, verifyInPkg, successfulExit);
  assert.ok(afterPass.lastVerifyAt >= afterEdit.lastEditAt, 'confirmed Set-Location verifier must advance lastVerifyAt');
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
