import hashlib,json,pathlib
root=pathlib.Path(__file__).resolve().parent
paths=sorted(p for p in root.rglob('*') if p.is_file() and p.name!='sha256.json')
sealed={p.relative_to(root).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}
(root/'sha256.json').write_text(json.dumps(sealed,indent=2)+'\n',encoding='utf8')
assert all(hashlib.sha256((root/p).read_bytes()).hexdigest()==h for p,h in sealed.items())
print(str(len(sealed))+' artifact SHA-256 digests verified.')
