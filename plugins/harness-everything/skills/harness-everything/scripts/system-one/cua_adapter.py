"""Optional CPU CUA-S1 bridge. Stdout is protocol-only; never execute UI actions."""
import hashlib
import hmac
import json
import math
import os
from pathlib import Path
import re
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time

ACTIVE_STAGES = ('validity', 'intent', 'tier')
LEGACY_ROUTING_METADATA = frozenset(('domain', 'bestEpoch', 'validation', 'datasets', 'seed', 'catalog'))


def verify_artifacts(manifest):
    weights = Path(manifest['checkpoint'])
    if not weights.is_absolute() or weights.suffix != '.safetensors':
        raise ValueError('checkpoint-format')
    config = Path(manifest.get('config', weights.with_suffix('.json')))
    if not config.is_absolute() or config.suffix != '.json':
        raise ValueError('checkpoint-format')
    for file, key in [(weights, 'weightsSha256'), (config, 'configSha256')]:
        with file.open('rb') as handle:
            digest = hashlib.file_digest(handle, 'sha256').hexdigest()
        if digest != manifest[key]:
            raise ValueError('artifact-hash')
    return weights


def check_limits(request, config):
    if len(request['context'].encode('utf-8')) > config['context_tokens'] or any(
        len(option['text'].encode('utf-8')) > config['option_tokens'] for option in request['options']
    ):
        raise ValueError('input-too-long')


def _score_semantics(weights, manifest):
    config_path = Path(manifest.get('config', Path(weights).with_suffix('.json')))
    try:
        document = json.loads(config_path.read_text(encoding='utf-8'))
    except (OSError, TypeError, ValueError):
        raise ValueError('checkpoint-semantics') from None
    if not isinstance(document, dict):
        raise ValueError('checkpoint-semantics')
    metadata = document.get('metadata', {})
    if not isinstance(metadata, dict):
        raise ValueError('checkpoint-semantics')
    if manifest.get('modelId') == 'cua-ai/cua-s1-forms' and manifest.get('domain') == 'forms-v1':
        loss = metadata.get('loss')
        if metadata.get('domain') not in (None, 'forms-v1') or loss not in (None, 'cross_entropy'):
            raise ValueError('checkpoint-semantics')
        return 'categorical', 'tier'
    if manifest.get('domain') == 'harness-routing-v1' and metadata.get('domain') == 'harness-routing-v1':
        if metadata.get('task') in ACTIVE_STAGES and metadata.get('loss') == 'binary_cross_entropy':
            return 'independent', metadata['task']
        # The old tier trainer emitted this exact sidecar shape after categorical cross-entropy training.
        validation = metadata.get('validation')
        datasets = metadata.get('datasets')
        if (set(metadata) == LEGACY_ROUTING_METADATA and metadata.get('catalog') == ['tier1', 'tier2', 'tier3']
                and isinstance(metadata.get('bestEpoch'), int) and not isinstance(metadata['bestEpoch'], bool)
                and metadata['bestEpoch'] > 0 and isinstance(metadata.get('seed'), int) and not isinstance(metadata['seed'], bool)
                and isinstance(validation, dict) and set(validation) == {'nll', 'accuracy'}
                and all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) for value in validation.values())
                and isinstance(datasets, dict) and {'prompts.jsonl', 'labels.jsonl'} <= datasets.keys()
                and all(isinstance(value, str) and re.fullmatch(r'[0-9a-f]{64}', value) for value in datasets.values())):
            return 'categorical', 'tier'
    raise ValueError('checkpoint-semantics')


