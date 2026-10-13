'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const VERIFY = path.join(ROOT, 'harness-everything', 'scripts', 'verify-gate.js');
const { isVerificationShell } = require('../hooks/scripts/lib/workflow-isolation');
const { hasCommitHook, hookIsRunnable } = require('../scripts/lib/verification-contract');
const { getWorkspaceKey } = require('../scripts/lib/workspace');

function run(command, args, cwd, options = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, HARNESS_SKIP_PROJECT_CHECKS: '', ...(options.env || {}) },
    timeout: options.timeout || 30000,
  });
  if (!options.allowFailure && result.status !== 0) {
    throw new Error([
      `${command} ${args.join(' ')} failed with ${result.status}`,
      result.stdout,
      result.stderr,
    ].filter(Boolean).join('\n'));
  }
  return result;
}

function git(cwd, args, options = {}) {
  return run('git', args, cwd, options);
}

function initRepo(dir) {
  fs.mkdirSync(dir, { recursive: true });
  git(dir, ['init', '-b', 'main']);
  git(dir, ['config', 'user.name', 'Harness Verify Test']);
  git(dir, ['config', 'user.email', 'verify@example.invalid']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'fixture\n');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-m', 'seed']);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

function invokeGate(cwd, options = {}) {
  const args = options.json === false ? [] : ['--json'];
  const result = run(process.execPath, [VERIFY, ...args], cwd, {
    allowFailure: true,
    env: options.env || {},
    timeout: options.timeout || 30000,
  });
  if (options.json === false) return result;
  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch (error) {
    throw new Error(`verify-gate did not emit JSON (exit=${result.status})\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
  }
  return { ...result, report };
}

function packageScript(body) {
  return {
    name: 'verify-fixture',
    version: '1.0.0',
    private: true,
    scripts: body,
  };
}

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-verify-contract-'));

assert.strictEqual(hookIsRunnable({ isFile: () => true, mode: 0o100755 }, 'linux'), true);
assert.strictEqual(hookIsRunnable({ isFile: () => true, mode: 0o100644 }, 'linux'), false);
assert.strictEqual(hookIsRunnable({ isFile: () => true, mode: 0o100644 }, 'win32'), true);
assert.strictEqual(hookIsRunnable({ isFile: () => false, mode: 0o100755 }, 'linux'), false);

try {
  // Taxonomy: truly no checks is distinct from discovered-but-unrun.
  const empty = path.join(temp, 'empty');
  initRepo(empty);
  let result = invokeGate(empty);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.report.status, 'UNCHECKED_NO_CHECKS');
  assert.deepStrictEqual(result.report.candidates, []);
  const emptyHuman = invokeGate(empty, { json: false });
  assert.match(emptyHuman.stdout + emptyHuman.stderr, /PROHIBITED: Do NOT cite this run as proof/i);

  // npm compatibility: placeholder is no check; lint/test auto-run; failure blocks.
  const npmRepo = path.join(temp, 'npm');
  initRepo(npmRepo);
  writeJson(path.join(npmRepo, 'package.json'), packageScript({
    test: 'echo "Error: no test specified" && exit 1',
  }));
  result = invokeGate(npmRepo);
  assert.strictEqual(result.report.status, 'UNCHECKED_NO_CHECKS');

  writeJson(path.join(npmRepo, 'package.json'), packageScript({
    lint: 'node -e "process.exit(0)"',
    test: 'node -e "process.exit(0)"',
  }));
  result = invokeGate(npmRepo);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.report.status, 'PASSED');
  assert.strictEqual(result.report.checks.length, 2);
  assert.ok(result.report.checks.every(check => check.exitCode === 0));

  writeJson(path.join(npmRepo, 'package.json'), packageScript({
    test: 'node -e "process.exit(9)"',
  }));
  result = invokeGate(npmRepo);
  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.report.status, 'FAILED');
  assert.strictEqual(result.report.checks[0].exitCode, 9);

  fs.writeFileSync(path.join(npmRepo, 'package.json'), '{ invalid json');
  result = invokeGate(npmRepo);
  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.report.status, 'FAILED');
  assert.match(result.report.reason, /package\.json/i);

  fs.writeFileSync(path.join(npmRepo, '.verify-fail.tmp'), 'fail');
  result = invokeGate(npmRepo);
  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.report.status, 'FAILED');
  fs.rmSync(path.join(npmRepo, '.verify-fail.tmp'));

  result = invokeGate(npmRepo, { env: { HARNESS_SKIP_PROJECT_CHECKS: '1' } });
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.report.status, 'SKIPPED');

  // Read-only discovery: candidates are listed but never executed.
  const detected = path.join(temp, 'detected');
  initRepo(detected);
  fs.writeFileSync(path.join(detected, 'sentinel.js'), 'require("fs").writeFileSync("RAN", "bad")\n');
  fs.writeFileSync(path.join(detected, 'Makefile'), 'test:\n\tnode sentinel.js\ncheck:\n\t@echo check\n');
  fs.writeFileSync(path.join(detected, 'justfile'), 'ci:\n    node sentinel.js\n');
  fs.writeFileSync(path.join(detected, '.pre-commit-config.yaml'), 'repos: []\n');
  fs.writeFileSync(path.join(detected, 'pyproject.toml'), '[tool.pytest.ini_options]\naddopts = "-q"\n[tool.ruff]\nline-length = 100\n');
  fs.writeFileSync(path.join(detected, 'tox.ini'), '[tox]\nenvlist = py\n');
  fs.writeFileSync(path.join(detected, 'noxfile.py'), '# nox fixture\n');
  fs.writeFileSync(path.join(detected, 'Cargo.toml'), '[package]\nname="x"\nversion="0.1.0"\n');
  fs.writeFileSync(path.join(detected, 'go.mod'), 'module example.invalid/x\n\ngo 1.22\n');
  result = invokeGate(detected);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.report.status, 'UNCHECKED_DISCOVERED');
  const candidateRuns = result.report.candidates.map(candidate => candidate.run);
  for (const command of [
    'pre-commit run --all-files',
    'make test',
    'make check',
    'just ci',
    'pytest',
    'ruff check .',
    'tox',
    'nox',
    'cargo test',
    'go test ./...',
  ]) assert.ok(candidateRuns.includes(command), `missing candidate: ${command}\n${JSON.stringify(result.report.candidates)}`);
  assert.ok(!fs.existsSync(path.join(detected, 'RAN')), 'detected commands must not run');

  // package check/typecheck/verify are detected but not auto-run.
  writeJson(path.join(detected, 'package.json'), packageScript({
    test: 'node -e "process.exit(0)"',
    check: 'node sentinel.js',
    typecheck: 'node sentinel.js',
    verify: 'node sentinel.js',
  }));
  result = invokeGate(detected);
  assert.strictEqual(result.report.status, 'UNCHECKED_DISCOVERED');
  assert.ok(result.report.checks.some(check => / run test$/.test(check.run)));
  assert.ok(result.report.candidates.some(candidate => / run check$/.test(candidate.run)));
  assert.ok(!fs.existsSync(path.join(detected, 'RAN')));

  // Explicit contract is authoritative and executable.
  const contracted = path.join(temp, 'contracted');
  initRepo(contracted);
  writeJson(path.join(contracted, 'package.json'), packageScript({
    test: 'node -e "process.exit(13)"',
  }));
  writeJson(path.join(contracted, '.harness', 'verify.json'), {
    version: 1,
    roots: ['.'],
    checks: [{
      id: 'contract-pass',
      run: 'node -e "if(process.env.HARNESS_SKIP_PROJECT_CHECKS!==\'1\') process.exit(7)"',
      cwd: '.',
      timeoutSec: 10,
    }],
  });
  result = invokeGate(contracted);
  assert.strictEqual(result.status, 0);
  assert.strictEqual(result.report.status, 'PASSED');
  assert.strictEqual(result.report.checks.length, 1, 'package.json must be ignored when contract exists');
  assert.strictEqual(result.report.checks[0].id, 'contract-pass');

  writeJson(path.join(contracted, '.harness', 'verify.json'), {
    version: 1,
    checks: [{ id: 'contract-fail', run: 'node -e "process.exit(4)"', cwd: '.' }],
  });
  result = invokeGate(contracted);
  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.report.status, 'FAILED');
  assert.strictEqual(result.report.checks[0].id, 'contract-fail');
  assert.strictEqual(result.report.checks[0].exitCode, 4);

  writeJson(path.join(contracted, '.harness', 'verify.json'), {
    version: 1,
    checks: [{ id: 'timeout', run: 'node -e "setTimeout(()=>{}, 5000)"', timeoutSec: 1 }],
  });
  result = invokeGate(contracted, { timeout: 10000 });
  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.report.status, 'FAILED');
  assert.match(result.report.reason, /timeout/i);

  fs.writeFileSync(path.join(contracted, '.harness', 'verify.json'), '{ bad');
  result = invokeGate(contracted);
  assert.strictEqual(result.status, 1);
  assert.match(result.report.reason, /verify\.json/i);

  writeJson(path.join(contracted, '.harness', 'verify.json'), {
    version: 1,
    unknown: true,
    checks: [{ id: 'x', run: 'node -e "process.exit(0)"' }],
  });
  result = invokeGate(contracted);
  assert.strictEqual(result.status, 1);
  assert.match(result.report.reason, /unknown/i);

  writeJson(path.join(contracted, '.harness', 'verify.json'), {
    version: 1,
    roots: ['..'],
    checks: [{ id: 'escape', run: 'node -e "process.exit(0)"' }],
  });
  result = invokeGate(contracted);
  assert.strictEqual(result.status, 1);
  assert.match(result.report.reason, /inside|escape|root/i);

  // Multi-root contract reports every root and applies worst-root status.
  fs.mkdirSync(path.join(contracted, 'sub', 'a'), { recursive: true });
  fs.mkdirSync(path.join(contracted, 'sub', 'b'), { recursive: true });
  writeJson(path.join(contracted, '.harness', 'verify.json'), {
    version: 1,
    roots: ['.', 'sub/a', 'sub/b'],
    checks: [
      { id: 'root', run: 'node -e "process.exit(0)"', cwd: '.' },
      { id: 'a', run: 'node -e "process.exit(0)"', cwd: 'sub/a' },
      { id: 'b', run: 'node -e "process.exit(0)"', cwd: 'sub/b' },
    ],
  });
  result = invokeGate(contracted);
  assert.strictEqual(result.report.status, 'PASSED');
  assert.strictEqual(result.report.roots.length, 3);
  assert.ok(result.report.roots.every(root => root.status === 'PASSED'));

  writeJson(path.join(contracted, '.harness', 'verify.json'), {
    version: 1,
    roots: ['.', 'sub/a', 'sub/b'],
    checks: [
      { id: 'root', run: 'node -e "process.exit(0)"', cwd: '.' },
      { id: 'a', run: 'node -e "process.exit(8)"', cwd: 'sub/a' },
      { id: 'b', run: 'node -e "process.exit(0)"', cwd: 'sub/b' },
    ],
  });
  result = invokeGate(contracted);
  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.report.status, 'FAILED');
  assert.strictEqual(result.report.roots.find(root => /sub[\\/]a$/.test(root.path)).status, 'FAILED');

  // No-contract multi-root discovery enumerates initialized submodules.
  const childA = path.join(temp, 'child-a');
  const childB = path.join(temp, 'child-b');
  for (const child of [childA, childB]) {
    initRepo(child);
    writeJson(path.join(child, 'package.json'), packageScript({ test: 'node -e "process.exit(0)"' }));
    git(child, ['add', 'package.json']);
    git(child, ['commit', '-m', 'add passing test']);
  }
  const multi = path.join(temp, 'multi');
  initRepo(multi);
  writeJson(path.join(multi, 'package.json'), packageScript({ test: 'node -e "process.exit(0)"' }));
  git(multi, ['add', 'package.json']);
  git(multi, ['commit', '-m', 'parent test']);
  git(multi, ['-c', 'protocol.file.allow=always', 'submodule', 'add', childA, 'sub/a']);
  git(multi, ['-c', 'protocol.file.allow=always', 'submodule', 'add', childB, 'sub/b']);
  git(multi, ['commit', '-am', 'add submodules']);
  result = invokeGate(multi);
  assert.strictEqual(result.report.status, 'PASSED');
  assert.strictEqual(result.report.roots.length, 3);

  writeJson(path.join(multi, 'sub', 'b', 'package.json'), packageScript({ test: 'node -e "process.exit(6)"' }));
  result = invokeGate(multi);
  assert.strictEqual(result.status, 1);
  assert.strictEqual(result.report.status, 'FAILED');
  assert.strictEqual(result.report.roots.find(root => /sub[\\/]b$/.test(root.path)).status, 'FAILED');

  // Hook-side recognition uses the same project signals and contract.
  const classifyRepo = path.join(temp, 'classify');
  initRepo(classifyRepo);
  fs.writeFileSync(path.join(classifyRepo, '.pre-commit-config.yaml'), 'repos: []\n');
  fs.writeFileSync(path.join(classifyRepo, 'Makefile'), 'test:\n\t@echo ok\n');
  fs.writeFileSync(path.join(classifyRepo, 'justfile'), 'ci:\n    @echo ok\n');
  fs.writeFileSync(path.join(classifyRepo, 'tox.ini'), '[tox]\nenvlist=py\n');
  fs.writeFileSync(path.join(classifyRepo, 'Cargo.toml'), '[package]\nname="x"\nversion="0.1.0"\n');
  fs.writeFileSync(path.join(classifyRepo, 'go.mod'), 'module example.invalid/x\n\ngo 1.22\n');
  fs.writeFileSync(path.join(classifyRepo, 'pyproject.toml'), '[tool.pytest.ini_options]\naddopts="-q"\n');
  writeJson(path.join(classifyRepo, '.harness', 'verify.json'), {
    version: 1,
    checks: [
      { id: 'precommit', run: 'pre-commit run --all-files' },
      { id: 'e2e', run: 'bash scripts/e2e.sh' },
    ],
  });
  fs.mkdirSync(path.join(classifyRepo, '.git', 'hooks'), { recursive: true });
  const preCommitHook = path.join(classifyRepo, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(preCommitHook, '#!/bin/sh\nexit 0\n');
  assert.strictEqual(hasCommitHook(classifyRepo, 'linux'), false, 'a non-executable POSIX hook must not count as verification');
  if (process.platform !== 'win32') fs.chmodSync(preCommitHook, 0o755);

  assert.strictEqual(isVerificationShell('pre-commit run --all-files', { cwd: classifyRepo }), true);
  assert.strictEqual(isVerificationShell('bash scripts/e2e.sh', { cwd: classifyRepo }), true);
  assert.strictEqual(isVerificationShell('git commit -m x', { cwd: classifyRepo }), true);
  assert.strictEqual(isVerificationShell('git commit --no-verify -m x', { cwd: classifyRepo }), false);
  assert.strictEqual(isVerificationShell('git commit -n -m x', { cwd: classifyRepo }), false);
  assert.strictEqual(isVerificationShell('git commit -an -m x', { cwd: classifyRepo }), false, 'combined -n must still bypass hooks');
  if (process.platform !== 'win32') {
    fs.chmodSync(preCommitHook, 0o644);
    assert.strictEqual(isVerificationShell('git commit -m x', { cwd: classifyRepo }), false, 'a non-executable POSIX hook cannot verify a commit');
    fs.chmodSync(preCommitHook, 0o755);
  }

  // An invalid authoritative contract must fail closed in the hook classifier too.
  // The verify gate reports FAILED here, so legacy command matching must not
  // silently manufacture lastVerifyAt evidence from the same workspace.
  fs.writeFileSync(path.join(classifyRepo, '.harness', 'verify.json'), '{ broken');
  assert.strictEqual(isVerificationShell('npm test', { cwd: classifyRepo }), false, 'invalid contract must suppress legacy verifier fallback');
  assert.strictEqual(isVerificationShell('pre-commit run --all-files', { cwd: classifyRepo }), false, 'invalid contract must suppress detector-based evidence');

  fs.rmSync(path.join(classifyRepo, '.harness', 'verify.json'));
  assert.strictEqual(isVerificationShell('git commit -m x', { cwd: classifyRepo }), false, 'commit is not full verification without a declared hook contract');
  assert.strictEqual(isVerificationShell('pre-commit run --all-files', { cwd: classifyRepo }), true);
  assert.strictEqual(isVerificationShell('make test', { cwd: classifyRepo }), true);
  assert.strictEqual(isVerificationShell('just ci', { cwd: classifyRepo }), true);
  assert.strictEqual(isVerificationShell('tox', { cwd: classifyRepo }), true);
  assert.strictEqual(isVerificationShell('cargo test', { cwd: classifyRepo }), true);
  assert.strictEqual(isVerificationShell('go test ./...', { cwd: classifyRepo }), true);
  assert.strictEqual(isVerificationShell('uv run pytest', { cwd: classifyRepo }), true);
  assert.strictEqual(isVerificationShell('npm run build', { cwd: classifyRepo }), true, 'legacy build evidence remains recognized without a contract');
  assert.strictEqual(isVerificationShell('npx tsc --noEmit', { cwd: classifyRepo }), true, 'legacy typecheck evidence remains recognized without a contract');
  assert.strictEqual(isVerificationShell('echo test', { cwd: classifyRepo }), false, 'plain words must not become verification evidence');

  // Hook evidence: successful declared pre-commit verification after an edit
  // updates lastVerifyAt, so Stop does not emit a stale verification reminder.
  writeJson(path.join(classifyRepo, '.harness', 'verify.json'), {
    version: 1,
    checks: [{ id: 'precommit', run: 'pre-commit run --all-files' }],
  });
  const stateHome = path.join(temp, 'state-home');
  const session = 'verify-contract-hook';
  const stateEnv = { HARNESS_STATE_HOME: stateHome, CLAUDE: '1' };
  const statePersist = path.join(ROOT, 'hooks', 'scripts', 'state-persist.js');
  const stopGate = path.join(ROOT, 'hooks', 'scripts', 'stop-gate.js');
  const invokeHook = (script, payload) => spawnSync(process.execPath, [script], {
    cwd: classifyRepo,
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, ...stateEnv },
  });

  fs.appendFileSync(path.join(classifyRepo, 'README.md'), 'dirty\n');
  let hook = invokeHook(statePersist, {
    session_id: session,
    cwd: classifyRepo,
    hook_event_name: 'PostToolUse',
    tool_name: 'Edit',
    tool_input: { file_path: path.join(classifyRepo, 'README.md') },
    tool_response: { stdout: '', exitCode: 0 },
  });
  assert.strictEqual(hook.status, 0);

  hook = invokeHook(statePersist, {
    session_id: session,
    cwd: classifyRepo,
    hook_event_name: 'PostToolUse',
    tool_name: 'Bash',
    tool_input: { command: 'pre-commit run --all-files' },
    tool_response: { stdout: 'ok', exitCode: 0 },
  });
  assert.strictEqual(hook.status, 0);

  const stateFile = path.join(
    stateHome,
    'workspaces',
    getWorkspaceKey(classifyRepo),
    'state',
    'sessions',
    session,
    'handoff-state.json',
  );
  const handoff = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  assert.ok(handoff.lastVerifyAt >= handoff.lastEditAt, JSON.stringify(handoff));

  const stop = invokeHook(stopGate, { session_id: session, cwd: classifyRepo });
  assert.strictEqual(stop.status, 0);
  assert.doesNotMatch(String(stop.stderr || ''), /Verification Reminder/i);

  // Issue #306: a host working-directory prelude (`cd <workspace> && <check>`)
  // is recognized only for a validated in-root directory followed by exactly
  // one plain verification command. Canonical and packaged copies must agree.
  fs.rmSync(path.join(classifyRepo, '.harness', 'verify.json'));
  const physicalRepo = fs.realpathSync.native(classifyRepo);
  const posixRepo = physicalRepo.replace(/\\/g, '/');
  const outside = fs.mkdtempSync(path.join(temp, 'outside-'));
  fs.mkdirSync(path.join(classifyRepo, 'pkg'), { recursive: true });
  fs.writeFileSync(path.join(classifyRepo, 'not-a-dir.txt'), 'x\n');
  const classifiers = {
    canonical: require('../hooks/scripts/lib/workflow-isolation').isVerificationShell,
    packaged: require('../plugins/harness-everything/hooks/scripts/lib/workflow-isolation').isVerificationShell,
  };
  const wrapperCases = (repo) => {
    const positive = [
      `cd "${physicalRepo}" && npm test`,
      `cd '${physicalRepo}' && npm test`,
      `cd '${posixRepo}' && npm test`,
      `cd   "${physicalRepo}"   &&   npm   test`,
      `cd "${physicalRepo}" && pre-commit run --all-files`,
      `cd pkg && npm test`,
      'npm test',
    ];
    if (!/[^A-Za-z0-9_./:@%+,-]/.test(posixRepo)) positive.push(`cd ${posixRepo} && npm test`);
    if (process.platform === 'win32') {
      positive.push(`cd '/${physicalRepo[0].toLowerCase()}${posixRepo.slice(2)}' && npm test`);
    }
    const negative = [
      `cd "${physicalRepo}" && npm test && rm -rf build`,
      `cd "${physicalRepo}" && npm test || true`,
      'npm test || true',
      'npm test; rm -rf build',
      `cd "${physicalRepo}" && npm test | tee out.txt`,
      `cd "${physicalRepo}" && npm test > out.txt`,
      `cd "${physicalRepo}" && npm test 2>&1`,
      `cd "${physicalRepo}" && npm test $(rm -rf build)`,
      `cd "${physicalRepo}" && npm test \`rm -rf build\``,
      `cd "${physicalRepo}" && npm test &`,
      `cd "${physicalRepo}" && (npm test)`,
      `cd "${physicalRepo}" && npm test\nrm -rf build`,
      `cd "${physicalRepo}" && echo npm test`,
      'echo npm test',
      `cd "${physicalRepo}" && cd "${physicalRepo}" && npm test`,
      `cd "${physicalRepo}\\" && npm test" && rm -rf build`,
      `cd "${physicalRepo};rm -rf build" && npm test`,
      'cd "$HOME" && npm test',
      'cd ~ && npm test',
      `cd "${outside}" && npm test`,
      `cd "${path.join(physicalRepo, '..')}" && npm test`,
      `cd "${path.join(physicalRepo, 'missing')}" && npm test`,
      `cd "${path.join(physicalRepo, 'not-a-dir.txt')}" && npm test`,
      `cd "${physicalRepo}" ; npm test`,
      `cd "${physicalRepo}" || npm test`,
      `pushd "${physicalRepo}" && npm test`,
      `cd "${physicalRepo}" &&`,
    ];
    return { positive, negative, repo };
  };
  for (const [label, classify] of Object.entries(classifiers)) {
    const { positive, negative } = wrapperCases(classifyRepo);
    for (const command of positive) {
      assert.strictEqual(classify(command, { cwd: classifyRepo, root: classifyRepo }), true, `${label}: wrapper must count: ${command}`);
    }
    for (const command of negative) {
      assert.strictEqual(classify(command, { cwd: classifyRepo, root: classifyRepo }), false, `${label}: must not count: ${JSON.stringify(command)}`);
    }
    // Unexpected inputs fail closed rather than throwing.
    for (const value of [undefined, null, '', '   ', 42, 'cd', 'cd ""  && npm test']) {
      assert.strictEqual(classify(value, { cwd: classifyRepo, root: classifyRepo }), false, `${label}: unexpected input ${JSON.stringify(value)}`);
    }
  }

  // A declared contract still governs the wrapped command: declared checks
  // count through the wrapper, undeclared legacy commands do not.
  writeJson(path.join(classifyRepo, '.harness', 'verify.json'), {
    version: 1,
    checks: [{ id: 'e2e', run: 'bash scripts/e2e.sh' }],
  });
  for (const [label, classify] of Object.entries(classifiers)) {
    const options = { cwd: classifyRepo, root: classifyRepo };
    assert.strictEqual(classify(`cd "${physicalRepo}" && bash scripts/e2e.sh`, options), true, `${label}: declared contract check through wrapper`);
    assert.strictEqual(classify(`cd "${physicalRepo}" && npm test`, options), false, `${label}: wrapper must not bypass the declared contract`);
    assert.strictEqual(classify(`cd "${physicalRepo}" && bash scripts/e2e.sh && rm -rf build`, options), false, `${label}: chained contract check`);
  }
  fs.writeFileSync(path.join(classifyRepo, '.harness', 'verify.json'), '{ broken');
  assert.strictEqual(isVerificationShell(`cd "${physicalRepo}" && npm test`, { cwd: classifyRepo }), false, 'invalid contract still fails closed through the wrapper');
  fs.rmSync(path.join(classifyRepo, '.harness', 'verify.json'));

  // End-to-end hook replay (Windows-Bash-shaped Claude payload, no exit code):
  // edit -> wrapped verification -> Stop is clean. Repeated twice for determinism.
  const wrappedCommand = `cd "${physicalRepo}" && npm test`;
  for (const scripts of [
    { label: 'canonical', persist: statePersist, stop: stopGate },
    { label: 'packaged', persist: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'state-persist.js'), stop: path.join(ROOT, 'plugins', 'harness-everything', 'hooks', 'scripts', 'stop-gate.js') },
  ]) {
    for (let round = 0; round < 2; round++) {
      const wrapSession = `verify-wrapper-${scripts.label}-${round}`;
      const wrapStateFile = path.join(stateHome, 'workspaces', getWorkspaceKey(classifyRepo), 'state', 'sessions', wrapSession, 'handoff-state.json');
      const readWrapState = () => JSON.parse(fs.readFileSync(wrapStateFile, 'utf8'));
      const bash = (command, extra = {}) => invokeHook(scripts.persist, {
        session_id: wrapSession,
        cwd: classifyRepo,
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        tool_input: { command },
        tool_response: { stdout: 'ok', stderr: '' },
        ...extra,
      });

      assert.strictEqual(invokeHook(scripts.persist, {
        session_id: wrapSession,
        cwd: classifyRepo,
        hook_event_name: 'PostToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: path.join(classifyRepo, 'README.md') },
        tool_response: { stdout: '' },
      }).status, 0);
      const editedAt = readWrapState().lastEditAt;
      assert.ok(Number.isFinite(editedAt), `${scripts.label}: edit recorded`);

      // Failed or unconfirmed outcomes never mark a passing verification.
      assert.strictEqual(bash(wrappedCommand, { hook_event_name: 'PostToolUseFailure', tool_response: { stderr: 'boom' } }).status, 0);
      assert.ok(!readWrapState().lastVerifyAt, `${scripts.label}: PostToolUseFailure must not verify`);
      assert.strictEqual(bash(wrappedCommand, { tool_response: { stdout: '', stderr: 'boom', exitCode: 1 } }).status, 0);
      assert.ok(!readWrapState().lastVerifyAt, `${scripts.label}: nonzero exit must not verify`);
      assert.strictEqual(bash(wrappedCommand, { hook_event_name: undefined }).status, 0);
      assert.ok(!readWrapState().lastVerifyAt, `${scripts.label}: unknown event without exit code must not verify`);
      assert.strictEqual(bash(`${wrappedCommand} && rm -rf build`).status, 0);
      assert.ok(!readWrapState().lastVerifyAt, `${scripts.label}: chained wrapper must not verify`);

      const failingStop = invokeHook(scripts.stop, { session_id: wrapSession, cwd: classifyRepo });
      assert.strictEqual(failingStop.status, 0, `${scripts.label}: Stop stays fail-open`);
      assert.match(String(failingStop.stderr || ''), /Verification Reminder/i, `${scripts.label}: reminder before verification`);

      assert.strictEqual(bash(wrappedCommand).status, 0);
      const verified = readWrapState();
      assert.ok(verified.lastVerifyAt >= verified.lastEditAt, `${scripts.label}: wrapper verification recorded ${JSON.stringify(verified)}`);
      assert.strictEqual(verified.lastVerifyExitCode, null);
      const cleanStop = invokeHook(scripts.stop, { session_id: wrapSession, cwd: classifyRepo });
      assert.strictEqual(cleanStop.status, 0);
      assert.doesNotMatch(String(cleanStop.stderr || ''), /Verification Reminder/i, `${scripts.label}: clean Stop after wrapped verification`);
    }
  }

  console.log('Issue #242 verification contract: taxonomy, discovery, execution safety, multi-root scope, hook recognition, and Stop evidence verified.');
  console.log('Issue #306 host cwd wrapper: validated prelude recognition, negative chaining/injection/out-of-root cases, contract governance, canonical/packaged parity, and hook-to-Stop replay verified.');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
