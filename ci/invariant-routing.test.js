#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..');let failed=0;
function check(c,m){if(c)console.log('  PASS '+m);else{console.error('  FAIL '+m);failed++;}}
function read(p){return fs.readFileSync(path.join(ROOT,p),'utf8');}
console.log('=== Semantic Contract-Strength Routing Contract ===');
const kernel=path.join(ROOT,'harness-everything/scripts/kernel-router.js');
const tier2=spawnSync(process.execPath,[kernel,'add a login endpoint with tests and update the implementation'],{cwd:ROOT,encoding:'utf8'});
check(tier2.status===0,'kernel router exits successfully');
check(/RECOMMENDED TIER:\s*Tier 2/i.test(tier2.stdout),'classifier result is preserved');
check(tier2.stdout.includes('"strategy":"iterative-single"'),'Tier 2 selects iterative-single workflow');
check(tier2.stdout.includes('loop-awareness:'),'iterative work exposes loop-awareness instead of a hard budget');
check(tier2.stdout.includes('WORKFLOW SKILLS (APPLICABILITY MUST BE RESOLVED)'),'skill applicability is explicitly mandatory');
check(tier2.stdout.includes('ORCHESTRATION POLICY: Selected-topology required obligations and applicable skill core contracts are semantic MUSTs'),'orchestration policy preserves semantic MUST obligations');
check(tier2.stdout.includes('WORKFLOW SEMANTIC CONTRACT (NON-BLOCKING OBSERVATION)'),'kernel separates semantic contract from non-blocking observation');
check(tier2.stdout.includes('Tier 3 / Fable broad mutation MUST resolve isolation'),'worktree isolation disposition is a semantic MUST');
check(!tier2.stdout.includes('SELECTED WORKFLOW IS GUIDANCE'),'old planning-guidance label is absent');
check(!tier2.stdout.includes('unavailable isolation means BLOCKED'),'old worktree hard-block wording is absent');
check(tier2.stdout.includes('evaluate-suggestions-before-skip'),'skill suggestions still require evaluation before omission');
check(tier2.stdout.includes('visible-status-updates'),'workflow plan carries mandatory user-visible status invariant');
check(tier2.stdout.includes('USER-VISIBLE HARNESS STATUS CONTRACT (MUST)'),'kernel emits the mandatory unified status contract');
for(const field of ['### 🚦 Harness Status','- **Current:**','- **Read / Evidence:**','- **Next:**','- **Risk / Blocked:**']){
  check(tier2.stdout.includes(field),'kernel status contract includes readable Markdown field '+field);
}
check(tier2.stdout.includes('HARNESS ROUTING CHECKPOINT (INTERNAL SOURCE STATE — DO NOT RENDER SEPARATELY)'),'routing checkpoint is marked internal rather than user-facing');
check(!tier2.stdout.includes('HARNESS ROUTING CHECKPOINT (REQUIRED VISIBLE STATE)'),'legacy duplicate-visible checkpoint label is absent');
check(tier2.stdout.includes('nested bullets when there are multiple items'),'kernel tells agents to split dense evidence into nested bullets');
check(tier2.stdout.includes('semantic communication MUST, not a hard execution lock'),'kernel separates semantic MUST from mechanical blocking');

const tier3=spawnSync(process.execPath,[kernel,'audit the entire repository architecture and coordinate multiple modules'],{cwd:ROOT,encoding:'utf8'});
check(tier3.status===0,'Tier 3 routing exits successfully');
check(/RECOMMENDED TIER:\s*Tier 3/i.test(tier3.stdout),'macro task remains Tier 3');
check(tier3.stdout.includes('using-git-worktrees'),'Tier 3 still routes the worktree skill');
check(tier3.stdout.includes('Tier 3 / Fable broad mutation MUST resolve isolation'),'Tier 3 requires an isolation disposition without a hard lock');

const hs=read('harness-everything/SKILL.md');
check(/required obligations are MUST; tactics MAY adapt/i.test(hs),'Harness skill separates required obligations from adaptable tactics');
check(/only Rule-of-3 reflection and explicit user\/host permission boundaries may block/i.test(hs),'Harness skill names the only intentional blocking boundaries');
check(/Surface status.*MUST render.*Harness Status/i.test(hs)&&/bold bullets/i.test(hs)&&/Read \/ Evidence/i.test(hs),'Harness skill requires the readable unified user-visible status');
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
  'Read/evaluate every suggested skill before omission',
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
check(/Rule of 3/i.test(advisory)&&/Permission boundaries are separate/i.test(advisory),'installer text preserves Rule-of-3 and permission boundaries');
check(read('plugins/harness-everything/scripts/lib/advisory-text.js')===advisory,'OpenAI advisory mirror matches');

const agents=read('AGENTS.md');
check(/Selected workflow is a semantic contract/i.test(agents),'repository agent contract is contract-first');
check(/User-visible Harness Status is mandatory/i.test(agents)&&/### 🚦 Harness Status/i.test(agents)&&/nested evidence bullets/i.test(agents),'repository agent contract requires readable unified user-visible status');
check(/Tier-3\/Fable isolation disposition is mandatory/i.test(agents)&&/degraded fallback/i.test(agents),'repository worktree rule requires disposition without hard lock');

const envSkill=read('environment-detection/SKILL.md');
check(/semantic \*\*MUST\*\*/i.test(envSkill)&&/environment-sensitive/i.test(envSkill),'environment discovery is a conditional semantic MUST');
check(read('plugins/harness-everything/skills/environment-detection/SKILL.md')===envSkill,'environment skill mirror matches');

const commitSkill=read('git-commit/SKILL.md');
check(/MUST.*git diff --cached/i.test(commitSkill)&&/SHOULD.*split/i.test(commitSkill),'commit skill separates staged-diff MUST from split SHOULD');
check(read('plugins/harness-everything/skills/git-commit/SKILL.md')===commitSkill,'git-commit skill mirror matches');

const hooks=JSON.parse(read('hooks/hooks.json'));
check((hooks.hooks.PreToolUse||[]).some(e=>e.id==='harness:pre:workflow-gate'),'Claude packages workflow reminder hook');
check((hooks.hooks.PreToolUse||[]).some(e=>e.id==='harness:pre:rule-of-3'),'Claude preserves Rule-of-3 boundary');
check((hooks.hooks.PreToolUse||[]).some(e=>e.id==='harness:pre:action-gate'),'Claude preserves action permission gate');

console.log('\n'+(failed===0?'PASS':'FAIL')+': semantic contract-strength routing contract ('+failed+' failures)');
process.exit(failed===0?0:1);
