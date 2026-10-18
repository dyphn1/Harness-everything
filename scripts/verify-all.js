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
 * Usage:
 *   npm run verify:all                    # full gate set, current tree
 *   npm run verify:all -- --fast          # hermetic + mutations + consistency + portability
 *   npm run verify:all -- --clean         # all gates in a fresh detached worktree of HEAD
 *   npm run verify:all -- --node22        # add the Node 22 runtime-floor lane (npx node@22)
 *   npm run verify:all -- --clean --no-install   # --clean without npm ci in the worktree
 *   npm run verify:all -- --no-waza       # skip the optional waza readiness gate
 *
 * Exit code is 1 when any executed gate fails. Skipped gates are printed as
 * UNCHECKED and are never counted as passing evidence.
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
  { label: 'node22 lane: hermetic self-regression', command: ['npx', '-y', 'node@22', 'self-evolve/scripts/self-regression.js'] },
  { label: 'node22 lane: installer roundtrip', command: ['npx', '-y', 'node@22', 'ci/installer-roundtrip.test.js'] },
];

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

function run(command, cwd, env) {
  const [cmd, ...args] = command;
  const started = Date.now();
  const needsShell = process.platform === 'win32';
  const result = spawnSync(cmd, args, {
    cwd,
    stdio: 'inherit',
    shell: needsShell,
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
  return spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });
}

function git(args, cwd) {
  return capture(['git', ...args], cwd);
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

function prepareCleanRoot(install) {
  const head = git(['rev-parse', 'HEAD']).stdout.trim();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-verify-all-'));
  const add = git(['worktree', 'add', '--detach', dir, head]);
  if (add.status !== 0) {
    throw new Error(`git worktree add failed: ${add.stderr || add.stdout}`);
  }
  if (install) {
    console.log(`\nInstalling dependencies in clean worktree (npm ci --ignore-scripts)...`);
    const ci = run(['npm', 'ci', '--ignore-scripts'], dir);
    if (ci.status !== 0) {
      git(['worktree', 'remove', '--force', dir]);
      throw new Error('npm ci failed in the clean worktree');
    }
  }
  return { dir, head };
}

function removeCleanRoot(dir) {
  const removed = git(['worktree', 'remove', '--force', dir]);
  if (removed.status !== 0) {
    console.error(`warning: could not remove clean worktree ${dir}: ${removed.stderr || removed.stdout}`);
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const head = git(['rev-parse', 'HEAD']).stdout.trim();

  console.log('=== 🚦 Harness local gate runner (CI mirror) ===');
  console.log(`Repository: ${ROOT}`);
  console.log(`HEAD:       ${head}`);
  console.log(`Runtime:    node ${process.version} on ${process.platform}`);
  console.log(`Mode:       ${options.fast ? 'fast subset' : 'full gate set'}${options.clean ? ', clean detached worktree' : ', current working tree'}`);

  const plan = options.fast ? FULL_PLAN.filter(entry => entry.fast) : FULL_PLAN.slice();
  if (options.node22) plan.push(...NODE22_PLAN);

  let cwd = ROOT;
  let clean = null;
  if (options.clean) {
    clean = prepareCleanRoot(options.install);
    cwd = clean.dir;
  }

  const rows = [];
  try {
    for (let index = 0; index < plan.length; index += 1) {
      const entry = plan[index];
      console.log(`\n▶ [${index + 1}/${plan.length}] ${entry.label}`);
      console.log(`   $ ${entry.command.join(' ')}`);
      const result = run(entry.command, cwd);
      const passed = result.status === 0;
      rows.push({ label: entry.label, status: passed ? 'PASS' : 'FAIL', seconds: result.seconds });
    }

    if (options.waza) {
      const env = wazaEnv();
      if (env) {
        console.log(`\n▶ [${plan.length + 1}/${plan.length + 1}] waza readiness (optional)`);
        console.log('   $ npm run waza:check');
        const result = run(['npm', 'run', 'waza:check'], cwd, env);
        rows.push({
          label: 'waza readiness (optional)',
          status: result.status === 0 ? 'PASS' : 'FAIL',
          seconds: result.seconds,
        });
      } else {
        console.log('\n⚠ waza not found on PATH or ~/bin; waza:check left UNCHECKED (not passing evidence).');
        rows.push({ label: 'waza readiness (optional)', status: 'UNCHECKED', seconds: null });
      }
    }
  } finally {
    if (clean) removeCleanRoot(clean.dir);
  }

  const failures = rows.filter(row => row.status === 'FAIL').length;
  const unchecked = rows.filter(row => row.status === 'UNCHECKED').length;

  console.log('\n## Local gate run — paste-ready evidence');
  console.log(`HEAD \`${head}\` · node ${process.version} · ${process.platform}${options.clean ? ' · clean detached worktree' : ''}`);
  console.log('');
  console.log('| # | Gate | Result | Time |');
  console.log('| --- | --- | --- | --- |');
  rows.forEach((row, index) => {
    console.log(`| ${index + 1} | ${row.label} | ${row.status} | ${row.seconds === null ? '—' : formatSeconds(row.seconds)} |`);
  });
  console.log('');
  console.log(`Summary: ${rows.length - failures - unchecked} PASS, ${failures} FAIL, ${unchecked} UNCHECKED.`);
  if (failures > 0) process.exit(1);
}

main();
