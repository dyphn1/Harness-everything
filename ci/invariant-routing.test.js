#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),{spawnSync:spawnNodeSync}=require('child_process');
function spawnSync(command,args,options={}){
 const {systemOneMode='off',...spawnOptions}=options;
 return spawnNodeSync(command,args,{...spawnOptions,env:{...process.env,...(spawnOptions.env||{}),HARNESS_SYSTEM_ONE_MODE:systemOneMode}});
}
const ROOT=path.resolve(__dirname,'..');let failed=0;
function check(c,m){if(c)console.log('  PASS '+m);else{console.error('  FAIL '+m);failed++;}}
function read(p){return fs.readFileSync(path.join(ROOT,p),'utf8');}
console.log('=== Semantic Contract-Strength Routing Contract ===');
const kernel=path.join(ROOT,'harness-everything/scripts/kernel-router.js');
function runKernel(prompt, {systemOneMode='off'}={}){
 return spawnSync(process.execPath,[kernel,prompt],{cwd:ROOT,encoding:'utf8',systemOneMode});
}
const priorMode=process.env.HARNESS_SYSTEM_ONE_MODE;
let inheritedLive;
try{
 process.env.HARNESS_SYSTEM_ONE_MODE='live';
 inheritedLive=runKernel('add a login endpoint with tests and update the implementation');
}finally{
 if(priorMode===undefined)delete process.env.HARNESS_SYSTEM_ONE_MODE;
 else process.env.HARNESS_SYSTEM_ONE_MODE=priorMode;
}
check(inheritedLive.status===0&&!inheritedLive.stdout.includes('SYSTEM ONE REFERENCE CONFIDENCE'),'kernel routing fixture ignores inherited live mode unless explicitly selected');
const explicitLive=runKernel('add a login endpoint with tests and update the implementation',{systemOneMode:'live'});
check(explicitLive.status===0&&explicitLive.stdout.includes('SYSTEM ONE REFERENCE CONFIDENCE'),'kernel routing fixture retains an explicit live-mode control');
const tier2=runKernel('add a login endpoint with tests and update the implementation');
check(tier2.status===0,'kernel router exits successfully');
check(/RECOMMENDED TIER:\s*Tier 2/i.test(tier2.stdout),'classifier result is preserved');
check(tier2.stdout.includes('"strategy":"iterative-single"'),'Tier 2 selects iterative-single workflow');
const planMatch=tier2.stdout.match(/ROUTER WORKFLOW PLAN \(JSON\): ([^\r\n]+)/);
const plan=planMatch?JSON.parse(planMatch[1]):{};
check(!plan.requiredInvariants?.includes('replan-after-repeated-failure'),'router plan does not require recurrence-triggered replanning');
check(plan.requiredInvariants?.includes('loop-awareness'),'iterative work retains loop-awareness');
check(plan.requiredInvariants?.includes('objective-verification'),'iterative work retains objective verification');
check(!tier2.stdout.includes('MUST stop micro-retrying after 3 same-signature failures'),'emitted prompt omits the Rule-of-3 invariant text');
check(!tier2.stdout.includes('Rule-of-3 zoom-out'),'emitted prompt omits the forced-reflection boundary');
check(tier2.stdout.includes('explicit user/host permission boundaries'),'emitted prompt retains the permission boundary');
const kernelSource=read('harness-everything/scripts/kernel-router.js');
check(/hardBoundaries:\s*\['user-host-permission'\]/.test(kernelSource),'machine-readable hardBoundaries retain only the permission boundary');
check(tier2.stdout.includes('loop-awareness:'),'iterative work exposes loop-awareness instead of a hard budget');
check(tier2.stdout.includes('ACTIVE-STEP KNOWLEDGE BINDINGS (MUST)'),'active-step binding resolution is explicitly mandatory');
check(tier2.stdout.includes('ORCHESTRATION POLICY: Selected-topology required obligations and applicable skill core contracts are semantic MUSTs'),'orchestration policy preserves semantic MUST obligations');
check(tier2.stdout.includes('WORKFLOW SEMANTIC CONTRACT (NON-BLOCKING OBSERVATION)'),'kernel separates semantic contract from non-blocking observation');
check(tier2.stdout.includes('Tier 3 / Fable broad mutation MUST resolve isolation'),'worktree isolation disposition is a semantic MUST');
check(!tier2.stdout.includes('SELECTED WORKFLOW IS GUIDANCE'),'old planning-guidance label is absent');
check(!tier2.stdout.includes('unavailable isolation means BLOCKED'),'old worktree hard-block wording is absent');
check(tier2.stdout.includes('future-step bindings remain undisclosed'),'future step knowledge stays undisclosed');
check(tier2.stdout.includes('unknown/unavailable binding stays visible and unresolved'),'required binding gaps remain visible without adding a lock');
check(!tier2.stdout.includes('evaluate-suggestions-before-skip'),'global read-every-suggestion invariant is removed');
check(tier2.stdout.includes('visible-status-updates'),'workflow plan carries mandatory user-visible status invariant');
check(tier2.stdout.includes('USER-VISIBLE HARNESS STATUS CONTRACT (MUST)'),'kernel emits the mandatory unified status contract');
for(const field of ['### 🚦 Harness Status','- **Current:**','- **Read / Evidence:**','- **Next:**','- **Risk / Blocked:**']){
  check(tier2.stdout.includes(field),'kernel status contract includes readable Markdown field '+field);
}
check(tier2.stdout.includes('HARNESS ROUTING CHECKPOINT (INTERNAL SOURCE STATE — DO NOT RENDER SEPARATELY)'),'routing checkpoint is marked internal rather than user-facing');
check(!tier2.stdout.includes('HARNESS ROUTING CHECKPOINT (REQUIRED VISIBLE STATE)'),'legacy duplicate-visible checkpoint label is absent');
check(tier2.stdout.includes('nested bullets when there are multiple items'),'kernel tells agents to split dense evidence into nested bullets');
check(tier2.stdout.includes('semantic communication MUST, not a hard execution lock'),'kernel separates semantic MUST from mechanical blocking');