def load_scorer(weights, manifest):
    """Load a verified checkpoint and apply its declared training objective."""
    semantics, task = _score_semantics(weights, manifest)
    import torch
    from cua_s1.model import ChoiceExample, load_checkpoint

    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    config_path = Path(manifest.get('config', Path(weights).with_suffix('.json')))
    if config_path != Path(weights).with_suffix('.json'):
        with tempfile.TemporaryDirectory() as root:
            shutil.copyfile(weights, Path(root) / 'model.safetensors')
            shutil.copyfile(config_path, Path(root) / 'config.json')
            model, collator, config = load_checkpoint(root, 'cpu')
    else:
        model, collator, config = load_checkpoint(weights, 'cpu')

    def score(request):
        if request.get('task') != task:
            raise ValueError('checkpoint-semantics')
        example = ChoiceExample(context=request['context'], options=tuple(o['text'] for o in request['options']), label=0)
        with torch.inference_mode():
            logits = model(collator([example]))
            return (logits.softmax(-1) if semantics == 'categorical' else logits.sigmoid())[0].tolist()
    score.score_semantics = semantics
    score.training_task = task
    return score, config


def build_response(request, manifest, probabilities):
    return {
        'schemaVersion': 1, 'requestHash': request['requestHash'], 'catalogHash': request['catalogHash'],
        'model': {'id': manifest['modelId'], 'revision': manifest['revision'], 'domain': manifest['domain']},
        'scores': [{'id': option['id'], 'probability': probability} for option, probability in zip(request['options'], probabilities, strict=True)],
    }


def infer(request, manifest):
    weights = verify_artifacts(manifest)
    score, config = load_scorer(weights, manifest)
    check_limits(request, config)
    return build_response(request, manifest, score(request))


def validate_shared_manifest(manifest):
    node = os.environ.get('HARNESS_SYSTEM_ONE_NODE') or shutil.which('node')
    if not node:
        raise ValueError('active-manifest')
    validator = Path(__file__).with_name('manifest.js')
    try:
        result = subprocess.run([node, str(validator)], input=json.dumps(manifest), text=True,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5,
                                shell=False, check=False)
    except (OSError, subprocess.SubprocessError):
        raise ValueError('active-manifest') from None
    if result.returncode != 0:
        raise ValueError('active-manifest')


def _active_artifact(directory, name, suffix):
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9._-]+', name) or name in ('.', '..') or Path(name).name != name or '\\' in name or Path(name).suffix != suffix:
        raise ValueError('checkpoint-format')
    file = directory / name
    if file.is_symlink() or not file.is_file():
        raise ValueError('checkpoint-format')
    return file


def _active_fingerprint(version, directory, scorers):
    values = [version, str(directory)]
    for stage in ACTIVE_STAGES:
        entry = scorers[stage]
        values.extend((stage, entry['sha256'], entry['manifest']['configSha256']))
    return hashlib.sha256('\0'.join(values).encode('utf-8')).hexdigest()


def _active_stamp(bundle):
    paths = [Path(bundle['activePath']), Path(bundle['manifestPath'])]
    for stage in ACTIVE_STAGES:
        paths.extend((bundle['scorers'][stage]['weights'], bundle['scorers'][stage]['configPath']))
    return [(file.stat().st_size, file.stat().st_mtime_ns) for file in paths]


def _active_unchanged(bundle, stamp):
    try:
        return _active_stamp(bundle) == stamp
    except OSError:
        return False


