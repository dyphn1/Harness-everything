"""Export only these six trial threads' counters, authored prompts and hashes; no reasoning text."""
import collections,hashlib,json,pathlib,re,sqlite3
from decimal import Decimal
root=pathlib.Path(__file__).resolve().parent
home=pathlib.Path.home()/'.codex'
m=json.loads((root/'manifest.json').read_text())
conn=sqlite3.connect('file:'+str(home/'state_5.sqlite')+'?mode=ro',uri=True);conn.row_factory=sqlite3.Row
keys=['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens']
rates={'uncached':'0.10','cached':'0.01','write':'0.125','output':'0.50'}
trials=[];seen=set();normalized=[]
for t in m['trials']:
 agent=t['agentPath']
 rows=conn.execute('select id,agent_path,rollout_path,first_user_message from threads where agent_path=?',(agent,)).fetchall()
 assert len(rows)==1,(agent,len(rows))
 row=rows[0];source=pathlib.Path(row['rollout_path']);blob=source.read_bytes();es=[json.loads(line) for line in blob.decode('utf8').splitlines()]
 ctx=[e['payload'] for e in es if e['type']=='turn_context'];models={(c['model'],c['effort']) for c in ctx};assert models=={('gpt-6-luna','xhigh')},models
 records=[{'timestamp':e['timestamp'],'responseId':e['payload']['response_id'],'rootTurnId':e['payload']['root_turn_id'],'usage':{k:e['payload']['usage'].get(k,0) for k in keys}} for e in es if e['type']=='token_usage_record' and e['payload'].get('thread_id')==row['id']]
 assert records and any(e['type']=='event_msg' and e['payload'].get('type')=='task_complete' for e in es),agent+' is not complete'
 for r in records:
  assert r['responseId'] not in seen;seen.add(r['responseId']);u=r['usage'];assert u['total_tokens']==u['input_tokens']+u['output_tokens'];assert u['reasoning_output_tokens']<=u['output_tokens'];assert u['cached_input_tokens']+u['cache_write_input_tokens']<=u['input_tokens'];assert u['input_tokens']<=272000
 sums={k:sum(r['usage'][k] for r in records) for k in keys}
 last=next(e['payload'] for e in reversed(es) if e['type']=='token_usage_record' and e['payload'].get('thread_id')==row['id'])
 assert sums=={k:last['thread_token_usage'].get(k,0) for k in keys}
 sums['uncached_input_tokens']=sums['input_tokens']-sums['cached_input_tokens']-sums['cache_write_input_tokens']
 costparts={n:str(Decimal(sums[k])*Decimal(rates[n])/Decimal(1000000)) for n,k in [('uncached','uncached_input_tokens'),('cached','cached_input_tokens'),('write','cache_write_input_tokens'),('output','output_tokens')]}
 prompt=row['first_user_message']
 (root/t['id']/'agent-prompt.txt').write_text(prompt or 'Unavailable: native subagent task messages are encrypted in retained rollouts; SQLite first_user_message is empty. Task text is retained separately in task.txt. Wrapper equality cannot be independently verified from exported telemetry.\n',encoding='utf8')
 if prompt:normalized.append(prompt.replace(t['id'],'TRIAL'))
 ledger=[json.loads(l) for l in (root/t['id']/'ledger.jsonl').read_text().splitlines()]
 contract=json.loads((root/t['id']/'contract.json').read_text(encoding='utf-8-sig'));answer=json.loads((root/t['id']/'answer.json').read_text(encoding='utf-8-sig'))
 rd=(root/t['id']/'README.md').read_text();edited='## Installation' in rd and 'Instalation' not in rd
 profile=answer.get('profile',{})
 if not isinstance(profile,dict):profile=answer.get('answer',{}) if isinstance(answer.get('answer'),dict) else {}
 alias='sonnect' if t['size']=='small' else 'sonnet' if t['size']=='medium' else 'opus'
 canonical='orchestrator' if alias=='opus' else 'reasoning';role='orchestrator' if alias=='opus' else 'reasoning-worker'
 profileok=all(profile.get(k)==v for k,v in {'requestedProfile':canonical,'effectiveProfile':canonical,'profileAlias':alias,'assignedRole':role}.items())
 expectedstrategy='direct-single' if t['size']=='small' else 'fable-staged'
 checks={'profileCanonical':profileok,'expectedRouterTopology':contract['workflowPlan']['strategy']==expectedstrategy,'READMEEdit':edited if t['size']=='medium' else not edited}
 if t['size']=='large':
  plan=answer['plan'];stages=plan['stages'];arch=json.loads((root/t['id']/'architecture.json').read_text());files={f for mod in arch['modules'] for f in mod['files']};covered=set();visited=set();depok=True;scopeok=True
  for s in stages:
   depok=depok and all(d in visited for d in s['dependsOn']);visited.add(s['id']);scope=s.get('authorizedFileScope',s.get('writeScope',[]));allowed=scope if isinstance(scope,list) else scope.get('writable',scope.get('write',[]));reads=s.get('readScope',[]) if isinstance(scope,list) else scope.get('readOnly',scope.get('read',[]));covered.update(allowed+reads);scopeok=scopeok and set(allowed+reads)<=files
  checks.update({'largeStageCount':len(stages),'largeDependenciesValid':depok,'largeAuthorizedFilesCovered':covered==files and scopeok,'largeEveryStageHasFailableChecks':all(s.get('failableChecks',s.get('failableVerificationChecks')) for s in stages),'largeIsolationDispositionPresent':bool(plan.get('isolationDisposition',plan.get('isolation'))),'largeFinalColdVerifierPresent':'fable-verifier' in json.dumps(stages[-1]),'largeNoMutationClaim':answer['mutationPerformed'] is False})
 trials.append({'id':t['id'],'arm':t['arm'],'size':t['size'],'threadId':row['id'],'agentPath':agent,'model':'gpt-6-luna','effort':'xhigh','sourceRolloutRelative':str(source.relative_to(home)),'sourceRolloutSHA256':hashlib.sha256(blob).hexdigest(),'agentPromptSHA256':hashlib.sha256(prompt.encode()).hexdigest() if prompt else None,'requests':records,'usage':sums,'standardAPIEquivalentUSD':str(sum(Decimal(v) for v in costparts.values())),'costPartsUSD':costparts,'readLedger':ledger,'routerTier':contract['classification']['tier'],'routerStrategy':contract['workflowPlan']['strategy'],'checks':checks})
