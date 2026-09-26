"""Contract tests for the single-device Laya trainer (#255 Phase 3).

Pure parts run on stdlib; torch parts skip when torch is missing
(same convention as S1-I08/S1-I13). Run with:
    python3 ci/system-one-laya-train-test.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True  # never leave __pycache__ in the source tree that packaging copies
path = Path(__file__).resolve().parents[1] / 'scripts/system-one-train-laya.py'
spec = importlib.util.spec_from_file_location('laya_trainer', path)
laya_trainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(laya_trainer)

try:
    import torch  # noqa: F401
    HAS_TORCH = True
except ImportError:
    HAS_TORCH = False


class CalibSplitTests(unittest.TestCase):
    def test_holdout_is_stable_disjoint_and_ten_percent(self):
        items = [{'id': i} for i in range(1000)]
        a_train, a_calib = laya_trainer.calib_split(items, seed=20260922, frac=0.1)
        b_train, b_calib = laya_trainer.calib_split(items, seed=20260922, frac=0.1)
        self.assertEqual(a_calib, b_calib, 'same seed replays the holdout')
        self.assertEqual(len(a_calib), 100)
        self.assertEqual(len(set(map(str, a_train)) & set(map(str, a_calib))), 0, 'disjoint')
        c_train, c_calib = laya_trainer.calib_split(items, seed=1, frac=0.1)
        self.assertNotEqual(a_calib, c_calib, 'seed matters')

    def test_small_inputs_keep_at_least_one_calib(self):
        _, calib = laya_trainer.calib_split([{'id': i} for i in range(5)], seed=7, frac=0.1)
        self.assertEqual(len(calib), 1)

    def test_prompt_groups_do_not_cross_split_and_calib_deduplicates_oversamples(self):
        items = []
        for prompt_id in range(20):
            items.append({'promptId': str(prompt_id), 'intent': 'fix'})
            items.append({'promptId': str(prompt_id), 'intent': 'refactor'})
            items.append({'promptId': str(prompt_id), 'intent': 'refactor'})  # oversampled duplicate
        train, calib = laya_trainer.calib_split(items, seed=20260922, frac=0.1)
        train_prompts = {it['promptId'] for it in train}
        calib_prompts = {it['promptId'] for it in calib}
        self.assertFalse(train_prompts & calib_prompts, 'a prompt must stay wholly on one side')
        calib_keys = [(it['promptId'], it['intent']) for it in calib]
        self.assertEqual(len(calib_keys), len(set(calib_keys)),
                         'oversampled duplicates must not overweight temperature fitting')
        self.assertEqual(len(calib), 4, '10% of 40 de-duplicated prompt-intent identities')
        self.assertEqual(sum(1 for it in train if it['intent'] == 'refactor'), 2 * len(train_prompts),
                         'training keeps oversampled copies for non-calibration prompt groups')


class IntentWeightTests(unittest.TestCase):
    def test_default_weights_are_one(self):
        self.assertEqual(laya_trainer.intent_weights(['fix', 'test'], {}), [1.0, 1.0])

    def test_table_applies_per_item_intent(self):
        self.assertEqual(laya_trainer.intent_weights(['refactor', 'fix', 'refactor'], {'refactor': 2.0}),
                         [2.0, 1.0, 2.0])

    def test_bad_table_fails(self):
        with self.assertRaisesRegex(ValueError, 'intent-weights'):
            laya_trainer.intent_weights(['fix'], {'nope': 2.0})
        with self.assertRaisesRegex(ValueError, 'intent-weights'):
            laya_trainer.intent_weights(['fix'], {'fix': 0})


@unittest.skipUnless(HAS_TORCH, 'torch not installed')
class TorchTests(unittest.TestCase):
    def test_collate_shapes(self):
        items = [{'ids': [1, 2, 3], 'markers': [0, 2], 'qtype': 2,
                  'target': [0.3, 0.7], 'label': 1} for _ in range(4)]
        batch = laya_trainer.collate(items, pad_id=0)
        self.assertEqual(tuple(batch['input_ids'].shape), (4, 3))
        self.assertEqual(tuple(batch['marker_pos'].shape), (4, 2))
        self.assertTrue(bool((batch['target'].sum(-1) - 1.0 < 1e-6).all()))

    def test_temperature_fit_is_finite_and_bounded(self):
        import random
        rng = random.Random(0)
        sel = [([rng.uniform(-1, 1), rng.uniform(-1, 1)],
                [0.4, 0.6]) for _ in range(30)]
        t = laya_trainer.fit_one_temp(sel)
        self.assertTrue(0.1 <= t <= 10.0)


if __name__ == '__main__':
    unittest.main()
