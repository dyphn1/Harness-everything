"""Read-only, scoped Codex usage audit. Exports tokens/actions; never exports conversation or reasoning text."""
import collections, datetime, hashlib, json, pathlib, re, sqlite3
from decimal import Decimal
HOME=pathlib.Path.home()/'.codex'
OUT=pathlib.Path(__file__).resolve().parent
ROOT='01a0f7d4-ba11-7ce3-ac45-870ac544d5d5'
LATEST='01a0f845-45bb-7af0-b87b-448c98fe7f4d'
INITIAL='01a0f81b-3de4-7b31-9bd5-16f3e3667943'
KEYS=['input_tokens','cached_input_tokens','cache_write_input_tokens','output_tokens','reasoning_output_tokens','total_tokens']
RATES={'gpt-6-luna':{'uncached':Decimal('.10'),'cache':Decimal('.01'),'write':Decimal('.125'),'output':Decimal('.50')},'gpt-6.1-sol':{'uncached':Decimal('2'),'cache':Decimal('.10'),'write':Decimal('2.50'),'output':Decimal('10')}}
CREDITS={'gpt-6-luna':{'uncached':Decimal('2.5'),'cache':Decimal('.25'),'output':Decimal('12.5')},'gpt-6.1-sol':{'uncached':Decimal('50'),'cache':Decimal('2.5'),'output':Decimal('250')}}
conn=sqlite3.connect('file:'+str(HOME/'state_5.sqlite')+'?mode=ro',uri=True);conn.row_factory=sqlite3.Row
logdb=sqlite3.connect('file:'+str(HOME/'logs_2.sqlite')+'?mode=ro',uri=True)
def read(row,turn=None):
    events=[json.loads(line) for line in pathlib.Path(row['rollout_path']).read_text().splitlines()]
    contexts=[e['payload'] for e in events if e['type']=='turn_context' and (turn is None or e['payload'].get('root_turn_id',e['payload'].get('turn_id'))==turn)]
    # Root turn-context may use turn_id; both scopes here retain the same model/effort.
    if not contexts:contexts=[e['payload'] for e in events if e['type']=='turn_context' and e['payload'].get('turn_id')==turn]
    assert contexts and len({(c['model'],c['effort']) for c in contexts})==1
    model=contexts[-1]['model'];effort=contexts[-1]['effort'];records=[];pending=[];calls=0
    for e in events:
        q=e.get('payload',{})
        if e['type']=='response_item' and q.get('type') in ['function_call','custom_tool_call']:
            a=q.get('arguments',q.get('input',''));m=re.search(r'probe\.cjs (route|read) (baseline|fixed) r[12](?: ([A-Za-z0-9_/.-]+))?',a)
            action=(m.group(1)+(' '+m.group(3) if m.group(3) else '')) if m else ('write-report' if 'answer.json' in a else 'tool:'+q.get('name','unknown'))
            pending.append(action)
        if e['type']!='token_usage_record':continue
        if q.get('thread_id')!=row['id']:continue
        if turn is not None and q.get('root_turn_id')!=turn:pending=[];continue
        records.append({'timestamp':e['timestamp'],'responseId':q['response_id'],'rootTurnId':q['root_turn_id'],'actions':pending or ['final-or-message'],'usage':{k:q['usage'].get(k,0) for k in KEYS}})
        calls+=len(pending);pending=[]
    assert records and len({r['responseId'] for r in records})==len(records)
    sums={k:sum(r['usage'][k] for r in records) for k in KEYS}
    last=next(e['payload'] for e in reversed(events) if e['type']=='token_usage_record' and (turn is None or e['payload'].get('root_turn_id')==turn))
    expected=last['thread_token_usage'] if turn is None else last['turn_token_usage']
    assert sums=={k:expected.get(k,0) for k in KEYS},(row['agent_path'],sums,expected)
    for r in records:
        u=r['usage'];assert u['total_tokens']==u['input_tokens']+u['output_tokens'];assert u['reasoning_output_tokens']<=u['output_tokens'];assert u['cached_input_tokens']+u['cache_write_input_tokens']<=u['input_tokens']
    sums['uncached_input_tokens']=sums['input_tokens']-sums['cached_input_tokens']-sums['cache_write_input_tokens'];sums['nonreasoning_output_tokens']=sums['output_tokens']-sums['reasoning_output_tokens']
    rates=RATES[model];components={k:float(Decimal(sums[t])*rates[k]/Decimal(1000000)) for k,t in [('uncached','uncached_input_tokens'),('cache','cached_input_tokens'),('write','cache_write_input_tokens'),('output','output_tokens')]}
    credits=sum(Decimal(sums[t])*CREDITS[model][k]/Decimal(1000000) for k,t in [('uncached','uncached_input_tokens'),('cache','cached_input_tokens'),('output','output_tokens')])
    starts=[e for e in events if e['type']=='event_msg' and e['payload'].get('type')=='task_started' and (turn is None or e['payload'].get('turn_id')==turn)]
    first=starts[0] if starts else None
    complete=[e for e in events if e['type']=='event_msg' and e['payload'].get('type')=='task_complete' and (turn is None or e['payload'].get('turn_id')==turn)]
    end=complete[-1]['timestamp'] if complete else records[-1]['timestamp'];start=first['timestamp'] if first else records[0]['timestamp']
    duration=(datetime.datetime.fromisoformat(end.replace('Z','+00:00'))-datetime.datetime.fromisoformat(start.replace('Z','+00:00'))).total_seconds()
    start_ts=int(datetime.datetime.fromisoformat(start.replace('Z','+00:00')).timestamp());end_ts=int(datetime.datetime.fromisoformat(end.replace('Z','+00:00')).timestamp())+1
    tier_rows=logdb.execute("select feedback_log_body from logs where thread_id=? and ts between ? and ? and feedback_log_body like '%service_tier%'",(row['id'],start_ts,end_ts)).fetchall()
    tiers=sorted({v for rr in tier_rows for v in re.findall(r'service_tier.{0,8}(default|priority|flex|auto)',rr[0] or '')})
    result={'threadId':row['id'],'agentPath':row['agent_path'],'scopeRootTurnId':turn,'sourceRolloutRelativePath':str(pathlib.Path(row['rollout_path']).relative_to(HOME)),'actualModel':model,'actualEffort':effort,'requestServiceTiersObservedInLocalLogs':tiers,'modelRequests':len(records),'toolCalls':calls,'startUtc':start,'endUtc':end,'durationSeconds':duration,'tokens':sums,'apiEquivalentCostUsdStandard':round(sum(components.values()),10),'apiCostComponentsUsd':components,'creditEquivalentStandard':float(credits),'actualBilledUsd':None,'requests':records}
    result['sourceUsageRecordsSha256']=hashlib.sha256(json.dumps(records,sort_keys=True).encode()).hexdigest()
    return result
