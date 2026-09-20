#!/usr/bin/env node
'use strict';
const fs = require('fs'), path = require('path'), { spawnSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const runtime = require(path.join(ROOT, 'hooks/scripts/lib/workflow-runtime.js'));
let failed=0;
function check(c,m){if(c)console.log('  PASS '+m);else{console.error('  FAIL '+m);failed++;}}
function runNode(args){return spawnSync(process.execPath,args,{cwd:ROOT,encoding:'utf8'});}
console.log('=== Workflow Guidance Contract ===');
for(const rel of ['harness-everything/scripts/kernel-router.js','hooks/scripts/workflow-gate.js','hooks/scripts/workflow-stop-gate.js','hooks/scripts/workflow-disposition.js','hooks/scripts/state-persist.js','hooks/scripts/rule-of-3.js','hooks/scripts/rule-of-3-tracker.js'])check(runNode(['--check',path.join(ROOT,rel)]).status===0,rel+' parses as valid JavaScript');
const ctx={workflow:{workflowPlan:{limits:{maxIterations:8,maxRevisionRounds:2,maxReplans:2,maxWorkers:4}}}};
for(const type of ['iteration','revision','replan','worker-acquire'])check(runtime.recordBudgetEvent(ctx,type,{evidence:'fixture'}).advisory===true,type+' is advisory rather than blocking');
check(runtime.mutationProbeReservations(ctx)===0,'mutation probes reserve no capacity');
check(runtime.registerMutationProbe(ctx,'x','y')===null,'mutation probe registration is a no-op');
check(runtime.resetWorkflowBudget(ctx,'legacy').retired===true,'reset-budget API is retired compatibility only');
check(!runtime.WORKFLOW_CONTROLLER_COMMANDS.has('reset-budget'),'reset-budget is no longer a controller command');
const rs=fs.readFileSync(path.join(ROOT,'hooks/scripts/lib/workflow-runtime.js'),'utf8');
check(!rs.includes('.mutation-probes.lock'),'runtime contains no mutation-probe lock');
check(!rs.includes('budget-exhausted'),'runtime contains no budget-exhausted transition');
const gs=fs.readFileSync(path.join(ROOT,'hooks/scripts/workflow-gate.js'),'utf8');
check(!gs.includes('registerMutationProbe')&&!gs.includes('recordBudgetEvent'),'workflow gate has no probe/budget enforcement');
check(gs.includes('[Workflow Reminder]'),'workflow gate emits reminders');
const r3=fs.readFileSync(path.join(ROOT,'hooks/scripts/rule-of-3.js'),'utf8');
check(r3.includes('state.count >= 3'),'Rule of 3 uses fixed third-failure boundary');
check(!r3.includes('blockForHumanDecision'),'Rule of 3 has no second-stage permanent hard lock');
const tr=fs.readFileSync(path.join(ROOT,'hooks/scripts/rule-of-3-tracker.js'),'utf8');
check(!tr.includes('threshold = 2')&&!tr.includes('threshold = 4'),'Rule of 3 has no category-specific thresholds');
const oc=fs.readFileSync(path.join(ROOT,'opencode-plugin/index.mjs'),'utf8');
check(!oc.includes('action: "hard_lock"'),'OpenCode has no permanent hard-lock action');
const hk=JSON.parse(fs.readFileSync(path.join(ROOT,'hooks/hooks.json'),'utf8'));
check(!hk.hooks.PermissionDenied,'obsolete mutation-probe PermissionDenied hook is removed');
console.log('\n'+(failed===0?'PASS':'FAIL')+': workflow guidance contract ('+failed+' failures)');
process.exit(failed===0?0:1);