const tier3=runKernel('audit the entire repository architecture and coordinate multiple modules');
check(tier3.status===0,'Tier 3 routing exits successfully');
check(/RECOMMENDED TIER:\s*Tier 3/i.test(tier3.stdout),'macro task remains Tier 3');
check(tier3.stdout.includes('isolated-worktree-before-mutation'),'Tier 3 keeps the worktree isolation invariant');
check(!tier3.stdout.includes('using-git-worktrees/SKILL.md'),'Tier 3 does not push a global worktree skill path');
check(tier3.stdout.includes('Tier 3 / Fable broad mutation MUST resolve isolation'),'Tier 3 requires an isolation disposition without a hard lock');

const hs=read('harness-everything/SKILL.md');
check(/required obligations are MUST; tactics MAY adapt/i.test(hs),'Harness skill separates required obligations from adaptable tactics');
check(/only explicit user\/host permission boundaries may block/i.test(hs)&&!/Rule-of-3|after 3 same-signature failures/i.test(hs),'Harness skill retains permission boundaries without recurrence blocking');
check(/Surface status \(MUST\).*Harness Status/i.test(hs)&&/Read \/ Evidence/i.test(hs),'Harness skill requires the readable unified user-visible status');
check(read('plugins/harness-everything/skills/harness-everything/SKILL.md')===hs,'Harness skill mirror matches');

const wt=read('using-git-worktrees/SKILL.md');
check(/Tier 3 \/ Fable \(MUST resolve\)/i.test(wt)&&/explicit degraded fallback/i.test(wt),'worktree skill requires isolation disposition but permits degraded fallback');
check(!/Creation\/entry failure => `BLOCKED`/i.test(wt),'worktree creation failure is not a cognitive blocked state');
check(read('plugins/harness-everything/skills/using-git-worktrees/SKILL.md')===wt,'worktree skill mirror matches');

const triage=read('harness-everything/references/triage-and-tiers.md');
check(/Contract-first lifecycle/i.test(triage),'triage reference uses contract-first policy');
check(/User-visible status contract/i.test(triage)&&/Harness Status/i.test(triage)&&/MUST/i.test(triage),'triage defines the mandatory unified status contract');
check(read('plugins/harness-everything/skills/harness-everything/references/triage-and-tiers.md')===triage,'triage mirror matches');

