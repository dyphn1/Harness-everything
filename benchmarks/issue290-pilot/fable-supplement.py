#!/usr/bin/env python3
"""Preregistered Fable-only supplement; original bounded-stage rows stay retained."""
import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import time
import shutil

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('pilot',HERE/'run.py')
pilot=importlib.util.module_from_spec(spec)
spec.loader.exec_module(pilot)
original_prepare=pilot.prepare
WORKLOAD='polyglot-simple-linked-list-staged'
PROMPT="Use Fable staged execution. "+pilot.PROMPTS[WORKLOAD]

def linked_prepare(*args, **kwargs):
    episode,primary,hooks=original_prepare(*args,**kwargs)
    linked=Path(tempfile.mkdtemp(prefix='harness290-fable-'))
    subprocess.run(['git','worktree','add','-q','-b','pilot-linked',str(linked)],cwd=primary,check=True)
    shutil.copyfile(primary/'hook-settings.json',linked/'hook-settings.json')
    for name in ['hook-settings.json','.pilot.json','simple-linked-list.js','dev-check.cjs']:
        if not (linked/name).is_file():raise RuntimeError(f'linked launch prerequisite missing: {name}')
    return episode,linked,hooks

if __name__=='__main__':
    import argparse
    parser=argparse.ArgumentParser();parser.add_argument('--output',required=True)
    parser.add_argument('--engine',choices=['codex','claude'])
    args=parser.parse_args();base=Path(args.output).resolve();base.mkdir(parents=True,exist_ok=True)
    pilot.prepare=linked_prepare
    pilot.PROMPTS[WORKLOAD]=PROMPT
    start=time.monotonic()
    for model in pilot.PROTOCOL['models']:
        if args.engine and model['engine']!=args.engine:continue
        for repeat in [1,2]:
            for arm in (['A','B'] if repeat==1 else ['B','A']):
                existing_seconds=0;existing_output=0
                roots={Path('/tmp/issue290-formal-20261014').resolve(),Path('/tmp/issue290-fable-20261014').resolve(),base}
                for root in roots:
                    for file in root.glob('*/result.json'):
                        existing_seconds+=json.loads(file.read_text())['wall_seconds']
                    for file in root.glob('*/transcript.jsonl'):
                        for line in file.read_text().splitlines():
                            try:e=json.loads(line)
                            except json.JSONDecodeError:continue
                            if e.get('type') in ['result','turn.completed']:
                                existing_output+=e.get('usage',{}).get('output_tokens',0)
                if existing_seconds>pilot.PROTOCOL['aggregate_wall_budget_seconds'] or existing_output>pilot.PROTOCOL['aggregate_output_token_cap']:
                    raise SystemExit('shared original budget reached; remaining Fable rows unattempted')
                episode=pilot.run_episode(base,model,WORKLOAD,arm,repeat)
                pilot.require_router_attribution(episode)
    pilot.summarize(base)
