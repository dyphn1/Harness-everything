"""Stdlib contract tests for the Laya soft-target exporter (#255 Phase 3).

The exporter converts teacher relevance scores to upstream RLCD training
items without loading any model: sequence building is injected. Run with:
    python3 ci/system-one-laya-export-test.py
"""
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True  # never leave __pycache__ in the source tree that packaging copies
path = Path(__file__).resolve().parents[1] / 'scripts/system-one-export-laya.py'
spec = importlib.util.spec_from_file_location('laya_exporter', path)
laya_exporter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(laya_exporter)

INTENTS = ['explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor',
           'review', 'test', 'docs', 'plan', 'investigate']


def fake_builder(state, instructions, probs):
    """Deterministic stub: token ids derive from the text, markers fixed."""
    ids = [len(state) % 251 + 1, len(instructions) % 251 + 1, 7]
    return {'ids': ids, 'markers': [0, 1], 'target': [probs['false'], probs['true']]}


class ItemTests(unittest.TestCase):
    def test_noul_target_is_false_true_pair(self):
        item = laya_exporter.build_item('fix it', 'repair?', {'true': 0.8, 'false': 0.2}, fake_builder)
        self.assertEqual(item['qtype'], 2, 'noul qtype follows laya.common.QTYPES')
        self.assertEqual(item['target'], [0.2, 0.8])
        self.assertEqual(item['label'], 1)

    def test_relevance_p_maps_to_true_p(self):
        item = laya_exporter.build_item('x', 'y', {'true': 0.0, 'false': 1.0}, fake_builder)
        self.assertEqual((item['target'], item['label']), ([1.0, 0.0], 0))

    def test_target_distribution_is_conserved(self):
        for p in (0.0, 0.25, 0.6, 1.0):
            item = laya_exporter.build_item('x', 'y', {'true': p, 'false': 1 - p}, fake_builder)
            self.assertAlmostEqual(sum(item['target']), 1.0, msg=f'p={p}')

    def test_bad_probabilities_fail(self):
        with self.assertRaisesRegex(ValueError, 'probabilities'):
            laya_exporter.build_item('x', 'y', {'true': 0.8, 'false': 0.8}, fake_builder)


