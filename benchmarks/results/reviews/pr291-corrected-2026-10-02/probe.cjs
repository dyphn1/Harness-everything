const fs=require('fs'),path=require('path'),cp=require('child_process');
const manifest=require('./manifest.json');
const [action,id,arg]=process.argv.slice(2),trial=manifest.trials.find(t=>t.id===id);
if(!trial)throw Error('Unknown trial');
const repo=manifest.arms[trial.arm],dir=trial.dir;
const log=(action,file)=>fs.appendFileSync(path.join(dir,'ledger.jsonl'),JSON.stringify({action,file})+'\n');
if(action==='route'){
 const r=cp.spawnSync(process.execPath,['harness-everything/scripts/tier-router.js',fs.readFileSync(path.join(dir,'task.txt'),'utf8')],{cwd:repo,encoding:'utf8',env:{...process.env,HARNESS_SYSTEM_ONE_MODE:'off',HARNESS_ROUTER_CONTRACT_PATH:path.join(dir,'contract.json')}});
 fs.writeFileSync(path.join(dir,'router.stdout'),r.stdout);fs.writeFileSync(path.join(dir,'router.stderr'),r.stderr);log('route');process.stdout.write(r.stdout);process.stdout.write('\nSTRUCTURED CONTRACT:\n'+fs.readFileSync(path.join(dir,'contract.json'),'utf8'));process.exitCode=r.status;
}else if(action==='read'){
 const target=path.resolve(repo,arg);if(!target.startsWith(path.resolve(repo)+path.sep))throw Error('Path escapes snapshot');log('read',arg);process.stdout.write(fs.readFileSync(target,'utf8'));
}else throw Error('Unknown action');
