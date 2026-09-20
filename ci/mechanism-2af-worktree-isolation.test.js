#!/usr/bin/env node
'use strict';
const fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..'),GATE=path.join(ROOT,'hooks/scripts/workflow-gate.js');
let failed=0;function check(c,m,d=''){if(c)console.log('PASS '+m);else{console.error('FAIL '+m+(d?': '+d:''));failed++;}}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'harness-worktree-guidance-')),home=path.join(temp,'home'),repo=path.join(temp,'repo'),linked=path.join(temp,'linked');
fs.mkdirSync(home,{recursive:true});fs.mkdirSync(repo,{recursive:true});
const env={...process.env,HOME:home,USERPROFILE:home,HARNESS_STATE_HOME:path.join(home,'state'),HARNESS_WORKSPACE_ROOT:repo,CLAUDE:'1'};
function git(cwd,args){return spawnSync('git',args,{cwd,encoding:'utf8'});}
function runGate(tool,cwd,input={}){return spawnSync(process.execPath,[GATE],{cwd:ROOT,env,input:JSON.stringify({session_id:'worktree-guidance',cwd,tool_name:tool,tool_input:input}),encoding:'utf8'});}
try{
 check(git(repo,['init']).status===0,'fixture repository initializes');
 fs.writeFileSync(path.join(repo,'README.md'),'fixture\n');git(repo,['add','README.md']);git(repo,['-c','user.name=Harness','-c','user.email=h@example.invalid','commit','-m','init']);
 const state=require(path.join(ROOT,'hooks/scripts/lib/harness-state'));const dir=state.getSessionDir(repo,'worktree-guidance');
 fs.writeFileSync(path.join(dir,'workflow-run.json'),JSON.stringify({schemaVersion:1,sessionId:'worktree-guidance',tier:'tier3',strategy:'iterative-single',state:'active'}));
 const primary=runGate('Write',repo,{file_path:path.join(repo,'src.js'),content:'x'});
 check(primary.status===0,'Tier-3 primary-tree mutation is not hard-blocked',primary.stderr);
 check(/worktree/i.test(primary.stderr),'Tier-3 primary-tree mutation emits worktree guidance',primary.stderr);
 const mutator=runGate('Bash',repo,{command:'git status --short && rm -rf src'});
 check(mutator.status===0,'mutation-shaped shell command remains available',mutator.stderr);
 check(/worktree/i.test(mutator.stderr),'mutation-shaped shell command receives worktree guidance',mutator.stderr);
 const readOnly=runGate('Bash',repo,{command:'git status --short'});
 check(readOnly.status===0,'read-only discovery remains available');
 const create=git(repo,['worktree','add',linked,'-b','guidance-test']);check(create.status===0,'linked worktree fixture creates',create.stderr);
 const isolated=runGate('Write',linked,{file_path:path.join(linked,'src.js'),content:'x'});
 check(isolated.status===0,'linked-worktree mutation remains available',isolated.stderr);
 const escape=runGate('Write',linked,{file_path:path.join(repo,'escape.js'),content:'x'});
 check(escape.status===0,'cross-worktree target is reminder-only',escape.stderr);
 check(/outside|worktree|target/i.test(escape.stderr),'cross-worktree target emits scope/isolation guidance',escape.stderr);
 const wf=JSON.parse(fs.readFileSync(path.join(dir,'workflow-run.json'),'utf8'));wf.state='blocked';fs.writeFileSync(path.join(dir,'workflow-run.json'),JSON.stringify(wf));
 const legacy=runGate('Write',linked,{file_path:path.join(linked,'legacy.js'),content:'x'});
 check(legacy.status===0,'legacy blocked workflow state does not trap mutation',legacy.stderr);
 check(/marked BLOCKED/i.test(legacy.stderr),'legacy blocked state is surfaced as reminder',legacy.stderr);
 fs.writeFileSync(path.join(dir,'workflow-run.json'),'{broken');
 const corrupt=runGate('Write',linked,{file_path:path.join(linked,'corrupt.js'),content:'x'});
 check(corrupt.status===0,'corrupt workflow state fails open',corrupt.stderr);
}finally{fs.rmSync(temp,{recursive:true,force:true});}
if(failed)process.exit(1);
console.log('PASS: worktree isolation is guidance, not a cognitive lock');
