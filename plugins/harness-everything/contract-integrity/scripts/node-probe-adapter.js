#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const VERSION = '1.0.0';
const ADAPTER = 'node-npm-v1';
const STRATEGIES = new Set(['env', 'replace']);
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_TIMEOUT_MS = 120000;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function safeRelative(value) {
  if (typeof value !== 'string' || !value.trim() || path.isAbsolute(value)) return false;
  const normalized = value.replace(/\\/g, '/');
  return normalized !== '..' && !normalized.startsWith('../') && !normalized.includes('/../') && !normalized.includes('\0');
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value || ''), 'utf8').digest('hex');
}

function validatePlan(plan) {
  const errors = [];
  if (!isObject(plan)) return ['probe plan must be an object'];
  if (plan.schemaVersion !== VERSION) errors.push(`schemaVersion must be ${VERSION}`);
  if (plan.adapter !== ADAPTER) errors.push(`adapter must be ${ADAPTER}`);
  if (typeof plan.script !== 'string' || !/^[A-Za-z0-9:_-]+$/.test(plan.script)) errors.push('script must be an npm script name');
  if (!Array.isArray(plan.probes) || plan.probes.length === 0) errors.push('probes must be a non-empty array');
  const ids = new Set();
  for (const [index, probe] of (Array.isArray(plan.probes) ? plan.probes : []).entries()) {
    const p = `probes[${index}]`;
    if (!isObject(probe)) { errors.push(`${p} must be an object`); continue; }
    for (const field of ['probeId', 'requirementId', 'sourceSection', 'strategy', 'expectedFailureContains']) {
      if (typeof probe[field] !== 'string' || !probe[field].trim()) errors.push(`${p}.${field} is required`);
    }
    if (probe.probeId && ids.has(probe.probeId)) errors.push(`${p}.probeId is duplicated: ${probe.probeId}`);
    if (probe.probeId) ids.add(probe.probeId);
    if (!STRATEGIES.has(probe.strategy)) errors.push(`${p}.strategy must be env or replace`);
    if (probe.strategy === 'env') {
      if (!isObject(probe.env) || Object.keys(probe.env).length === 0) errors.push(`${p}.env is required for env strategy`);
      for (const [key, value] of Object.entries(isObject(probe.env) ? probe.env : {})) {
        if (!/^[A-Z][A-Z0-9_]{0,79}$/.test(key)) errors.push(`${p}.env contains invalid key: ${key}`);
        if (typeof value !== 'string' || value.length > 200) errors.push(`${p}.env.${key} must be a string <= 200 chars`);
      }
    }
    if (probe.strategy === 'replace') {
      if (!safeRelative(probe.target)) errors.push(`${p}.target must be a repo-relative path`);
      if (typeof probe.find !== 'string' || probe.find.length === 0 || probe.find.length > 4000) errors.push(`${p}.find must be 1..4000 chars`);
      if (typeof probe.replace !== 'string' || probe.replace.length > 4000) errors.push(`${p}.replace must be <= 4000 chars`);
    }
  }
  if (plan.timeoutMs !== undefined && (!Number.isInteger(plan.timeoutMs) || plan.timeoutMs < 100 || plan.timeoutMs > MAX_TIMEOUT_MS)) {
    errors.push(`timeoutMs must be an integer between 100 and ${MAX_TIMEOUT_MS}`);
  }
  return errors;
}

function discoverProject(workspace, plan) {
  const packageFile = path.join(workspace, 'package.json');
  if (!fs.existsSync(packageFile)) return { ok: false, reason: 'package-json-missing' };
  let pkg;
  try { pkg = JSON.parse(fs.readFileSync(packageFile, 'utf8')); }
  catch (_) { return { ok: false, reason: 'package-json-invalid' }; }
  if (!isObject(pkg.scripts) || typeof pkg.scripts[plan.script] !== 'string') {
    return { ok: false, reason: 'npm-script-missing' };
  }
  const dependencyCount =
    Object.keys(isObject(pkg.dependencies) ? pkg.dependencies : {}).length +
    Object.keys(isObject(pkg.devDependencies) ? pkg.devDependencies : {}).length +
    Object.keys(isObject(pkg.optionalDependencies) ? pkg.optionalDependencies : {}).length;
  if (dependencyCount > 0) {
    return {
      ok: false,
      reason: 'external-dependencies-not-supported-v1',
      detail: 'node-npm-v1 intentionally supports zero-external-dependency projects only; dependency installation is never inferred or networked',
    };
  }
  return {
    ok: true,
    packageName: typeof pkg.name === 'string' ? pkg.name : null,
    script: plan.script,
    command: `npm run ${plan.script}`,
    dependencyMode: 'zero-external-dependencies',
  };
}

