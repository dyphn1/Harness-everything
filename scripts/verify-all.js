#!/usr/bin/env node
'use strict';

/**
 * Local CI-mirror gate runner.
 *
 * AGENTS.md lists the gate commands that cover the same contract categories
 * as CI; recent PR history shows runs where a gate category was skipped
 * locally and failed only after push (PR #301 consistency/runtime-floor,
 * PR #327 Windows self-regression). This script runs the same set in CI
 * order, from the working tree or a clean detached checkout of HEAD, and
 * prints a Markdown table that is paste-ready for PR evidence.
 *
 * Every known gate always appears in the report. A gate that did not run is
 * UNCHECKED with its reason (fast subset, skipped by flag, tool unavailable)
 * and never counts as passing evidence.
 *
 * Usage:
 *   npm run verify:all                    # full gate set, current tree
 *   npm run verify:all -- --fast          # hermetic + mutations + consistency + portability
 *   npm run verify:all -- --clean         # all gates in a fresh detached worktree of HEAD
 *   npm run verify:all -- --node22        # add the Node 22 execution smoke-test lane (npx node@22)
 *   npm run verify:all -- --clean --no-install   # --clean without npm ci in the worktree
 *   npm run verify:all -- --no-waza       # skip the optional waza readiness gate
 *
 * Exit code is 1 when any executed gate fails.
 *
 * Process launching: `git` always runs with shell:false and structured
 * argument vectors, so worktree paths with spaces survive on every OS. On
 * Windows `npm`/`npx`/`waza` may be `.cmd` shims, which Node refuses to
 * spawn without a shell; those are launched through the shell with only
 * fixed, space-free argument tokens (scripts/ci/mechanism-38-* covers the
 * split).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');

const FULL_PLAN = [
  { label: 'self-regression (hermetic + mechanism + routing contracts)', command: ['npm', 'test'], fast: true },
  { label: 'mutation checks', command: ['npm', 'run', 'test:mutations'], fast: true },
  { label: 'consistency (docs, manifests, repo contract, prompt contracts)', command: ['npm', 'run', 'test:consistency'], fast: true },
  { label: 'references resolve', command: ['npm', 'run', 'test:references'], fast: false },
  { label: 'release consistency', command: ['npm', 'run', 'test:release'], fast: false },
  { label: 'skill description collision', command: ['npm', 'run', 'test:collision'], fast: false },
  { label: 'skill routing coverage', command: ['npm', 'run', 'test:routing:skills'], fast: false },
  { label: 'routing invariants', command: ['npm', 'run', 'test:routing:invariants'], fast: false },
  { label: 'openai plugin package', command: ['npm', 'run', 'test:plugin:openai'], fast: false },
  { label: 'openai public submission', command: ['npm', 'run', 'test:plugin:submission'], fast: false },
  { label: 'platform compatibility matrix', command: ['npm', 'run', 'test:platform:compatibility'], fast: false },
  { label: 'test-source portability', command: ['npm', 'run', 'test:portability'], fast: true },
];

const NODE22_PLAN = [
  { label: 'node22 lane: self-regression execution smoke test', command: ['npx', '-y', 'node@22', 'self-evolve/scripts/self-regression.js'] },
  { label: 'node22 lane: installer roundtrip execution smoke test', command: ['npx', '-y', 'node@22', 'ci/installer-roundtrip.test.js'] },
];

// CI's runtime-floor job installs dependencies under Node 22 before running
// the suite. Locally the smoke tests execute under Node 22 but use the
// current host's node_modules, so dependency-install compatibility stays
// explicitly UNCHECKED instead of being implied.
const NODE22_UNVERIFIED = {
  label: 'node22 lane: dependency install (npm ci under Node 22)',
  reason: 'covered by the CI runtime-floor job; not replicated locally',
};

const WAZA_ENTRY = {
  label: 'waza readiness (optional)',
  command: ['npm', 'run', 'waza:check'],
  tool: 'waza',
};

function usage() {
  console.log('Usage: npm run verify:all [-- --fast] [-- --clean] [-- --node22] [-- --no-install] [-- --no-waza]');
}

function parseArgs(argv) {
  const options = { fast: false, clean: false, node22: false, install: true, waza: true };
  for (const arg of argv) {
    if (arg === '--fast') options.fast = true;
    else if (arg === '--clean') options.clean = true;
    else if (arg === '--node22') options.node22 = true;
    else if (arg === '--no-install') options.install = false;
    else if (arg === '--no-waza') options.waza = false;
    else if (arg === '--help' || arg === '-h') {
      usage();
      process.exit(0);
    } else {
      console.error(`Unknown argument: ${arg}`);
      usage();
      process.exit(2);
    }
  }
  return options;
}

// Windows may resolve npm/npx/waza as .cmd shims that Node only spawns with
// a shell. They receive fixed, space-free tokens only; git never needs this.
const SHELL_TOOLS = new Set(['npm', 'npx', 'waza']);

function needsShell(cmd, platform = process.platform) {
  return platform === 'win32' && SHELL_TOOLS.has(cmd);
}

function spawnTool(cmd, args, options) {
  return spawnSync(cmd, args, { ...options, shell: needsShell(cmd) });
}

function run(command, cwd, env) {
  const [cmd, ...args] = command;
  const started = Date.now();
  const result = spawnTool(cmd, args, {
    cwd,
    stdio: 'inherit',
    env: env ? { ...process.env, ...env } : process.env,
  });
  const seconds = (Date.now() - started) / 1000;
  if (result.error) {
    console.error(`spawn failed: ${cmd} — ${result.error.message}`);
    return { status: null, seconds };
  }
  return { status: result.status, seconds };
}

function capture(command, cwd) {
  const [cmd, ...args] = command;
  return spawnTool(cmd, args, { cwd, encoding: 'utf8' });
}

function runGit(args, cwd) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', shell: false });
}

function formatSeconds(value) {
  return `${value.toFixed(1)}s`;
}

function wazaEnv() {
  const probe = capture(['waza', '--version']);
  if (probe.status === 0) return {};
  const local = path.join(os.homedir(), 'bin', process.platform === 'win32' ? 'waza.exe' : 'waza');
  if (fs.existsSync(local)) return { WAZA_BIN: local };
  return null;
}

function buildPlan(options) {
  const entries = FULL_PLAN.map(entry => ({
    ...entry,
    enabled: options.fast ? entry.fast : true,
    reason: entry.fast ? null : 'not in the --fast subset',
  }));
  entries.push(...NODE22_PLAN.map(entry => ({
    ...entry,
    enabled: options.node22,
    reason: options.node22 ? null : 'not requested; add --node22',
  })));
  entries.push({ ...NODE22_UNVERIFIED, enabled: false, alwaysUnchecked: true });
  entries.push({
    ...WAZA_ENTRY,
    enabled: options.waza,
    reason: options.waza ? null : 'skipped by --no-waza',
  });
  return entries;
}

function prepareCleanRoot(install) {
  const head = runGit(['rev-parse', 'HEAD'], ROOT).stdout.trim();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-verify-all-'));
  const add = runGit(['worktree', 'add', '--detach', dir, head], ROOT);
  if (add.status !== 0) {
    throw new Error(`git worktree add failed: ${add.stderr || add.stdout}`);
  }
  if (install) {
    console.log('\nInstalling dependencies in clean worktree (npm ci --ignore-scripts)...');
    const ci = run(['npm', 'ci', '--ignore-scripts'], dir);
    if (ci.status !== 0) {
      runGit(['worktree', 'remove', '--force', dir], ROOT);
      throw new Error('npm ci failed in the clean worktree');
    }
  }
  return { dir, head };
}

function removeCleanRoot(dir) {
  const removed = runGit(['worktree', 'remove', '--force', dir], ROOT);
  if (removed.status !== 0) {
    console.error(`warning: could not remove clean worktree ${dir}: ${removed.stderr || removed.stdout}`);
  }
}

function formatMode(options) {
  return options.fast ? 'fast subset' : 'full gate set';
}

function formatFlags(options) {
  const flags = [];
  if (options.fast) flags.push('--fast');
  if (options.clean) flags.push('--clean');
  if (options.node22) flags.push('--node22');
  if (!options.install) flags.push('--no-install');
  if (!options.waza) flags.push('--no-waza');
  return flags.length > 0 ? flags.join(' ') : '(defaults)';
}

function renderReport(rows, meta) {
  const lines = [];
  lines.push('## Local gate run — paste-ready evidence');
  lines.push(
    `HEAD \`${meta.head}\` · node ${meta.node} · ${meta.platform}` +
      `${meta.clean ? ' · clean detached worktree' : ''} · mode: ${meta.mode} · flags: ${meta.flags}`
  );
  lines.push('');
  lines.push('| # | Gate | Result | Time |');
  lines.push('| --- | --- | --- | --- |');
  rows.forEach((row, index) => {
    const result = row.status === 'UNCHECKED' ? `UNCHECKED (${row.reason})` : row.status;
    const time = row.seconds === null || row.seconds === undefined ? '—' : formatSeconds(row.seconds);
    lines.push(`| ${index + 1} | ${row.label} | ${result} | ${time} |`);
  });
  const failures = rows.filter(row => row.status === 'FAIL').length;
  const unchecked = rows.filter(row => row.status === 'UNCHECKED').length;
  const passed = rows.filter(row => row.status === 'PASS').length;
  lines.push('');
  lines.push(`Summary: ${passed} PASS, ${failures} FAIL, ${unchecked} UNCHECKED.`);
  return { text: lines.join('\n'), failures, unchecked, passed };
}

function probeWazaEntry(entry) {
  if (entry.tool !== 'waza' || !entry.enabled) return entry;
  const env = wazaEnv();
  if (env) return { ...entry, env };
  return { ...entry, enabled: false, reason: 'waza not found on PATH or ~/bin' };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const head = runGit(['rev-parse', 'HEAD'], ROOT).stdout.trim();

  console.log('=== 🚦 Harness local gate runner (CI mirror) ===');
  console.log(`Repository: ${ROOT}`);
  console.log(`HEAD:       ${head}`);
  console.log(`Runtime:    node ${process.version} on ${process.platform}`);
  console.log(`Mode:       ${formatMode(options)} · flags: ${formatFlags(options)}`);

  const plan = buildPlan(options).map(probeWazaEntry);

  let cwd = ROOT;
  let clean = null;
  if (options.clean) {
    clean = prepareCleanRoot(options.install);
    cwd = clean.dir;
  }

  const rows = [];
  try {
    let executed = 0;
    const enabledCount = plan.filter(entry => entry.enabled).length;
    for (const entry of plan) {
      if (!entry.enabled) {
        rows.push({ label: entry.label, status: 'UNCHECKED', reason: entry.reason, seconds: null });
        continue;
      }
      executed += 1;
      console.log(`\n▶ [${executed}/${enabledCount}] ${entry.label}`);
      console.log(`   $ ${entry.command.join(' ')}`);
      const result = run(entry.command, cwd, entry.env);
      rows.push({
        label: entry.label,
        status: result.status === 0 ? 'PASS' : 'FAIL',
        seconds: result.seconds,
      });
    }
  } finally {
    if (clean) removeCleanRoot(clean.dir);
  }

  const report = renderReport(rows, {
    head,
    node: process.version,
    platform: process.platform,
    clean: Boolean(options.clean),
    mode: formatMode(options),
    flags: formatFlags(options),
  });

  console.log(`\n${report.text}`);

  if (report.failures > 0) {
    process.exitCode = 1;
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  FULL_PLAN,
  NODE22_PLAN,
  NODE22_UNVERIFIED,
  buildPlan,
  needsShell,
  renderReport,
  runGit,
  formatMode,
  formatFlags,
  parseArgs,
};