def load_active_bundle(active_path, expected_fingerprint=None, scorer_loader=None):
    """Read one active pointer and load its three verified stage checkpoints."""
    active_path = Path(active_path)
    if not active_path.is_absolute() or active_path.is_symlink() or not active_path.is_file() or active_path.stat().st_size > 65536:
        raise ValueError('active-pointer')
    pointer = json.loads(active_path.read_text(encoding='utf-8'))
    if (not isinstance(pointer, dict) or set(pointer) != {'schemaVersion', 'version', 'dir', 'previous', 'activatedAt'}
            or pointer.get('schemaVersion') != 1 or not isinstance(pointer.get('version'), str)
            or not ID_PATTERN.fullmatch(pointer['version']) or not isinstance(pointer.get('dir'), str)
            or not Path(pointer['dir']).is_absolute()
            or (pointer.get('previous') is not None and (not isinstance(pointer['previous'], str) or not ID_PATTERN.fullmatch(pointer['previous'])))
            or not isinstance(pointer.get('activatedAt'), str)):
        raise ValueError('active-pointer')
    directory = Path(pointer['dir'])
    if directory.is_symlink() or not directory.is_dir():
        raise ValueError('active-pointer')
    manifest_path = directory / 'manifest.json'
    if manifest_path.is_symlink() or not manifest_path.is_file() or manifest_path.stat().st_size > 131072:
        raise ValueError('active-manifest')
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    validate_shared_manifest(manifest)
    if manifest['version'] != pointer['version']:
        raise ValueError('active-manifest')
    scorers = {}
    loader = scorer_loader or load_scorer
    for stage in ACTIVE_STAGES:
        entry = manifest['stages'][stage]
        weights = _active_artifact(directory, entry['weights'], '.safetensors')
        config_path = _active_artifact(directory, entry['config'], '.json')
        if hashlib.sha256(weights.read_bytes()).hexdigest() != entry['sha256']:
            raise ValueError('artifact-hash')
        stage_manifest = {
            'checkpoint': str(weights),
            'config': str(config_path),
            'weightsSha256': entry['sha256'],
            'configSha256': hashlib.sha256(config_path.read_bytes()).hexdigest(),
            'modelId': pointer['version'],
            'revision': pointer['version'],
            'domain': 'harness-routing-v1',
        }
        score, config = loader(weights, stage_manifest)
        if scorer_loader is None and (score.score_semantics != 'independent' or score.training_task != stage):
            raise ValueError('active-stage')
        scorers[stage] = {**entry, 'manifest': stage_manifest, 'score': score, 'config': config,
                          'weights': weights, 'configPath': config_path}
    fingerprint = _active_fingerprint(pointer['version'], pointer['dir'], scorers)
    if expected_fingerprint is not None and fingerprint != expected_fingerprint:
        raise ValueError('active-changed')
    bundle = {'activePath': str(active_path), 'manifestPath': str(manifest_path), 'pointer': pointer,
              'manifest': manifest, 'version': pointer['version'], 'dir': pointer['dir'],
              'fingerprint': fingerprint, 'scorers': scorers}
    bundle['stamp'] = _active_stamp(bundle)
    return bundle


MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_OPTIONS = 256
MAX_CLIENTS = 64
READ_DEADLINE_S = 1.0  # never longer than the Node client's 1000 ms call deadline
STARTUP_REASONS = ('artifact-hash', 'checkpoint-format')
ID_PATTERN = re.compile(r'[a-z0-9._-]{1,80}')
HASH_PATTERN = re.compile(r'[0-9a-f]{64}')
_USER_SID = []


def _artifact_stamp(weights):
    return [(p.stat().st_size, p.stat().st_mtime_ns) for p in (weights, weights.with_suffix('.json'))]


