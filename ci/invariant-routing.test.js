#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
let failed = 0;

function check(condition, message) {
  if (condition) {
    console.log(`  PASS ${message}`);
  } else {
    console.error(`  FAIL ${message}`);
    failed++;
  }
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

console.log('=== Invariant-First Routing Contract ===');

const kernel = path.join(ROOT, 'harness-everything', 'scripts', 'kernel-router.js');
const tier2 = spawnSync(process.execPath, [kernel, 'add a login endpoint with tests and update the implementation'], {
  cwd: ROOT,
  encoding: 'utf8',
});

check(tier2.status === 0, 'kernel router exits successfully');
check(/RECOMMENDED TIER:\s*Tier 2/i.test(tier2.stdout), 'classifier result is preserved');
check(tier2.stdout.includes('REQUIRED HARNESS INVARIANTS'), 'kernel emits mandatory invariants');
check(tier2.stdout.includes('Route before execution'), 'route-before-execution invariant is present');
check(tier2.stdout.includes('Verify before claim'), 'verify-before-claim invariant is present');
check(tier2.stdout.includes('after 3 same-signature failures'), 'failure escalation invariant is present');
check(tier2.stdout.includes('SUGGESTED SKILLS (ADVISORY'), 'domain skills are explicitly advisory');
check(tier2.stdout.includes('tdd:'), 'Tier 2 can still recommend TDD');
check(!tier2.stdout.includes('BASE EXECUTION LOOP'), 'legacy fixed base-execution-loop output is suppressed');
check(tier2.stdout.includes('Do not enforce workflow order'), 'self-orchestration policy is explicit');

const tier3 = spawnSync(process.execPath, [kernel, 'audit the entire repository architecture and coordinate multiple modules'], {
  cwd: ROOT,
  encoding: 'utf8',
});
check(tier3.status === 0, 'Tier 3 kernel routing exits successfully');
check(/RECOMMENDED TIER:\s*Tier 3/i.test(tier3.stdout), 'macro task remains Tier 3');
check(tier3.stdout.includes('fable-mode / fable-discipline'), 'Tier 3 can still suggest Fable capabilities');
check(tier3.stdout.includes('use selectively'), 'Tier 3 suggestions remain non-mandatory');

const harnessSkill = read('harness-everything/SKILL.md');
check(!/Requests that already name a skill/i.test(harnessSkill), 'harness entrypoint no longer opts out when another skill is named');
check(/including work that already names or strongly matches another skill/i.test(harnessSkill), 'named domain skills still pass through Harness routing');
check(/not a fixed pipeline/i.test(harnessSkill), 'skill contract rejects fixed pipeline semantics');

const cognitiveSkill = read('install-cognitive-os/SKILL.md');
check(/policy, not a required peer-skill selection/i.test(cognitiveSkill), 'Cognitive OS is defined as policy rather than peer-skill dependency');
check(!/Tasks already governed by a more specific domain skill/i.test(cognitiveSkill), 'domain skill selection no longer disables Cognitive OS policy');

const hooks = JSON.parse(read('hooks/hooks.json'));
const promptHooks = hooks.hooks && hooks.hooks.UserPromptSubmit;
const command = promptHooks && promptHooks[0] && promptHooks[0].hooks && promptHooks[0].hooks[0] && promptHooks[0].hooks[0].command;
check(command === 'node harness-everything/scripts/kernel-router.js', 'UserPromptSubmit runs the Harness kernel before peer-skill execution');

const triageDoc = read('harness-everything/references/triage-and-tiers.md');
check(triageDoc.includes('Do not enforce workflow order. Enforce workflow invariants.'), 'architecture reference records the invariant-first decision');
check(triageDoc.includes('A tier is **not** a fixed pipeline'), 'tier documentation rejects rigid orchestration');
check(!triageDoc.includes('MUST load `todo-driven-workflow`'), 'documentation no longer mandates TODO as universal Tier 2/3 first step');
check(triageDoc.includes('```mermaid'), 'updated architecture retains executable flowchart documentation');

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'}: invariant routing contract (${failed} failure${failed === 1 ? '' : 's'})`);
process.exit(failed === 0 ? 0 : 1);
