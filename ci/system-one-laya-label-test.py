"""Stdlib contract tests for the Laya dense intent labeler (#255 Phase 1+2).

No model dependency: backends are injected as stubs. Run with:
    python3 ci/system-one-laya-label-test.py
"""
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True  # never leave __pycache__ in the source tree that packaging copies
path = Path(__file__).resolve().parents[1] / 'scripts/system-one-label-laya.py'
spec = importlib.util.spec_from_file_location('laya_labeler', path)
laya_labeler = importlib.util.module_from_spec(spec)
spec.loader.exec_module(laya_labeler)

INTENTS = ['explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor',
           'review', 'test', 'docs', 'plan', 'investigate']


class MappingTests(unittest.TestCase):
    def test_intent_order_matches_owner_catalog(self):
        # catalogs.js INTENT_OPTIONS order is the scorer output order; it must not drift.
        self.assertEqual(laya_labeler.INTENTS, INTENTS)

    def test_every_intent_has_one_noul_question(self):
        questions = laya_labeler.build_questions()
        self.assertEqual(list(questions), INTENTS, 'question order follows the catalog order')
        for intent, q in questions.items():
            self.assertEqual(q['type'], 'noul')
            self.assertTrue(q['instructions'], intent)

    def test_question_order_change_keeps_semantic_mapping(self):
        a = laya_labeler.build_questions()
        b = laya_labeler.build_questions()
        self.assertEqual(a, b)
        self.assertEqual(list(a), INTENTS)

    def test_mapping_version_is_pinned(self):
        self.assertRegex(laya_labeler.QUESTIONS_VERSION, r'^v\d+$')


class ValidatorTests(unittest.TestCase):
    def scores(self, **over):
        base = {i: 0.0 for i in INTENTS}
        base.update(over)
        return base

    def test_valid_scores_pass(self):
        self.assertTrue(laya_labeler.validate_scores(self.scores(fix=0.9, test=0.4)))

    def test_missing_or_unknown_key_fails(self):
        bad = self.scores(fix=0.9)
        del bad['fix']
        with self.assertRaisesRegex(ValueError, 'keys'):
            laya_labeler.validate_scores(bad)
        bad2 = self.scores(fix=0.9)
        bad2['nope'] = 0.1
        with self.assertRaisesRegex(ValueError, 'keys'):
            laya_labeler.validate_scores(bad2)

    def test_out_of_range_or_nan_fails(self):
        for v in (-0.1, 1.1, float('nan')):
            with self.assertRaisesRegex(ValueError, 'range', msg=f'value={v}'):
                laya_labeler.validate_scores(self.scores(fix=v))

    def test_non_float_fails(self):
        with self.assertRaisesRegex(ValueError, 'range'):
            laya_labeler.validate_scores(self.scores(fix='0.9'))


class DeriveTests(unittest.TestCase):
    def scores(self, **over):
        base = {i: 0.0 for i in INTENTS}
        base.update(over)
        return base

    def test_primary_and_secondary_from_bands(self):
        out = laya_labeler.derive_label(self.scores(fix=0.9, test=0.5, docs=0.3))
        self.assertEqual(out['gold'], 'fix')
        self.assertEqual(out['secondary'], ['test'])

    def test_low_max_abstains(self):
        out = laya_labeler.derive_label(self.scores(explain=0.2))
        self.assertIsNone(out['gold'])
        self.assertEqual(out['secondary'], [])

    def test_tie_breaks_by_catalog_order(self):
        out = laya_labeler.derive_label(self.scores(fix=0.7, test=0.7))
        self.assertEqual(out['gold'], 'fix')

    def test_derived_labels_are_marked_bootstrap(self):
        out = laya_labeler.derive_label(self.scores(fix=0.9))
        self.assertTrue(out['derived'])


