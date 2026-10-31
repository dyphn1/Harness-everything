#!/usr/bin/env python3
"""Post-run attribution: distinguish file listings from returned source content."""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import re
import shlex
import subprocess

def is_tdd_quality_command(command, depth=0):
    """Recognize explicit invocations, never gate names inside argument text.

    Deliberately conservative: compound shell programs and dynamic expansion
    are not execution evidence. Supported transparent wrappers are env,
    command/exec and a shell's single -c/-lc command.
    """
    if not isinstance(command, str) or depth > 4:
        return False
    try:
        lexer = shlex.shlex(command, posix=True, punctuation_chars=';&|()<>')
        lexer.whitespace_split = True
        tokens = list(lexer)
    except ValueError:
        return False
    if any(token and all(c in ';&|()<>' for c in token) for token in tokens):
        return False
    while tokens and re.fullmatch(r'[A-Za-z_][A-Za-z0-9_]*=.*', tokens[0]):
        tokens.pop(0)
    if not tokens:
        return False
    executable = tokens.pop(0).replace('\\', '/').rsplit('/', 1)[-1]
    if executable in ('command', 'exec'):
        if tokens[:1] == ['--']:
            tokens.pop(0)
        return is_tdd_quality_command(shlex.join(tokens), depth+1)
    if executable == 'env':
        if tokens[:1] == ['--']:
            tokens.pop(0)
        return is_tdd_quality_command(shlex.join(tokens), depth+1)
    if executable in ('sh', 'bash', 'zsh'):
        return (len(tokens) == 2 and tokens[0] in ('-c', '-lc')
                and is_tdd_quality_command(tokens[1], depth+1))
    if executable in ('npm', 'npm.cmd'):
        while tokens and tokens[0].startswith('-'):
            option = tokens.pop(0)
            if option in ('--prefix', '--workspace', '-w'):
                if not tokens:
                    return False
                tokens.pop(0)
            elif option not in ('--silent', '-s', '--quiet') and not option.startswith(('--prefix=', '--workspace=')):
                return False
        if len(tokens) < 2 or tokens[0] not in ('run', 'run-script') or tokens[1] != 'tdd:quality':
            return False
        options = tokens[2:tokens.index('--')] if '--' in tokens else tokens[2:]
        return not any(option in ('--help', '-h', '--version', '-v', '--dry-run') for option in options)
    if executable in ('node', 'node.exe'):
        while tokens and tokens[0] in ('--no-warnings', '--enable-source-maps'):
            tokens.pop(0)
        return bool(tokens and tokens[0].replace('\\', '/').rsplit('/', 1)[-1] == 'quality-gate.js')
    return False

def is_content_command(command):
    if re.search(r'\brg\s+--files\b|\bfind\b|\bls\b|\bwc\b', command):
        return False
    return bool(re.search(r'\b(cat|sed|head|tail|rg|grep|read_text|readFileSync)\b', command))

def references(value, source):
    return '.harness/' in value or source+'/' in value or 'SKILL.md' in value

