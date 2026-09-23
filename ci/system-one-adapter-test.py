"""Stdlib adapter tests: no claim of real checkpoint inference."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import tempfile
import threading
import time
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


def stub_factory(weights, manifest):
    return (lambda request: [1.0] + [0.0] * (len(request['options']) - 1)), {'context_tokens': 8, 'option_tokens': 8}


def call(port, payload, raw=None):
    with socket.create_connection(('127.0.0.1', port), timeout=5) as conn:
        conn.sendall(raw if raw is not None else (json.dumps(payload) + '\n').encode('utf-8'))
        conn.shutdown(socket.SHUT_WR)
        data = b''.join(iter(lambda: conn.recv(65536), b''))
    return json.loads(data)


class ResidentServerTests(unittest.TestCase):
    def setUp(self):
        self.root = tempfile.TemporaryDirectory()
        weights = Path(self.root.name) / 'model.safetensors'
        weights.write_bytes(b'synthetic-not-real-weights')
        weights.with_suffix('.json').write_text('{}', encoding='utf-8')
        self.weights = weights
        self.manifest = {'checkpoint': str(weights), 'modelId': 'stub', 'revision': 'v1', 'domain': 'harness-routing-v1',
                         'weightsSha256': hashlib.sha256(weights.read_bytes()).hexdigest(),
                         'configSha256': hashlib.sha256(weights.with_suffix('.json').read_bytes()).hexdigest()}
        self.state = Path(self.root.name) / 'state.json'
        self.lock = Path(self.root.name) / 'state.starting'
        self.lock.write_text('{}', encoding='utf-8')

    def tearDown(self):
        self.root.cleanup()

    def start(self, idle=30):
        thread = threading.Thread(target=adapter.serve, args=(self.manifest, self.state, self.lock),
                                  kwargs={'scorer_factory': stub_factory, 'idle_timeout_s': idle}, daemon=True)
        thread.start()
        deadline = time.time() + 10
        while not self.state.exists() and time.time() < deadline:
            time.sleep(0.02)
        self.assertTrue(self.state.exists())
        return thread, json.loads(self.state.read_text(encoding='utf-8'))

    def request(self, context='fix', options=('a', 'b')):
        return {'schemaVersion': 1, 'task': 'tier', 'context': context, 'requestHash': 'r' * 64, 'catalogHash': 'c' * 64,
                'options': [{'id': f'o{i}', 'text': t} for i, t in enumerate(options)]}

    def test_protocol_auth_limits_and_shutdown(self):
        thread, state = self.start()
        self.assertEqual(set(state), {'schemaVersion', 'pid', 'port', 'token', 'startedAt'})
        self.assertRegex(state['token'], r'^[0-9a-f]{64}$')
        self.assertEqual(state['pid'], os.getpid())
        self.assertFalse(self.lock.exists())
        if os.name == 'posix':
            self.assertEqual(self.state.stat().st_mode & 0o777, 0o600)
        token, port = state['token'], state['port']
        self.assertEqual(call(port, {'token': token, 'op': 'ping'})['ok'], True)
        self.assertEqual(call(port, {'token': '0' * 64, 'op': 'ping'}), {'ok': False, 'reason': 'unauthorized'})
        self.assertEqual(call(port, {'op': 'ping'}), {'ok': False, 'reason': 'unauthorized'})
        self.assertEqual(call(port, None, raw=b'not-json\n'), {'ok': False, 'reason': 'invalid-request'})
        self.assertEqual(call(port, None, raw=b'x' * (2 * 1024 * 1024 + 2)), {'ok': False, 'reason': 'request-limit'})
        self.assertEqual(call(port, {'token': token, 'op': 'unknown'}), {'ok': False, 'reason': 'invalid-request'})
        reply = call(port, {'token': token, 'op': 'score', 'request': self.request()})
        self.assertEqual(reply['ok'], True)
        self.assertEqual(reply['response']['requestHash'], 'r' * 64)
        self.assertEqual(reply['response']['model'], {'id': 'stub', 'revision': 'v1', 'domain': 'harness-routing-v1'})
        self.assertEqual([s['probability'] for s in reply['response']['scores']], [1.0, 0.0])
        self.assertEqual(call(port, {'token': token, 'op': 'score', 'request': self.request(context='123456789')}),
                         {'ok': False, 'reason': 'input-too-long'})
        self.assertEqual(call(port, {'token': token, 'op': 'score', 'request': {'context': 'x'}}), {'ok': False, 'reason': 'invalid-request'})
        self.assertEqual(call(port, {'token': token, 'op': 'shutdown'}), {'ok': True})
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertFalse(self.state.exists())

    def test_artifact_change_stops_server(self):
        thread, state = self.start()
        time.sleep(0.05)
        self.weights.write_bytes(b'changed-weights-with-new-size')
        reply = call(state['port'], {'token': state['token'], 'op': 'score', 'request': self.request()})
        self.assertEqual(reply, {'ok': False, 'reason': 'artifact-changed'})
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertFalse(self.state.exists())

    def test_idle_timeout_exits_and_removes_state(self):
        thread, _ = self.start(idle=0.3)
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertFalse(self.state.exists())

    def test_startup_failure_is_recorded_in_lock(self):
        self.manifest['weightsSha256'] = '0' * 64
        adapter.serve(self.manifest, self.state, self.lock, scorer_factory=stub_factory, idle_timeout_s=1)
        self.assertFalse(self.state.exists())
        self.assertEqual(json.loads(self.lock.read_text(encoding='utf-8'))['failed'], 'artifact-hash')


if __name__ == '__main__':
    unittest.main()
