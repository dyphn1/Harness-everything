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
