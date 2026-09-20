const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process'),helper=require('./test-helper');
console.log('\n[2b] Boundary reminder...');
const bigFile=helper.tempFile('.mechanism-test-big.tmp');fs.writeFileSync(bigFile,'x'.repeat(600*1024));
const result=spawnSync(process.execPath,[path.join(helper.hooksDir,'boundary-guard.js')],{input:JSON.stringify({tool_name:'Read',tool_input:{file_path:bigFile}}),encoding:'utf8'});
helper.check('2b. Large read emits a reminder but remains available',result.status===0&&/Boundary Reminder/i.test(result.stderr),`exit=${result.status}, stderr=${result.stderr.slice(0,200)}`);
fs.unlinkSync(bigFile);helper.finish();