def inspect_episode(episode):
    row=json.loads((episode/'analysis.json').read_text())
    manifest=json.loads((episode/'manifest.json').read_text())
    source=str(Path(__file__).resolve().parent.parent.parent)
    events=[]
    for line in (episode/'transcript.jsonl').read_text().splitlines():
        try:events.append(json.loads(line))
        except json.JSONDecodeError:pass
    active='uncomposed';reads=[];errors=[];children=[];ttft=None;commands=[];requests=[];private_dispatch=[]
    for event in events:
        outputs=[]
        item=event.get('item',{})
        if event.get('type')=='item.completed' and item.get('type')=='command_execution':
            outputs.append((item.get('command',''),item.get('aggregated_output','')))
            if item.get('exit_code') not in [0,None]:
                errors.append({'command':item.get('command'),'exit':item.get('exit_code')})
        result=event.get('tool_use_result')
        if isinstance(result,dict):
            if result.get('type')=='text' and isinstance(result.get('file'),dict):
                f=result['file'];p=f.get('filePath','');content=f.get('content','')
                if references(p,source):
                    reads.append({'active_step':active,'path':p,'returned_bytes':len(content.encode()),
                                  'exact_reference_bytes':len(content.encode()),
                                  'content_sha256':hashlib.sha256(content.encode()).hexdigest(),
                                  'evidence':'native Read result','lines':f.get('numLines')})
            if 'stdout' in result:
                command=''
                for content in event.get('message',{}).get('content',[]):
                    if content.get('type')=='tool_result':
                        tool_id=content.get('tool_use_id')
                        for prior in events:
                            for tool in prior.get('message',{}).get('content',[]):
                                if tool.get('id')==tool_id: command=tool.get('input',{}).get('command','')
                outputs.append((command,result.get('stdout','')))
                if result.get('interrupted'):errors.append({'command':command,'interrupted':True})
        if isinstance(result,str) and result.startswith('Error:'):
            errors.append({'tool_error':result})
        for command,output in outputs:
            commands.append(command)
            if 'workflow-disposition.js' in command:
                try:
                    # Shell batches may append a contract dump after the
                    # controller's single-line JSON response.
                    data,_=json.JSONDecoder().raw_decode(output.lstrip())
                    if isinstance(data,dict):
                        if data.get('activeStep'):active=data['activeStep']['id']
                        elif data.get('activeStages'):active=','.join(s.get('stageId','?') for s in data['activeStages'])
                except (json.JSONDecodeError,KeyError,TypeError):pass
            if references(command,source) and is_content_command(command) and output:
                paths=re.findall(r'(?:\.harness/|'+re.escape(source)+r'/)([\w./-]+)',command)
                remaining=output;exact_bytes=0;matched=[]
                for relative in paths:
                    file=Path(source)/relative
                    if not file.is_file():continue
                    content=file.read_text()
                    if content and content in remaining:
                        exact_bytes+=len(content.encode());matched.append(relative)
                        remaining=remaining.replace(content,'',1)
                reads.append({'active_step':active,'paths':paths,'command':command,
                              'returned_bytes':len(output.encode()),
                              'exact_reference_bytes':exact_bytes,'matched_full_files':matched,
                              'content_sha256':hashlib.sha256(output.encode()).hexdigest(),
                              'evidence':'completed native shell output; may contain multiple files'})
        if event.get('type')=='assistant':
            for tool in event.get('message',{}).get('content',[]):
                if tool.get('type')=='tool_use' and tool.get('name') in ['Task','Agent']:children.append(tool)
        if event.get('type')=='result':
            ttft=event.get('ttft_ms');row['subagent_stats']=event.get('subagent_stats')
            row['permission_denials']=event.get('permission_denials')
            row['host_error']=event.get('is_error');row['terminal_reason']=event.get('terminal_reason')
    if row['model']['engine']=='claude':
        sid=next((e.get('session_id') for e in events if e.get('subtype')=='init'),None)
        efforts=set()
        if sid:
            for file in (Path.home()/'.claude/projects').glob('*/'+sid+'.jsonl'):
                for line in file.read_text().splitlines():
                    e=json.loads(line)
                    if e.get('effort'):efforts.add(e['effort'])
        row['effective_effort_reported']=sorted(efforts) if efforts else None
        by_id={}
        for event in events:
            message=event.get('message',{})
            if event.get('type')=='assistant' and message.get('id') and message.get('usage'):
                previous=by_id.get(message['id'],{})
                if message['usage'].get('output_tokens',0)>=previous.get('output_tokens',0):
                    by_id[message['id']]=message['usage']
        child_ids={e['tool_use_result']['agentId'] for e in events
            if isinstance(e.get('tool_use_result'),dict) and e['tool_use_result'].get('agentId')}
        child_audits=[]
        if sid:
            for parent_file in (Path.home()/'.claude/projects').glob('*/'+sid+'.jsonl'):
                for agent_id in child_ids:
                    child_file=parent_file.with_suffix('')/'subagents'/('agent-'+agent_id+'.jsonl')
                    if not child_file.exists():continue
                    raw=child_file.read_text();child_events=[json.loads(line) for line in raw.splitlines()]
                    child_models=set();child_efforts=set();child_requests={}
                    for event in child_events:
                        message=event.get('message',{})
                        if event.get('effort'):child_efforts.add(event['effort'])
                        if message.get('model'):child_models.add(message['model'])
                        if event.get('type')=='assistant' and message.get('id') and message.get('usage'):
                            previous=by_id.get(message['id'],{})
                            if message['usage'].get('output_tokens',0)>=previous.get('output_tokens',0):
                                by_id[message['id']]=message['usage'];child_requests[message['id']]=message['usage']
                    (episode/('child-'+agent_id+'.jsonl')).write_text(raw)
                    child_audits.append({'agent_id':agent_id,'models':sorted(child_models),
                        'efforts':sorted(child_efforts),'request_usage':list(child_requests.values()),
                        'raw_sha256':hashlib.sha256(raw.encode()).hexdigest()})
        row['child_audits']=child_audits
        requests=list(by_id.values())
        all_model_usage=row.get('actual_model_reported')
        if isinstance(all_model_usage,dict) and set(all_model_usage)=={row['model']['model']}:
            aggregate=all_model_usage[row['model']['model']]
            row['parent_usage']=row.get('usage')
            row['usage']={
                'input_tokens':aggregate['inputTokens'],'output_tokens':aggregate['outputTokens'],
                'cache_read_input_tokens':aggregate['cacheReadInputTokens'],
                'cache_creation_input_tokens':aggregate['cacheCreationInputTokens'],
                'output_tokens_details':{'thinking_tokens':aggregate.get('thinkingTokens')},
            }
            row['usage_scope']='all parent/worker modelUsage, reconciled with unique request IDs'
    else:
        sid=next((e.get('thread_id') for e in events if e.get('type')=='thread.started'),None)
        if sid:
            seen=set()
            for file in (Path.home()/'.codex/sessions').glob('*/*/*/*'+sid+'*'):
                private_events=[json.loads(line) for line in file.read_text().splitlines()]
                for event in private_events:
                    payload=event.get('payload',{})
                    if event.get('type')=='response_item' and payload.get('type')=='function_call' and payload.get('name') in ['spawn_agent','wait_agent']:
                        arguments=json.loads(payload.get('arguments','{}'))
                        outputs=[x.get('payload',{}).get('output') for x in private_events
                            if x.get('payload',{}).get('type')=='function_call_output' and x['payload'].get('call_id')==payload.get('call_id')]
                        private_dispatch.append({'tool':payload['name'],'arguments':arguments,'outputs':outputs,
                            'evidence':'attributable parent rollout response_item; absent from CLI JSON spawn items'})
                    if event.get('type')!='event_msg' or payload.get('type')!='token_count':continue
                    info=payload.get('info') or {};total=info.get('total_token_usage');last=info.get('last_token_usage')
                    if not total or not last:continue
                    key=json.dumps(total,sort_keys=True)
                    if key not in seen:requests.append(last);seen.add(key)
    bindings=[];steps=[];strategies=[];stages=[]
    for file in (episode/'state').rglob('workflow-obligations.json'):
        data=json.loads(file.read_text())
        for step in data.get('requirements',[]):
            steps.append({'id':step['id'],'type':step.get('stepType'),'status':step.get('status')})
            bindings.extend({'step':step['id'],**b} for b in step.get('requiredBindings',[]))
    for file in (episode/'state').rglob('workflow-run.json'):
        data=json.loads(file.read_text());strategies.append(data.get('strategy'))
    for file in (episode/'state').rglob('*.json'):
        data=json.loads(file.read_text())
        if isinstance(data,dict) and data.get('schemaVersion')==2 and data.get('stageId') and data.get('runId'):
            stages.append({'file':str(file),'stage':data['stageId'],'status':data.get('status'),
                           'dependsOn':data.get('dependsOn'),'requiredBindings':data.get('requiredBindings'),
                           'verification':data.get('verification')})
            bindings.extend({'stage':data['stageId'],**b} for b in data.get('requiredBindings',[]))
    for read in reads:
        paths=read.get('paths') or [read.get('path','')]
        read['declared_binding_matches']=[{'id':b.get('id'),'step':b.get('step'),
                                          'stage':b.get('stage'),'path':b.get('path')}
            for b in bindings if b.get('path') and any(b['path'] in p for p in paths)]
    usage=row.get('usage') or {};price=None;input_price=None;reconstructed_price=None
    # Independently re-run the immutable upstream cases against the retained
    # final artifact, never an agent-writable checker or cases file.
    if row['workload']=='quixbugs-find-in-sorted':
        checker="import json,importlib.util,sys;from pathlib import Path;s=importlib.util.spec_from_file_location('target',sys.argv[1]);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);cases=[json.loads(x) for x in Path(sys.argv[2]).read_text().splitlines()];assert all(m.find_in_sorted(*args)==expected for args,expected in cases);print('PASS all 7 immutable upstream cases')"
        try:
            check=subprocess.run(['python3','-c',checker,str(episode/'find_in_sorted.py'),
                str(Path(__file__).resolve().parent/'fixtures/quixbugs/cases.json')],capture_output=True,text=True,timeout=20)
            row['independent_grader']={'pass':check.returncode==0,'exit':check.returncode,'stdout':check.stdout,'stderr':check.stderr}
        except subprocess.TimeoutExpired:
            row['independent_grader']={'pass':False,'timeout':True}
    elif row['workload']=='polyglot-simple-linked-list-staged':
        check=subprocess.run(['node',str(Path(__file__).resolve().parent/'grader.cjs'),
            str(episode/'simple-linked-list.js')],capture_output=True,text=True,timeout=20)
        row['independent_grader']={'pass':check.returncode==0,'exit':check.returncode,'stdout':check.stdout,'stderr':check.stderr}
    else:row['independent_grader']=row['grader']
    if row['model']['engine']=='codex' and usage and usage.get('cache_write_input_tokens')==0:
        price=((usage['input_tokens']-usage['cached_input_tokens'])*.10+
               usage['cached_input_tokens']*.01+usage['output_tokens']*.50)/1e6
    elif row['model']['engine']=='claude':price=row.get('host_reported_cost_usd')
    if requests:
        input_price=0.;reconstructed_price=0.
        for request in requests:
            if row['model']['engine']=='codex':
                n=request['input_tokens'];cached=request['cached_input_tokens'];writes=request.get('cache_write_input_tokens')
                if writes is None:input_price=None;reconstructed_price=None;break
                multiplier=2 if n>272000 else 1
                c=((n-cached-writes)*.10+cached*.01+writes*.125)*multiplier/1e6
                output_cost=request['output_tokens']*.50*(1.5 if n>272000 else 1)/1e6
            else:
                n=request.get('input_tokens',0);cached=request.get('cache_read_input_tokens',0)
                writes=request.get('cache_creation_input_tokens',0);split=request.get('cache_creation')
                if writes and not split:input_price=None;reconstructed_price=None;break
                split=split or {};multiplier=5 if n+cached+writes>100000 else 1
                c=(n*.10+cached*.01+split.get('ephemeral_5m_input_tokens',0)*.125+
                   split.get('ephemeral_1h_input_tokens',0)*.20)*multiplier/1e6
                output_cost=request.get('output_tokens',0)*.50*multiplier/1e6
            input_price+=c;reconstructed_price+=c+output_cost
        mapping={'input_tokens':'input_tokens','output_tokens':'output_tokens'}
        if row['model']['engine']=='codex':mapping['cached_input_tokens']='cached_input_tokens'
        else:
            mapping['cache_read_input_tokens']='cache_read_input_tokens'
            mapping['cache_creation_input_tokens']='cache_creation_input_tokens'
        sums={field:sum(r.get(field,0) for r in requests) for field in mapping}
        input_reconciles=all(sums[field]==usage.get(field) for field in mapping if field!='output_tokens')
        if not input_reconciles:input_price=None;reconstructed_price=None
        elif row['model']['engine']=='claude':
            # Assistant stream records expose initial/provisional output usage.
            # Final aggregate output is usable when all requests share one tier.
            tiers={5 if r.get('input_tokens',0)+r.get('cache_read_input_tokens',0)+r.get('cache_creation_input_tokens',0)>100000 else 1 for r in requests}
            reconstructed_price=(input_price+usage['output_tokens']*.5*next(iter(tiers))/1e6) if len(tiers)==1 and input_price is not None else None
    else:sums={};input_reconciles=False
    # No tokenizer estimate: bytes are measured, tokenizer/content tokens unknown.
    row.update({'observed_reference_reads':reads,'reference_returned_bytes':sum(x['returned_bytes'] for x in reads),
                'exact_reference_bytes_lower_bound':sum(x['exact_reference_bytes'] for x in reads),
                'observed_errors':errors,'required_bindings':bindings,'steps':steps,'strategies':strategies,
                'stages':stages,'child_calls':children,'ttft_ms':ttft,'api_equivalent_cost_usd':price,
                'tdd_quality_gate_executed':any(is_tdd_quality_command(c) for c in commands),
                'cost_basis':'list-price estimate, not subscription billing',
                'request_usage':requests,'api_equivalent_input_cost_usd':input_price,
                'request_usage_sums':sums,'input_usage_reconciles':input_reconciles,
                'request_output_usage_complete':sums.get('output_tokens')==usage.get('output_tokens') if requests else False,
                'reconstructed_total_cost_usd':reconstructed_price,
                'reference_content_tokens':None})
    row['private_collaboration_dispatch']=private_dispatch
    row['parent_api_equivalent_input_cost_usd']=input_price
    row['parent_api_equivalent_cost_usd']=price
    if any(x['tool']=='spawn_agent' for x in private_dispatch):
        row['api_equivalent_input_cost_usd']=None
        row['api_equivalent_cost_usd']=None
        row['child_usage_observability']='unknown; dispatched worker usage/model ID not exposed in parent CLI stream'
    else:row['child_usage_observability']='no attributable native spawn in inspected parent rollout'
    if (row.get('stop_reason')=='wall-time-budget' or row.get('terminal_reason')=='max_turns') and row.get('router_attributed'):
        row['classification']='definitive-agent-budget-failure'
        row['budget_failure']=True
        row['cost_observability']='partial; final aggregate unavailable'
        # Retain measured request counters without pretending the interrupted
        # in-flight request has complete billed/output telemetry.
        row['observed_request_token_sums']={field:sum(r.get(field,0) for r in requests)
            for field in ['input_tokens','cached_input_tokens','cache_read_input_tokens',
                          'cache_creation_input_tokens','output_tokens','reasoning_output_tokens']}
    else:row['budget_failure']=False;row['cost_observability']='final aggregate retained' if usage else 'unknown'
    (episode/'audit.json').write_text(json.dumps(row,indent=2)+'\n')
    return row

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('roots',nargs='+');parser.add_argument('--output',required=True)
    args=parser.parse_args();rows=[]
    for root in args.roots:
        for episode in sorted(Path(root).iterdir()):
            if (episode/'analysis.json').exists():
                row=inspect_episode(episode);row['series']=Path(root).name;rows.append(row)
    out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    (out/'audited-rows.json').write_text(json.dumps(rows,indent=2)+'\n')
    groups=defaultdict(list)
    for row in rows:
        groups[(row['series'],row['model']['engine'],row['workload'],row['arm'])].append(row)
    summary=[]
    for key,group in sorted(groups.items()):
        summary.append({'series':key[0],'engine':key[1],'workload':key[2],'arm':key[3],
            'n':len(group),'artifact_passes':sum(r['independent_grader'].get('pass',False) for r in group),
            'inconclusive':sum(r['classification']=='inconclusive' for r in group),
            'budget_failures':sum(r['budget_failure'] for r in group),
            'reference_bytes':sum(r['reference_returned_bytes'] for r in group),
            'exact_reference_bytes_lower_bound':sum(r['exact_reference_bytes_lower_bound'] for r in group),
            'mean_wall_seconds':sum(r['wall_seconds'] for r in group)/len(group),
            'api_equivalent_cost_usd':sum(r['api_equivalent_cost_usd'] or 0 for r in group),
            'api_equivalent_input_cost_usd':sum(r['api_equivalent_input_cost_usd'] or 0 for r in group),
            'input_cost_missing':sum(r['api_equivalent_input_cost_usd'] is None for r in group),
            'cost_missing':sum(r['api_equivalent_cost_usd'] is None for r in group),
            'all_steps_pass':sum(bool(r['steps']) and all(s['status']=='pass' for s in r['steps']) for r in group),
            'required_bindings_unresolved':sum(b.get('status')!='loaded' for r in group for b in r['required_bindings'])})
    (out/'group-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
    print(json.dumps(summary,indent=2))