class ExportTests(unittest.TestCase):
    def write_data(self, data, prompts, teacher):
        (data / 'prompts.jsonl').write_text(
            '\n'.join(json.dumps(p) for p in prompts) + '\n', encoding='utf-8')
        (data / 'labels-intent-scores.jsonl').write_text(
            '\n'.join(json.dumps(t) for t in teacher) + '\n', encoding='utf-8')

    def teacher_row(self, id, scores):
        return {'id': id, 'gold': 'fix', 'secondary': [], 'scores': scores}

    def test_exports_train_only_in_id_order(self):
        prompts = [{'id': 'b', 'split': 'train', 'text': 'commit'},
                   {'id': 'a', 'split': 'train', 'text': 'fix it'},
                   {'id': 'c', 'split': 'validation', 'text': 'skip me'}]
        scores = {i: (0.9 if i == 'fix' else 0.0) for i in INTENTS}
        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / 'data'
            data.mkdir()
            self.write_data(data, prompts, [self.teacher_row('a', scores), self.teacher_row('b', scores)])
            out = Path(d) / 'train_items.json'
            manifest = Path(d) / 'manifest.json'
            summary = laya_exporter.export(data, 'train', out, manifest, fake_builder, seed=0)
            self.assertEqual(summary['items'], 24, '2 prompts x 12 intents')
            rows = [json.loads(line) for line in out.read_text(encoding='utf-8').strip().split('\n')]
            self.assertEqual([r['promptId'] for r in rows[::12]], ['a', 'b'], 'deterministic id order')
            self.assertTrue(all(set(r) >= {'promptId', 'intent', 'ids', 'markers', 'qtype', 'target', 'label'} for r in rows))
            self.assertEqual(summary['manifest']['seed'], 0)

    def test_seed_controls_order(self):
        prompts = [{'id': c, 'split': 'train', 'text': c * 20} for c in 'abcd']
        scores = {i: 0.1 for i in INTENTS}
        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / 'data'
            data.mkdir()
            self.write_data(data, prompts, [self.teacher_row(p['id'], scores) for p in prompts])
            outs = []
            for seed in (11, 11, 12):
                out = Path(d) / f'o{seed}.json'
                laya_exporter.export(data, 'train', out, Path(d) / f'm{seed}.json', fake_builder, seed=seed)
                outs.append([json.loads(line)['promptId'] for line in out.read_text(encoding='utf-8').strip().split('\n')][::12])
        self.assertEqual(outs[0], outs[1], 'same seed replays the order')
        self.assertNotEqual(outs[0], outs[2], 'a different seed shuffles')

    def test_overlap_with_forbidden_ids_fails(self):
        prompts = [{'id': 'a', 'split': 'train', 'text': 'fix it'}]
        scores = {i: 0.1 for i in INTENTS}
        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / 'data'
            data.mkdir()
            self.write_data(data, prompts, [self.teacher_row('a', scores)])
            forbid = Path(d) / 'forbid.json'
            forbid.write_text(json.dumps(['a']), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'overlap'):
                laya_exporter.export(data, 'train', Path(d) / 'o.json', Path(d) / 'm.json',
                                     fake_builder, seed=7, forbid_path=forbid)

    def test_missing_teacher_row_is_skipped_and_counted(self):
        prompts = [{'id': 'a', 'split': 'train', 'text': 'fix it'},
                   {'id': 'b', 'split': 'train', 'text': 'no teacher'}]
        scores = {i: 0.1 for i in INTENTS}
        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / 'data'
            data.mkdir()
            self.write_data(data, prompts, [self.teacher_row('a', scores)])
            out = Path(d) / 'o.json'
            summary = laya_exporter.export(data, 'train', out, Path(d) / 'm.json', fake_builder, seed=7)
        self.assertEqual((summary['items'], summary['skippedNoTeacher']), (12, 1))

    def test_oversample_repeats_only_selected_positive_intent(self):
        prompts = [{'id': 'a', 'split': 'train', 'text': 'restructure'},
                   {'id': 'b', 'split': 'train', 'text': 'fix it'}]
        scores_a = {i: (0.9 if i == 'refactor' else 0.0) for i in INTENTS}
        scores_b = {i: (0.9 if i == 'fix' else 0.0) for i in INTENTS}
        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / 'data'
            data.mkdir()
            self.write_data(data, prompts, [self.teacher_row('a', scores_a), self.teacher_row('b', scores_b)])
            out = Path(d) / 'o.json'
            summary = laya_exporter.export(data, 'train', out, Path(d) / 'm.json', fake_builder,
                                           seed=0, oversample={'refactor': 3})
            rows = [json.loads(line) for line in out.read_text(encoding='utf-8').strip().split('\n')]
            keys = [(r['promptId'], r['intent']) for r in rows]
            self.assertEqual(summary['items'], 26, '24 base items plus two refactor repeats')
            self.assertEqual(keys.count(('a', 'refactor')), 3)
            self.assertTrue(all(keys.count(('a', intent)) == 1 for intent in INTENTS if intent != 'refactor'),
                            'sibling intents must not be reweighted')
            self.assertTrue(all(keys.count(('b', intent)) == 1 for intent in INTENTS),
                            'non-positive prompt must remain at base multiplicity')
            self.assertEqual(summary['manifest']['oversample'], {'refactor': 3})

    def test_bad_oversample_spec_fails(self):
        with tempfile.TemporaryDirectory() as d:
            data = Path(d) / 'data'
            data.mkdir()
            self.write_data(data, [], [])
            with self.assertRaisesRegex(ValueError, 'oversample'):
                laya_exporter.export(data, 'train', Path(d) / 'o.json', Path(d) / 'm.json',
                                     fake_builder, oversample={'nope': 2})
            with self.assertRaisesRegex(ValueError, 'oversample'):
                laya_exporter.export(data, 'train', Path(d) / 'o.json', Path(d) / 'm.json',
                                     fake_builder, oversample={'fix': 1})


if __name__ == '__main__':
    unittest.main()
