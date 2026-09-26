"""Stdlib tests for per-intent Bernoulli evaluation (#255 Phase 3).

Each intent is its own binary decision with its own threshold: no simplex,
no single winner. Run with:
    python3 ci/system-one-laya-perintent-test.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True  # never leave __pycache__ in the source tree that packaging copies
path = Path(__file__).resolve().parents[1] / 'scripts/system-one-perintent-laya.py'
spec = importlib.util.spec_from_file_location('laya_perintent', path)
laya_perintent = importlib.util.module_from_spec(spec)
spec.loader.exec_module(laya_perintent)

INTENTS = ['explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor',
           'review', 'test', 'docs', 'plan', 'investigate']


class BinarizeTests(unittest.TestCase):
    def test_band_boundary(self):
        self.assertEqual(laya_perintent.binarize({'fix': 0.4, 'test': 0.39}), {'fix', 'test'} - {'test'})
        self.assertEqual(laya_perintent.binarize({'fix': 0.4}), {'fix'})

    def test_custom_positive_band(self):
        self.assertEqual(laya_perintent.binarize({'fix': 0.5}, band=0.6), set())


class SweepTests(unittest.TestCase):
    def test_separable_intent_gets_perfect_threshold(self):
        scores = [0.1, 0.2, 0.8, 0.9]
        truth = [False, False, True, True]
        tau, p, r, f = laya_perintent.sweep_threshold(scores, truth)
        self.assertEqual((p, r, f), (1.0, 1.0, 1.0))
        self.assertTrue(0.2 < tau <= 0.8)

    def test_all_negative_stays_silent(self):
        tau, p, r, f = laya_perintent.sweep_threshold([0.1, 0.2, 0.3], [False, False, False])
        self.assertEqual(r, 0.0)
        self.assertTrue(tau > 0.3)


class MicroTests(unittest.TestCase):
    def test_hand_computed_micro(self):
        # totals: tp=1, fp=2, fn=2.
        per = {'a': (1, 1, 1), 'b': (0, 1, 1)}  # (tp, fp, fn)
        m = laya_perintent.micro(per)
        self.assertAlmostEqual(m['precision'], 1 / 3)
        self.assertAlmostEqual(m['recall'], 1 / 3)
        self.assertAlmostEqual(m['f1'], 1 / 3)

    def test_empty_predictions_score_zero_not_nan(self):
        m = laya_perintent.micro({'a': (0, 0, 2)})
        self.assertEqual((m['precision'], m['recall'], m['f1']), (0.0, 0.0, 0.0))


class StageTests(unittest.TestCase):
    def teacher(self):
        return {
            'a': {'gold': 'fix', 'scores': {'fix': 0.9}},
            'b': {'gold': 'docs', 'scores': {'docs': 0.5}},
            'c': {'gold': None, 'scores': {}},
            'd': {'gold': 'test', 'scores': {'test': 0.7}},
        }

    def test_confident_classifiable_first_null_last(self):
        teacher = self.teacher()
        preds = {'a': {'fix': 0.9}, 'b': {'docs': 0.5}, 'c': {'fix': 0.1}, 'd': {'test': 0.7}}
        conf, steps, nulls = laya_perintent.stage_split(['a', 'b', 'c', 'd'], teacher, preds)
        self.assertEqual(conf, ['a', 'd'], 'model max >= 0.6 with a primary')
        self.assertEqual(nulls, ['c'], 'unclassifiable rows wait for the last stage')
        self.assertEqual([s[0] for s in steps], ['docs'], 'remaining classes in catalog order')
        self.assertEqual(steps[0][1], ['a', 'd', 'b'], 'cumulative: confident plus added class')
        flat = (steps[-1][1] if steps else conf) + nulls
        self.assertEqual(sorted(flat), ['a', 'b', 'c', 'd'], 'disjoint and complete')


if __name__ == '__main__':
    unittest.main()
