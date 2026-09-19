#!/usr/bin/env node
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const FIXTURE = path.join(ROOT, 'contract-integrity', 'fixtures', 'node-probe-project');
const ADAPTER = path.join(ROOT, 'contract-integrity', 'scripts', 'node-probe-adapter.js');
const { applyProbe, executePlan, validatePlan } = require(ADAPTER);
const { evaluateTrace } = require(path.join(ROOT, 'contract-integrity', 'scripts', 'audit.js'));

let failed = 0;
function check(condition, message, detail = '') {
  if (condition) console.log('  PASS ' + message);
  else {
    console.error('  FAIL ' + message + (detail ? ' — ' + detail : ''));
    failed++;
  }
}
function clone(value) {
  return JSON.parse(JSON.stringify(value));
}
function json(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function digest(file) {
  return require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

console.log('=== Contract Integrity Phase 3 Node Probe Adapter (#84) ===');

const plan = json(path.join(FIXTURE, 'probe-plan.json'));
check(validatePlan(plan).length === 0, 'declared node-npm-v1 probe plan validates');

const beforeSource = digest(path.join(FIXTURE, 'src', 'limit.js'));
const beforeTest = digest(path.join(FIXTURE, 'test', 'contract.test.js'));
const protectedReport = executePlan(FIXTURE, plan);
check(protectedReport.result === 'PROTECTED', 'green baseline plus both explicit probes produces PROTECTED evidence');
check(protectedReport.probes.length === 2 && protectedReport.probes.every(probe =>
  probe.status === 'KILLED' && probe.failureClass === 'contract' && probe.workspaceIsolation === 'isolated'),
  'env and exact-replace probes are killed only by expected contract failures');
check(digest(path.join(FIXTURE, 'src', 'limit.js')) === beforeSource &&
  digest(path.join(FIXTURE, 'test', 'contract.test.js')) === beforeTest,
  'adapter never mutates the source workspace');
check(!JSON.stringify(protectedReport).includes('out-of-range input must be rejected'),
  'probe report retains output hashes/evidence refs instead of project test output');

const trace = json(path.join(ROOT, 'contract-integrity', 'fixtures', 'consistent-trace.json'));
trace.probes = protectedReport.probes.filter(probe => probe.probeId === 'PROBE-001').map(probe => ({
  probeId: probe.probeId,
  requirementId: probe.requirementId,
  status: probe.status,
  sourceSection: probe.sourceSection,
  evidenceRef: probe.evidenceRef,
  workspaceIsolation: probe.workspaceIsolation,
  failureClass: probe.failureClass,
}));
const tdd = json(path.join(ROOT, 'tdd', 'fixtures', 'pass-evidence.json'));
tdd.requirements[0].source.path = 'docs/specs/api.md';
tdd.requirements[0].source.section = 'REQ-001';
const integrated = evaluateTrace(trace, { tddEvidence: tdd });
check(integrated.result === 'PASS' && integrated.scores.protectionScore === 100,
  'derived adapter evidence feeds the existing #84/#58 strict integrity gate');

const survivingPlan = clone(plan);
survivingPlan.probes = [clone(plan.probes[0])];
survivingPlan.probes[0].env.HARNESS_CONTRACT_PROBE = 'noop';
const surviving = executePlan(FIXTURE, survivingPlan);
check(surviving.result === 'SURVIVED' && surviving.probes[0].status === 'SURVIVED',
  'green test run under a required probe is explicitly SURVIVED, never PASS');
const weakTrace = clone(trace);
weakTrace.probes[0] = {
  probeId: surviving.probes[0].probeId,
  requirementId: surviving.probes[0].requirementId,
  status: surviving.probes[0].status,
  sourceSection: surviving.probes[0].sourceSection,
  evidenceRef: surviving.probes[0].evidenceRef,
  workspaceIsolation: surviving.probes[0].workspaceIsolation,
  failureClass: surviving.probes[0].failureClass,
};
const weakAudit = evaluateTrace(weakTrace, { tddEvidence: tdd });
check(weakAudit.result === 'FAIL' && weakAudit.scores.completenessScore === 100 &&
  weakAudit.scores.protectionScore === 0,
  'green but weak suite cannot compensate 100 completeness with a surviving contract probe');

const unrelatedPlan = clone(plan);
unrelatedPlan.probes = [clone(plan.probes[0])];
unrelatedPlan.probes[0].expectedFailureContains = 'THIS-MARKER-DOES-NOT-EXIST';
const unrelated = executePlan(FIXTURE, unrelatedPlan);
check(unrelated.probes[0].status === 'INVALID' && unrelated.probes[0].failureClass === 'unknown',
  'unrelated failing test output is INVALID and cannot be credited as a kill');

const ambiguousReplace = clone(plan);
ambiguousReplace.probes = [clone(plan.probes[1])];
ambiguousReplace.probes[0].find = 'return';
const ambiguous = executePlan(FIXTURE, ambiguousReplace);
check(ambiguous.probes[0].status === 'NOT_EVALUATED' &&
  /exactly once/.test(ambiguous.probes[0].adapterReason),
  'ambiguous exact-replace fallback fails closed without mutating source');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-contract-adapter-test-'));
try {
  const symlinkWorkspace = path.join(temp, 'symlink-workspace');
  fs.mkdirSync(symlinkWorkspace, { recursive: true });
  const outsideTarget = path.join(temp, 'outside.txt');
  fs.writeFileSync(outsideTarget, 'SAFE', 'utf8');
  fs.symlinkSync(outsideTarget, path.join(symlinkWorkspace, 'linked.txt'));
  let symlinkRejected = false;
  try {
    applyProbe(symlinkWorkspace, {
      strategy: 'replace',
      target: 'linked.txt',
      find: 'SAFE',
      replace: 'MUTATED',
    });
  } catch (error) {
    symlinkRejected = /symbolic link|reparse-point|outside isolated workspace/.test(String(error.message || error));
  }
  check(symlinkRejected && fs.readFileSync(outsideTarget, 'utf8') === 'SAFE',
    'replace probe rejects symlink/reparse escape without mutating outside the isolated workspace');

  const dependent = path.join(temp, 'dependent');
  fs.cpSync(FIXTURE, dependent, { recursive: true });
  const pkg = json(path.join(dependent, 'package.json'));
  pkg.dependencies = { leftpad: '1.0.0' };
  fs.writeFileSync(path.join(dependent, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
  const dependencyReport = executePlan(dependent, plan);
  check(dependencyReport.result === 'NOT_EVALUATED' &&
    dependencyReport.discovery.reason === 'external-dependencies-not-supported-v1',
    'v1 adapter refuses to infer/install external dependencies');

  const broken = path.join(temp, 'broken');
  fs.cpSync(FIXTURE, broken, { recursive: true });
  fs.appendFileSync(path.join(broken, 'test', 'contract.test.js'), "\nthrow new Error('baseline fixture failure');\n", 'utf8');
  const baselineFailure = executePlan(broken, plan);
  check(baselineFailure.result === 'NOT_EVALUATED' &&
    baselineFailure.baseline.status === 'FAIL' &&
    baselineFailure.probes.every(probe => probe.status === 'NOT_EVALUATED'),
    'non-green baseline blocks all protection claims');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}

const invalidPlan = clone(plan);
invalidPlan.probes[0].target = '../escape.js';
invalidPlan.probes[0].strategy = 'replace';
invalidPlan.probes[0].find = 'x';
invalidPlan.probes[0].replace = 'y';
delete invalidPlan.probes[0].env;
check(validatePlan(invalidPlan).some(error => /repo-relative/.test(error)),
  'probe plan rejects replace targets that escape the isolated workspace');

const protectedCli = spawnSync(process.execPath, [
  ADAPTER, '--workspace', FIXTURE, '--plan', path.join(FIXTURE, 'probe-plan.json'),
], { encoding: 'utf8' });
check(protectedCli.status === 0 && /"result": "PROTECTED"/.test(protectedCli.stdout),
  'CLI returns exit 0 only for fully killed declared probes', protectedCli.stderr);

const docs = fs.readFileSync(path.join(ROOT, 'contract-integrity', 'ADAPTERS.md'), 'utf8');
check(/does \*\*not\*\* claim generic mutation-testing support/.test(docs) &&
  /zero external npm dependencies/.test(docs) &&
  /Not yet supported/.test(docs),
  'adapter documentation states exact supported scope and explicit non-support');

console.log('\n' + (failed === 0 ? 'PASS' : 'FAIL') +
  ': #84 contract protection node adapter (' + failed + ' failure' + (failed === 1 ? '' : 's') + ')');
process.exit(failed === 0 ? 0 : 1);