function copyWorkspace(source) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-contract-probe-'));
  const destination = path.join(root, 'workspace');
  fs.cpSync(source, destination, {
    recursive: true,
    filter: src => {
      const relative = path.relative(source, src).replace(/\\/g, '/');
      if (!relative) return true;
      const head = relative.split('/')[0];
      return !['.git', 'node_modules', '.harness'].includes(head);
    },
  });
  return { root, workspace: destination };
}

function runScript(workspace, plan, extraEnv = {}) {
  const timeout = plan.timeoutMs || DEFAULT_TIMEOUT_MS;
  // On Windows npm is normally a .cmd shim, which child_process cannot
  // execute directly without a command shell. The script name is restricted
  // to a safe identifier by validatePlan(), and no user-provided shell text is
  // interpolated into the command.
  const result = spawnSync('npm', ['run', plan.script], {
    cwd: workspace,
    encoding: 'utf8',
    timeout,
    windowsHide: true,
    shell: process.platform === 'win32',
    env: { ...process.env, CI: '1', ...extraEnv },
  });
  const stdout = String(result.stdout || '');
  const stderr = String(result.stderr || '');
  const combined = stdout + '\n' + stderr;
  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    return {
      kind: timedOut ? 'timeout' : 'spawn-error',
      exitCode: null,
      signal: result.signal || null,
      outputHash: sha256(combined + String(result.error.message || '')),
      combined,
    };
  }
  return {
    kind: 'exit',
    exitCode: Number.isInteger(result.status) ? result.status : null,
    signal: result.signal || null,
    outputHash: sha256(combined),
    combined,
  };
}

function isolatedRegularFile(workspace, relativeTarget) {
  const root = path.resolve(workspace);
  const target = path.resolve(root, relativeTarget);
  const lexical = path.relative(root, target);
  if (lexical === '..' || lexical.startsWith('..' + path.sep) || path.isAbsolute(lexical)) {
    throw new Error('replace target escaped isolated workspace');
  }

  let current = root;
  for (const segment of lexical.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment);
    if (!fs.existsSync(current)) throw new Error('replace target does not exist');
    const stat = fs.lstatSync(current);
    if (stat.isSymbolicLink()) {
      throw new Error('replace target contains symbolic link/reparse-point component');
    }
  }

  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(target);
  const resolved = path.relative(realRoot, realTarget);
  if (resolved === '..' || resolved.startsWith('..' + path.sep) || path.isAbsolute(resolved)) {
    throw new Error('replace target resolved outside isolated workspace');
  }
  if (!fs.lstatSync(realTarget).isFile()) throw new Error('replace target does not exist');
  return realTarget;
}

function applyProbe(workspace, probe) {
  if (probe.strategy === 'env') return { env: { ...probe.env }, mutation: 'environment-only' };

  const target = isolatedRegularFile(workspace, probe.target);
  const source = fs.readFileSync(target, 'utf8');
  const first = source.indexOf(probe.find);
  const last = source.lastIndexOf(probe.find);
  if (first < 0) throw new Error('replace find text was not present');
  if (first !== last) throw new Error('replace find text must match exactly once');
  fs.writeFileSync(target, source.slice(0, first) + probe.replace + source.slice(first + probe.find.length), 'utf8');
  return { env: {}, mutation: `replace:${probe.target}` };
}

function evidenceRef(probe, run) {
  return `probe:${probe.probeId}:output-sha256:${run.outputHash}`;
}

function notEvaluatedProbe(probe, reason, failureClass = 'infrastructure') {
  return {
    probeId: probe.probeId,
    requirementId: probe.requirementId,
    status: 'NOT_EVALUATED',
    sourceSection: probe.sourceSection,
    evidenceRef: null,
    workspaceIsolation: 'isolated',
    failureClass,
    adapterReason: reason,
  };
}

