const fs=require('fs'),path=require('path'),crypto=require('crypto'),{spawnSync}=require('child_process');
const roots={baseline:'/private/tmp/harness-pr289-review',fixed:'/private/tmp/harness-pr289-fix'};
const [action,arm,trial,rel]=process.argv.slice(2);if(!roots[arm]||!/^r[12]$/.test(trial))throw Error('Invalid arm/trial');
const root=roots[arm],out=path.join('/tmp/pr291-agent-rerun',arm+'-'+trial);fs.mkdirSync(out,{recursive:true});
const prompt="Explain what 'fable on sonnect' means; return only a small JSON selection record.";
const sha=d=>crypto.createHash('sha256').update(d).digest('hex');
const log=entry=>fs.appendFileSync(path.join(out,'ledger.jsonl'),JSON.stringify(entry)+'\n');
if(action==='route'){
 const contractPath=path.join(out,'contract.json');const env={...process.env,HARNESS_SYSTEM_ONE_MODE:'off',HARNESS_ROUTER_CONTRACT_PATH:contractPath};
 const r=spawnSync('/Users/daniel.chang/.nvm/versions/node/v24.14.1/bin/node',['harness-everything/scripts/tier-router.js',prompt],{cwd:root,env,encoding:'utf8'});
 fs.writeFileSync(path.join(out,'router.stdout'),r.stdout);fs.writeFileSync(path.join(out,'router.stderr'),r.stderr);
 const contract=r.status===0?JSON.parse(fs.readFileSync(contractPath,'utf8')):null;
 const record={kind:'route',prompt,promptSha256:sha(prompt),arm,trial,exitCode:r.status,stdoutBytes:Buffer.byteLength(r.stdout),stderrBytes:Buffer.byteLength(r.stderr),tier:contract?.classification.tier,strategy:contract?.workflowPlan.strategy,root};log(record);
 console.log(JSON.stringify(record));process.stdout.write(r.stdout);process.stderr.write(r.stderr);process.exitCode=r.status??1;
}else if(action==='read'){
 const f=fs.realpathSync(path.resolve(root,rel));if(!f.startsWith(fs.realpathSync(root)+path.sep))throw Error('Outside arm root');
 const data=fs.readFileSync(f);const record={kind:'context-read',relativePath:path.relative(root,f),path:f,bytes:data.length,sha256:sha(data)};log(record);console.log(JSON.stringify(record));process.stdout.write(data);
}else throw Error('Use route/read');
