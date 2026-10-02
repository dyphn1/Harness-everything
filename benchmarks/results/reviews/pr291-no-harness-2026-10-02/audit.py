import datetime,hashlib,json,pathlib,sqlite3
from decimal import Decimal
root=pathlib.Path(__file__).resolve().parent;previous=root.parent/'pr291-corrected-2026-10-02'
keys=['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens']
def elapsed(es):
 starts=[e for e in es if e['type']=='event_msg' and e['payload'].get('type')=='task_started']
 ends=[e for e in es if e['type']=='event_msg' and e['payload'].get('type')=='task_complete']
 assert len(starts)==len(ends)==1,'Require one completed turn'
 a,b=starts[0]['timestamp'],ends[0]['timestamp']
 return {'startUTC':a,'endUTC':b,'elapsedSeconds':round((datetime.datetime.fromisoformat(b.replace('Z','+00:00'))-datetime.datetime.fromisoformat(a.replace('Z','+00:00'))).total_seconds(),3),'definition':'Native rollout task_started to task_complete; excludes launch/startup overhead.'}
old=json.loads((previous/'usage.json').read_text());conn=sqlite3.connect('file:'+str(pathlib.Path.home()/'.codex/state_5.sqlite')+'?mode=ro',uri=True)
timings={}
for t in old['trials']:
 p=pathlib.Path(conn.execute('select rollout_path from threads where id=?',(t['threadId'],)).fetchone()[0]);blob=p.read_bytes();assert hashlib.sha256(blob).hexdigest()==t['sourceRolloutSHA256']
 es=[json.loads(l) for l in blob.decode().splitlines()];timings[t['id']]=elapsed(es)
