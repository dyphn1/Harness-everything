import json,pathlib,shutil,subprocess,time
root=pathlib.Path(__file__).resolve().parent;repo=root.parents[3];prior=root.parent/'pr291-independent-2026-10-02'/'verification-corrected'
baseline=json.loads((prior/'summary.json').read_text());assert len(baseline)==14 and all(r['exitCode']==0 for r in baseline)
shutil.copytree(prior,root/'verification-before-polite-fix',dirs_exist_ok=True)
out=root/'verification-final';out.mkdir(exist_ok=True);summary=[]
for gate in ['test','test:mutations','test:mechanism']:
 start=time.monotonic()
 with (out/(gate.replace(':','-')+'.log')).open('w',encoding='utf8') as f:r=subprocess.run(['npm.cmd','run',gate],cwd=repo,stdout=f,stderr=subprocess.STDOUT)
 summary.append({'gate':gate,'exitCode':r.returncode,'seconds':round(time.monotonic()-start,3)})
 (out/'summary.json').write_text(json.dumps(summary,indent=2)+'\n');print(gate,r.returncode,flush=True)
 merged={r['gate']:r for r in baseline};merged.update({r['gate']:r for r in summary})
 (root/'verification-effective.json').write_text(json.dumps({'snapshot':subprocess.run(['git','rev-parse','HEAD'],cwd=repo,capture_output=True,text=True).stdout.strip(),'gates':list(merged.values()),'finalAffectedGatesRun':[r['gate'] for r in summary],'remaining':[g for g in ['test','test:mutations','test:mechanism'] if g not in [r['gate'] for r in summary]]},indent=2)+'\n')
