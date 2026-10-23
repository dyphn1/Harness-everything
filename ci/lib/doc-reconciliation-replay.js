'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, spawnSync } = require('child_process');
const fx = require('./doc-reconciliation-prep-fixtures');

const CORPUS = path.join(__dirname, '..', 'fixtures', 'doc-obligations', 'reconciliation-s2b', 'corpus');
const CASES = path.join(__dirname, '..', 'fixtures', 'doc-obligations', 'reconciliation-s2b', 'f4', 'cases.json');
const EVENT_HOOKS = new Set(['PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'SubagentStart', 'SubagentStop']);
const SITES = ['moduleLoads', 'stateFiles', 'captureRecords', 'pilotReport', 'workflowStep', 'workflowStop', 'genericStop'];

function load(streamId) {
  const file = path.join(CORPUS, `${streamId}.json`);
  const stream = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!stream.id || !Array.isArray(stream.events) || !stream.expectations) throw new Error(`invalid stream ${file}`);
  for (const site of SITES) if (!stream.expectations[site]) throw new Error(`${stream.id} missing expectation site ${site}`);
  return stream;
}

function tracePreloader(file) {
  fs.writeFileSync(file, `const M=require('module'), fs=require('fs'); const old=M._load; M._load=function(id,p,m){const x=old.apply(this,arguments);if(typeof id==='string'&&/(doc-reconciliation|state-persist|workflow-disposition|stop-gate)/.test(id))fs.appendFileSync(process.env.F4_C1_TRACE,JSON.stringify({pid:process.pid,module:id,requester:m&&m.filename})+'\\n');return x};\n`);
}

function actionsFor(stream, template) {
  const actions = template.actions.filter(a => !['lint-run','post-lint','verify-pass','stop','stop-generic'].includes(a.id));
  stream.events.forEach((event, i) => {
    if (!EVENT_HOOKS.has(event.event)) throw new Error(`${stream.id}: unsupported event ${event.event}`);
    const id = `capture-${String(i + 1).padStart(2, '0')}`;
    if (event.runArgs) actions.push({ id: `${id}-run`, op: 'hostRun', payload: { command: 'doc-check', args: event.runArgs } });
    const payload = { event: event.event };
    if (event.toolName) payload.toolName = event.toolName;
    if (event.command !== undefined) payload.command = event.command;
    if (event.toolUseId) payload.toolUseId = event.toolUseId;
    if (event.runArgs && event.event === 'PostToolUse') payload.fromRun = `${id}-run`;
    if (event.event === 'PostToolUse') payload.response = { stdout: event.runArgs ? 'doc-check completed' : 'completed', stderr: '', interrupted: false };
    if (event.event === 'PostToolUseFailure') { payload.error = 'stable fixture failure'; payload.isInterrupt = false; }
    if (event.event === 'SubagentStart' || event.event === 'SubagentStop') {
      payload.agentId = `agent-${i + 1}`; payload.agentType = 'reviewer';
      if (event.event === 'SubagentStop') payload.lastAssistantMessage = 'APPROVE: reviewed the governed document.';
    }
    actions.push({ id, op: 'hookDeliver', payload });
  });
  actions.push({ id: 'verify-pass', op: 'step', payload: { stepId: 'req-verify', disposition: 'pass', evidence: 'recorded document verification' }, expectExit: { on: [0, 2] } });
  actions.push({ id: 'stop', op: 'stop' }, { id: 'stop-generic', op: 'stopGeneric' });
  return actions;
}

function concurrent(stream, leg, mode) {
  const dist = fx.DISTRIBUTIONS[leg];
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'f4c1-concurrent-'));
  const stateHome = path.join(root, 'state'); const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace); fs.mkdirSync(stateHome);
  const barrier = path.join(root, 'barrier'); fs.mkdirSync(barrier);
  const worker = path.join(root, 'worker.js');
  fs.writeFileSync(worker, `const fs=require('fs'),cp=require('child_process'),path=require('path');const [hook,barrier,home,workspace,sid,index,pilot]=process.argv.slice(2);fs.writeFileSync(path.join(barrier,'ready-'+index),'ready');while(!fs.existsSync(path.join(barrier,'go')))Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,20);const p={session_id:sid,cwd:workspace,hook_event_name:'PostToolUse',tool_name:'Bash',tool_input:{command:'npm test'},tool_use_id:'concurrent-'+index,tool_response:{stdout:'ok',stderr:'',interrupted:false}};const r=cp.spawnSync(process.execPath,[hook],{input:JSON.stringify(p),encoding:'utf8',env:{...process.env,HARNESS_STATE_HOME:home,HARNESS_WORKSPACE_ROOT:workspace,...(pilot==='on'?{HARNESS_DOC_RECONCILIATION_PILOT:'1'}:{})}});process.exit(r.status||0);`);
  const children = [1, 2].map(i => spawn(process.execPath, [worker, dist.stateHook, barrier, stateHome, workspace, 'concurrent-session', String(i), mode], { stdio: 'ignore' }));
  while (![1, 2].every(i => fs.existsSync(path.join(barrier, `ready-${i}`)))) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  fs.writeFileSync(path.join(barrier, 'go'), 'release');
  const exits = children.map(child => new Promise(resolve => child.on('exit', (code, signal) => resolve({ code, signal }))));
  return Promise.all(exits).then(results => {
    const files=[]; const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const f=path.join(d,e.name);if(e.isDirectory())walk(f);else files.push({path:path.relative(stateHome,f),json:f.endsWith('.json')?safeJson(f):undefined,provenance:'concurrent state-persist process'});}};walk(stateHome);
    fs.rmSync(root,{recursive:true,force:true}); return {results,files};
  });
}
function safeJson(file){try{return JSON.parse(fs.readFileSync(file,'utf8'));}catch(_){return null;}}

