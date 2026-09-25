#!/usr/bin/env python3
"""Zero-shot dense intent labeling with Laya (#255 Phase 1+2).

Maps each of the 12 owner intents (catalogs.js order, frozen) to one Laya
`noul` question and records the yes-probability as the per-intent relevance
score. Output rows match the `labels-intent-scores.jsonl` trainer contract
{id, gold, secondary, scores}, but MUST be written to a separate file: the
sonnet-scored labels are never overwritten. Derived gold/secondary are
mechanical bootstrap only (labeler.derived=true), never owner truth.

Stdlib only at import time; `laya` / `laya_mlx` are imported lazily inside
the backend constructors so contract tests run without model weights.
"""
import argparse
import hashlib
import json
import math
import statistics
import sys
import time
from pathlib import Path

# Owner catalog order (harness-everything/scripts/system-one/catalogs.js).
# This order is the scorer output order; changing it invalidates weights.
INTENTS = ['explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor',
           'review', 'test', 'docs', 'plan', 'investigate']

QUESTIONS_VERSION = 'v1'

_PROPOSITIONS = {
    'explain': 'The request asks for an explanation of how something works or an answer to a question.',
    'discuss': 'The request asks to weigh options, give an opinion, or settle a decision.',
    'git': 'The request asks for Git or GitHub housekeeping: commit, push, branch, or pull request.',
    'fix': 'The request asks to repair wrong behavior: a bug, crash, failing test, or build.',
    'edit': 'The request asks to change an existing value, setting, text, or behavior.',
    'feature': 'The request asks to add new behavior: a command, option, format, or script.',
    'refactor': 'The request asks to restructure or unify existing code without adding new behavior.',
    'review': 'The request asks to evaluate an existing artifact against a standard.',
    'test': 'The request asks to run tests or builds, or to write tests as the main deliverable.',
    'docs': 'The request asks to write or edit documentation as the main deliverable.',
    'plan': 'The request asks to produce a plan, specification, or breakdown before implementation.',
    'investigate': 'The request asks to find facts or a cause and report back without changing anything.',
}

# The sonnet-scored labels file. The labeler refuses to write to it.
PROTECTED_OUTPUT = 'labels-intent-scores.jsonl'


def build_questions():
    """One `noul` question per intent, in catalog order."""
    return {intent: {'type': 'noul', 'instructions': _PROPOSITIONS[intent]} for intent in INTENTS}


def validate_scores(scores):
    """True when scores cover exactly the 12 intents with finite 0..1 floats."""
    if not isinstance(scores, dict) or set(scores) != set(INTENTS):
        raise ValueError(f'scores keys must be exactly the 12 intents, got {sorted(scores) if isinstance(scores, dict) else type(scores)}')
    for intent in INTENTS:
        v = scores[intent]
        if not isinstance(v, float) or not math.isfinite(v) or not 0.0 <= v <= 1.0:
            raise ValueError(f'scores[{intent!r}] out of range: {v!r}')
    return True


def derive_label(scores):
    """Mechanical {gold, secondary} from bands (bootstrap only, derived=true).

    Mirrors the scoredLabel bands: secondary is every other intent at 0.4+;
    a max at or below 0.2 abstains to null. Ties break by catalog order.
    """
    validate_scores(scores)
    top = max(scores[intent] for intent in INTENTS)
    if top <= 0.2:
        return {'gold': None, 'secondary': [], 'derived': True}
    gold = max(INTENTS, key=lambda i: (scores[i], -INTENTS.index(i)))
    secondary = sorted((i for i in INTENTS if i != gold and scores[i] >= 0.4),
                       key=lambda i: (-scores[i], INTENTS.index(i)))
    return {'gold': gold, 'secondary': secondary, 'derived': True}


def output_row(prompt, scores, backend, out_name, routing=None):
    """One trainer-contract row for a labeled prompt."""
    if Path(out_name).name == PROTECTED_OUTPUT:
        raise ValueError(f'protected output: refusing to overwrite {PROTECTED_OUTPUT}')
    derived = derive_label(scores)
    labeler = {'task': 'intent', 'target': 'scores', 'backend': backend,
               'questions': QUESTIONS_VERSION, 'derived': True}
    if routing is not None:
        labeler['routing'] = routing
    return {'id': prompt['id'], 'gold': derived['gold'], 'secondary': derived['secondary'],
            'scores': {intent: scores[intent] for intent in INTENTS},
            'labeler': labeler}


def torch_backend():
    """Official PyTorch Laya backend (lazy import). Returns (fn, provenance)."""
    import laya  # noqa: PLC0415
    router = laya.Router()
    questions = build_questions()

    def run(text):
        started = time.monotonic()
        result = router.predict(text, questions)
        elapsed_ms = (time.monotonic() - started) * 1000.0
        answers = result['answers']
        scores = {intent: float(answers[intent]['noul']) for intent in INTENTS}
        return scores, result['routing']['model'], elapsed_ms

    provenance = {'package': 'laya', 'version': laya.__version__}
    return run, provenance