def _restrict_to_current_user(path):
    """Windows: replace the whole DACL with one protected full-control ACE for the current user.

    Editing ACEs is not enough: some hosts create files with explicit (non-inherited) SYSTEM,
    Administrators or OWNER RIGHTS entries that survive `icacls /inheritance:r /grant:r`.
    """
    if os.name != 'nt':
        return
    import ctypes
    from ctypes import wintypes
    if not _USER_SID:
        tools = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32'
        out = subprocess.run([str(tools / 'whoami.exe'), '/user', '/fo', 'csv', '/nh'],
                             capture_output=True, text=True, timeout=10, check=True).stdout
        sid = out.strip().split(',')[-1].strip().strip('"')
        if not re.fullmatch(r'S-1-[0-9-]+', sid):
            raise OSError('user-sid')
        _USER_SID.append(sid)
    advapi32 = ctypes.WinDLL('advapi32', use_last_error=True)
    kernel32 = ctypes.WinDLL('kernel32', use_last_error=True)
    descriptor = ctypes.c_void_p()
    if not advapi32.ConvertStringSecurityDescriptorToSecurityDescriptorW(
            f'D:P(A;;FA;;;{_USER_SID[0]})', 1, ctypes.byref(descriptor), None):
        raise OSError('dacl-build')
    try:
        present, defaulted, dacl = wintypes.BOOL(), wintypes.BOOL(), ctypes.c_void_p()
        if not advapi32.GetSecurityDescriptorDacl(descriptor, ctypes.byref(present), ctypes.byref(dacl), ctypes.byref(defaulted)):
            raise OSError('dacl-read')
        SE_FILE_OBJECT, DACL_INFO, PROTECTED_DACL_INFO = 1, 0x4, 0x80000000
        advapi32.SetNamedSecurityInfoW.argtypes = [wintypes.LPWSTR, ctypes.c_int, wintypes.DWORD,
                                                   ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p]
        if advapi32.SetNamedSecurityInfoW(str(path), SE_FILE_OBJECT, DACL_INFO | PROTECTED_DACL_INFO, None, None, dacl, None) != 0:
            raise OSError('dacl-set')
    finally:
        kernel32.LocalFree(descriptor)


def _write_private_json(target, value):
    """Atomic replace of an owner-only file (0600; explicit owner-only DACL on Windows) before the token is written."""
    tmp = target.with_name(f'.{target.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp')
    os.close(os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600))
    _restrict_to_current_user(tmp)
    with open(tmp, 'w', encoding='utf-8') as handle:
        json.dump(value, handle)
    os.replace(tmp, target)


def _read_request_line(conn):
    buffer = bytearray()
    while b'\n' not in buffer and len(buffer) <= MAX_REQUEST_BYTES:
        chunk = conn.recv(65536)
        if not chunk:
            break
        buffer.extend(chunk)
    if len(buffer.split(b'\n', 1)[0]) > MAX_REQUEST_BYTES:
        # Drain to EOF (bounded by size and the read deadline) so the reply is not lost to a reset.
        drained = 0
        try:
            while drained < 8 * MAX_REQUEST_BYTES and conn.recv(65536):
                drained += 65536
        except OSError:
            pass
        raise ValueError('request-limit')
    return bytes(buffer).split(b'\n', 1)[0]


def _valid_score_request(request):
    """Phase 0 request structure. Hashes are fingerprints, not authentication, so they are shape-checked only."""
    if (not isinstance(request, dict)
            or set(request) != {'schemaVersion', 'task', 'context', 'options', 'catalogHash', 'requestHash'}
            or request['schemaVersion'] != 1 or not isinstance(request['task'], str) or not ID_PATTERN.fullmatch(request['task'])
            or not isinstance(request['context'], str)
            or not all(isinstance(request[k], str) and HASH_PATTERN.fullmatch(request[k]) for k in ('catalogHash', 'requestHash'))):
        return False
    options = request['options']
    if not isinstance(options, list) or not 1 <= len(options) <= MAX_OPTIONS:
        return False
    if any(not isinstance(o, dict) or set(o) != {'id', 'text'} or not isinstance(o['id'], str)
           or not ID_PATTERN.fullmatch(o['id']) or not isinstance(o['text'], str) for o in options):
        return False
    return len({o['id'] for o in options}) == len(options)


