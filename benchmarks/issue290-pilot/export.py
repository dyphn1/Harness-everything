#!/usr/bin/env python3
"""Sanitize attributed evidence while retaining raw and exported SHA-256 hashes."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import socket
import tarfile

HERE=Path(__file__).resolve().parent
SOURCE=str(HERE.parent.parent)
HOME=str(Path.home())
HOST=socket.gethostname().split('.')[0]

SECRET_PATTERNS = {
    'provider-token': r'\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|xox[baprs]-[A-Za-z0-9-]{20,}|AKIA[A-Z0-9]{16})\b',
    'private-key': r'-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----',
    'authorization': r'(?i)\b(?:bearer|basic)\s+[A-Za-z0-9+/_.=-]{16,}',
    'assigned-secret': r'''(?i)["']?\b(?:api[_-]?key|access[_-]?token|client[_-]?secret|password|aws_secret_access_key)["']?\s*[:=]\s*["']?[A-Za-z0-9+/_.=-]{16,}''',
}

def validate_no_secrets(text):
    # JSON escaping cannot hide a credential in a nested transcript/log field.
    candidates = [text]
    try:
        value = json.loads(text)
    except (ValueError, TypeError):
        value = None
    def strings(value):
        if isinstance(value, str):
            candidates.append(value)
        elif isinstance(value, dict):
            for key, item in value.items():
                candidates.append(str(key))
                strings(item)
        elif isinstance(value, list):
            for item in value:
                strings(item)
    strings(value)
    for candidate in candidates:
        for category, pattern in SECRET_PATTERNS.items():
            if re.search(pattern, candidate):
                raise ValueError('possible credential class: ' + category)

def scan_final(paths):
    count = 0
    for path in map(Path, paths):
        if path.name.endswith(('.tar.gz', '.tgz')):
            with tarfile.open(path) as archive:
                for member in archive.getmembers():
                    validate_no_secrets(member.name)
                    if member.isfile():
                        validate_no_secrets(archive.extractfile(member).read().decode('utf8'))
                        count += 1
        else:
            for file in sorted(path.rglob('*')) if path.is_dir() else [path]:
                if file.is_file() and '__pycache__' not in file.parts:
                    validate_no_secrets(str(file))
                    validate_no_secrets(file.read_text())
                    count += 1
    return count

def sanitize(text):
    validate_no_secrets(text)
    text=text.replace(SOURCE,'<HARNESS_SOURCE>').replace(HOME,'<USER_HOME>')
    text=re.sub(r'(?:/private)?/var/folders/[^/]+/[^/]+/T/', '<TMP>/',text)
    text=text.replace('/private/tmp/','<TMP>/').replace('/tmp/','<TMP>/')
    text=re.sub(r'\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b','<REDACTED_EMAIL>',text)
    if HOST:text=text.replace(HOST,'<HOST>')
    # Local login name leaks through `ls -l` owner columns in captured tool output.
    text=re.sub(r'\bdaniel\.chang\b','<USER>',text)
    # Fail closed rather than publish a possible credential silently.
    validate_no_secrets(text)
    return text

def strip_private_reasoning(value):
    if isinstance(value,list):return [strip_private_reasoning(v) for v in value]
    if isinstance(value,dict):
        if value.get('type') in ['thinking','redacted_thinking','reasoning']:
            return {'type':'private_reasoning_redacted'}
        return {k:strip_private_reasoning(v) for k,v in value.items() if k not in ['signature','thinking']}
    return value

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('roots',nargs='+');p.add_argument('--output');p.add_argument('--scan-only',action='store_true')
    a=p.parse_args()
    if a.scan_only:
        print('credential scan PASS:', scan_final(a.roots), 'UTF-8 files; configured classes only')
        raise SystemExit(0)
    if not a.output:p.error('--output is required for export')
    out=Path(a.output);out.mkdir(parents=True,exist_ok=True);inventory=[]
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
    scan_final([out])
    print('exported',len(inventory),'files;',sum(x['bytes'] for x in inventory),'bytes')
