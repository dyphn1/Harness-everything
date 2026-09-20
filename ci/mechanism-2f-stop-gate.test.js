const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process'),helper=require('./test-helper');
console.log('\n[2f] Verification reminders...');
function run(script,payload){return spawnSync(process.execPath,[path.join(helper.hooksDir,script)],{input:JSON.stringify(payload),encoding:'utf8'});}
helper.writeState('handoff-state.json',{status:'idle',lastEditAt:Date.now(),lastVerifyAt:0});
const dirty=helper.tempFile('.mechanism-test-dirty.tmp');fs.writeFileSync(dirty,'dirty');
const reminder=run('stop-gate.js',{session_id:helper.SESSION_ID});
helper.check('2f. Unverified dirty Stop emits reminder and exits 0',reminder.status===0&&/Verification Reminder/i.test(reminder.stderr),`exit=${reminder.status}, stderr=${reminder.stderr.slice(0,200)}`);
helper.check('2f. Stop reminder creates no lock/throttle state',!helper.stateExists('stop-gate-state.json'),'unexpected stop-gate-state.json');
fs.unlinkSync(dirty);

const now=Date.now();
helper.writeState('workflow-run.json',{schemaVersion:1,sessionId:helper.SESSION_ID,strategy:'iterative-single',state:'running',lastMutationAt:now-5000});
helper.writeState('handoff-state.json',{status:'idle',lastEditAt:now-5000,lastVerifyAt:now,lastVerifyExitCode:null});
const verified=run('workflow-stop-gate.js',{session_id:helper.SESSION_ID});
helper.check('2f. Observed verification can mark workflow satisfied',verified.status===0&&helper.readState('workflow-run.json').state==='satisfied',verified.stderr);

helper.writeState('workflow-run.json',{schemaVersion:1,sessionId:helper.SESSION_ID,strategy:'iterative-single',state:'running',lastMutationAt:now});
helper.writeState('handoff-state.json',{status:'idle',lastEditAt:now,lastVerifyAt:now-5000,lastVerifyExitCode:null});
const stale=run('workflow-stop-gate.js',{session_id:helper.SESSION_ID});
helper.check('2f. Missing verification is reminder-only',stale.status===0&&/verification-after-edit-missing/i.test(stale.stderr),`exit=${stale.status}, stderr=${stale.stderr.slice(0,300)}`);
helper.check('2f. Missing verification does not create blocked state',helper.readState('workflow-run.json').state==='running',JSON.stringify(helper.readState('workflow-run.json')));
helper.finish();
