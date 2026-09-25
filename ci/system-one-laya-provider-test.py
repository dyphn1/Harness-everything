"""Contract tests for the Laya fine-tuned provider adapter (#255 Phase 3).

The 13-option evaluator vector, unclassified ramp, limits and artifact
rules are all pinned here with a stub predictor: no model weights needed.
Run with:
    python3 ci/system-one-laya-provider-test.py
"""
import hashlib
import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True  # never leave __pycache__ in the source tree that packaging copies
path = Path(__file__).resolve().parents[1] / 'harness-everything/scripts/system-one/laya_adapter.py'
spec = importlib.util.spec_from_file_location('laya_adapter', path)
laya_adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(laya_adapter)

INTENTS = ['explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor',
           'review', 'test', 'docs', 'plan', 'investigate']
OPTIONS = [{'id': i, 'text': f'{i} text'} for i in INTENTS] + [{'id': 'unclassified', 'text': 'unclear'}]


def request(options=None, task='intent', context='fix it'):
    return {'schemaVersion': 1, 'task': task, 'context': context,
            'options': options if options is not None else OPTIONS,
            'catalogHash': 'b' * 64, 'requestHash': 'a' * 64}


def stub_predict(probs):
    def run(state, questions):
        assert state and set(questions) == set(INTENTS)
        return dict(probs)
    return run


class ArtifactTests(unittest.TestCase):
    def write_ckpt(self, root, weights=b'fake-weights-1', config=b'{"cfg":1}'):
        ckpt = Path(root) / 'model.safetensors'
        ckpt.write_bytes(weights)
        (Path(root) / 'rl_agent_config.json').write_bytes(config)
        return {'checkpoint': str(ckpt),
                'weightsSha256': hashlib.sha256(weights).hexdigest(),
                'configSha256': hashlib.sha256(config).hexdigest()}

    def test_verify_ok_and_config_sibling_rule(self):
        with tempfile.TemporaryDirectory() as d:
            m = self.write_ckpt(d)
            self.assertEqual(laya_adapter.verify_artifacts(m), Path(m['checkpoint']))

    def test_hash_mismatch_and_bad_format_fail(self):
        with tempfile.TemporaryDirectory() as d:
            m = self.write_ckpt(d)
            bad = dict(m, weightsSha256='0' * 64)
            with self.assertRaisesRegex(ValueError, 'artifact-hash'):
                laya_adapter.verify_artifacts(bad)
            bad2 = dict(m, checkpoint=str(Path(d) / 'model.pt'))
            with self.assertRaisesRegex(ValueError, 'checkpoint-format'):
                laya_adapter.verify_artifacts(bad2)
            bad3 = dict(m, checkpoint='relative/model.safetensors')
            with self.assertRaisesRegex(ValueError, 'checkpoint-format'):
                laya_adapter.verify_artifacts(bad3)


class ScorerTests(unittest.TestCase):
    def probs(self, **over):
        base = {i: 0.05 for i in INTENTS}
        base.update(over)
        return base

    def test_scores_follow_request_option_order_raw(self):
        score, _ = laya_adapter.make_scorer(stub_predict(self.probs(fix=0.8)))
        shuffled = [OPTIONS[5], OPTIONS[0], *[o for o in OPTIONS if o['id'] not in ('feature', 'explain')]]
        out = score(request(options=shuffled))
        self.assertEqual(len(out), 13)
        by_id = {o['id']: p for o, p in zip(shuffled, out)}
        self.assertGreater(by_id['fix'], by_id['test'])
        self.assertTrue(all(0.0 <= p <= 1.0 for p in out))
        self.assertGreater(sum(out), 1.0, 'independent scores sum past one: no simplex')

    def test_confident_max_leaves_no_unclassified_mass(self):
        score, _ = laya_adapter.make_scorer(stub_predict(self.probs(fix=0.9)))
        out = score(request())
        self.assertEqual(out[-1], 0.0, 'max above the cutoff closes the abstain ramp')

    def test_flat_lows_abstain_through_unclassified(self):
        score, _ = laya_adapter.make_scorer(stub_predict(self.probs()))
        out = score(request())
        self.assertGreater(out[-1], 0.5, 'nothing actionable concentrates on unclassified')

    def test_non_intent_task_and_missing_intent_fail(self):
        score, _ = laya_adapter.make_scorer(stub_predict(self.probs()))
        with self.assertRaisesRegex(ValueError, 'task'):
            score(request(task='tier'))
        with self.assertRaisesRegex(ValueError, 'options'):
            score(request(options=[{'id': 'fix', 'text': 'x'}, {'id': 'unclassified', 'text': 'y'}]))


class LimitTests(unittest.TestCase):
    def test_boundary_passes_and_overflow_fails(self):
        score, config = laya_adapter.make_scorer(stub_predict({i: 0.1 for i in INTENTS}))
        ok_ctx = 'x' * config['context_tokens']
        laya_adapter.check_limits(request(context=ok_ctx), config)
        with self.assertRaisesRegex(ValueError, 'input-too-long'):
            laya_adapter.check_limits(request(context=ok_ctx + 'x'), config)
        big_opt = [{'id': 'a', 'text': 'y' * (config['option_tokens'] + 1)}, {'id': 'b', 'text': 'z'}]
        with self.assertRaisesRegex(ValueError, 'input-too-long'):
            laya_adapter.check_limits(request(options=big_opt), config)


if __name__ == '__main__':
    unittest.main()