class GuardTests(unittest.TestCase):
    def test_refuses_to_overwrite_sonnet_scores_file(self):
        with self.assertRaisesRegex(ValueError, 'protected'):
            laya_labeler.output_row({'id': 'x', 'text': 'fix it'}, {}, backend='stub',
                                    out_name='labels-intent-scores.jsonl')

    def test_output_row_shape_matches_trainer_contract(self):
        scores = {i: (0.9 if i == 'fix' else 0.0) for i in INTENTS}
        row = laya_labeler.output_row({'id': 'abc', 'text': 'fix it'}, scores,
                                      backend='stub', out_name='labels-intent-laya-zs.jsonl',
                                      routing='english')
        self.assertEqual(row['id'], 'abc')
        self.assertEqual(row['gold'], 'fix')
        self.assertEqual(row['secondary'], [])
        self.assertEqual(list(row['scores']), INTENTS)
        self.assertEqual(row['labeler']['task'], 'intent')
        self.assertEqual(row['labeler']['routing'], 'english')
        self.assertEqual(json.loads(json.dumps(row)), row)


class EndToEndTests(unittest.TestCase):
    def test_stub_backend_labels_a_split(self):
        prompts = [{'id': 'p1', 'split': 'validation', 'text': 'fix the crash'},
                   {'id': 'p2', 'split': 'train', 'text': 'commit and push'}]
        calls = []

        def stub(text):
            calls.append(text)
            return ({i: (0.8 if i == 'fix' else 0.05) for i in INTENTS}, 'english', 1.0)

        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / 'data'
            data.mkdir()
            (data / 'prompts.jsonl').write_text(
                '\n'.join(json.dumps(p) for p in prompts) + '\n', encoding='utf-8')
            out = Path(d) / 'labels-intent-laya-zs.jsonl'
            manifest = Path(d) / 'manifest.json'
            summary = laya_labeler.label_split(
                data, 'validation', out, manifest, backend_fn=stub, backend_name='stub')
            self.assertEqual(calls, ['fix the crash'], 'only the requested split is labeled')
            rows = [json.loads(line) for line in out.read_text(encoding='utf-8').strip().split('\n')]
            self.assertEqual([r['id'] for r in rows], ['p1'])
            self.assertEqual(rows[0]['gold'], 'fix')
            self.assertEqual(summary['labeled'], 1)
            man = json.loads(manifest.read_text(encoding='utf-8'))
            self.assertEqual(man['backend'], 'stub')
            self.assertEqual(man['split'], 'validation')

    def test_resume_skips_done_ids(self):
        calls = []

        def stub(text):
            calls.append(text)
            return ({i: (0.8 if i == 'fix' else 0.05) for i in INTENTS}, 'english', 1.0)

        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / 'data'
            data.mkdir()
            prompts = [{'id': f'p{i}', 'split': 'validation', 'text': f'text {i}'} for i in range(3)]
            (data / 'prompts.jsonl').write_text(
                '\n'.join(json.dumps(p) for p in prompts) + '\n', encoding='utf-8')
            out = Path(d) / 'labels-intent-laya-zs.jsonl'
            manifest = Path(d) / 'manifest.json'
            laya_labeler.label_split(data, 'validation', out, manifest,
                                     backend_fn=stub, backend_name='stub')
            self.assertEqual(len(calls), 3)
            laya_labeler.label_rows(
                prompts, 'validation', 'sha', out, manifest, backend_fn=stub,
                backend_name='stub', resume=True)
            self.assertEqual(len(calls), 3, 'resume makes no new backend calls')
            self.assertEqual(
                [json.loads(line)['id'] for line in out.read_text(encoding='utf-8').splitlines()],
                ['p0', 'p1', 'p2'], 'resume appends nothing when all ids are done')
            man2 = json.loads(manifest.read_text(encoding='utf-8'))
            self.assertEqual([man2['labeled'], man2['thisRun'], man2['resumed']], [3, 0, True])
            self.assertEqual(man2['routing'], {'english': 3})


if __name__ == '__main__':
    unittest.main()
