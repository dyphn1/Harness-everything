"""Protect the central evidence distinction: inventory is not an observed read."""
import importlib.util
from pathlib import Path
import unittest
import json
import tempfile

spec=importlib.util.spec_from_file_location('audit',Path(__file__).with_name('analyze.py'))
audit=importlib.util.module_from_spec(spec);spec.loader.exec_module(audit)

class AttributionTest(unittest.TestCase):
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