async function replay(streamId, leg='source', mode='on') {
  if (!fx.DISTRIBUTIONS[leg]) throw new Error(`unknown distribution ${leg}`);
  if (!['on','off'].includes(mode)) throw new Error(`unknown mode ${mode}`);
  const stream=load(streamId); const cases=JSON.parse(fs.readFileSync(CASES,'utf8')).cases;
  const template=cases.find(item=>item.id==='F4-POS-body-edit');
  const definition={...template,id:stream.id,actions:actionsFor(stream,template)};
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'f4c1-')); const spy=path.join(scratch,'trace.js'); const trace=path.join(scratch,'modules.jsonl'); tracePreloader(spy);
  const previous=process.env.F4_C1_TRACE; process.env.F4_C1_TRACE=trace;
  let root;
  try { root=fx.replayCase(definition,leg,{...(mode==='on'?{pilot:'1'}:{}),nodeArgs:['--require',spy]}); }
  finally { if(previous===undefined)delete process.env.F4_C1_TRACE;else process.env.F4_C1_TRACE=previous; }
  const modules=fs.existsSync(trace)?fs.readFileSync(trace,'utf8').trim().split('\n').filter(Boolean).map(JSON.parse):[];
  const stateFiles=[]; const provenance=[];
  for(const [actionId,action] of Object.entries(root.actions)) for(const key of ['workflow','obligations','handoff','capture']) if(action.state&&action.state[key]) {
    stateFiles.push({actionId,key,provenance:`snapshot after ${actionId}`,value:action.state[key]});
    if(key==='capture') for(const record of action.state.capture.records||[]) provenance.push({actionId,event:record.event,toolUseId:record.tool_use_id||record.toolUseId,provenance:'state-persist capture journal'});
  }
  const result={stream:stream.id,leg,mode,infrastructureErrors:fx.infrastructureFaults(definition,root,mode),moduleLoads:modules,stateFiles,captureRecords:provenance,pilotReport:root.pilot,pilotReportOrigin:root.pilotReportOrigin,workflowStep:Object.fromEntries(Object.entries(root.actions).filter(([id])=>id==='verify-pass').map(([id,a])=>[id,{exitCode:a.exitCode,stdout:a.stdout,stderr:a.stderr}])),workflowStop:root.actions.stop&&{exitCode:root.actions.stop.exitCode,stdout:root.actions.stop.stdout,stderr:root.actions.stop.stderr},genericStop:root.actions['stop-generic']&&{exitCode:root.actions['stop-generic'].exitCode,stdout:root.actions['stop-generic'].stdout,stderr:root.actions['stop-generic'].stderr},expectations:stream.expectations};
  if(stream.concurrency) result.concurrency=await concurrent(stream,leg,mode);
  fs.rmSync(scratch,{recursive:true,force:true});
  return result;
}

async function selfCheck(){
  const ids=fs.readdirSync(CORPUS).filter(f=>f.endsWith('.json')).map(f=>path.basename(f,'.json')).sort();
  let failed=false;
  for(const leg of ['source','packaged']) for(const id of ids){const stream=load(id);const result=await replay(id,leg,stream.mode);const journal=result.concurrency&&result.concurrency.files.find(file=>file.path.endsWith('doc-reconciliation-capture.json'));const concurrentBad=result.concurrency&&(result.concurrency.results.some(x=>x.code!==0)||!journal||journal.json.records.length!==2);const bad=result.infrastructureErrors.length||concurrentBad;console.log(`${bad?'INFRA':'OK'} ${leg}/${id}${bad?`: ${JSON.stringify(result.infrastructureErrors)} ${JSON.stringify(result.concurrency&&result.concurrency.results)} journalRecords=${journal&&journal.json.records.length}`:''}`);failed ||= Boolean(bad);}
  return failed?1:0;
}

if(require.main===module){
  if(process.argv[2]==='--worker')process.exit(0);
  if(process.argv[2]==='--self-check')selfCheck().then(code=>process.exit(code));
  else replay(process.argv[2],process.argv[3]||'source',process.argv[4]||'on').then(r=>console.log(JSON.stringify(r,null,2)));
}
module.exports={load,replay,selfCheck};
