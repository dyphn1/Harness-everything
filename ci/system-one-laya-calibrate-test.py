"""Stdlib tests for the Laya zero-shot calibration (#255 Phase 3 prep).

No model dependency. Run with:
    python3 ci/system-one-laya-calibrate-test.py
"""
import importlib.util
import sys
import unittest
from pathlib import Path

sys.dont_write_bytecode = True  # never leave __pycache__ in the source tree that packaging copies
path = Path(__file__).resolve().parents[1] / 'scripts/system-one-calibrate-laya.py'
spec = importlib.util.spec_from_file_location('laya_calibrate', path)
laya_calibrate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(laya_calibrate)


class IsotonicTests(unittest.TestCase):
    def test_exact_staircase_on_separable_data(self):
        knots = laya_calibrate.isotonic_fit([0.1, 0.2, 0.8, 0.9], [0.0, 0.0, 1.0, 1.0])
        self.assertEqual([laya_calibrate.isotonic_predict(knots, x) for x in (0.1, 0.2, 0.8, 0.9)],
                         [0.0, 0.0, 1.0, 1.0])

    def test_predictions_are_monotone(self):
        xs = [0.05, 0.4, 0.35, 0.7, 0.6, 0.9, 0.2, 0.5]
        ys = [0.0, 1.0, 0.0, 0.6, 1.0, 0.8, 0.2, 0.4]
        knots = laya_calibrate.isotonic_fit(xs, ys)
        grid = [i / 20 for i in range(21)]
        preds = [laya_calibrate.isotonic_predict(knots, x) for x in grid]
        self.assertTrue(all(b >= a for a, b in zip(preds, preds[1:])), 'monotone non-decreasing')

    def test_duplicate_x_averages_y(self):
        knots = laya_calibrate.isotonic_fit([0.5, 0.5, 0.5], [0.0, 0.6, 0.3])
        self.assertAlmostEqual(laya_calibrate.isotonic_predict(knots, 0.5), 0.3)

    def test_clamps_outside_range(self):
        knots = laya_calibrate.isotonic_fit([0.2, 0.8], [0.3, 0.9])
        self.assertEqual(laya_calibrate.isotonic_predict(knots, 0.0), 0.3)
        self.assertEqual(laya_calibrate.isotonic_predict(knots, 1.0), 0.9)

    def test_knots_are_json_serializable(self):
        import json
        knots = laya_calibrate.isotonic_fit([0.1, 0.9, 0.4], [0.2, 0.8, 0.5])
        self.assertEqual(json.loads(json.dumps(knots)), knots)


class DeriveCalibratedTests(unittest.TestCase):
    def scores(self, **over):
        base = {i: 0.0 for i in
                ['explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor',
                 'review', 'test', 'docs', 'plan', 'investigate']}
        base.update(over)
        return base

    def test_null_cutoff_abstains_low_max(self):
        out = laya_calibrate.derive_calibrated(self.scores(fix=0.5, test=0.3), {}, 0.6)
        self.assertIsNone(out['gold'])

    def test_identity_mapping_keeps_bands(self):
        out = laya_calibrate.derive_calibrated(self.scores(fix=0.9, test=0.5), {}, 0.2)
        self.assertEqual((out['gold'], out['secondary']), ('fix', ['test']))


if __name__ == '__main__':
    unittest.main()
