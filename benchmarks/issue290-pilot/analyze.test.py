"""Protect the central evidence distinction: inventory is not an observed read."""
import importlib.util
from pathlib import Path
import unittest
import json
import tempfile
import tarfile

spec=importlib.util.spec_from_file_location('audit',Path(__file__).with_name('analyze.py'))
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)

class AttributionTest(unittest.TestCase):
    def test_tdd_gate_requires_an_invocation(self):
        negatives = [
            'node workflow-disposition.js stage-binding --evidence "npm tdd:quality gate N/A (no package.json in workspace)"',
            'echo "npm run tdd:quality"',
            'printf "%s" "node ./tdd/scripts/quality-gate.js"',
            '# npm run tdd:quality',
            'cat tdd/scripts/quality-gate.js',
            'node other.js --evidence "npm run tdd:quality"',
            'npm run other -- tdd:quality',
            'node -e "console.log(\'quality-gate.js\')"',
            'bash -lc \'echo "npm run tdd:quality"\'',
            'npm run tdd:quality-extra',
            'npm run tdd:quality --help',
            'npm run tdd:quality --dry-run',
            'node ./quality-gate.js.backup',
            '', 'npm run "unterminated',
        ]
        positives = [
            'npm run tdd:quality -- evidence.json',
            '  npm\t run  tdd:quality  ',
            'node ./tdd/scripts/quality-gate.js evidence.json',
            'node "/path with spaces/quality-gate.js" evidence.json',
            'HARNESS_STATE_HOME=/tmp/state npm run tdd:quality',
            'env HARNESS_STATE_HOME=/tmp/state npm run tdd:quality',
            'command npm run tdd:quality',
            'bash -lc \'npm run tdd:quality -- evidence.json\'',
            '/usr/bin/node --no-warnings ./tdd/scripts/quality-gate.js evidence.json',
            'npm --prefix ./project run tdd:quality',
        ]
        for command in negatives:
            with self.subTest(command=command):
                self.assertFalse(audit.is_tdd_quality_command(command))
        for command in positives:
            with self.subTest(command=command):
                self.assertTrue(audit.is_tdd_quality_command(command))
        for command in [None, 17, [], b'npm run tdd:quality']:
            self.assertIs(audit.is_tdd_quality_command(command), False)
        self.assertIs(audit.is_tdd_quality_command('npm run tdd:quality', depth=5), False)

    def test_binding_evidence_is_not_gate_execution(self):
        with tempfile.TemporaryDirectory() as directory:
            episode=Path(directory)
            (episode/'analysis.json').write_text(json.dumps({'model':{'engine':'codex'},
                'workload':'profile-lookup','grader':{'pass':False},'usage':None}))
            (episode/'manifest.json').write_text('{}')
            transcript=episode/'transcript.jsonl'
            def inspect(command):
                transcript.write_text(json.dumps({'type':'item.completed','item':{
                    'type':'command_execution','command':command,
                    'aggregated_output':'','exit_code':0}})+'\n')
                return audit.inspect_episode(episode)['tdd_quality_gate_executed']
            self.assertFalse(inspect('node workflow-disposition.js stage-binding --evidence "npm tdd:quality gate N/A (no package.json in workspace)"'))
            self.assertTrue(inspect('npm run tdd:quality -- evidence.json'))

    def test_retained_ledger_tdd_flags(self):
        """Recompute only this flag from all 40 immutable exported transcripts."""
        root=Path(__file__).parent
        rows=json.loads((root/'evidence/ledger.json').read_text())
        actual={}
        with tarfile.open(root/'evidence.tar.gz') as archive:
            for member in archive.getmembers():
                if not member.name.endswith('/transcript.jsonl'):
                    continue
                parent=member.name.rsplit('/',1)[0]
                row=json.load(archive.extractfile(parent+'/analysis.json'))
                events=[json.loads(line) for line in archive.extractfile(member) if line.strip()]
                tool_commands={tool['id']:tool.get('input',{}).get('command','')
                    for event in events for tool in event.get('message',{}).get('content',[])
                    if tool.get('type')=='tool_use' and tool.get('id')}
                commands=[]
                for event in events:
                    item=event.get('item',{})
                    if event.get('type')=='item.completed' and item.get('type')=='command_execution':
                        commands.append(item.get('command',''))
                    result=event.get('tool_use_result')
                    if isinstance(result,dict) and 'stdout' in result:
                        commands.extend(tool_commands.get(tool.get('tool_use_id'),'')
                            for tool in event.get('message',{}).get('content',[])
                            if tool.get('type')=='tool_result')
                key=(parent.split('/')[1],row['model']['engine'],row['workload'],row['arm'],row['repeat'])
                self.assertNotIn(key,actual)
                actual[key]=any(audit.is_tdd_quality_command(command) for command in commands)
        self.assertEqual(len(actual),40)
        self.assertEqual(len(rows),40)
        for row in rows:
            key=(row['series'],row['model']['engine'],row['workload'],row['arm'],row['repeat'])
            self.assertEqual(row['tdd_quality_gate_executed'],actual[key],key)

    def test_inventory_not_content(self):
        for command in ['rg --files .harness','find .harness -name SKILL.md','ls .harness','wc -c .harness/fable-mode/SKILL.md']:
            self.assertFalse(audit.is_content_command(command),command)

    def test_completed_content_commands(self):
        for command in ['cat .harness/fable-mode/SKILL.md',"sed -n '1,20p' .harness/tdd/SKILL.md",'rg core .harness/tdd/SKILL.md']:
            self.assertTrue(audit.is_content_command(command),command)

    def test_scalar_controller_output_is_not_a_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            episode=Path(directory)
            (episode/'analysis.json').write_text(json.dumps({'model':{'engine':'codex'},
                'workload':'profile-lookup','grader':{'pass':False},'usage':None}))
            (episode/'manifest.json').write_text('{}')
            (episode/'transcript.jsonl').write_text(json.dumps({'type':'item.completed','item':{
                'type':'command_execution','command':'node workflow-disposition.js --help',
                'aggregated_output':'2\nUsage: command syntax','exit_code':2}})+'\n')
            row=audit.inspect_episode(episode)
            self.assertEqual(len(row['observed_errors']),1)
            self.assertEqual(row['steps'],[])

    def test_batched_dictionary_preserves_active_step(self):
        with tempfile.TemporaryDirectory() as directory:
            episode=Path(directory)
            (episode/'analysis.json').write_text(json.dumps({'model':{'engine':'codex'},
                'workload':'profile-lookup','grader':{'pass':False},'usage':None}))
            (episode/'manifest.json').write_text('{}')
            events=[{'type':'item.completed','item':{'type':'command_execution',
                'command':'node workflow-disposition.js start',
                'aggregated_output':'{"activeStep":{"id":"verify"}}\n{"other":true}',
                'exit_code':0}}, {'type':'item.completed','item':{'type':'command_execution',
                'command':'cat .harness/verification-loop/SKILL.md',
                'aggregated_output':'observed reference content','exit_code':0}}]
            (episode/'transcript.jsonl').write_text('\n'.join(map(json.dumps,events))+'\n')
            row=audit.inspect_episode(episode)
            self.assertEqual(row['observed_reference_reads'][0]['active_step'],'verify')

if __name__=='__main__':unittest.main()