threads=[]
for path in ['/root/rerun_baseline_1','/root/rerun_fixed_1','/root/rerun_baseline_2','/root/rerun_fixed_2','/root/lookup_baseline_1','/root/lookup_fixed_1','/root/lookup_baseline_2','/root/lookup_fixed_2']:
    row=conn.execute('select * from threads where agent_path=?',(path,)).fetchone();assert row is not None;threads.append(read(row))
parent=conn.execute('select * from threads where id=?',(ROOT,)).fetchone();parents=[read(parent,LATEST),read(parent,INITIAL)]
latest=[t for t in threads if '/rerun_' in t['agentPath']];initial=[t for t in threads if '/lookup_' in t['agentPath']]
means={}
for arm in ['baseline','fixed']:
    xs=[t for t in latest if '_'+arm+'_' in t['agentPath']]
    means[arm]={'tokens':{k:sum(t['tokens'][k] for t in xs)/len(xs) for k in latest[0]['tokens']},'apiEquivalentCostUsdStandard':sum(t['apiEquivalentCostUsdStandard'] for t in xs)/len(xs),'creditEquivalentStandard':sum(t['creditEquivalentStandard'] for t in xs)/len(xs),'modelRequests':sum(t['modelRequests'] for t in xs)/len(xs),'toolCalls':sum(t['toolCalls'] for t in xs)/len(xs),'durationSeconds':sum(t['durationSeconds'] for t in xs)/len(xs)}
