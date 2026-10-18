const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const verifyAll = require(path.join(__dirname, '..', 'scripts', 'verify-all.js'));

// --- launcher policy: git never through a shell, Windows shims do -------

assert.strictEqual(verifyAll.needsShell('git', 'darwin'), false, 'git stays shell-free on POSIX');
assert.strictEqual(verifyAll.needsShell('git', 'win32'), false, 'git stays shell-free on Windows (spaces survive)');
assert.strictEqual(verifyAll.needsShell('npm', 'win32'), true, 'npm may be a .cmd shim on Windows');
assert.strictEqual(verifyAll.needsShell('npx', 'win32'), true, 'npx may be a .cmd shim on Windows');
assert.strictEqual(verifyAll.needsShell('waza', 'win32'), true, 'waza may be a shim on Windows');
assert.strictEqual(verifyAll.needsShell('npm', 'darwin'), false, 'npm runs shell-free on POSIX');

// --- plan: every known gate is retained in every mode --------------------

const labels = (plan) => plan.map((entry) => entry.label);
const entryFor = (plan, label) => plan.find((entry) => entry.label === label);

const full = verifyAll.buildPlan({ fast: false, node22: false, waza: true });
for (const entry of verifyAll.FULL_PLAN) {
  assert.ok(labels(full).includes(entry.label), `full plan retains ${entry.label}`);
  assert.strictEqual(entryFor(full, entry.label).enabled, true, `${entry.label} runs by default`);
}
assert.strictEqual(full.length, verifyAll.FULL_PLAN.length + verifyAll.NODE22_PLAN.length + 2, 'full plan retains node22 + unverified + waza rows');

for (const entry of verifyAll.NODE22_PLAN) {
  const node22Row = entryFor(full, entry.label);
  assert.ok(node22Row, `full plan retains ${entry.label}`);
  assert.strictEqual(node22Row.enabled, false, 'node22 lane is opt-in');
  assert.strictEqual(node22Row.reason, 'not requested; add --node22', 'opt-out carries a reason');
}
const unverified = entryFor(full, verifyAll.NODE22_UNVERIFIED.label);
assert.ok(unverified, 'dependency-install row is always present');
assert.strictEqual(unverified.enabled, false, 'dependency-install row never runs locally');
assert.ok(/runtime-floor/.test(unverified.reason), 'dependency-install row names where it is covered');

const fast = verifyAll.buildPlan({ fast: true, node22: false, waza: true });
for (const entry of verifyAll.FULL_PLAN) {
  const row = entryFor(fast, entry.label);
  assert.strictEqual(row.enabled, entry.fast, `${entry.label} follows the fast subset`);
  if (!entry.fast) {
    assert.strictEqual(row.reason, 'not in the --fast subset', `${entry.label} explains why it is unchecked`);
  }
}
assert.ok(entryFor(fast, 'waza readiness (optional)').enabled, 'waza runs by default in fast mode too');

const noWaza = verifyAll.buildPlan({ fast: false, node22: false, waza: false });
const wazaRow = entryFor(noWaza, 'waza readiness (optional)');
assert.strictEqual(wazaRow.enabled, false, '--no-waza disables the row');
assert.strictEqual(wazaRow.reason, 'skipped by --no-waza', '--no-waza row explains itself');

// --- report: self-describing, never overstating --------------------------

const rows = [
  { label: 'self-regression', status: 'PASS', seconds: 1.2 },
  { label: 'release consistency', status: 'FAIL', seconds: 0.4 },
  { label: 'references resolve', status: 'UNCHECKED', reason: 'not in the --fast subset', seconds: null },
];
const report = verifyAll.renderReport(rows, {
  head: 'abc123',
  node: 'v24.0.0',
  platform: 'darwin',
  clean: false,
  mode: verifyAll.formatMode({ fast: true }),
  flags: verifyAll.formatFlags({ fast: true, clean: false, node22: false, install: true, waza: true }),
});
assert.ok(/mode: fast subset/.test(report.text), 'report names the mode');
assert.ok(/flags: --fast/.test(report.text), 'report names the exact flags');
assert.ok(/HEAD `abc123`/.test(report.text), 'report names HEAD');
assert.ok(/node v24\.0\.0/.test(report.text), 'report names the runtime');
assert.ok(/darwin/.test(report.text), 'report names the OS');
assert.ok(report.text.includes('UNCHECKED (not in the --fast subset)'), 'unchecked rows carry their reason');
assert.ok(report.text.includes('| 2 | release consistency | FAIL |'), 'failed gates stay visible');
assert.ok(report.text.includes('Summary: 1 PASS, 1 FAIL, 1 UNCHECKED.'), 'summary counts all three statuses');
assert.strictEqual(report.failures, 1, 'renderReport returns the failure count for exit handling');

const defaults = verifyAll.formatFlags({ fast: false, clean: false, node22: false, install: true, waza: true });
assert.strictEqual(defaults, '(defaults)', 'no flags prints (defaults)');
assert.ok(/--clean --node22 --no-waza/.test(
  verifyAll.formatFlags({ fast: false, clean: true, node22: true, install: true, waza: false })
), 'flags list every activated mode');

// --- git runner: worktree paths with spaces survive ----------------------

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-all-test-'));
try {
  const repo = path.join(base, 'repo');
  fs.mkdirSync(repo);
  assert.strictEqual(verifyAll.runGit(['init', '--quiet'], repo).status, 0, 'git init works');
  fs.writeFileSync(path.join(repo, 'seed.txt'), 'seed');
  assert.strictEqual(verifyAll.runGit(['add', 'seed.txt'], repo).status, 0, 'git add works');
  const commit = verifyAll.runGit(
    ['-c', 'user.name=Harness', '-c', 'user.email=harness@example.com', 'commit', '--quiet', '-m', 'seed'],
    repo,
  );
  assert.strictEqual(commit.status, 0, `git commit works: ${commit.stderr}`);

  const spaced = path.join(base, 'worktree with spaces');
  const add = verifyAll.runGit(['worktree', 'add', '--detach', spaced, 'HEAD'], repo);
  assert.strictEqual(add.status, 0, `git worktree add survives a spaced path: ${add.stderr}`);
  assert.ok(fs.existsSync(path.join(spaced, 'seed.txt')), 'spaced worktree has the checked-out tree');

  const remove = verifyAll.runGit(['worktree', 'remove', '--force', spaced], repo);
  assert.strictEqual(remove.status, 0, `git worktree remove survives a spaced path: ${remove.stderr}`);
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}

console.log('mechanism-38-verify-all: launcher, plan, report, and spaced-path contracts hold');