for(const p of ['docs/routing.md','docs/architecture.md','docs/philosophy.md']){
 const t=read(p); check(/MUST/i.test(t)&&/MAY/i.test(t),'current doc '+p+' preserves explicit semantic strength');
}
for(const p of ['docs/routing.md','docs/architecture.md','docs/workflow-runtime.md']){
 const t=read(p); check(/Harness Status/i.test(t)&&/MUST/i.test(t),'current doc '+p+' defines mandatory user-visible status');
}
const philosophy=read('docs/philosophy.md');
check(/Contract Strength: MUST \/ SHOULD \/ MAY/i.test(philosophy),'philosophy defines canonical MUST/SHOULD/MAY strength');
for(const phrase of [
  'Route before software/project execution',
  'Resolve active required skill/reference bindings before their step',
  'Resolve selected-topology invariants/stages/checks/synthesis/verification',
  'Discover relevant environment/host facts',
  'Resolve Tier-3/Fable isolation before broad mutation',
  'Numeric iteration/revision/replan/worker values',
  'Durable memory writes'
]){
  check(philosophy.includes(phrase),'contract-strength audit classifies '+phrase);
}
check(!/Applicable workflow is guidance:/i.test(philosophy),'old ambiguous philosophy wording is removed');

const advisory=read('scripts/lib/advisory-text.js');
check(/Selected-topology required obligations are MUSTs/i.test(advisory)&&/numeric.*MAY guide planning/i.test(advisory),'instruction-only installer preserves MUST/MAY semantics');
check(/USER-VISIBLE STATUS \(MUST\)/i.test(advisory)&&/### 🚦 Harness Status/i.test(advisory)&&/\*\*Read \/ Evidence:\*\*/i.test(advisory),'instruction-only installers carry the readable mandatory status contract');
check(/zoom-out.*meaningful signal/i.test(advisory)&&/productive iterations may continue/i.test(advisory)&&/Permission boundaries are separate/i.test(advisory)&&!/after 3 same-signature failures/i.test(advisory),'installer text permits agent-initiated reassessment and preserves permission boundaries');
check(read('plugins/harness-everything/scripts/lib/advisory-text.js')===advisory,'OpenAI advisory mirror matches');

const agents=read('AGENTS.md');
check(/Selected workflow is a semantic contract/i.test(agents),'repository agent contract is contract-first');
check(/User-visible Harness Status is mandatory/i.test(agents)&&/### 🚦 Harness Status/i.test(agents)&&/nested evidence bullets/i.test(agents),'repository agent contract requires readable unified user-visible status');
check(/Tier-3\/Fable isolation disposition is mandatory/i.test(agents)&&/degraded fallback/i.test(agents),'repository worktree rule requires disposition without hard lock');

const architectureSkill=read('improve-codebase-architecture/SKILL.md');
check(/3 same-signature failures.*zoom-out/i.test(architectureSkill),'architecture skill aligns rollback with the third same-signature failure');
check(!/>3 cascading errors/i.test(architectureSkill),'architecture skill no longer waits beyond the Rule-of-3 threshold');
check(read('plugins/harness-everything/skills/improve-codebase-architecture/SKILL.md')===architectureSkill,'architecture skill mirror matches');

const envSkill=read('environment-detection/SKILL.md');
check(/semantic \*\*MUST\*\*/i.test(envSkill)&&/environment-sensitive/i.test(envSkill),'environment discovery is a conditional semantic MUST');
check(read('plugins/harness-everything/skills/environment-detection/SKILL.md')===envSkill,'environment skill mirror matches');

const commitSkill=read('git-commit/SKILL.md');
check(/MUST.*git diff --cached/i.test(commitSkill)&&/SHOULD.*split/i.test(commitSkill),'commit skill separates staged-diff MUST from split SHOULD');
check(read('plugins/harness-everything/skills/git-commit/SKILL.md')===commitSkill,'git-commit skill mirror matches');

const hooks=JSON.parse(read('hooks/hooks.json'));
check((hooks.hooks.PreToolUse||[]).some(e=>e.id==='harness:pre:workflow-gate'),'Claude packages workflow reminder hook');
check((hooks.hooks.PreToolUse||[]).some(e=>e.id==='harness:pre:action-gate'),'Claude preserves action permission gate');

console.log('\n'+(failed===0?'PASS':'FAIL')+': semantic contract-strength routing contract ('+failed+' failures)');
process.exit(failed===0?0:1);
