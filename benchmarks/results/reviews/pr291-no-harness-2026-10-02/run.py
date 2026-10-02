import concurrent.futures,datetime,hashlib,json,os,pathlib,shutil,subprocess,time
root=pathlib.Path(__file__).resolve().parent
previous=root.parent/'pr291-corrected-2026-10-02'
manifest=json.loads((previous/'manifest.json').read_text())
workspace=pathlib.Path('D:/tmp/pr291-no-harness-20261002')
assert not workspace.exists(),'Do not overwrite an earlier control run'
workspace.mkdir(parents=True)
cli=pathlib.Path(os.environ['APPDATA'])/'npm/node_modules/@openai/codex/bin/codex.js'
assert cli.is_file()
trials=[]
for size in ['small','medium','large']:
 trial=workspace/(size+'-C');trial.mkdir()
 artifact=root/(size+'-C');artifact.mkdir()
 authhome=workspace/(size+'-codex-home');authhome.mkdir()
 # Reuse the already-authorized native login; never export credential contents.
 shutil.copyfile(pathlib.Path.home()/'.codex/auth.json',authhome/'auth.json')
 for name in ['task.txt','architecture.json']:
  data=(previous/(size+'-B')/name).read_bytes();(trial/name).write_bytes(data);(artifact/name).write_bytes(data)
 data=b'# Fixture\n\n## Instalation\n\nRun npm install.\n';(trial/'README.md').write_bytes(data);(artifact/'README.initial.md').write_bytes(data)
 hashes={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in trial.iterdir()}
 expected=next(t['hashes'] for t in manifest['trials'] if t['id']==size+'-B');assert hashes==expected
 prompt='Complete the request in task.txt using the supplied README.md and architecture.json as needed. Work only inside this fixture directory. This is a bounded probe: do not implement the migration, run a full staged workflow, delegate, install anything, or access outside files/network. Only the medium case may edit README.md, solely for its requested spelling correction; other fixture files must remain unchanged. Do not invent unavailable custom workflow definitions or runtime metadata. Return a JSON object with routeTier, strategy, profile, answer, mutationPerformed, and plan (empty unless a plan is requested). No source files exist beyond the supplied architecture inventory; plan from that inventory only.'
 (artifact/'agent-prompt.txt').write_text(prompt,encoding='utf8')
 args=['node',str(cli),'exec','--ignore-user-config','--ignore-rules','--skip-git-repo-check','--json','--color','never','-C',str(trial),'-m','gpt-6-luna','-c','model_reasoning_effort="xhigh"','-c','approval_policy="never"','-s','danger-full-access','--disable','hooks','--disable','plugins','--disable','apps','--disable','multi_agent','--disable','memories','--enable','skip_host_skill_discovery','-c','web_search="disabled"','-o',str(trial/'answer.json'),'-']
 trials.append({'id':size+'-C','size':size,'arm':'C','dir':str(trial),'authHome':str(authhome),'initialHashes':hashes,'args':args,'prompt':prompt})
def run(t):
 env=os.environ.copy();env['CODEX_HOME']=t['authHome'];env.pop('CODEX_THREAD_ID',None);env.pop('CODEX_INTERNAL_ORIGINATOR_OVERRIDE',None)
 start=datetime.datetime.now(datetime.timezone.utc).isoformat();clock=time.perf_counter();artifact=root/t['id']
 with (artifact/'events.jsonl').open('wb') as out,(artifact/'stderr.log').open('wb') as err:
  p=subprocess.run(t['args'],input=t['prompt'].encode(),stdout=out,stderr=err,cwd=t['dir'],env=env)
 end=datetime.datetime.now(datetime.timezone.utc).isoformat()
 for name in ['answer.json','README.md']:
  if (pathlib.Path(t['dir'])/name).exists():shutil.copyfile(pathlib.Path(t['dir'])/name,artifact/name)
 result={k:v for k,v in t.items() if k not in ['prompt']};result.update({'processStartUTC':start,'processEndUTC':end,'processWallSeconds':round(time.perf_counter()-clock,3),'exitCode':p.returncode})
 (artifact/'run.json').write_text(json.dumps(result,indent=2)+'\n',encoding='utf8')
 print(t['id']+' exit '+str(p.returncode),flush=True)
 return result
with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:results=list(pool.map(run,trials))
(root/'manifest.json').write_text(json.dumps({'model':'gpt-6-luna','effort':'xhigh','cliVersion':'0.159.3','sourceManifest':str(previous/'manifest.json'),'trials':results},indent=2)+'\n',encoding='utf8')
assert all(t['exitCode']==0 for t in results), 'Retain failed runs; do not silently replace model'