function executePlan(workspace, plan) {
  const errors = validatePlan(plan);
  if (errors.length) return { schemaVersion: VERSION, adapter: ADAPTER, result: 'INVALID_PLAN', errors, probes: [] };

  const discovered = discoverProject(workspace, plan);
  if (!discovered.ok) {
    return {
      schemaVersion: VERSION,
      adapter: ADAPTER,
      result: 'NOT_EVALUATED',
      discovery: discovered,
      baseline: null,
      probes: plan.probes.map(probe => notEvaluatedProbe(probe, discovered.reason)),
      errors: [],
    };
  }

  let baselineIsolation;
  try {
    baselineIsolation = copyWorkspace(workspace);
    const baselineRun = runScript(baselineIsolation.workspace, plan);
    const baseline = {
      status: baselineRun.kind === 'exit' && baselineRun.exitCode === 0 ? 'PASS' : 'FAIL',
      exitCode: baselineRun.exitCode,
      failureClass: baselineRun.kind === 'exit' ? (baselineRun.exitCode === 0 ? 'none' : 'baseline-test') : 'infrastructure',
      evidenceRef: `baseline:output-sha256:${baselineRun.outputHash}`,
      workspaceIsolation: 'isolated',
    };
    if (baseline.status !== 'PASS') {
      return {
        schemaVersion: VERSION,
        adapter: ADAPTER,
        result: 'NOT_EVALUATED',
        discovery: discovered,
        baseline,
        probes: plan.probes.map(probe => notEvaluatedProbe(probe, 'baseline-not-green')),
        errors: [],
      };
    }
  } finally {
    if (baselineIsolation?.root) fs.rmSync(baselineIsolation.root, { recursive: true, force: true });
  }

  const results = [];
  for (const probe of plan.probes) {
    let isolated;
    try {
      isolated = copyWorkspace(workspace);
      const applied = applyProbe(isolated.workspace, probe);
      const run = runScript(isolated.workspace, plan, applied.env);
      if (run.kind !== 'exit') {
        results.push(notEvaluatedProbe(probe, run.kind));
        continue;
      }
      if (run.exitCode === 0) {
        results.push({
          probeId: probe.probeId,
          requirementId: probe.requirementId,
          status: 'SURVIVED',
          sourceSection: probe.sourceSection,
          evidenceRef: evidenceRef(probe, run),
          workspaceIsolation: 'isolated',
          failureClass: 'none',
          adapterReason: 'project-test-suite-remained-green',
        });
        continue;
      }
      if (run.combined.includes(probe.expectedFailureContains)) {
        results.push({
          probeId: probe.probeId,
          requirementId: probe.requirementId,
          status: 'KILLED',
          sourceSection: probe.sourceSection,
          evidenceRef: evidenceRef(probe, run),
          workspaceIsolation: 'isolated',
          failureClass: 'contract',
          adapterReason: 'expected-observable-contract-failure',
        });
      } else {
        results.push({
          probeId: probe.probeId,
          requirementId: probe.requirementId,
          status: 'INVALID',
          sourceSection: probe.sourceSection,
          evidenceRef: evidenceRef(probe, run),
          workspaceIsolation: 'isolated',
          failureClass: 'unknown',
          adapterReason: 'test-failed-without-expected-contract-observable',
        });
      }
    } catch (error) {
      results.push(notEvaluatedProbe(probe, String(error.message || error), 'infrastructure'));
    } finally {
      if (isolated?.root) fs.rmSync(isolated.root, { recursive: true, force: true });
    }
  }

  return {
    schemaVersion: VERSION,
    adapter: ADAPTER,
    result: results.every(probe => probe.status === 'KILLED') ? 'PROTECTED' :
      results.some(probe => probe.status === 'SURVIVED') ? 'SURVIVED' : 'NOT_EVALUATED',
    discovery: discovered,
    baseline: { status: 'PASS', workspaceIsolation: 'isolated' },
    probes: results,
    errors: [],
  };
}

function parseArgs(argv) {
  const args = { workspace: null, plan: null, output: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--workspace') args.workspace = argv[++i];
    else if (argv[i] === '--plan') args.plan = argv[++i];
    else if (argv[i] === '--output') args.output = argv[++i];
    else throw new Error('unknown argument: ' + argv[i]);
  }
  if (!args.workspace || !args.plan) throw new Error('Usage: node node-probe-adapter.js --workspace <project> --plan <probe-plan.json> [--output report.json]');
  return args;
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    const workspace = path.resolve(args.workspace);
    const plan = JSON.parse(fs.readFileSync(path.resolve(args.plan), 'utf8'));
    const report = executePlan(workspace, plan);
    const json = JSON.stringify(report, null, 2) + '\n';
    if (args.output) {
      fs.mkdirSync(path.dirname(path.resolve(args.output)), { recursive: true });
      fs.writeFileSync(path.resolve(args.output), json, 'utf8');
    }
    process.stdout.write(json);
    process.exitCode = report.result === 'PROTECTED' ? 0 : report.result === 'SURVIVED' ? 1 : 2;
  } catch (error) {
    console.error('[Contract Probe Adapter] ' + error.message);
    process.exitCode = 2;
  }
}

if (require.main === module) main();

module.exports = {
  ADAPTER,
  VERSION,
  applyProbe,
  discoverProject,
  executePlan,
  runScript,
  safeRelative,
  validatePlan,
};
