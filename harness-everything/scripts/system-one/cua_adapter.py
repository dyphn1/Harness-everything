"""Optional CPU CUA-S1 bridge. Stdout is protocol-only; never execute UI actions."""
import hashlib
import hmac
import json
import os
from pathlib import Path
import re
import secrets
import socket
import sys
import time


def verify_artifacts(manifest):
    weights = Path(manifest['checkpoint'])
    if not weights.is_absolute() or weights.suffix != '.safetensors':
        raise ValueError('checkpoint-format')
    for file, key in [(weights, 'weightsSha256'), (weights.with_suffix('.json'), 'configSha256')]:
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


def load_scorer(weights, manifest):
    """Load the verified checkpoint once; return (score(request) -> probabilities, config)."""
    import torch
    from cua_s1.model import ChoiceExample, load_checkpoint

    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    model, collator, config = load_checkpoint(weights, 'cpu')

    def score(request):
        example = ChoiceExample(context=request['context'], options=tuple(o['text'] for o in request['options']), label=0)
        with torch.inference_mode():
            return model(collator([example])).softmax(-1)[0].tolist()
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


MAX_REQUEST_BYTES = 2 * 1024 * 1024
STARTUP_REASONS = ('artifact-hash', 'checkpoint-format')


def _artifact_stamp(weights):
    return [(p.stat().st_size, p.stat().st_mtime_ns) for p in (weights, weights.with_suffix('.json'))]


def _write_private_json(target, value):
    """Atomic replace of a 0600 file; the resident token must not be readable by other users."""
    tmp = target.with_name(f'.{target.name}.{os.getpid()}.{secrets.token_hex(4)}.tmp')
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as handle:
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
        # Drain to EOF (bounded) so the reply is not lost to a reset from unread input.
        drained = 0
        while drained < 8 * MAX_REQUEST_BYTES and conn.recv(65536):
            drained += 65536
        raise ValueError('request-limit')
    return bytes(buffer).split(b'\n', 1)[0]


def _valid_score_request(request):
    return (isinstance(request, dict) and isinstance(request.get('context'), str)
            and all(isinstance(request.get(k), str) for k in ('requestHash', 'catalogHash'))
            and isinstance(request.get('options'), list) and len(request['options']) >= 2
            and all(isinstance(o, dict) and isinstance(o.get('id'), str) and isinstance(o.get('text'), str) for o in request['options']))


def _handle(conn, token, manifest, weights, stamp, score, config):
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
        return {'ok': True, 'pid': os.getpid(), 'model': {'id': manifest['modelId'], 'revision': manifest['revision'], 'domain': manifest['domain']}}, False
    if op == 'shutdown':
        return {'ok': True}, True
    if op != 'score' or not _valid_score_request(message.get('request')):
        return invalid, False
    try:
        changed = _artifact_stamp(weights) != stamp
    except OSError:
        changed = True
    if changed:
        return {'ok': False, 'reason': 'artifact-changed'}, True
    request = message['request']
    try:
        check_limits(request, config)
    except ValueError:
        return {'ok': False, 'reason': 'input-too-long'}, False
    try:
        return {'ok': True, 'response': build_response(request, manifest, score(request))}, False
    except Exception:
        return {'ok': False, 'reason': 'score-failed'}, False


def serve(manifest, state_path, lock_path, scorer_factory=None, idle_timeout_s=None):
    """Resident loopback scorer: verify, load once, publish state, serve until idle/shutdown/artifact change."""
    state_path, lock_path = Path(state_path), Path(lock_path)
    try:
        weights = verify_artifacts(manifest)
        stamp = _artifact_stamp(weights)
        score, config = (scorer_factory or load_scorer)(weights, manifest)
    except Exception as exc:
        reason = str(exc) if str(exc) in STARTUP_REASONS else 'load-failed'
        _write_private_json(lock_path, {'failed': reason, 'at': time.time()})
        return 1
    idle = idle_timeout_s if idle_timeout_s is not None else manifest.get('idleTimeoutMs', 1800000) / 1000
    token = secrets.token_hex(32)
    pid = os.getpid()
    server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        server.bind(('127.0.0.1', 0))
        server.listen(16)
        server.settimeout(0.25)
        _write_private_json(state_path, {'schemaVersion': 1, 'pid': pid, 'port': server.getsockname()[1], 'token': token, 'startedAt': time.time()})
        try:
            lock_path.unlink()
        except FileNotFoundError:
            pass
        last = time.monotonic()
        while time.monotonic() - last <= idle:
            try:
                conn, _ = server.accept()
            except socket.timeout:
                continue
            last = time.monotonic()
            with conn:
                conn.settimeout(2.0)
                reply, stop = _handle(conn, token, manifest, weights, stamp, score, config)
                try:
                    conn.sendall((json.dumps(reply, allow_nan=False) + '\n').encode('utf-8'))
                except OSError:
                    pass
            if stop:
                break
    finally:
        server.close()
        try:
            if json.loads(state_path.read_text(encoding='utf-8')).get('pid') == pid:
                state_path.unlink()
        except (OSError, ValueError):
            pass
    return 0


def serve_main(argv, scorer_factory=None):
    if len(argv) != 3:
        return 2
    return serve(json.loads(argv[0]), argv[1], argv[2], scorer_factory=scorer_factory)


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
