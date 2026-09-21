#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..');let failed=0;
function check(c,m){if(c)console.log('  PASS '+m);else{console.error('  FAIL '+m);failed++;}}
function read(p){return fs.readFileSync(path.join(ROOT,p),'utf8');}
console.log('=== Guidance-First Routing Contract ===');
const kernel=path.join(ROOT,'harness-everything/scripts/kernel-router.js');
const tier2=spawnSync(process.execPath,[kernel,'add a login endpoint with tests and update the implementation'],{cwd:ROOT,encoding:'utf8'});
check(tier2.status===0,'kernel router exits successfully');
check(/RECOMMENDED TIER:\s*Tier 2/i.test(tier2.stdout),'classifier result is preserved');
check(tier2.stdout.includes('"strategy":"iterative-single"'),'Tier 2 selects iterative-single guidance');
check(tier2.stdout.includes('loop-awareness:'),'iterative work exposes loop-awareness instead of a hard budget');
check(tier2.stdout.includes('SELECTED WORKFLOW IS GUIDANCE'),'suggested workflow is explicitly guidance');
check(tier2.stdout.includes('ORCHESTRATION POLICY: Selected topology is planning guidance'),'orchestration policy is guidance-first');
check(tier2.stdout.includes('WORKFLOW GUIDANCE (ADVISORY WHEN SELECTED)'),'kernel emits advisory workflow guidance');
check(tier2.stdout.includes('missing isolation is a strong reminder, not a Harness lock'),'worktree guidance is non-blocking');
check(!tier2.stdout.includes('WORKFLOW EXECUTION CONTRACT (MANDATORY'),'old mandatory execution contract is absent');
check(!tier2.stdout.includes('unavailable isolation means BLOCKED'),'old worktree hard-block wording is absent');
check(tier2.stdout.includes('evaluate-suggestions-before-skip'),'skill suggestions still require evaluation before omission');
check(tier2.stdout.includes('visible-status-updates'),'workflow plan carries mandatory user-visible status invariant');
check(tier2.stdout.includes('USER-VISIBLE HARNESS STATUS CONTRACT (MUST)'),'kernel emits the mandatory unified status contract');
for(const field of ['Harness Status','Current:','Read/Evidence:','Next:','Blocked/Risk:']){
  check(tier2.stdout.includes(field),'kernel status contract includes '+field);
}
check(tier2.stdout.includes('semantic communication MUST, not a hard execution lock'),'kernel separates semantic MUST from mechanical blocking');

const tier3=spawnSync(process.execPath,[kernel,'audit the entire repository architecture and coordinate multiple modules'],{cwd:ROOT,encoding:'utf8'});
check(tier3.status===0,'Tier 3 routing exits successfully');
check(/RECOMMENDED TIER:\s*Tier 3/i.test(tier3.stdout),'macro task remains Tier 3');
check(tier3.stdout.includes('using-git-worktrees'),'Tier 3 still recommends worktree guidance');
check(tier3.stdout.includes('WORKFLOW GUIDANCE (ADVISORY WHEN SELECTED)'),'Tier 3 workflow remains advisory');

const hs=read('harness-everything/SKILL.md');
check(/workflow state and numeric limits guide; they do not hard-stop execution/i.test(hs),'Harness skill states non-blocking workflow contract');
check(/only Rule-of-3 reflection and explicit user\/host permission boundaries may block/i.test(hs),'Harness skill names the only intentional blocking boundaries');
check(/Surface status.*MUST use one.*Harness Status/i.test(hs)&&/Read\/Evidence/i.test(hs),'Harness skill makes the unified user-visible status mandatory');
check(read('plugins/harness-everything/skills/harness-everything/SKILL.md')===hs,'Harness skill mirror matches');

const wt=read('using-git-worktrees/SKILL.md');
check(/safer in a linked worktree/i.test(wt),'worktree skill strongly recommends isolation');
check(!/Creation\/entry failure => `BLOCKED`/i.test(wt),'worktree creation failure is not a cognitive blocked state');
check(read('plugins/harness-everything/skills/using-git-worktrees/SKILL.md')===wt,'worktree skill mirror matches');

const triage=read('harness-everything/references/triage-and-tiers.md');
check(/Guidance-first workflow/i.test(triage),'triage reference uses guidance-first policy');
check(/User-visible status contract/i.test(triage)&&/Harness Status/i.test(triage)&&/MUST/i.test(triage),'triage defines the mandatory unified status contract');
check(read('plugins/harness-everything/skills/harness-everything/references/triage-and-tiers.md')===triage,'triage mirror matches');

for(const p of ['docs/routing.md','docs/architecture.md','docs/philosophy.md','docs/mechanism-first-skill-mesh.md']){
 const t=read(p); check(/guidance/i.test(t),'current doc '+p+' describes guidance');
}
for(const p of ['docs/routing.md','docs/architecture.md','docs/workflow-runtime.md']){
 const t=read(p); check(/Harness Status/i.test(t)&&/MUST/i.test(t),'current doc '+p+' defines mandatory user-visible status');
}
const advisory=read('scripts/lib/advisory-text.js');
check(/selected workflow topology.*planning guidance/i.test(advisory),'installer advisory text keeps workflow non-blocking');
check(/USER-VISIBLE STATUS \(MUST\)/i.test(advisory)&&/Read\/Evidence:/i.test(advisory),'instruction-only installers carry the mandatory unified status contract');
check(/Rule of 3/i.test(advisory)&&/Permission boundaries are separate/i.test(advisory),'installer text preserves Rule-of-3 and permission boundaries');
check(read('plugins/harness-everything/scripts/lib/advisory-text.js')===advisory,'OpenAI advisory mirror matches');

const agents=read('AGENTS.md');
check(/Selected workflow is planning guidance/i.test(agents),'repository agent contract is guidance-first');
check(/User-visible Harness Status is mandatory/i.test(agents),'repository agent contract requires unified user-visible status');
check(/Prefer Git worktree isolation/i.test(agents),'repository worktree rule is a recommendation');

const hooks=JSON.parse(read('hooks/hooks.json'));
check((hooks.hooks.PreToolUse||[]).some(e=>e.id==='harness:pre:workflow-gate'),'Claude packages workflow reminder hook');
check((hooks.hooks.PreToolUse||[]).some(e=>e.id==='harness:pre:rule-of-3'),'Claude preserves Rule-of-3 boundary');
check((hooks.hooks.PreToolUse||[]).some(e=>e.id==='harness:pre:action-gate'),'Claude preserves action permission gate');

console.log('\n'+(failed===0?'PASS':'FAIL')+': guidance-first routing contract ('+failed+' failures)');
process.exit(failed===0?0:1);