b,f=means['baseline'],means['fixed'];reduction={k:round((1-f['tokens'][k]/b['tokens'][k])*100,4) for k in b['tokens'] if b['tokens'][k]}
reduction['apiEquivalentCostUsdStandard']=round((1-f['apiEquivalentCostUsdStandard']/b['apiEquivalentCostUsdStandard'])*100,4)
leaf=sum(t['apiEquivalentCostUsdStandard'] for t in latest);initialleaf=sum(t['apiEquivalentCostUsdStandard'] for t in initial);full=leaf+parents[0]['apiEquivalentCostUsdStandard']
result={'scope':'Completed final rerun: four complete child threads plus the completed parent rerun/report/publish turn. Initial comparison and its implementation/verification parent turn are shown separately. Earlier PR review/OpenCode experiments and the ongoing audit turn are excluded.','pricingDate':'2026-10-02','pricingSource':'https://developers.openai.com/api/docs/pricing?tab=suite','creditPricingSource':'https://learn.chatgpt.com/docs/pricing','reasoningBillingSource':'https://developers.openai.com/api/docs/guides/reasoning','ratesUsdPerMillion':{m:{k:float(v) for k,v in r.items()} for m,r in RATES.items()},'currencyMethod':'Standard short-context API-equivalent USD, not an invoice; cached input is subtracted from input, reasoning is already included in output; cache writes are zero. Local request logs report default tier.','latestTrials':latest,'initialExploratoryTrials':initial,'parentTurns':parents,'latestMeans':means,'latestReductionPercent':reduction,'latestCompleteOperation':{'childrenApiEquivalentUsd':round(leaf,10),'parentApiEquivalentUsd':parents[0]['apiEquivalentCostUsdStandard'],'totalApiEquivalentUsd':round(full,10),'parentSharePercent':round(parents[0]['apiEquivalentCostUsdStandard']/full*100,4)},'initialImplementationPlusComparison':{'childrenApiEquivalentUsd':round(initialleaf,10),'parentApiEquivalentUsd':parents[1]['apiEquivalentCostUsdStandard'],'totalApiEquivalentUsd':round(initialleaf+parents[1]['apiEquivalentCostUsdStandard'],10)},'bothOperationsApiEquivalentUsd':round(full+initialleaf+parents[1]['apiEquivalentCostUsdStandard'],10)}
savings=b['apiEquivalentCostUsdStandard']-f['apiEquivalentCostUsdStandard'];components={}
for component in ['uncached','cache','output']:
    bc=sum(t['apiCostComponentsUsd'][component] for t in latest if '_baseline_' in t['agentPath'])/2
    fc=sum(t['apiCostComponentsUsd'][component] for t in latest if '_fixed_' in t['agentPath'])/2
    components[component]={'baselineUsd':bc,'fixedUsd':fc,'savedUsd':bc-fc,'shareOfSavingsPercent':round((bc-fc)/savings*100,4)}
result['latestCostSavingsComponents']=components
(OUT/'audit.json').write_text(json.dumps(result,indent=2)+'\n')
print('PASS: unique per-request usage sums equal cumulative counters; no cache/reasoning double count; eight child threads and two scoped parent turns')
print(json.dumps({k:result[k] for k in ['latestMeans','latestReductionPercent','latestCompleteOperation','initialImplementationPlusComparison','bothOperationsApiEquivalentUsd']},indent=2))
