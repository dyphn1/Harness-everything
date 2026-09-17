#!/usr/bin/env node
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;

function check(condition, message) {
  if (condition) console.log(`  PASS ${message}`);
  else { console.error(`  FAIL ${message}`); failed++; }
}

function runNode(args, options = {}) {
  return spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', ...options });
}

console.log('=== Workflow Execution Enforcement ===');

for (const rel of [
  'harness-everything/scripts/kernel-router.js',
  'harness-everything/scripts/kernel-router-core.js',
  'hooks/scripts/workflow-gate.js',
  'hooks/scripts/workflow-stop-gate.js',
  'hooks/scripts/workflow-disposition.js',
]) {
  const result = runNode(['--check', path.join(ROOT, rel)]);
  check(result.status === 0, `${rel} parses as valid JavaScript`);
}

const routed = runNode([
  path.join(ROOT, 'harness-everything/scripts/kernel-router.js'),
  'audit the entire repository architecture and coordinate multiple modules',
]);
check(routed.status === 0, 'enforced kernel route exits successfully');
check(routed.stdout.includes('"strategy":"fable-staged"'), 'macro prompt selects fable-staged');
check(routed.stdout.includes('WORKFLOW EXECUTION CONTRACT (MANDATORY WHEN SELECTED)'), 'wrapper emits mandatory execution contract');
check(routed.stdout.includes('Execute the selected workflow to resolution'), 'wrapper requires workflow resolution');
check(routed.stdout.includes('workflow-uncovered-scope'), 'wrapper exposes only explicit evidence-backed escape path');
check(!routed.stdout.includes('execution remains advisory after evaluation'), 'wrapper removes advisory-execution runtime wording');

const disposition = fs.readFileSync(path.join(ROOT, 'hooks/scripts/workflow-disposition.js'), 'utf8');
check(disposition.includes("'workflow-uncovered-scope'"), 'escape supports workflow-uncovered-scope');
check(disposition.includes("'host-capability-unavailable'"), 'escape supports host-capability-unavailable');
check(disposition.includes('generic simple/routine/already-clear reasons are intentionally rejected'), 'generic confidence-based escape reasons are rejected');
check(disposition.includes('--scope is required') && disposition.includes('--evidence is required') && disposition.includes('--stage-id must name'), 'escape requires a declared stage, scope and evidence');

const hooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'hooks/hooks.json'), 'utf8'));
check((hooks.hooks.PreToolUse || []).some(entry => entry.id === 'harness:pre:workflow-gate'), 'Claude hook wiring includes pre-mutation workflow gate');
check((hooks.hooks.Stop || []).some(entry => entry.id === 'harness:stop:workflow-completion-gate'), 'Claude hook wiring includes workflow completion gate');

const pluginHooks = JSON.parse(fs.readFileSync(path.join(ROOT, 'plugins/harness-everything/hooks/hooks.json'), 'utf8'));
check((pluginHooks.hooks.PreToolUse || []).some(entry => (entry.hooks || []).some(hook => /workflow-gate\.js/.test(hook.command || ''))), 'OpenAI plugin hook package carries workflow gate adapter');
check((pluginHooks.hooks.Stop || []).some(entry => (entry.hooks || []).some(hook => /workflow-stop-gate\.js/.test(hook.command || ''))), 'OpenAI plugin hook package carries workflow completion adapter');

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: workflow execution enforcement (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);
