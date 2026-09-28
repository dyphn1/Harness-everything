#!/usr/bin/env node
'use strict';

/**
 * Harness project verification gate.
 *
 * Contract: .harness/verify.json
 * Discovery: read-only candidates; legacy package lint/test remains auto-run.
 * UNCHECKED_* is non-blocking control flow and is never passing-test evidence.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function loadVerificationModel() {
  for (const candidate of [
    path.resolve(__dirname, '../../scripts/lib/verification-contract.js'),
    path.resolve(__dirname, '../../../scripts/lib/verification-contract.js'),
  ]) {
    if (fs.existsSync(candidate)) return require(candidate);
  }
  throw new Error('verification-contract runtime is missing from this Harness distribution');
}

const {
  detectRoot,
  enumerateSubmoduleRoots,
  findGitRoot,
  readContract,
} = loadVerificationModel();

const jsonMode = process.argv.includes('--json');
const cwd = path.resolve(process.cwd());
const repoRoot = findGitRoot(cwd);

function emptyReport(status, reason) {
  return {
    status,
    reason,
    repoRoot,
    roots: [],
    checks: [],
    candidates: [],
  };
}

function emit(report) {
  if (jsonMode) {
    process.stdout.write(JSON.stringify(report, null, 2) + '\n');
    return;
  }

  console.log('=== 🛡️ Harness Verification Gate ===');
  console.log(`Status: ${report.status}`);
  console.log(`Repository: ${report.repoRoot}`);
  if (report.reason) console.log(`Reason: ${report.reason}`);

  for (const root of report.roots || []) {
    console.log(`\n[${root.status}] ${root.path}`);
    if (root.reason) console.log(`  ${root.reason}`);
    for (const check of root.checks || []) {
      const exit = check.exitCode === null ? 'timeout/error' : check.exitCode;
      console.log(`  check ${check.id}: ${check.run} (exit ${exit}, ${check.durationMs}ms)`);
      if (check.stdout) process.stdout.write(check.stdout.endsWith('\n') ? check.stdout : check.stdout + '\n');
      if (check.stderr) process.stderr.write(check.stderr.endsWith('\n') ? check.stderr : check.stderr + '\n');
    }
    for (const candidate of root.candidates || []) {
      console.log(`  candidate [${candidate.source}]: ${candidate.run}`);
    }
  }

  if (report.status === 'UNCHECKED_NO_CHECKS' || report.status === 'UNCHECKED_DISCOVERED') {
    console.log('\nExit code is 0 (non-blocking), but NO COMPLETE AUTOMATED EVIDENCE was produced.');
    console.log('PROHIBITED: Do NOT cite this run as proof that tests pass. Perform the listed or project-declared verification first.');
  } else if (report.status === 'PASSED') {
    console.log('\n✅ Verification PASSED. Objective project checks completed successfully.');
  } else if (report.status === 'FAILED') {
    console.error('\n❌ Verification FAILED. Fix the reported check/contract error and run this gate again.');
  } else if (report.status === 'SKIPPED') {
    console.log('ℹ️ Project checks skipped by HARNESS_SKIP_PROJECT_CHECKS=1.');
  }
}

function finish(report) {
  emit(report);
  process.exit(report.status === 'FAILED' ? 1 : 0);
}

function statusRank(status) {
  return {
    PASSED: 0,
    UNCHECKED_NO_CHECKS: 1,
    UNCHECKED_DISCOVERED: 2,
    FAILED: 3,
  }[status] ?? 0;
}

function aggregateStatus(roots) {
  if (!roots.length) return 'UNCHECKED_NO_CHECKS';
  return roots.reduce((worst, root) => statusRank(root.status) > statusRank(worst) ? root.status : worst, 'PASSED');
}

function executeCheck(check) {
  const started = Date.now();
  const result = spawnSync(check.run, {
    cwd: check.cwd,
    shell: true,
    encoding: 'utf8',
    windowsHide: true,
    timeout: check.timeoutSec * 1000,
    env: { ...process.env, HARNESS_SKIP_PROJECT_CHECKS: '1' },
    maxBuffer: 16 * 1024 * 1024,
  });
  const durationMs = Date.now() - started;
  const timedOut = !!(result.error && result.error.code === 'ETIMEDOUT');
  const exitCode = typeof result.status === 'number' ? result.status : null;
  return {
    id: check.id,
    run: check.run,
    cwd: check.cwd,
    source: check.source,
    exitCode,
    durationMs,
    timedOut,
    signal: result.signal || null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    passed: !timedOut && exitCode === 0,
  };
}

function publicCheck(check) {
  return {
    id: check.id,
    run: check.run,
    cwd: check.cwd,
    source: check.source,
    exitCode: check.exitCode,
    durationMs: check.durationMs,
    ...(check.timedOut ? { timedOut: true } : {}),
    ...(check.signal ? { signal: check.signal } : {}),
    ...(!jsonMode && check.stdout ? { stdout: check.stdout } : {}),
    ...(!jsonMode && check.stderr ? { stderr: check.stderr } : {}),
  };
}

function candidateView(candidate) {
  return {
    source: candidate.source,
    run: candidate.run,
    cwd: candidate.cwd,
  };
}

function rootReason(status, checks, candidates) {
  if (status === 'FAILED') {
    const failed = checks.find(check => !check.passed);
    if (!failed) return 'verification failed';
    return failed.timedOut
      ? `check ${failed.id} timed out after ${failed.durationMs}ms`
      : `check ${failed.id} exited ${failed.exitCode}`;
  }
  if (status === 'UNCHECKED_DISCOVERED') return `${candidates.length} verification candidate(s) detected but not executed`;
  if (status === 'UNCHECKED_NO_CHECKS') return 'no project verification checks were declared or detected';
  return `${checks.length} check(s) passed`;
}

function contractPlan(contract) {
  const rootResults = contract.roots.map(root => ({
    path: root.path,
    status: 'UNCHECKED_NO_CHECKS',
    reason: '',
    checks: [],
    candidates: [],
  }));
  const byPath = new Map(rootResults.map(root => [path.resolve(root.path), root]));

  for (const check of contract.checks) {
    const executed = executeCheck(check);
    const root = byPath.get(path.resolve(check.root));
    root.checks.push(executed);
  }

  for (const root of rootResults) {
    root.status = root.checks.length === 0
      ? 'UNCHECKED_NO_CHECKS'
      : root.checks.some(check => !check.passed) ? 'FAILED' : 'PASSED';
    root.reason = rootReason(root.status, root.checks, root.candidates);
  }
  return rootResults;
}

function discoveredPlan() {
  const roots = [];
  for (const rootPath of enumerateSubmoduleRoots(repoRoot)) {
    const detected = detectRoot(rootPath);
    const executed = detected.checks.map(executeCheck);
    const candidates = detected.candidates;
    const status = executed.some(check => !check.passed)
      ? 'FAILED'
      : candidates.length > 0 ? 'UNCHECKED_DISCOVERED'
        : executed.length > 0 ? 'PASSED' : 'UNCHECKED_NO_CHECKS';
    roots.push({
      path: rootPath,
      status,
      reason: rootReason(status, executed, candidates),
      checks: executed,
      candidates,
    });
  }
  return roots;
}

function finalize(roots) {
  const status = aggregateStatus(roots);
  const failingRoot = roots.find(root => root.status === status);
  const report = {
    status,
    reason: failingRoot ? failingRoot.reason : '',
    repoRoot,
    roots: roots.map(root => ({
      path: root.path,
      status: root.status,
      reason: root.reason,
      checks: root.checks.map(publicCheck),
      candidates: root.candidates.map(candidateView),
    })),
    checks: roots.flatMap(root => root.checks.map(publicCheck)),
    candidates: roots.flatMap(root => root.candidates.map(candidateView)),
  };
  finish(report);
}

try {
  // Injection remains first and cannot be bypassed by the recursion guard.
  if (fs.existsSync(path.join(cwd, '.verify-fail.tmp'))) {
    finish(emptyReport('FAILED', '.verify-fail.tmp present (injected failure)'));
  }

  if (process.env.HARNESS_SKIP_PROJECT_CHECKS === '1') {
    finish(emptyReport('SKIPPED', 'HARNESS_SKIP_PROJECT_CHECKS=1 recursion guard'));
  }

  const contract = readContract(repoRoot);
  finalize(contract ? contractPlan(contract) : discoveredPlan());
} catch (error) {
  finish(emptyReport('FAILED', error && error.message ? error.message : String(error)));
}
