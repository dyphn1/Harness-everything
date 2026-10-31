import importlib.util
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import analyze
from read_metrics import collect_reads, observed_read
from reporting import paired_rows, summarize_groups


class ReadMetricTest(unittest.TestCase):
    def setUp(self):
        self.path = 'find-skills/SKILL.md'
        self.content = '# A sufficiently distinctive reference title\nA second sufficiently distinctive line of reference text.\n'
        self.documents = {self.path: self.content}

    def test_compound_both_orders_separate_mixed_output(self):
        for command in ('cat .harness/find-skills/SKILL.md && ls', 'ls && cat .harness/find-skills/SKILL.md'):
            with self.subTest(command=command):
                row = observed_read(command, self.content+'inventory\n', self.documents)
                self.assertEqual(row['returned_bytes'], len(self.content.encode()))
                self.assertEqual(row['uncertain_or_mixed_output_bytes'], len('inventory\n'))
                self.assertEqual(row['filesystem_access_candidates'], 1)

    def test_transformed_output_is_not_content(self):
        row = observed_read('cat .harness/find-skills/SKILL.md | wc -l', '2\n', self.documents)
        self.assertEqual(row['returned_bytes'], 0)
        self.assertEqual(row['uncertain_or_mixed_output_bytes'], 2)

    def test_partial_content_counts_only_matched_lines(self):
        partial = self.content.splitlines(keepends=True)[0]
        row = observed_read("sed -n '1p' .harness/find-skills/SKILL.md", partial, self.documents)
        self.assertEqual(row['returned_bytes'], len(partial.encode()))
        self.assertEqual(row['matched_content'][0]['kind'], 'partial-content')

    def test_powershell_paths_and_alias(self):
        for command in (r'Get-Content .harness\find-skills\SKILL.md', r'gc -Raw .harness\find-skills\SKILL.md'):
            self.assertEqual(observed_read(command, self.content, self.documents)['returned_bytes'], len(self.content.encode()))

    def test_frozen_source_placeholder_and_wrapped_shell(self):
        for command in ('cat <HARNESS_SOURCE>/find-skills/SKILL.md', '/bin/bash -lc "cat .harness/find-skills/SKILL.md && ls"'):
            self.assertEqual(observed_read(command, self.content, self.documents)['returned_bytes'], len(self.content.encode()))

    def test_bundle_excludes_arbitrary_repository_files_and_mentions(self):
        for command in ('cat <HARNESS_SOURCE>/grader.cjs', 'cat .harness/unknown/SKILL.md', 'echo .harness/find-skills/SKILL.md', 'rg --files .harness/find-skills/SKILL.md'):
            self.assertIsNone(observed_read(command, self.content, self.documents))

    def test_native_read_cannot_identify_unknown_content_as_bytes(self):
        row = observed_read('', 'unmatched output', self.documents, native_path='.harness/'+self.path)
        self.assertEqual(row['returned_bytes'], 0)
        self.assertEqual(row['uncertain_or_mixed_output_bytes'], 16)


class AccountingTest(unittest.TestCase):
    def episode(self, root, engine='claude', workload='profile-lookup', events=None):
        row = {'model': {'engine': engine, 'model': 'fixture'}, 'workload': workload,
               'grader': {'pass': False}, 'usage': None, 'router_attributed': True}
        (root/'analysis.json').write_text(json.dumps(row))
        (root/'manifest.json').write_text('{}')
        (root/'transcript.jsonl').write_text('\n'.join(json.dumps(e) for e in (events or [])))

    def test_offline_never_reads_host_home_or_invents_cost(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.episode(root)
            with patch.object(Path, 'home', side_effect=AssertionError('host home accessed')):
                row = analyze.inspect_episode(root, offline=True, documents={})
            self.assertIsNone(row['api_equivalent_cost_usd'])
            self.assertIn('unknown', row['child_usage_observability'])

    def test_missing_claude_child_logs_make_whole_cost_unknown(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.episode(root, events=[{'type':'assistant','message':{'content':[{'type':'tool_use','name':'Task','id':'worker'}]}},
                                      {'tool_use_result':{'agentId':'missing'}}])
            with patch.object(Path, 'home', return_value=root):
                row = analyze.inspect_episode(root, documents={})
            self.assertIsNone(row['api_equivalent_cost_usd'])
            self.assertIn('unknown', row['child_usage_observability'])

    def test_polyglot_grader_timeout_is_retained_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.episode(root, workload='polyglot-simple-linked-list-staged')
            with patch('analyze.subprocess.run', side_effect=subprocess.TimeoutExpired('node', 20)):
                row = analyze.inspect_episode(root, offline=True, documents={})
            self.assertEqual(row['independent_grader'], {'pass':False, 'timeout':True})

    def test_filesystem_enumeration_order_does_not_change_binding_attribution(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            content = 'A sufficiently distinctive reference content line.\n'
            self.episode(root, events=[{'type':'item.completed', 'item':{
                'type':'command_execution', 'command':'cat .harness/find-skills/SKILL.md',
                'aggregated_output':content, 'exit_code':0}}])
            state = root/'state'
            state.mkdir()
            for name in ('z', 'a'):
                (state/(name+'.json')).write_text(json.dumps({'schemaVersion':2, 'stageId':name,
                    'runId':'fixture', 'requiredBindings':[{'id':'read', 'path':'find-skills/SKILL.md'}]}))
            documents = {'find-skills/SKILL.md':content}
            first = analyze.inspect_episode(root, offline=True, documents=documents)
            original = Path.rglob
            def reverse_listing(path, pattern):
                return iter(reversed(list(original(path, pattern))))
            with patch.object(Path, 'rglob', reverse_listing):
                second = analyze.inspect_episode(root, offline=True, documents=documents)
            self.assertEqual(first['observed_reference_reads'], second['observed_reference_reads'])

    def test_null_costs_and_metric_specific_denominators(self):
        base = {'series':'test', 'model':{'engine':'codex'}, 'workload':'test', 'arm':'A', 'repeat':1,
                'preflight':False, 'classification':'definitive', 'independent_grader':{'pass':True},
                'budget_failure':False, 'reference_returned_bytes':3, 'exact_reference_bytes_lower_bound':3,
                'wall_seconds':1, 'api_equivalent_cost_usd':1, 'api_equivalent_input_cost_usd':1}
        failure = {**base, 'arm':'B', 'classification':'definitive-agent-budget-failure', 'budget_failure':True,
                   'api_equivalent_cost_usd':None, 'api_equivalent_input_cost_usd':None}
        infrastructure = {**base, 'classification':'inconclusive', 'repeat':2}
        groups = summarize_groups([base, failure, infrastructure])
        self.assertEqual(groups[0]['n_quality_included'], 1)
        self.assertEqual(groups[0]['n_quality_excluded'], 1)
        self.assertEqual(groups[1]['artifact_passes'], 0)
        self.assertEqual(groups[1]['budget_failures'], 1)
        self.assertIsNone(groups[1]['api_equivalent_cost_usd'])
        self.assertFalse(paired_rows([base, failure])[0]['api_equivalent_cost_usd']['included'])


if __name__ == '__main__':
    unittest.main()
