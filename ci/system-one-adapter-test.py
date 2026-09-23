"""Stdlib adapter tests: no claim of real checkpoint inference."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

path = Path(__file__).resolve().parents[1] / 'harness-everything/scripts/system-one/cua_adapter.py'
spec = importlib.util.spec_from_file_location('adapter', path)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


class AdapterTests(unittest.TestCase):
    def test_artifact_hash_and_pickle_rejection(self):
        with tempfile.TemporaryDirectory() as root:
            weights = Path(root) / 'model.safetensors'
            weights.write_bytes(b'synthetic-not-real-weights')
            sidecar = weights.with_suffix('.json')
            sidecar.write_text('{}', encoding='utf-8')
            manifest = {'checkpoint': str(weights), 'weightsSha256': hashlib.sha256(weights.read_bytes()).hexdigest(), 'configSha256': hashlib.sha256(sidecar.read_bytes()).hexdigest()}
            self.assertEqual(adapter.verify_artifacts(manifest), weights)
            sidecar.write_text('{"changed":true}', encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'artifact-hash'):
                adapter.verify_artifacts(manifest)
            manifest['checkpoint'] = str(weights.with_suffix('.pt'))
            with self.assertRaisesRegex(ValueError, 'checkpoint-format'):
                adapter.verify_artifacts(manifest)

    def test_byte_limits_no_truncation(self):
        request = {'context': '中文', 'options': [{'text': 'abc'}, {'text': 'x'}]}
        adapter.check_limits(request, {'context_tokens': 6, 'option_tokens': 3})
        for config in [{'context_tokens': 5, 'option_tokens': 3}, {'context_tokens': 6, 'option_tokens': 2}]:
            with self.assertRaisesRegex(ValueError, 'input-too-long'):
                adapter.check_limits(request, config)

    def test_source_revision_only_from_recorded_vcs_commit(self):
        commit = 'b7f7e2d8714609853a29c7d049140bc46aec0954'
        vcs = {'url': 'https://github.com/trycua/cua', 'vcs_info': {'vcs': 'git', 'commit_id': commit}, 'subdirectory': 'libs/cua-s1/python'}
        self.assertEqual(adapter.source_revision(json.dumps(vcs)), commit)
        for text in ['', 'not-json', '[]', json.dumps({'url': 'file:///src', 'dir_info': {'editable': True}}),
                     json.dumps({'vcs_info': {'commit_id': 'main'}}), json.dumps({'vcs_info': {'commit_id': commit.upper()}}), json.dumps({'vcs_info': []})]:
            self.assertIsNone(adapter.source_revision(text))
        self.assertIsNone(adapter.source_revision(None))

    def test_provenance_shape_without_ml_dependency(self):
        result = adapter.provenance()
        self.assertEqual(set(result), {'schemaVersion', 'python', 'cuaS1', 'torch'})
        self.assertEqual(set(result['python']), {'implementation', 'version'})
        self.assertEqual(set(result['cuaS1']), {'distribution', 'version', 'sourceRevision'})
        self.assertEqual(json.loads(json.dumps(result)), result)


if __name__ == '__main__':
    unittest.main()