assert not normalized or len(set(normalized))==1,'Unequal available arm wrapper prompts'
totals={arm:{k:sum(t['usage'][k] for t in trials if t['arm']==arm) for k in trials[0]['usage']} for arm in ['A','B']}
for arm in totals:totals[arm]['standardAPIEquivalentUSD']=str(sum(Decimal(t['standardAPIEquivalentUSD']) for t in trials if t['arm']==arm))
result={'date':'2026-10-02','pricingSource':'https://developers.openai.com/api/docs/models/gpt-6-luna','ratesUSDPerMillion':rates,'wrapperEqualityVerified':len(normalized)==6,'costScope':'All requests of six completed fresh Luna trial threads. Standard API-equivalent only; actual invoice/subscription cost is unavailable. Shared parent review/setup/reporting overhead is excluded from both arms.','comparability':'One trial per size/arm; equal task/fixture hashes per pair. Wrapper equality is intended but not independently verifiable from encrypted native task messages. Warm caching is observed, not experimentally controlled. No full multi-agent Fable execution or live-host hook-enforcement claim.','trials':trials,'totals':totals}
(root/'usage.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
print(json.dumps({'trials':[{k:t[k] for k in ['id','usage','standardAPIEquivalentUSD','routerStrategy','checks']} for t in trials],'totals':totals},indent=2))
