#!/usr/bin/env node
'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const router = require(path.join(ROOT, 'harness-everything', 'scripts', 'router-contract.js'));

const tier3 = router.buildRouterContract({
  routingStatus: 'ok',
  recommendedTier: 'Tier 3',
  rationale: 'major architecture change',
  signals: { macroScope: true, dependentStages: true },
}).workflowPlan;

assert.strictEqual(tier3.strategy, 'fable-staged');
assert.ok(tier3.requiredInvariants.includes('isolated-worktree-before-mutation'), 'Tier 3 plan must carry mutation isolation invariant');
assert.ok(tier3.suggestedSkills.includes('using-git-worktrees'), 'Tier 3 plan must surface the worktree workflow');
assert.strictEqual(tier3.workspace.required, false, 'Git worktree isolation must remain distinct from durable multi-agent workspace state');

const tier2 = router.buildRouterContract({
  routingStatus: 'ok',
  recommendedTier: 'Tier 2',
  rationale: 'bounded bug fix',
  signals: { tier2Keyword: true },
}).workflowPlan;

assert.strictEqual(tier2.strategy, 'iterative-single');
assert.ok(!tier2.requiredInvariants.includes('isolated-worktree-before-mutation'), 'Tier 2 must not be globally forced into major-workflow isolation');
assert.ok(!tier2.suggestedSkills.includes('using-git-worktrees'), 'Tier 2 keeps worktree use task-dependent');

const explicitFable = router.buildWorkflowPlan({
  routingStatus: 'ok',
  tier: 'tier3',
  taskShape: router.buildTaskShape({
    tier: 'tier3',
    signals: { macroScope: true, dependentStages: true },
    explicitRequest: { strategy: 'fable-staged' },
  }),
});
assert.ok(explicitFable.requiredInvariants.includes('isolated-worktree-before-mutation'), 'direct buildWorkflowPlan callers receive the same isolation contract');

console.log('PASS: router major-workflow plan carries worktree isolation independently of multi-agent workspace state.');
