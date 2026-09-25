"""Fine-tuned Laya intent provider bridge (#255 Phase 3, research only).

Speaks the same adapter protocol as cua_adapter.py (oneshot stdin/stdout,
resident --serve, --provenance) so the Harness evaluator machinery can score
it, but it is NOT a production transport: resident.js and provider.js still
point at cua_adapter. The scorer answers the fixed v1 noul questions it was
trained on (never the request option texts) and maps back by intent id; the
13th option (unclassified) rides a linear abstain ramp under NULL_CUTOFF.

Stdlib only at import time; `laya` imports lazily inside load_scorer.
"""
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

_HERE = Path(__file__).resolve()
if str(_HERE.parent) not in sys.path:
    sys.path.insert(0, str(_HERE.parent))
import cua_adapter  # noqa: E402  (resident serve machinery: socket server, token, phases)

_label_spec = importlib.util.spec_from_file_location(
    'laya_labeler', _HERE.parents[3] / 'scripts' / 'system-one-label-laya.py')
_label = importlib.util.module_from_spec(_label_spec)
_label_spec.loader.exec_module(_label)
INTENTS = _label.INTENTS
QUESTIONS_VERSION = _label.QUESTIONS_VERSION
build_questions = _label.build_questions

# B1 evidence (full-model validation sweep): cutoff 0.45 maximizes graded
# agreement with null rate near the teacher's 14%. Pinned, not tuned per run.
NULL_CUTOFF = 0.45
# Byte limits: holdout contexts peak at 368 B, validation at 1005 B; the
# multilingual window is 1024 tokens (~4 KB). Rejection is fail-safe lexical.
LIMITS = {'context_tokens': 4096, 'option_tokens': 1024}


def verify_artifacts(manifest):
    """Pin weights plus the training config beside them (rl_agent_config.json)."""
    weights = Path(manifest['checkpoint'])
    if not weights.is_absolute() or weights.suffix != '.safetensors':
        raise ValueError('checkpoint-format')
    config = weights.parent / 'rl_agent_config.json'
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


def make_scorer(predict_fn, cutoff=NULL_CUTOFF):
    """Build score(request) -> 13 probabilities in request-option order."""
    questions = build_questions()

    def score(request):
        if request.get('task') != 'intent':
            raise ValueError('task: laya intent bridge only')
        ids = [o['id'] for o in request['options']]
        if set(INTENTS) - set(ids):
            raise ValueError('options: all 12 intents required')
        raw = predict_fn(request['context'], questions)
        top = max(float(raw[i]) for i in INTENTS)
        ramp = max(0.0, min(1.0, (cutoff - top) / cutoff)) if cutoff > 0 else 0.0
        probs = [float(raw[i]) for i in INTENTS] + [ramp]
        total = sum(probs)
        if total <= 0:
            raise ValueError('scores: empty distribution')
        normed = [p / total for p in probs]
        by_id = dict(zip(INTENTS + ['unclassified'], normed))
        return [by_id[i] for i in ids]

    return score, dict(LIMITS)


def load_scorer(weights, manifest):
    """Load the fine-tuned checkpoint once; return (score, limits)."""
    import laya  # noqa: PLC0415
    agent = laya.load(str(weights.parent))
    questions = build_questions()

    def predict_fn(state, _questions):
        answers = agent.predict(state, questions)['answers']
        return {intent: float(answers[intent]['noul']) for intent in INTENTS}

    return make_scorer(predict_fn)


def provenance():
    """Installed laya facts only; never loads a checkpoint."""
    import importlib.metadata as metadata  # noqa: PLC0415
    import platform  # noqa: PLC0415

    def version(name):
        try:
            return metadata.version(name)
        except metadata.PackageNotFoundError:
            return None

    return {'schemaVersion': 1, 'python': {'implementation': platform.python_implementation(),
                                           'version': platform.python_version()},
            'laya': {'distribution': 'laya', 'version': version('laya'),
                     'checkpoint': 'convaiinnovations/laya:multilingual',
                     'questions': QUESTIONS_VERSION, 'nullCutoff': NULL_CUTOFF},
            'torch': version('torch')}


def infer(request, manifest):
    weights = verify_artifacts(manifest)
    score, config = load_scorer(weights, manifest)
    check_limits(request, config)
    return cua_adapter.build_response(request, manifest, score(request))


def main():
    try:
        if sys.argv[1:] == ['--provenance']:
            print(json.dumps(provenance(), allow_nan=False))
            return 0
        if sys.argv[1:2] == ['--serve']:
            return cua_adapter.serve_main(sys.argv[2:], scorer_factory=load_scorer)
        manifest = json.loads(sys.argv[1])
        raw = sys.stdin.buffer.read(2 * 1024 * 1024 + 1)
        if len(raw) > 2 * 1024 * 1024:
            raise ValueError('request-limit')
        request = json.loads(raw)
        print(json.dumps(infer(request, manifest), allow_nan=False))
    except Exception:
        print('laya-provider-unavailable', file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
