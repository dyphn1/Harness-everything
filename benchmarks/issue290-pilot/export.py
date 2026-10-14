#!/usr/bin/env python3
"""Sanitize attributed evidence while retaining raw and exported SHA-256 hashes."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import socket

HERE=Path(__file__).resolve().parent
SOURCE=str(HERE.parent.parent)
HOME=str(Path.home())
HOST=socket.gethostname().split('.')[0]

def sanitize(text):
    text=text.replace(SOURCE,'<HARNESS_SOURCE>').replace(HOME,'<USER_HOME>')
    text=re.sub(r'(?:/private)?/var/folders/[^/]+/[^/]+/T/', '<TMP>/',text)
    text=text.replace('/private/tmp/','<TMP>/').replace('/tmp/','<TMP>/')
    text=re.sub(r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b','<REDACTED_EMAIL>',text)
    if HOST:text=text.replace(HOST,'<HOST>')
    # Local login name leaks through `ls -l` owner columns in captured tool output.
    text=re.sub(r'\bdaniel\.chang\b','<USER>',text)
    # Fail closed rather than publish a possible credential silently.
    if re.search(r'\bsk-[A-Za-z0-9_-]{16,}\b',text):
        raise ValueError('possible credential; review before publishing')
    return text

def strip_private_reasoning(value):
    if isinstance(value,list):return [strip_private_reasoning(v) for v in value]
    if isinstance(value,dict):
        if value.get('type') in ['thinking','redacted_thinking','reasoning']:
            return {'type':'private_reasoning_redacted'}
        return {k:strip_private_reasoning(v) for k,v in value.items() if k not in ['signature','thinking']}
    return value

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('roots',nargs='+');p.add_argument('--output',required=True)
    a=p.parse_args();out=Path(a.output);out.mkdir(parents=True,exist_ok=True);inventory=[]
    for root in map(Path,a.roots):
        for file in sorted(root.rglob('*')):
            if not file.is_file() or file.suffix not in ['.json','.jsonl','.txt','.py','.js','.cjs','.log']:
                continue
            relative=Path(root.name)/file.relative_to(root)
            target=out/relative;target.parent.mkdir(parents=True,exist_ok=True)
            raw=file.read_bytes();text=raw.decode('utf8')
            if file.suffix=='.jsonl':
                text='\n'.join(json.dumps(strip_private_reasoning(json.loads(line)),ensure_ascii=False)
                    for line in text.splitlines() if line.strip())+'\n'
            elif file.suffix=='.json':text=json.dumps(strip_private_reasoning(json.loads(text)),indent=2,ensure_ascii=False)+'\n'
            clean=sanitize(text).encode()
            target.write_bytes(clean)
            inventory.append({'path':str(relative),'raw_sha256':hashlib.sha256(raw).hexdigest(),
                              'exported_sha256':hashlib.sha256(clean).hexdigest(),'bytes':len(clean)})
    (out/'inventory.json').write_text(json.dumps(inventory,indent=2)+'\n')
    print('exported',len(inventory),'files;',sum(x['bytes'] for x in inventory),'bytes')