def mlx_backend():
    """Native MLX Laya port backend (lazy import, inference only)."""
    import laya_mlx  # noqa: PLC0415
    from laya_mlx import Router  # noqa: PLC0415
    router = Router()
    questions = build_questions()

    def run(text):
        started = time.monotonic()
        result = router.predict(text, questions)
        elapsed_ms = (time.monotonic() - started) * 1000.0
        answers = result['answers']
        scores = {intent: float(answers[intent]['noul']) for intent in INTENTS}
        return scores, result['routing']['model'], elapsed_ms

    provenance = {'package': 'laya-mlx', 'version': laya_mlx.__version__}
    return run, provenance


def label_rows(rows, split, input_sha, out_path, manifest_path, backend_fn, backend_name, resume=False):
    """Label explicit rows; returns a summary dict."""
    out_path, manifest_path = Path(out_path), Path(manifest_path)
    if out_path.name == PROTECTED_OUTPUT:
        raise ValueError(f'protected output: refusing to overwrite {PROTECTED_OUTPUT}')
    done = set()
    if resume and out_path.exists():
        for line in out_path.read_text(encoding='utf-8').splitlines():
            if line.strip():
                done.add(json.loads(line)['id'])
        rows = [r for r in rows if r['id'] not in done]
    routing, latencies, this_run = {}, [], 0
    with out_path.open('a' if (resume and done) else 'w', encoding='utf-8') as fh:
        for prompt in rows:
            scores, routed, elapsed_ms = backend_fn(prompt['text'])
            fh.write(json.dumps(output_row(prompt, scores, backend_name, out_path.name, routed)) + '\n')
            routing[routed] = routing.get(routed, 0) + 1
            latencies.append(elapsed_ms)
            this_run += 1
    total, full_routing = this_run, routing
    if resume:
        # The file is the source of truth: recount everything for cumulative totals.
        full_routing = {}
        total = 0
        for line in out_path.read_text(encoding='utf-8').splitlines():
            if not line.strip():
                continue
            row = json.loads(line)
            routed = (row.get('labeler') or {}).get('routing', 'unknown')
            full_routing[routed] = full_routing.get(routed, 0) + 1
            total += 1
    manifest = {'backend': backend_name, 'split': split, 'questions': QUESTIONS_VERSION,
                'labeled': total, 'thisRun': this_run, 'resumed': bool(resume and done),
                'inputSha256': input_sha, 'routing': full_routing,
                'latencyMs': {'p50': statistics.median(latencies) if latencies else 0.0,
                              'p95': statistics.quantiles(latencies, n=100)[94] if len(latencies) >= 100 else (max(latencies) if latencies else 0.0)}}
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding='utf-8')
    return manifest


def label_split(data_dir, split, out_path, manifest_path, backend_fn, backend_name):
    """Label one prompts.jsonl split; returns a summary dict."""
    if split not in ('train', 'validation'):
        raise ValueError(f'split must be train or validation, got {split!r}')
    data_dir = Path(data_dir)
    prompts_raw = (data_dir / 'prompts.jsonl').read_text(encoding='utf-8')
    rows = [json.loads(line) for line in prompts_raw.splitlines() if line.strip()]
    todo = [r for r in rows if r.get('split') == split]
    return label_rows(todo, split, hashlib.sha256(prompts_raw.encode('utf-8')).hexdigest(),
                      out_path, manifest_path, backend_fn, backend_name)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', required=True, help='private corpus dir (holds prompts.jsonl)')
    parser.add_argument('--split', choices=['train', 'validation'], default='validation')
    parser.add_argument('--out', required=True, help='output jsonl (never labels-intent-scores.jsonl)')
    parser.add_argument('--manifest', required=True, help='provenance manifest json')
    parser.add_argument('--backend', choices=['torch', 'mlx'], required=True)
    parser.add_argument('--limit', type=int, default=0, help='label only the first N rows (0 = all)')
    parser.add_argument('--resume', action='store_true', help='skip ids already present in --out')
    args = parser.parse_args(argv)
    run, provenance = torch_backend() if args.backend == 'torch' else mlx_backend()
    print(json.dumps({'backend': args.backend, 'provenance': provenance}))

    data_dir = Path(args.data_dir)
    prompts_raw = (data_dir / 'prompts.jsonl').read_text(encoding='utf-8')
    rows = [json.loads(line) for line in prompts_raw.splitlines() if line.strip()]
    todo = [r for r in rows if r.get('split') == args.split]
    if args.limit > 0:
        todo = todo[:args.limit]
    summary = label_rows(todo, args.split,
                         hashlib.sha256(prompts_raw.encode('utf-8')).hexdigest(),
                         args.out, args.manifest, run, args.backend, resume=args.resume)
    summary['limit'] = args.limit
    Path(args.manifest).write_text(json.dumps(summary, indent=2), encoding='utf-8')
    print(json.dumps(summary))
    return 0


if __name__ == '__main__':
    sys.exit(main())
