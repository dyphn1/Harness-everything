#!/usr/bin/env python3
"""Bounded, evidence-retaining #290 pilot using existing subscription CLIs."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import uuid

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
PROTOCOL = json.loads((HERE / 'protocol.json').read_text())
FABLE = ['fable-mode/SKILL.md', 'fable-mode/references/profile-lookup.md',
         'fable-mode/references/model-matrix.md', 'fable-mode/CONTRACT-FORMAT.md',
         'fable-mode/references/execution-phases.md',
         'fable-mode/execution-guardrails/SKILL.md']
DOCUMENTS = {
    'profile-lookup': FABLE,
    'quixbugs-find-in-sorted': ['tdd/SKILL.md', 'verification-loop/SKILL.md',
                               'harness-everything/references/triage-and-tiers.md'],
    'polyglot-simple-linked-list-staged': FABLE + ['tdd/SKILL.md', 'verification-loop/SKILL.md'],
}
PROMPTS = {
    'profile-lookup': "Explain what 'fable on sonnect' means; return only a small JSON selection record with requestedProfile, effectiveProfile, profileAlias, assignedRole, runtimeModel, runtimeEffort. No orchestration or delegation.",
    'quixbugs-find-in-sorted': "Repair find_in_sorted.py so all cases in cases.json pass. Preserve the documented function contract and keep the repair within that file. Verify with python3 check.py before completing.",
    'polyglot-simple-linked-list-staged': "Implement the Simple Linked List module described in instructions.md. Execute a staged workflow with three dependent stages: (1) Element value and next representation; (2) List insertion, constructor, head and length using Element; (3) array conversion and reversal using List, followed by cold verification. Preserve all upstream API requirements. Keep implementation changes within simple-linked-list.js. Use the supplied dev-check.cjs to execute all 23 activated upstream tests. Keep the requested runtime model and high effort for any workers.",
}

def digest(data):
    return hashlib.sha256(data).hexdigest()

def write_json(path, data):
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + '\n')

def command(args, cwd=None, timeout=30):
    p = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    return {'command': args, 'exit': p.returncode, 'stdout': p.stdout, 'stderr': p.stderr}

def quix_check():
    return '''import json\nfrom find_in_sorted import find_in_sorted\nfrom pathlib import Path\nfor line in Path('cases.json').read_text().splitlines():\n    args, expected = json.loads(line)\n    assert find_in_sorted(*args) == expected, (args,expected)\nprint('PASS: all 7 pinned upstream cases')\n'''

def prepare(base, workload, arm, model, repeat):
    episode = base / f'{model["engine"]}-{workload}-r{repeat}-{arm}-{uuid.uuid4().hex[:8]}'
    episode.mkdir()
    ws = Path(tempfile.mkdtemp(prefix='harness290-'))
    (ws / '.harness').symlink_to(ROOT, target_is_directory=True)
    if workload == 'quixbugs-find-in-sorted':
        shutil.copyfile(HERE/'fixtures/quixbugs/find_in_sorted.py', ws/'find_in_sorted.py')
        shutil.copyfile(HERE/'fixtures/quixbugs/cases.json', ws/'cases.json')
        (ws/'check.py').write_text(quix_check())
    if workload == 'polyglot-simple-linked-list-staged':
        for name in ['instructions.md', 'simple-linked-list.js']:
            shutil.copyfile(HERE/'fixtures/polyglot'/name, ws/name)
        (ws/'package.json').write_text('{"type":"module"}\n')
        # Permitted development tests are the same full activated spec as the
        # independent post-run grader, never the reference solution.
        (ws/'dev-check.cjs').write_text(f"require({json.dumps(str(HERE/'grader.cjs'))}).grade(process.argv[2] || './simple-linked-list.js').then(p => process.exitCode=p?0:1);\n")
    (ws/'AGENTS.md').write_text('Follow the selected Harness workflow and required checks. Harness skills and references are available under .harness. Resolve required bindings at their applicable steps. Preserve requested model and effort. Do not read experiment runner files, other episode directories, or gold/reference solutions. Do not edit .pilot.json, hooks, graders, instructions, or acceptance tests. Do not commit, push, create issues, or modify user configuration.\n')
    docs = DOCUMENTS[workload]
    for doc in docs:
        if not (ROOT/doc).is_file():
            raise RuntimeError(f'missing document {doc}')
    write_json(ws/'.pilot.json', {'source': str(ROOT), 'arm': arm, 'documents': docs,
        'trace': str(episode/'host-events.jsonl'), 'routerTrace': str(episode/'router.txt')})
    subprocess.run(['git','init','-q'], cwd=ws, check=True)
    subprocess.run(['git','add','.'], cwd=ws, check=True)
    subprocess.run(['git','-c','user.name=Pilot','-c','user.email=pilot@example.invalid',
        '-c','commit.gpgsign=false','commit','-qm','fixture'], cwd=ws, check=True)
    hook = 'node ' + json.dumps(str(HERE/'host-hook.cjs'))
    hooks = {event: [{'hooks':[{'type':'command','command':hook+' '+event}]}]
             for event in ['UserPromptSubmit','PreToolUse','PostToolUse','Stop']}
    write_json(ws/'hook-settings.json', {'hooks': hooks})
    return episode, ws, hooks

def invocation(model, ws, hooks, smoke=False):
    if model['engine'] == 'claude':
        return ['claude','-p','--verbose','--output-format','stream-json','--include-hook-events',
                '--model', model['model'],'--effort','high','--max-turns','35',
                '--setting-sources','project,local','--settings',str(ws/'hook-settings.json'),
                '--allowedTools','Read,Edit,Write,Bash','--strict-mcp-config']
    # Configured automation trusts the reviewed experiment adapter, not an
    # action-gate override. Existing native permission policy stays never.
    def toml_value(value):
        if isinstance(value, dict):
            return '{'+','.join(k+'='+toml_value(v) for k,v in value.items())+'}'
        if isinstance(value,list): return '['+','.join(map(toml_value,value))+']'
        return json.dumps(value)
    args = ['codex','exec','--json','--ignore-user-config','--dangerously-bypass-hook-trust',
            '-m',model['model'],'-c','model_reasoning_effort="high"',
            '-c','approval_policy="never"','-s','workspace-write','-C',str(ws)]
    for event, groups in hooks.items():
        args += ['-c', 'hooks.'+event+'='+toml_value(groups)]
    return args + ['-']

def grade(workload, ws, transcript):
    if workload == 'profile-lookup':
        # Locate a JSON selection object, not incidental occurrences in tool
        # input. Final answer extraction is engine-specific in summarize().
        return {'external_check': 'selection-final-json', 'pending_parse': True}
    if workload == 'quixbugs-find-in-sorted':
        result = command(['python3','check.py'], ws, 20)
    else:
        result = command(['node',str(HERE/'grader.cjs'), str(ws/'simple-linked-list.js')], ws, 20)
    result['pass'] = result['exit'] == 0
    return result

def run_episode(base, model, workload, arm, repeat, smoke=False):
    episode, ws, hooks = prepare(base,workload,arm,model,repeat)
    prompt = PROMPTS[workload]
    env = dict(os.environ)
    env['HARNESS_STATE_HOME'] = str(ws/'.pilot-state')
    env['HARNESS_WORKSPACE_ROOT'] = str(ws)
    args = invocation(model,ws,hooks,smoke)
    manifest = {'model':model,'workload':workload,'arm':arm,'repeat':repeat,'preflight':smoke,
        'workspace':str(ws),'argv':args,'prompt_sha256':digest(prompt.encode()),
        'protocol_sha256':digest((HERE/'protocol.json').read_bytes()),
        'documents': {p:digest((ROOT/p).read_bytes()) for p in DOCUMENTS[workload]},
        'fixture':{p.name:digest(p.read_bytes()) for p in ws.iterdir() if p.is_file()},
        'started_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime())}
    write_json(episode/'manifest.json',manifest)
    (episode/'prompt.txt').write_text(prompt+'\n')
    start = time.monotonic()
    timeout = 90 if smoke else PROTOCOL['episode_timeout_seconds'][workload]
    with (episode/'transcript.jsonl').open('w') as out, (episode/'stderr.txt').open('w') as err:
        try:
            p = subprocess.Popen(args,cwd=ws,stdin=subprocess.PIPE,stdout=out,stderr=err,env=env,
                                 text=True,start_new_session=True)
            p.stdin.write(prompt+'\n'); p.stdin.close()
            while p.poll() is None:
                if time.monotonic()-start > timeout:
                    raise subprocess.TimeoutExpired(args, timeout)
                # Check emitted cumulative usage, never sum repeated snapshots.
                output_tokens = 0
                for line in (episode/'transcript.jsonl').read_text().splitlines():
                    try: event=json.loads(line)
                    except json.JSONDecodeError: continue
                    if event.get('type') in ['result','turn.completed']:
                        output_tokens = max(output_tokens,event.get('usage',{}).get('output_tokens',0))
                if output_tokens > PROTOCOL['episode_output_token_cap']:
                    raise subprocess.TimeoutExpired(args, timeout)
                time.sleep(1)
            status, reason = p.returncode, None
        except subprocess.TimeoutExpired:
            import signal
            os.killpg(p.pid,signal.SIGTERM)
            try: p.wait(timeout=5)
            except subprocess.TimeoutExpired:
                os.killpg(p.pid,signal.SIGKILL);p.wait()
            status, reason = p.returncode, 'wall-time-budget'
    result = {'exit':status,'stop_reason':reason,'wall_seconds':round(time.monotonic()-start,3),
              'grader':grade(workload,ws,episode/'transcript.jsonl')}
    for name in ['find_in_sorted.py','simple-linked-list.js']:
        if (ws/name).exists(): shutil.copyfile(ws/name,episode/name)
    state = ws/'.pilot-state'
    if state.exists(): shutil.copytree(state,episode/'state')
    write_json(episode/'result.json',result)
    print(json.dumps({'episode':str(episode),'result':result}),flush=True)
    return episode

def summarize(base):
    rows = []
    for episode in sorted(base.iterdir()):
        if not (episode/'result.json').exists(): continue
        m=json.loads((episode/'manifest.json').read_text()); r=json.loads((episode/'result.json').read_text())
        events=[]
        for line in (episode/'transcript.jsonl').read_text().splitlines():
            try: events.append(json.loads(line))
            except json.JSONDecodeError: pass
        final='';usage=None;actual=None;tool_calls=0;reads=[];reported_cost=None
        for e in events:
            if e.get('type')=='turn.completed': usage=e.get('usage')
            if e.get('type')=='item.completed':
                item=e.get('item',{})
                if item.get('type')=='agent_message': final=item.get('text','')
                if item.get('type')=='command_execution':
                    tool_calls+=1
                    reads.append({'command':item.get('command'),'output_bytes':len(item.get('aggregated_output','').encode())})
            if e.get('type')=='result':
                final=e.get('result','');usage=e.get('usage');reported_cost=e.get('total_cost_usd')
                actual=e.get('modelUsage')
            if e.get('type')=='assistant':
                actual=e.get('message',{}).get('model',actual)
                for item in e.get('message',{}).get('content',[]):
                    if item.get('type')=='tool_use':
                        tool_calls+=1
                        if item.get('name') in ['Read','Bash']:
                            reads.append({'tool':item.get('name'),'input':item.get('input')})
        router=(episode/'router.txt').read_text() if (episode/'router.txt').exists() else ''
        host_trace=(episode/'host-events.jsonl').read_text() if (episode/'host-events.jsonl').exists() else ''
        attributed='ROUTER WORKFLOW PLAN' in router or 'RETAINED EXECUTION CONTRACT' in router
        if m['workload']=='profile-lookup':
            decoder=json.JSONDecoder(); selection=None
            for pos,char in enumerate(final):
                if char!='{': continue
                try: obj,_=decoder.raw_decode(final[pos:])
                except json.JSONDecodeError: continue
                if isinstance(obj,dict) and 'requestedProfile' in obj: selection=obj;break
            expected={'requestedProfile':'reasoning','effectiveProfile':'reasoning','profileAlias':'sonnect',
                      'assignedRole':'reasoning-worker','runtimeModel':None,'runtimeEffort':None}
            import re
            clean=re.sub(r'<!--\s*harness-label\s+.*?-->','',final,flags=re.S).strip()
            if clean.startswith('```json\n') and clean.endswith('```'):
                clean=clean[len('```json\n'):-3].strip()
            try: format_pass=json.loads(clean)==expected
            except json.JSONDecodeError: format_pass=False
            r['grader']={'pass':selection==expected and format_pass,'selection_pass':selection==expected,
                         'format_pass':format_pass,'selection':selection,'expected':expected}
        thread=next((e.get('thread_id') for e in events if e.get('type')=='thread.started'),None)
        effective_effort=None
        if thread:
            session_root=Path.home()/'.codex/sessions'
            for session_file in session_root.glob('*/*/*/*'+thread+'*'):
                for line in session_file.read_text().splitlines():
                    event=json.loads(line)
                    if event.get('type')=='turn_context':
                        actual=event['payload'].get('model');effective_effort=event['payload'].get('effort')
        reference_reads=[x for x in reads if any(s in json.dumps(x) for s in ['.harness','SKILL.md','references/','CONTRACT-FORMAT'])]
        row={**m,**r,'actual_model_reported':actual,'usage':usage,'host_reported_cost_usd':reported_cost,
             'tool_calls':tool_calls,'reference_read_operations':reference_reads,'router_attributed':attributed,
             'hook_event_count':len(host_trace.splitlines()),'final':final,
             'effective_effort_reported':effective_effort,
             'classification':'definitive' if attributed and usage is not None else 'inconclusive'}
        write_json(episode/'analysis.json',row);rows.append(row)
    write_json(base/'summary.json',rows)
    print(json.dumps([{k:r[k] for k in ['model','workload','arm','repeat','classification','exit','wall_seconds','usage','router_attributed','grader']} for r in rows],indent=2))

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('mode',choices=['preflight','run','summarize'])
    parser.add_argument('--output',required=True);parser.add_argument('--engine',choices=['codex','claude'])
    args=parser.parse_args();base=Path(args.output).resolve();base.mkdir(parents=True,exist_ok=True)
    if args.mode=='summarize': summarize(base)
    else:
        suite_start=time.monotonic()
        for workload in (['profile-lookup'] if args.mode=='preflight' else PROTOCOL['workloads']):
            for model in PROTOCOL['models']:
                if args.engine and model['engine']!=args.engine:continue
                for repeat in ([0] if args.mode=='preflight' else [1,2]):
                    for arm in (['B'] if args.mode=='preflight' else (['A','B'] if repeat==1 else ['B','A'])):
                        if time.monotonic()-suite_start > PROTOCOL['aggregate_wall_budget_seconds']:
                            raise SystemExit('aggregate wall budget reached; remaining trials not attempted')
                        total_output=0
                        for file in base.glob('*/transcript.jsonl'):
                            for line in file.read_text().splitlines():
                                try: event=json.loads(line)
                                except json.JSONDecodeError:continue
                                if event.get('type') in ['result','turn.completed']:
                                    total_output+=event.get('usage',{}).get('output_tokens',0)
                        if total_output > PROTOCOL['aggregate_output_token_cap']:
                            raise SystemExit('aggregate output budget reached; remaining trials not attempted')
                        run_episode(base,model,workload,arm,repeat,args.mode=='preflight')
