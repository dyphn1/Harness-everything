"""Stdlib adapter tests: no claim of real checkpoint inference."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import unittest
from contextlib import nullcontext
from types import ModuleType
from unittest.mock import patch

sys.dont_write_bytecode = True  # never leave __pycache__ in the source tree that packaging copies
path = Path(__file__).resolve().parents[1] / 'harness-everything/scripts/system-one/cua_adapter.py'
spec = importlib.util.spec_from_file_location('adapter', path)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)

ACTIVE_OPTIONS = {
    'validity': ['invalid'],
    'intent': ['explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor', 'review', 'test', 'docs', 'plan', 'investigate'],
    'tier': ['tier1', 'tier2', 'tier3'],
}


def write_active_fixture(root):
    thresholds = {
        'validity': {'invalid': 0.55},
        'intent': {key: 0.55 for key in ACTIVE_OPTIONS['intent']},
        'tier': {key: 0.55 for key in ACTIVE_OPTIONS['tier']},
    }
    thresholds['intent']['fix'] = 1
    version_dir = Path(root) / 'v1'
    version_dir.mkdir()
    stages = {}
    for stage in ('validity', 'intent', 'tier'):
        weights = f'{stage}-weights.safetensors'
        config = f'{stage}-config.json'
        weight_bytes = f'{stage}-weights'.encode()
        config_bytes = json.dumps({'stage': stage}).encode()
        (version_dir / weights).write_bytes(weight_bytes)
        (version_dir / config).write_bytes(config_bytes)
        stages[stage] = {
            'weights': weights, 'config': config,
            'sha256': hashlib.sha256(weight_bytes).hexdigest(),
            'options': ACTIVE_OPTIONS[stage], 'thresholds': thresholds[stage],
        }
        if stage == 'intent':
            stages[stage]['referenceOnly'] = ['fix']
    (version_dir / 'manifest.json').write_text(json.dumps({
        'schemaVersion': 1, 'version': 'v1', 'createdAt': '2026-11-14T00:00:00Z',
        'stages': stages, 'evaluation': None,
    }), encoding='utf-8')
    pointer = Path(root) / 'active.json'
    pointer.write_text(json.dumps({
        'schemaVersion': 1, 'version': 'v1', 'dir': str(version_dir),
        'previous': None, 'activatedAt': '2026-11-14T00:00:00Z',
    }), encoding='utf-8')
    return pointer


class RequestSocket:
    def __init__(self, message):
        self.data = (json.dumps(message) + '\n').encode()

    def recv(self, size):
        result, self.data = self.data[:size], self.data[size:]
        return result


class AdapterTests(unittest.TestCase):
    def test_active_pointer_loads_all_stage_checkpoints_from_separate_files(self):
        with tempfile.TemporaryDirectory() as root:
            pointer = write_active_fixture(root)
            loaded = []

            def fake_loader(weights, manifest):
                loaded.append((weights.name, Path(manifest['config']).name))
                return (lambda _request: []), {'context_tokens': 8, 'option_tokens': 8}

            bundle = adapter.load_active_bundle(pointer, scorer_loader=fake_loader)
            self.assertEqual(bundle['version'], 'v1')
            self.assertEqual(list(bundle['scorers']), ['validity', 'intent', 'tier'])
            self.assertEqual(bundle['scorers']['intent']['referenceOnly'], ['fix'])
            self.assertEqual(loaded, [(f'{stage}-weights.safetensors', f'{stage}-config.json') for stage in ('validity', 'intent', 'tier')])

    def test_active_manifest_uses_shared_reference_only_validation(self):
        with tempfile.TemporaryDirectory() as root:
            pointer = write_active_fixture(root)
            manifest_path = pointer.parent / 'v1' / 'manifest.json'
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            manifest['stages']['intent']['thresholds']['fix'] = 0.99
            manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'active-manifest'):
                adapter.load_active_bundle(pointer, scorer_loader=lambda *_: (lambda _request: [] , {}))

    def test_active_stage_protocol_scores_independent_values_and_checks_catalog(self):
        with tempfile.TemporaryDirectory() as root:
            pointer = write_active_fixture(root)

            def fake_loader(_weights, _manifest):
                return (lambda request: [0.2, 0.76, 0.9, 0.1][:len(request['options'])]), {'context_tokens': 64, 'option_tokens': 64}

            bundle = adapter.load_active_bundle(pointer, scorer_loader=fake_loader)
            token = 'a' * 64

            def request(ids):
                return {
                    'schemaVersion': 1, 'task': 'tier', 'context': 'fixture',
                    'options': [{'id': option, 'text': option} for option in ids],
                    'catalogHash': 'b' * 64, 'requestHash': 'c' * 64,
                }

            def handle(ids):
                message = {'token': token, 'op': 'score', 'stage': 'tier', 'request': request(ids)}
                score = lambda req, stage: bundle['scorers'][stage]['score'](req)
                return adapter._handle(RequestSocket(message), token, bundle['manifest'], None, bundle['stamp'], score, None, bundle)

            reply, stop = handle(ACTIVE_OPTIONS['tier'])
            self.assertFalse(stop)
            self.assertTrue(reply['ok'])
            probabilities = [score['probability'] for score in reply['response']['scores']]
            self.assertEqual(probabilities, [0.2, 0.76, 0.9])
            self.assertGreater(sum(probabilities), 1)
            bad, stop = handle(['tier1', 'tier2'])
            self.assertFalse(stop)
            self.assertEqual(bad, {'ok': False, 'reason': 'invalid-request'})

    def test_load_scorer_uses_independent_sigmoid_probabilities(self):
        class Logits:
            def sigmoid(self):
                class Probabilities:
                    def __getitem__(self, _index):
                        return self

                    def tolist(self):
                        return [0.91, 0.28]

                return Probabilities()

            def softmax(self, *_args):
                raise AssertionError('softmax is not the per-option readout')

        class FakeModel:
            def __call__(self, _batch):
                return Logits()

        torch = ModuleType('torch')
        torch.set_num_threads = lambda _count: None
        torch.use_deterministic_algorithms = lambda _enabled: None
        torch.inference_mode = nullcontext
        cua_s1 = ModuleType('cua_s1')
        model = ModuleType('cua_s1.model')
        model.ChoiceExample = lambda **values: values
        model.load_checkpoint = lambda _weights, _device: (FakeModel(), lambda examples: examples, {'context_tokens': 10, 'option_tokens': 10})
        with tempfile.TemporaryDirectory() as root:
            weights = Path(root) / 'unused.safetensors'
            weights.with_suffix('.json').write_text(json.dumps({'metadata': {
                'domain': 'harness-routing-v1', 'task': 'tier', 'loss': 'binary_cross_entropy',
            }}), encoding='utf-8')
            manifest = {'modelId': 'fixture-v1', 'domain': 'harness-routing-v1'}
            with patch.dict(sys.modules, {'torch': torch, 'cua_s1': cua_s1, 'cua_s1.model': model}):
                score, _config = adapter.load_scorer(weights, manifest)
        self.assertEqual(score({'task': 'tier', 'context': 'fixture', 'options': [{'text': 'a'}, {'text': 'b'}]}), [0.91, 0.28])

    def test_unknown_checkpoint_semantics_remain_unavailable(self):
        with tempfile.TemporaryDirectory() as root:
            weights = Path(root) / 'model.safetensors'
            weights.with_suffix('.json').write_text(json.dumps({'metadata': {
                'domain': 'harness-routing-v1', 'task': 'tier', 'loss': 'cross_entropy',
            }}), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'checkpoint-semantics'):
                adapter.load_scorer(weights, {'modelId': 'unknown-v1', 'domain': 'harness-routing-v1'})

    def test_supported_forms_checkpoint_semantics_remain_categorical(self):
        with tempfile.TemporaryDirectory() as root:
            weights = Path(root) / 'model.safetensors'
            weights.with_suffix('.json').write_text(json.dumps({'metadata': {
                'domain': 'forms-v1', 'loss': 'cross_entropy',
            }}), encoding='utf-8')
            self.assertEqual(adapter._score_semantics(weights, {
                'modelId': 'cua-ai/cua-s1-forms', 'domain': 'forms-v1',
            }), ('categorical', 'tier'))

    def test_staged_checkpoint_readout_is_independent_in_oneshot_and_active_bundle(self):
        try:
            import torch
            import torch.nn.functional as functional
            from cua_s1.model import ChoiceExample, make_system, save_checkpoint
        except ImportError as exc:
            self.skipTest(f'real CUA checkpoint dependencies unavailable: {exc}')

        stage_options = {
            'validity': [('invalid', 'The request is invalid.')],
            'intent': [('explain', 'Explain'), ('fix', 'Fix')],
            'tier': [('tier1', 'Small change'), ('tier2', 'Iterative change'), ('tier3', 'Macro change')],
        }
        torch.set_num_threads(1)
        torch.use_deterministic_algorithms(True)
        with tempfile.TemporaryDirectory(prefix='harness-s1-stages-') as root:
            root = Path(root)
            version_dir = root / 'v1'
            version_dir.mkdir()
            stage_manifests, one_shot_scores = {}, {}
            for index, (stage, options) in enumerate(stage_options.items()):
                torch.manual_seed(20261115 + index)
                config = {'encoder': 'tiny', 'width': 8, 'rank': 8, 'context_tokens': 64, 'option_tokens': 64}
                model, collator = make_system(config, 'cpu')
                example = ChoiceExample(context='fixture context', options=tuple(text for _, text in options), label=0)
                batch = collator([example])
                target = torch.zeros((1, len(options)), dtype=torch.float32)
                target[0, 0] = 1.0
                optimizer = torch.optim.AdamW(model.parameters(), lr=0.01, weight_decay=0.0)
                for _ in range(2):
                    model.train()
                    optimizer.zero_grad()
                    loss = functional.binary_cross_entropy_with_logits(model(batch), target)
                    loss.backward()
                    optimizer.step()
                model.eval()
                weights, config_path = save_checkpoint(version_dir / f'{stage}.safetensors', model, config, {
                    'domain': 'harness-routing-v1', 'task': stage, 'loss': 'binary_cross_entropy',
                })
                option_rows = [{'id': option_id, 'text': text} for option_id, text in options]
                request = {'schemaVersion': 1, 'task': stage, 'context': 'fixture context', 'options': option_rows,
                           'catalogHash': 'a' * 64, 'requestHash': 'b' * 64}
                manifest = {
                    'checkpoint': str(weights), 'weightsSha256': hashlib.sha256(weights.read_bytes()).hexdigest(),
                    'configSha256': hashlib.sha256(config_path.read_bytes()).hexdigest(),
                    'modelId': f'fixture-{stage}', 'revision': 'v1', 'domain': 'harness-routing-v1',
                }
                response = adapter.infer(request, manifest)
                one_shot_scores[stage] = [item['probability'] for item in response['scores']]
                with torch.inference_mode():
                    expected = model(batch).sigmoid()[0].tolist()
                for actual, expected_value in zip(one_shot_scores[stage], expected):
                    self.assertAlmostEqual(actual, expected_value, places=6)
                stage_manifests[stage] = {
                    'weights': weights.name, 'config': config_path.name,
                    'sha256': manifest['weightsSha256'], 'options': [option_id for option_id, _ in options],
                    'thresholds': {option_id: 0.5 for option_id, _ in options},
                }

            (version_dir / 'manifest.json').write_text(json.dumps({
                'schemaVersion': 1, 'version': 'v1', 'createdAt': '2026-11-15T00:00:00Z',
                'stages': stage_manifests, 'evaluation': None,
            }), encoding='utf-8')
            pointer = root / 'active.json'
            pointer.write_text(json.dumps({
                'schemaVersion': 1, 'version': 'v1', 'dir': str(version_dir),
                'previous': None, 'activatedAt': '2026-11-15T00:00:00Z',
            }), encoding='utf-8')
            bundle = adapter.load_active_bundle(pointer)
            token = 'c' * 64
            resident_sums = []
            for stage, options in stage_options.items():
                request = {'schemaVersion': 1, 'task': stage, 'context': 'fixture context',
                           'options': [{'id': option_id, 'text': text} for option_id, text in options],
                           'catalogHash': 'a' * 64, 'requestHash': 'b' * 64}
                message = {'token': token, 'op': 'score', 'stage': stage, 'request': request}
                score = lambda req, selected_stage: bundle['scorers'][selected_stage]['score'](req)
                reply, stop = adapter._handle(RequestSocket(message), token, bundle['manifest'], None,
                                              bundle['stamp'], score, None, bundle)
                self.assertFalse(stop)
                self.assertTrue(reply['ok'], reply)
                resident = [item['probability'] for item in reply['response']['scores']]
                self.assertEqual(resident, one_shot_scores[stage])
                resident_sums.append(sum(resident))
            self.assertTrue(any(abs(total - 1.0) > 1e-6 for total in resident_sums), resident_sums)

    def test_real_categorical_checkpoint_adapter_round_trip_reaches_legacy_decide(self):
        try:
            import torch
            import torch.nn.functional as functional
            from cua_s1.model import ChoiceExample, load_checkpoint, make_system, save_checkpoint
        except ImportError as exc:
            self.skipTest(f'real CUA checkpoint dependencies unavailable: {exc}')

        repo = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory(prefix='harness-s1-legacy-') as root:
            root = Path(root)
            torch.set_num_threads(1)
            torch.use_deterministic_algorithms(True)
            torch.manual_seed(20261115)
            config = {'encoder': 'tinyx', 'width': 128, 'rank': 128, 'layers': 2, 'heads': 4,
                      'dropout': 0.1, 'context_tokens': 224, 'option_tokens': 96}
            options = (
                'A small bounded edit or operation with clear scope.',
                'Implementation or bug fix needing iterative testing.',
                'Architecture, repository-wide change or multi-stage engineering.',
                'Unclear intent, insufficient context or outside these categories.',
            )
            model, collator = make_system(config, 'cpu')
            example = ChoiceExample(context='repair typo', options=options, label=0)
            batch = collator([example])
            optimizer = torch.optim.AdamW(model.parameters(), lr=0.02, weight_decay=0.0)
            for _ in range(40):
                model.train()
                optimizer.zero_grad()
                loss = functional.cross_entropy(model(batch), batch['labels'])
                loss.backward()
                optimizer.step()
                model.eval()
                with torch.inference_mode():
                    categorical = model(batch)[0].softmax(-1)
                ranked = categorical.sort(descending=True).values
                if ranked[0] >= 0.9 and ranked[0] - ranked[1] >= 0.2:
                    break
            self.assertGreaterEqual(float(ranked[0]), 0.9)
            self.assertGreaterEqual(float(ranked[0] - ranked[1]), 0.2)
            weights, config_path = save_checkpoint(root / 'model.safetensors', model, config, {
                'domain': 'harness-routing-v1', 'bestEpoch': _ + 1,
                'validation': {'nll': float(loss.detach()), 'accuracy': 1.0},
                'datasets': {'prompts.jsonl': 'a' * 64, 'labels.jsonl': 'b' * 64},
                'seed': 20261115, 'catalog': ['tier1', 'tier2', 'tier3'],
            })
            manifest = {
                'schemaVersion': 1, 'python': sys.executable, 'checkpoint': str(weights),
                'weightsSha256': hashlib.sha256(weights.read_bytes()).hexdigest(),
                'configSha256': hashlib.sha256(config_path.read_bytes()).hexdigest(),
                'modelId': 'legacy-tier-fixture-v1', 'revision': 'f12-categorical-fixture-v1',
                'domain': 'harness-routing-v1', 'timeoutMs': 10000,
            }
            self.assertEqual(adapter.verify_artifacts(manifest), weights)
            loaded, _loaded_collator, loaded_config = load_checkpoint(weights, 'cpu')
            self.assertEqual(loaded_config, config)
            with torch.inference_mode():
                loaded_softmax = loaded(collator([example]))[0].softmax(-1)
            self.assertAlmostEqual(float(loaded_softmax.sum()), 1.0, places=6)

            request_script = "const {createRequest}=require('./harness-everything/scripts/system-one/contract'); const {TIER_OPTIONS}=require('./harness-everything/scripts/system-one/router'); process.stdout.write(JSON.stringify(createRequest('tier','repair typo',TIER_OPTIONS)));"
            request_result = subprocess.run(['node', '-e', request_script], cwd=repo, capture_output=True, text=True, check=True)
            request = json.loads(request_result.stdout)
            adapter_result = subprocess.run(
                [sys.executable, str(path), json.dumps(manifest)], input=json.dumps(request),
                cwd=repo, capture_output=True, text=True, timeout=15,
            )
            self.assertEqual(adapter_result.returncode, 0, adapter_result.stderr)
            response = json.loads(adapter_result.stdout)
            decide_script = "const fs=require('node:fs'); const input=JSON.parse(fs.readFileSync(0,'utf8')); const {decide}=require('./harness-everything/scripts/system-one/contract'); const decision=decide(input.request,input.response,{minConfidence:0.9,minMargin:0.2}); process.stdout.write(JSON.stringify({decision,scores:input.response.scores.map(x=>x.probability)}));"
            decision_result = subprocess.run(
                ['node', '-e', decide_script], input=json.dumps({'request': request, 'response': response}),
                cwd=repo, capture_output=True, text=True, check=True,
            )
            outcome = json.loads(decision_result.stdout)
            self.assertEqual(outcome['decision']['status'], 'accepted', outcome)
            self.assertEqual(outcome['decision']['selectedId'], 'tier1', outcome)

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
        return {'schemaVersion': 1, 'task': 'tier', 'context': context, 'requestHash': 'a' * 64, 'catalogHash': 'b' * 64,
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
        self.assertEqual(reply['response']['requestHash'], 'a' * 64)
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

    @unittest.skipUnless(os.name == 'nt', 'Windows DACL')
    def test_state_file_has_owner_only_explicit_dacl_on_windows(self):
        thread, state = self.start()
        # Drop the file path (it contains "C:\Users\...") and keep only the ACE text.
        acl = subprocess.run(['icacls', str(self.state)], capture_output=True, text=True).stdout.replace(str(self.state), '')
        self.assertIn(':(F)', acl)
        for bad in ['(I)', 'Users', 'Everyone', 'Administrators', 'SYSTEM']:
            self.assertNotIn(bad, acl)
        call(state['port'], {'token': state['token'], 'op': 'shutdown'})
        thread.join(5)

    @unittest.skipUnless(os.name == 'nt', 'Windows DACL')
    def test_explicit_foreign_aces_are_replaced_not_kept(self):
        # CI runners create files with explicit (non-inherited) SYSTEM/Administrators/OWNER RIGHTS entries.
        target = Path(self.root.name) / 'explicit.json'
        target.write_text('{}', encoding='utf-8')
        subprocess.run(['icacls', str(target), '/inheritance:d'], capture_output=True, check=True)
        subprocess.run(['icacls', str(target), '/grant', '*S-1-5-32-544:F', '*S-1-5-18:F', '*S-1-3-4:F', '*S-1-5-32-545:R'], capture_output=True, check=True)
        adapter._restrict_to_current_user(target)
        acl = subprocess.run(['icacls', str(target)], capture_output=True, text=True).stdout.replace(str(target), '')
        self.assertEqual(acl.count(':('), 1)
        self.assertIn(':(F)', acl)

    def test_slow_client_does_not_block_others_and_burst_is_served(self):
        thread, state = self.start()
        idle = socket.create_connection(('127.0.0.1', state['port']), timeout=5)
        try:
            began = time.monotonic()
            self.assertEqual(call(state['port'], {'token': state['token'], 'op': 'ping'})['ok'], True)
            self.assertLess(time.monotonic() - began, 0.5)
            results = []
            workers = [threading.Thread(target=lambda: results.append(call(state['port'], {'token': state['token'], 'op': 'ping'}))) for _ in range(32)]
            for w in workers:
                w.start()
            for w in workers:
                w.join(10)
            self.assertEqual(len(results), 32)
            self.assertTrue(all(r.get('ok') is True or r == {'ok': False, 'reason': 'busy'} for r in results))
            self.assertGreaterEqual(sum(1 for r in results if r.get('ok') is True), 16)
        finally:
            idle.close()
        call(state['port'], {'token': state['token'], 'op': 'shutdown'})
        thread.join(5)

    def test_server_exits_when_its_state_file_no_longer_names_it(self):
        thread, _ = self.start()
        self.state.write_text('{"corrupt": true}', encoding='utf-8')
        thread.join(5)
        self.assertFalse(thread.is_alive())
        self.assertEqual(self.state.read_text(encoding='utf-8'), '{"corrupt": true}')

    def test_rejects_requests_outside_phase0_structure(self):
        thread, state = self.start()
        token, port = state['token'], state['port']
        many = self.request(options=tuple('x' for _ in range(257)))
        extra = dict(self.request(), extra=1)
        dup = self.request(); dup['options'][1]['id'] = dup['options'][0]['id']
        bad_id = self.request(); bad_id['options'][0]['id'] = 'Bad ID'
        wrong_version = dict(self.request(), schemaVersion=2)
        for request in [many, extra, dup, bad_id, wrong_version]:
            self.assertEqual(call(port, {'token': token, 'op': 'score', 'request': request}), {'ok': False, 'reason': 'invalid-request'})
        self.assertEqual(call(port, {'token': token, 'op': 'score', 'request': self.request(options=tuple('x' for _ in range(256)))})['ok'], True)
        call(port, {'token': token, 'op': 'shutdown'})
        thread.join(5)

    def test_startup_failure_is_recorded_in_lock(self):
        self.manifest['weightsSha256'] = '0' * 64
        adapter.serve(self.manifest, self.state, self.lock, scorer_factory=stub_factory, idle_timeout_s=1)
        self.assertFalse(self.state.exists())
        self.assertEqual(json.loads(self.lock.read_text(encoding='utf-8'))['failed'], 'artifact-hash')


if __name__ == '__main__':
    unittest.main()
