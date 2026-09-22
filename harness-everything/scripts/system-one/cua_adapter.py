"""Optional CPU CUA-S1 bridge. Stdout is protocol-only; never execute UI actions."""
import hashlib
import json
from pathlib import Path
import sys


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


def infer(request, manifest):
    weights = verify_artifacts(manifest)
    import torch
    from cua_s1.model import ChoiceExample, load_checkpoint

    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    model, collator, config = load_checkpoint(weights, 'cpu')
    check_limits(request, config)
    example = ChoiceExample(context=request['context'], options=tuple(o['text'] for o in request['options']), label=0)
    with torch.inference_mode():
        probabilities = model(collator([example])).softmax(-1)[0].tolist()
    return {
        'schemaVersion': 1, 'requestHash': request['requestHash'], 'catalogHash': request['catalogHash'],
        'model': {'id': manifest['modelId'], 'revision': manifest['revision'], 'domain': manifest['domain']},
        'scores': [{'id': option['id'], 'probability': probability} for option, probability in zip(request['options'], probabilities, strict=True)],
    }


def main():
    try:
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
