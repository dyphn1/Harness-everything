import json,pathlib,sqlite3,re,subprocess
root=pathlib.Path(__file__).resolve().parent;u=json.loads((root/'usage.json').read_text());repo=root.parents[3]
conn=sqlite3.connect('file:'+str(pathlib.Path.home()/'.codex/state_5.sqlite')+'?mode=ro',uri=True)
diagnostics=[]
for t in u['trials']:
 p=conn.execute('select rollout_path from threads where id=?',(t['threadId'],)).fetchone()[0]
 es=[json.loads(l) for l in pathlib.Path(p).read_text(encoding='utf8').splitlines()]
 outputs=[str(e['payload'].get('output','')) for e in es if e['type']=='response_item' and e['payload'].get('type') in ['function_call_output','custom_tool_call_output']]
 bad=[o for o in outputs if re.search(r'exit_code["\\\s]*:\s*[1-9]',o) or any(x in o for x in ['SyntaxError:','Traceback (most recent call last):'])]
 diagnostics.append({'id':t['id'],'toolOutputs':len(outputs),'nonzeroOrSyntaxDiagnostics':[o[:700] for o in bad]})
(root/'tool-diagnostics.json').write_text(json.dumps(diagnostics,indent=2)+'\n')
print(json.dumps(diagnostics,indent=2))
scores=[]
prior=(repo/'evals/evaluation-reports.md').read_text(encoding='utf8')
for t,d in zip(u['trials'],diagnostics):
 env=5 if d['nonzeroOrSyntaxDiagnostics'] else 10
 failed=[k for k,v in t['checks'].items() if k not in ['largeStageCount','expectedRouterTopology'] and v is not True]
 correctness=5 if failed else 10
 insight=f"{t['id']}: canonical profile check passed; bounded probe only. Artifact checks needing review: {failed}. Efficiency 5/10 for avoidable reference reads, root-README reads or extended plan generation. No repeated three-signature failure loop was observed. Environment {env}/10: {'nonzero/syntax tool diagnostics occurred; retained for inspection' if env==5 else 'no syntax/nonzero diagnostics observed'}. Router contract expectation {'passed' if t['checks']['expectedRouterTopology'] else 'failed; reported separately as product routing evidence'}. Token cost is in usage.json; this subjective agent-artifact rubric is not proof of full workflow enforcement or effectiveness."
 r=subprocess.run(['node',str(repo/'eval-harness/scripts/evaluate.js'),str(correctness),'5','10',str(env),insight],cwd=repo,capture_output=True,text=True,encoding='utf8')
 if r.returncode!=0:raise RuntimeError(r.stderr)
 scores.append({'id':t['id'],'correctness':correctness,'efficiency':5,'focus':10,'environment':env,'total':correctness+15+env,'rationale':insight})
(root/'scorecards.json').write_text(json.dumps(scores,indent=2)+'\n')
(root/'scorecards.md').write_text((repo/'evals/evaluation-reports.md').read_text(encoding='utf8')[len(prior):],encoding='utf8')
print('Six eval-harness scorecards generated.')
