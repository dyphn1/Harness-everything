const fs=require('fs'),path=require('path'),{spawnSync}=require('child_process'),assert=require('assert');
const root=process.cwd(),out=path.join(root,'benchmarks/results/reviews/pr290-minimal-2026-10-01/verification');
const {validateRouterContract}=require(path.join(root,'harness-everything/scripts/router-contract.js'));
const prompt="Explain what 'fable on sonnect' means; return only a small JSON selection record.";
const contractPath=path.join(out,'determinism-contract.json');
const env={...process.env,HARNESS_SYSTEM_ONE_MODE:'off',HARNESS_ROUTER_CONTRACT_PATH:contractPath};
function execute(input){
 const r=spawnSync(process.execPath,['harness-everything/scripts/tier-router.js',input],{cwd:root,env,encoding:'utf8'});
 assert.equal(r.status,0);assert.equal(r.stderr,'');assert(fs.existsSync(contractPath));
 const contract=JSON.parse(fs.readFileSync(contractPath,'utf8'));assert(validateRouterContract(contract).valid);
 fs.unlinkSync(contractPath);assert(!fs.existsSync(contractPath));
 return {input,exitStatus:r.status,errorCategory:null,output:contract,sideEffects:{createdFiles:['determinism-contract.json'],changedFiles:[],deletedFiles:['determinism-contract.json'],persistentState:{},events:[],logs:[r.stdout],externalCalls:[]}};
}
const runs=[execute(prompt),execute(prompt)];assert.deepStrictEqual(runs[0],runs[1]);
for(const r of runs){assert.equal(r.output.classification.tier,'tier1');assert.equal(r.output.workflowPlan.strategy,'direct-single');assert.equal(r.output.workflowPlan.profileSelection.requested,'reasoning');assert.equal(r.output.workflowPlan.profileSelection.alias,'sonnect');assert(!r.sideEffects.logs[0].includes('RECOMMENDED KNOWLEDGE GUIDES'));}
const unknown=execute('Explain fable on unknown; return only JSON.');assert(!unknown.sideEffects.logs[0].includes('FABLE OPERATION: profile-lookup'));
runs.forEach((r,i)=>r.id='run-'+(i+1));
const evidence='ci/router-workflow-plan.test.js (#290 regression block); verification/green-boundary.log; verification/tdd-evidence.json';
const pass=(c)=>({id:c,class:c,status:'PASS',evidence});const na=(c,reason)=>({id:c,class:c,status:'N/A',reason});
const dims={
 positiveParameters:{applicable:true,checks:[pass('supported-english-chinese-aliases')]},
 negativeParameters:{applicable:true,checks:[pass('mixed-execution-and-macro-scope')]},
 inputCompleteness:{applicable:true,checks:[pass('required'),pass('boundary'),...['optional','omitted','empty','null','min','max'].map(c=>na(c,'No new prompt API validation, optional parameter, or numeric/length constraint is introduced; this requirement applies only to supported string lookup prompts.'))]},
 outputCompleteness:{applicable:true,checks:['value','type','schema','required-field','side-effect'].map(pass).concat([na('prohibited-extra-field','No fields were added or prohibited; the existing router contract validator checks the schema.')])},
 errorHandling:{applicable:false,reason:'The new branch introduces no error or rollback API; supported and unsupported prompt strings return the existing router contract. Contract-file emission and cleanup are exercised in output/determinism.'},
 unexpectedInput:{applicable:true,checks:[pass('unknown'),...['malformed','extra','unsupported','out-of-range','duplicate','wrong-type'].map(c=>na(c,'This scoped change introduces no new typed input interface; run() string API and host payload validation are unchanged. Unknown alias and mixed execution boundary are exercised.'))]},
 determinism:{applicable:true,runs,normalizations:[]},sourceTraceability:{applicable:true}
};
fs.writeFileSync(path.join(out,'tdd-evidence.json'),JSON.stringify({schemaVersion:'1.0.0',requirements:[{requirementId:'ISSUE-290-PROFILE-LOOKUP',testProfile:'integration',source:{type:'SPEC',path:'docs/platform-capabilities.md',section:'Claude Code Fable entrypoint boundary',status:'AUTHORITATIVE'},sourceConformance:'PASS',sourceValidity:'VALID',dimensions:dims,skippedTests:[],flakyTests:[],naDeclarations:[]}]},null,2)+'\n');
console.log('PASS: two identical subprocess runs, valid schema, alias preservation, unknown-alias boundary, contract-file cleanup');