def _handle(conn, token, manifest, weights, stamp, score, config, active_bundle=None):
    """Return (reply, stop). Errors carry bounded reason codes only: no prompt, path, or traceback."""
    invalid = {'ok': False, 'reason': 'invalid-request'}
    try:
        line = _read_request_line(conn)
    except ValueError:
        return {'ok': False, 'reason': 'request-limit'}, False
    except OSError:
        return invalid, False
    try:
        message = json.loads(line)
    except ValueError:
        return invalid, False
    if not isinstance(message, dict):
        return invalid, False
    supplied = message.get('token')
    if not isinstance(supplied, str) or not hmac.compare_digest(supplied.encode('utf-8'), token.encode('utf-8')):
        return {'ok': False, 'reason': 'unauthorized'}, False
    op = message.get('op')
    if op == 'ping':
        model = {'id': active_bundle['version'], 'revision': active_bundle['version'], 'domain': 'harness-routing-v1'} if active_bundle else {
            'id': manifest['modelId'], 'revision': manifest['revision'], 'domain': manifest['domain']}
        return {'ok': True, 'pid': os.getpid(), 'model': model}, False
    if op == 'shutdown':
        return {'ok': True}, True
    stage = message.get('stage') if active_bundle else None
    if (op != 'score' or (active_bundle and set(message) != {'token', 'op', 'stage', 'request'})
            or (not active_bundle and not _valid_score_request(message.get('request')))
            or (active_bundle and (not isinstance(stage, str) or stage not in active_bundle['scorers']
                or not _valid_score_request(message.get('request'))))):
        return invalid, False
    try:
        changed = not _active_unchanged(active_bundle, stamp) if active_bundle else _artifact_stamp(weights) != stamp
    except OSError:
        changed = True
    if changed:
        return {'ok': False, 'reason': 'artifact-changed'}, True
    request = message['request']
    selected = active_bundle['scorers'][stage] if active_bundle else None
    if active_bundle and (request['task'] != stage or [option['id'] for option in request['options']] != selected['options']):
        return invalid, False
    try:
        check_limits(request, selected['config'] if active_bundle else config)
    except ValueError:
        return {'ok': False, 'reason': 'input-too-long'}, False
    try:
        response = build_response(request, selected['manifest'], score(request, stage)) if active_bundle else build_response(request, manifest, score(request))
        return {'ok': True, 'response': response}, False
    except Exception:
        return {'ok': False, 'reason': 'score-failed'}, False


def serve(manifest, state_path, lock_path, scorer_factory=None, idle_timeout_s=None, active_bundle=None):
    """Resident loopback scorer: verify, load once, publish state, serve until idle/shutdown/artifact change."""
    state_path, lock_path = Path(state_path), Path(lock_path)
    try:
        if active_bundle:
            weights = None
            stamp = active_bundle['stamp']
            score = config = None
        else:
            weights = verify_artifacts(manifest)
            stamp = _artifact_stamp(weights)
            score, config = (scorer_factory or load_scorer)(weights, manifest)
    except Exception as exc:
        reason = str(exc) if str(exc) in STARTUP_REASONS else 'load-failed'
        try:
            _write_private_json(lock_path, {'failed': reason, 'at': time.time()})
        except OSError:
            pass
        return 1
    idle = idle_timeout_s if idle_timeout_s is not None else manifest.get('idleTimeoutMs', 1800000) / 1000
    token = secrets.token_hex(32)
    pid = os.getpid()
    stop = threading.Event()
    score_lock = threading.Lock()  # one model, one inference at a time; connections are handled concurrently
    slots = threading.BoundedSemaphore(MAX_CLIENTS)

    def guarded_score(request):
        with score_lock:
            return score(request)

    def guarded_active_score(request, stage):
        with score_lock:
            return active_bundle['scorers'][stage]['score'](request)

    def send(conn, reply):
        try:
            conn.sendall((json.dumps(reply, allow_nan=False) + '\n').encode('utf-8'))
        except OSError:
            pass

    def worker(conn):
        try:
            with conn:
                conn.settimeout(READ_DEADLINE_S)
                reply, halt = _handle(conn, token, manifest, weights, stamp,
                                      guarded_active_score if active_bundle else guarded_score, config, active_bundle)
                send(conn, reply)
            if halt:
                stop.set()
        finally:
            slots.release()

    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        server.bind(('127.0.0.1', 0))
        server.listen(MAX_CLIENTS)
        server.settimeout(0.25)
        _write_private_json(state_path, {'schemaVersion': 1, 'pid': pid, 'port': server.getsockname()[1], 'token': token, 'startedAt': time.time()})
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass
        last = time.monotonic()
        # A server whose state file no longer names it is undiscoverable (replaced or corrupted): exit, never orphan.
        while not stop.is_set() and time.monotonic() - last <= idle and _owns_state(state_path, pid, token) \
                and (active_bundle is None or _active_unchanged(active_bundle, stamp)):
            try:
                conn, _ = server.accept()
            except socket.timeout:
                continue
            last = time.monotonic()
            if not slots.acquire(blocking=False):
                with conn:
                    conn.settimeout(0.2)
                    try:
                        _read_request_line(conn)
                    except (OSError, ValueError):
                        pass
                    send(conn, {'ok': False, 'reason': 'busy'})
                continue
            threading.Thread(target=worker, args=(conn,), daemon=True).start()
    finally:
        server.close()
        if _owns_state(state_path, pid, token, missing=False):
            try:
                state_path.unlink()
            except OSError:
                pass
    return 0


