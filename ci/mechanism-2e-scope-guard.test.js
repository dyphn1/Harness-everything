const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process'),helper=require('./test-helper');
console.log('\n[2e] Subagent scope reminder...');
function run(payload){return spawnSync(process.execPath,[path.join(helper.hooksDir,'subagent-scope-guard.js')],{input:JSON.stringify(payload),encoding:'utf8'});}
run({session_id:helper.SESSION_ID,tool_name:'Task',hook_event_name:'PreToolUse',tool_input:{}});
const scopeFile=helper.tempFile('.mechanism-test-scope.tmp');fs.writeFileSync(scopeFile,'unexpected change');
const result=run({session_id:helper.SESSION_ID,tool_name:'Task',hook_event_name:'PostToolUse',tool_input:{}});
helper.check('2e. Scope drift is reported without blocking',result.status===0&&result.stderr.includes(path.basename(scopeFile)),`exit=${result.status}, stderr=${result.stderr.slice(0,300)}`);
fs.unlinkSync(scopeFile);helper.finish();