(previous/'timing.json').write_text(json.dumps(timings,indent=2)+'\n',encoding='utf8')
m=json.loads((root/'manifest.json').read_text());trials=[]
for t in m['trials']:
 assert t['exitCode']==0
 ps=list(pathlib.Path(t['authHome']).rglob('rollout-*.jsonl'));assert len(ps)==1
 blob=ps[0].read_bytes();es=[json.loads(l) for l in blob.decode().splitlines()]
 assert {(e['payload']['model'],e['payload']['effort']) for e in es if e['type']=='turn_context'}=={('gpt-6-luna','xhigh')}
 timing=elapsed(es);records=[{'timestamp':e['timestamp'],'responseId':e['payload']['response_id'],'usage':{k:e['payload']['usage'].get(k,0) for k in keys}} for e in es if e['type']=='token_usage_record']
 assert records and len({r['responseId'] for r in records})==len(records)
 u={k:sum(r['usage'][k] for r in records) for k in keys};last=next(e['payload'] for e in reversed(es) if e['type']=='token_usage_record');assert u=={k:last['thread_token_usage'].get(k,0) for k in keys}
 for r in records:
  x=r['usage'];assert x['total_tokens']==x['input_tokens']+x['output_tokens'];assert x['cached_input_tokens']+x['cache_write_input_tokens']<=x['input_tokens'];assert x['reasoning_output_tokens']<=x['output_tokens'];assert x['input_tokens']<=272000
 u['uncached_input_tokens']=u['input_tokens']-u['cached_input_tokens']-u['cache_write_input_tokens']
 cost=(Decimal(u['uncached_input_tokens'])*Decimal('.10')+Decimal(u['cached_input_tokens'])*Decimal('.01')+Decimal(u['cache_write_input_tokens'])*Decimal('.125')+Decimal(u['output_tokens'])*Decimal('.50'))/1000000
 # No raw reasoning export. Only public instructions and observable tool/message events.
 messages=[e['payload'] for e in es if e['type']=='response_item' and e['payload'].get('type')=='message' and e['payload'].get('role') in ['developer','user']]
 context='\n'.join(c.get('text','') for p in messages for c in p.get('content',[]))
 assert not any(s in context.lower() for s in ['harness-everything','harness status','fable-mode/skill','agents.md instructions for']), 'Harness instruction contamination'
 tools=[e['payload'] for e in es if e['type']=='response_item' and e['payload'].get('type') in ['function_call','custom_tool_call']]
 assert not any(s in json.dumps(tools).lower() for s in ['harness-everything','skill.md','kernel-router','tier-router','spawn_agent']), 'Harness/tool contamination'
 (root/t['id']/'instruction-context.json').write_text(json.dumps(messages,indent=2)+'\n',encoding='utf8')
 answer=json.loads((root/t['id']/'answer.json').read_text(encoding='utf-8-sig'))
 profile=answer.get('profile');profile=profile if isinstance(profile,dict) else {}
 semantic={'customProfileResolved':profile.get('requestedProfile')==('orchestrator' if t['size']=='large' else 'reasoning')}
 if t['size']=='large':
  plan=answer['plan'];stages=plan['stages'];files={f for mod in json.loads((root/t['id']/'architecture.json').read_text())['modules'] for f in mod['files']};covered=set();visited=set();depok=True;scopeok=True
  for s in stages:
   depok=depok and all(d in visited for d in s['dependsOn']);visited.add(s['stage']);scope=s['authorizedFileScope'];covered.update(scope);scopeok=scopeok and set(scope)<=files
  semantic.update({'largeStageCount':len(stages),'largeDependenciesValid':depok,'largeAuthorizedFilesCovered':covered==files and scopeok,'largeEveryStageHasFailableChecks':all(s.get('verificationChecks') for s in stages),'largeIsolationDispositionPresent':bool(plan.get('isolationDisposition')),'largeGenericIndependentReviewPresent':stages[-1]['roleAssignment']=='Independent reviewer' and stages[-1]['access']=='Read-only review','largeNoMutationClaim':answer['mutationPerformed'] is False})
 eventsfile=root/t['id']/'events.jsonl';events=[json.loads(l) for l in eventsfile.read_text(encoding='utf8').splitlines()]
 sanitized=[e for e in events if e.get('item',{}).get('type') not in ['reasoning']]
 eventsfile.write_text('\n'.join(json.dumps(e,ensure_ascii=False) for e in sanitized)+'\n',encoding='utf8')
 rd=(root/t['id']/'README.md').read_bytes();edited=b'## Installation' in rd and b'Instalation' not in rd
 unchanged={n:hashlib.sha256((pathlib.Path(t['dir'])/n).read_bytes()).hexdigest()==h for n,h in t['initialHashes'].items() if n!='README.md'};assert all(unchanged.values())
 trials.append({'id':t['id'],'arm':'C','size':t['size'],'model':'gpt-6-luna','effort':'xhigh','threadId':last['thread_id'],'sourceRolloutSHA256':hashlib.sha256(blob).hexdigest(),'timing':timing,'processWallSeconds':t['processWallSeconds'],'usage':u,'requests':records,'standardAPIEquivalentUSD':str(cost),'checks':{'noHarnessInstructionsObserved':True,'noHarnessToolReadsObserved':True,'taskAndArchitectureUnchanged':all(unchanged.values()),'READMEBehavior':edited if t['size']=='medium' else rd==(root/t['id']/'README.initial.md').read_bytes()},'semanticChecks':semantic,'observableEventsExport':'events.jsonl excludes reasoning items; raw local rollout stays private','answerKeys':list(answer)})
result={'scope':'C: native clean CLI control, no Harness plugin/hooks/instructions loaded. Host/wrapper differs from earlier native collaboration A/B: descriptive comparison, not causal estimate.','pricingSource':old['pricingSource'],'ratesUSDPerMillion':old['ratesUSDPerMillion'],'trials':trials,'previousTimings':timings}
(root/'usage.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
print(json.dumps([{k:t[k] for k in ['id','timing','usage','standardAPIEquivalentUSD','checks']} for t in trials],indent=2))
