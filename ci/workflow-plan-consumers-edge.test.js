#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-phase3-edge-'));
const workspace = path.join(tempRoot, 'workspace');
const stateHome = path.join(tempRoot, 'state-home');
fs.mkdirSync(path.join(workspace, '.git'), { recursive: true });
process.env.HARNESS_STATE_HOME = stateHome;

const { buildRouterContract } = require(path.join(ROOT, 'harness-everything', 'scripts', 'router-contract.js'));
const { prepareRun } = require(path.join(ROOT, 'fable-mode', 'scripts', 'workflow-plan-consumer.js'));
const { pathWithinScope } = require(path.join(ROOT, 'hooks', 'scripts', 'lib', 'fable-contracts.js'));

let failed = 0;
function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`);
  else { console.error(`  FAIL ${message}`); failed++; }
}

const staged = buildRouterContract({
  routingStatus: 'ok',
  recommendedTier: 'Tier 3 (Macro Task)',
  rationale: 'phase3 edge fixture',
  reasonCodes: ['phase3-edge'],
  signals: { macroScope: true, dependentStages: true },
});

const overlapping = prepareRun({
  routerContract: staged,
  workspaceRoot: workspace,
  runId: 'staged-overlap',
  stages: [
    { stageId: 'a', goal: 'a', agent: 'worker', task: 'a', dependsOn: [], writeSet: ['src/shared'], inputs: [], expectedOutputs: [] },
    { stageId: 'b', goal: 'b', agent: 'worker', task: 'b', dependsOn: [], writeSet: ['src/shared/file.js'], inputs: [], expectedOutputs: [] },
  ],
});
check(JSON.stringify(overlapping.execution.batches) === JSON.stringify([['a'], ['b']]), 'fable-staged serializes overlapping writers instead of rejecting them');
check(pathWithinScope('src/auth/token.js', 'src/auth'), 'scope matcher accepts already-normalized paths');

const isolated = prepareRun({
  routerContract: staged,
  workspaceRoot: workspace,
  runId: 'session-b-only',
  sessionId: 'session-b',
  stages: [{
    stageId: 'verify', goal: 'verify', agent: 'fable-verifier', task: 'verify', dependsOn: [], writeSet: [],
    inputs: [], expectedOutputs: [], checkCommand: 'node --test isolated.test.js', passCondition: 'exit 0',
  }],
});
const hook = path.join(ROOT, 'hooks', 'scripts', 'contract-test.js');
const result = spawnSync(process.execPath, [hook], {
  cwd: workspace,
  input: JSON.stringify({
    hook_event_name: 'PostToolUse', tool_name: 'Bash', session_id: 'session-a', cwd: workspace,
    tool_input: { command: 'node --test isolated.test.js' }, tool_response: { exitCode: 0, stdout: 'PASS' },
  }),
  encoding: 'utf8',
  env: { ...process.env, HARNESS_STATE_HOME: stateHome },
});
check(result.status === 0 && /session|correlat|resolve/i.test(result.stderr), 'a cross-session check is reported without resolving the run contract');
const manifest = JSON.parse(fs.readFileSync(path.join(isolated.runRoot, 'contracts', 'verify.json'), 'utf8'));
check(manifest.status === 'planned', 'cross-session check leaves the target contract unmodified');

try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch (_) {}
console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: #85 Phase 3 edge contracts (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);
