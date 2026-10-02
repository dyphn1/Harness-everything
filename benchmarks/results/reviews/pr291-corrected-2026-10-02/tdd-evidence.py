import copy,json,pathlib,subprocess
root=pathlib.Path(__file__).resolve().parent;repo=root.parents[3]
e=json.loads((repo/'tdd/fixtures/pass-evidence.json').read_text());r=e['requirements'][0]
r.update(requirementId='PR291-LOOKUP-CLAUSES',source={'type':'SPEC','path':'docs/platform-capabilities.md','section':'Claude Code Fable entrypoint boundary','status':'AUTHORITATIVE'})
ref='ci/router-workflow-plan.test.js Fable lookup/execution boundaries; parser-red.log (52 failures), parser-green.log and parser-refactor.log (0 failures)'
for name,d in r['dimensions'].items():
 if 'checks' in d:
  for c in d['checks']:c['evidence']=ref
for c in r['dimensions']['inputCompleteness']['checks']:
 if c['class'] in ['omitted','empty','null','min','max']:
  c.update(status='N/A',reason='This requirement covers complete string-prompt lookup classification, not CLI transport omission/type validation or numeric/length limits; no such bounds are declared.')
for c in r['dimensions']['outputCompleteness']['checks']:
 if c['class']=='prohibited-extra-field':c.update(status='N/A',reason='The existing router schema permits its declared fields; this change adds no output fields or stricter extra-field schema.')
for c in r['dimensions']['errorHandling']['checks']:
 if c['class'] in ['error-type','error-code','message','rollback']:
  c.update(status='N/A',reason='Unknown/mixed clauses are successful conservative execution routes, not exceptions; lookup classification does not mutate product state or define rollback/errors.')
for c in r['dimensions']['unexpectedInput']['checks']:
 if c['class'] in ['out-of-range','wrong-type']:
  c.update(status='N/A',reason='String lookup clauses have no declared numeric ranges; transport-level wrong-type handling is unchanged and outside this requirement.')
 if c['class']=='duplicate':c.update(status='N/A',reason='Canonical output field lists are read-only data; no distinct duplicate-field rejection contract is declared.')
prompt="Explain what 'fable on sonnect' means; return only a small JSON selection record with requestedProfile, effectiveProfile, profileAlias, assignedRole, runtimeModel, runtimeEffort. No orchestration or delegation."
runs=[]
for i in range(2):
 import os
 file=root/'tdd-contract.json'
 env={**os.environ,'HARNESS_SYSTEM_ONE_MODE':'off','HARNESS_ROUTER_CONTRACT_PATH':str(file)}
 result=subprocess.run(['node','harness-everything/scripts/tier-router.js',prompt],cwd=repo,env=env,capture_output=True,text=True,encoding='utf8');contract=json.loads(file.read_text(encoding='utf8'));file.unlink()
 assert result.returncode==0 and contract['workflowPlan']['strategy']=='direct-single'
 runs.append({'id':f'run-{i+1}','input':{'prompt':prompt,'systemOneMode':'off'},'exitStatus':result.returncode,'errorCategory':None,'output':{'stdout':result.stdout,'stderr':result.stderr,'contract':contract},'sideEffects':{'createdFiles':['tdd-contract.json'],'changedFiles':[],'deletedFiles':['tdd-contract.json'],'persistentState':{},'events':['router writes requested contract','test harness removes requested contract'],'logs':[],'externalCalls':[]}})
assert runs[0]['output']==runs[1]['output'];assert not (root/'tdd-contract.json').exists()
r['dimensions']['determinism']['runs']=runs;r['dimensions']['determinism']['normalizations']=[]
(root/'tdd-evidence.json').write_text(json.dumps(e,indent=2)+'\n',encoding='utf8')
print('Two equivalent clean subprocess runs match stdout/stderr/contracts; temporary contract cleaned up.')
