#!/usr/bin/env node
'use strict';
const assert=require('assert'),fs=require('fs'),os=require('os'),path=require('path'),{spawnSync}=require('child_process');
const ROOT=path.resolve(__dirname,'..'),plugin=process.argv.includes('--plugin'),runtimeRoot=plugin?path.join(ROOT,'plugins/harness-everything'):ROOT;
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'harness-workflow-guidance-')),repo=path.join(temp,'repo');fs.mkdirSync(repo);spawnSync('git',['init'],{cwd:repo});
const env={...process.env,HARNESS_STATE_HOME:path.join(temp,'state'),HARNESS_WORKSPACE_ROOT:repo};
process.env.HARNESS_STATE_HOME=env.HARNESS_STATE_HOME;process.env.HARNESS_WORKSPACE_ROOT=repo;
const state=require(path.join(runtimeRoot,'hooks/scripts/lib/harness-state')),sessionId='workflow-guidance',payload={session_id:sessionId,cwd:repo},sessionDir=state.getSessionDir(repo,sessionId),file=path.join(sessionDir,'workflow-run.json'),handoffFile=path.join(sessionDir,'handoff-state.json');
let passed=0;function check(v,m){assert.ok(v,m);passed++;console.log('PASS '+m);}function node(script,input,args=[]){const relative=plugin&&script.startsWith('harness-everything/')?'skills/'+script:script;return spawnSync(process.execPath,[path.join(runtimeRoot,relative),...args],{cwd:repo,env,input:input&&JSON.stringify(input),encoding:'utf8'});}function read(t){return JSON.parse(fs.readFileSync(t,'utf8'));}
try{
 fs.writeFileSync(file,JSON.stringify({schemaVersion:1,sessionId,strategy:'iterative-single',tier:'tier2',state:'running',lastMutationAt:0},null,2));check(fs.existsSync(file),'workflow guidance fixture is created');
 const workflow=read(file);workflow.state='blocked';workflow.blockReason='iteration-budget-exhausted';workflow.budget={schemaVersion:1,state:'budget-exhausted',reasonCode:'iteration-budget-exhausted'};fs.writeFileSync(file,JSON.stringify(workflow));
 const legacy=node('hooks/scripts/workflow-gate.js',{...payload,tool_name:'Write',tool_input:{file_path:path.join(repo,'x.js')}});check(legacy.status===0,'legacy exhausted state no longer blocks mutation');check(/Workflow Reminder/.test(legacy.stderr),'legacy state is a reminder');
 const shell=node('hooks/scripts/workflow-gate.js',{...payload,tool_name:'Bash',tool_use_id:'toolu_advisory',tool_input:{command:'node maybe-mutates.js'}});check(shell.status===0,'unproven shell is not iteration-blocked');check(!fs.existsSync(path.join(sessionDir,'mutation-probes')),'no mutation-probe state is created');
 fs.writeFileSync(handoffFile,JSON.stringify({lastEditAt:Date.now()}));const stop=node('hooks/scripts/workflow-stop-gate.js',{...payload});check(stop.status===0,'missing verification does not block Stop');check(/verification-after-edit-missing/.test(stop.stderr),'missing verification emits reminder');
 const verify=node('hooks/scripts/state-persist.js',{...payload,hook_event_name:'PostToolUse',tool_name:'exec_command',tool_input:{command:'npm test'},tool_response:{exitCode:0,stdout:'ok'}});check(verify.status===0,'exec_command verification is fail-open');check(Number.isFinite(read(handoffFile).lastVerifyAt),'#193 exec_command records lastVerifyAt');
 console.log('PASS: workflow guidance lifecycle ('+passed+' assertions)');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
if(!plugin){const packaged=spawnSync(process.execPath,[__filename,'--plugin'],{cwd:ROOT,env:process.env,encoding:'utf8'});assert.strictEqual(packaged.status,0,packaged.stdout+packaged.stderr);console.log('PASS: packaged OpenAI workflow guidance mirrors source');}
