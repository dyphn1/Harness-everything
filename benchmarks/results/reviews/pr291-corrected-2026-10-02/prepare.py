import hashlib,json,pathlib,shutil,subprocess
root=pathlib.Path(__file__).resolve().parent;previous=root.parent/'pr291-independent-2026-10-02';repo=root.parents[3]
m=json.loads((previous/'manifest.json').read_text());m['commits']['B']=subprocess.run(['git','rev-parse','HEAD'],cwd=repo,capture_output=True,text=True,check=True).stdout.strip()
m['date']='2026-10-02';m['previousPRHead']='c658e3a5c567e420c8bd86f894ac559aed67866f'
for t in m['trials']:
 t['dir']=str(root/t['id']);t['agentPath']='/root/r2_'+t['id'].replace('-','_').lower();pathlib.Path(t['dir']).mkdir(exist_ok=True)
 for name in ['task.txt','architecture.json']:
  content=(previous/t['id']/name).read_bytes();assert hashlib.sha256(content).hexdigest()==t['hashes'][name];(root/t['id']/name).write_bytes(content)
 content=b'# Fixture\n\n## Instalation\n\nRun npm install.\n';assert hashlib.sha256(content).hexdigest()==t['hashes']['README.md'];(root/t['id']/'README.md').write_bytes(content)
(root/'manifest.json').write_text(json.dumps(m,indent=2)+'\n')
shutil.copyfile(previous/'probe.cjs',root/'probe.cjs')
text=(previous/'audit.py').read_text(encoding='utf8').replace("agent='/root/'+t['id'].replace('-','_').lower()","agent=t['agentPath']")
(root/'audit.py').write_text(text,encoding='utf8');shutil.copyfile(previous/'usage.json',root/'previous-round-usage.json')
for name in ['parser-red.log','parser-green.log','parser-refactor.log']:
 shutil.copyfile(previous/name,root/name)
print('Prepared frozen identical tasks/fixtures, candidate '+m['commits']['B'])