def _owns_state(state_path, pid, token, missing=False):
    """True while the state file still names this server. A transient Windows sharing violation counts as owned."""
    try:
        data = json.loads(state_path.read_text(encoding='utf-8'))
    except FileNotFoundError:
        return missing
    except OSError:
        return True
    except ValueError:
        return False
    return isinstance(data, dict) and data.get('pid') == pid and data.get('token') == token


def serve_main(argv, scorer_factory=None):
    if len(argv) != 3:
        return 2
    return serve(json.loads(argv[0]), argv[1], argv[2], scorer_factory=scorer_factory)


def serve_active_main(argv):
    if len(argv) != 4:
        return 2
    active_path, state_path, lock_path, fingerprint = argv
    try:
        bundle = load_active_bundle(active_path, expected_fingerprint=fingerprint)
    except Exception:
        try:
            _write_private_json(Path(lock_path), {'failed': 'load-failed', 'at': time.time()})
        except OSError:
            pass
        return 1
    return serve(bundle['manifest'], state_path, lock_path, active_bundle=bundle)


def source_revision(direct_url_text):
    """Return the PEP 610 VCS commit recorded at install time, or None when unprovable."""
    try:
        commit = json.loads(direct_url_text)['vcs_info']['commit_id']
    except Exception:
        return None
    return commit if isinstance(commit, str) and re.fullmatch(r'[0-9a-f]{40}', commit) else None


def provenance():
    """Installed runtime/source facts only; never imports torch or loads a checkpoint."""
    import importlib.metadata as metadata
    import platform

    cua = {'distribution': None, 'version': None, 'sourceRevision': None}
    names = sorted(set(metadata.packages_distributions().get('cua_s1', [])))
    if len(names) == 1:
        dist = metadata.distribution(names[0])
        cua = {'distribution': names[0], 'version': dist.version, 'sourceRevision': source_revision(dist.read_text('direct_url.json'))}
    try:
        torch = metadata.version('torch')
    except metadata.PackageNotFoundError:
        torch = None
    return {'schemaVersion': 1, 'python': {'implementation': platform.python_implementation(), 'version': platform.python_version()},
            'cuaS1': cua, 'torch': torch}


def main():
    try:
        if sys.argv[1:] == ['--provenance']:
            print(json.dumps(provenance(), allow_nan=False))
            return 0
        if sys.argv[1:2] == ['--serve']:
            return serve_main(sys.argv[2:])
        if sys.argv[1:2] == ['--serve-active']:
            return serve_active_main(sys.argv[2:])
        manifest = json.loads(sys.argv[1])
        raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError('request-limit')
        request = json.loads(raw)
        result = infer(request, manifest)
        print(json.dumps(result, allow_nan=False))
    except Exception:
        # No raw prompt, selected values, artifact paths, or traceback on the wire.
        print('cua-provider-unavailable', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
