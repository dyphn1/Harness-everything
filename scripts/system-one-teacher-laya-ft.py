#!/usr/bin/env python3
"""Dense intent scores from the fine-tuned Laya teacher for unscored prompts (#255 Candidate B).

Scores every train prompt that has no teacher row in labels-intent-scores.jsonl
with the fine-tuned Laya checkpoint (the #255 full run), through the same
question set and raw independent noul answers as laya_adapter.py. Output rows
follow the trainer contract {id, gold, secondary, scores} and go to a separate
file with a provenance manifest; the Sonnet file is never written. Validation
and holdout prompts are never scored here. Runs locally; data does not leave
the machine.
"""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import time

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location('laya_labeler', HERE / 'system-one-label-laya.py')
labeler = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(labeler)
PROTECTED = labeler.PROTECTED_OUTPUT


def to_row(pid, raw):
    """Trainer-contract row from 12 raw scores, rounded to the 0.05 scale the teacher file uses."""
    scores = {i: round(round(float(raw[i]) * 20) / 20, 2) for i in labeler.INTENTS}
    ranked = sorted(labeler.INTENTS, key=lambda i: -scores[i])
    gold = ranked[0] if scores[ranked[0]] >= 0.4 else None
    secondary = [i for i in ranked[1:] if scores[i] >= 0.4] if gold else []
    return {'id': pid, 'gold': gold, 'secondary': secondary, 'scores': scores,
            'labeler': {'engine': 'laya-ft', 'derived': True}}


def targets(prompts, scored_ids, split='train'):
    return [p for p in prompts if p['split'] == split and p['id'] not in scored_ids]


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--data-dir', required=True)
    ap.add_argument('--model-dir', required=True, help='fine-tuned Laya run model dir (model.safetensors, rl_agent_config.json)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--limit', type=int, default=0)
    args = ap.parse_args(argv)
    out = Path(args.out)
    if out.name == PROTECTED:
        raise SystemExit(f'refusing to write {PROTECTED}')
    data = Path(args.data_dir)
    load = lambda p: [json.loads(l) for l in open(p, encoding='utf-8') if l.strip()]
    prompts = load(data / 'prompts.jsonl')
    scored = {r['id'] for r in load(data / PROTECTED)}
    todo = targets(prompts, scored)
    if args.limit:
        todo = todo[:args.limit]
    import laya  # noqa: PLC0415
    model_dir = Path(args.model_dir)
    agent = laya.load(str(model_dir))
    questions = labeler.build_questions()
    start = time.time()
    with out.open('w', encoding='utf-8') as fh:
        for n, p in enumerate(todo, 1):
            answers = agent.predict(p['text'], questions)['answers']
            fh.write(json.dumps(to_row(p['id'], {i: answers[i]['noul'] for i in labeler.INTENTS}), ensure_ascii=False) + '\n')
            if n % 100 == 0:
                print(f'{n}/{len(todo)} {time.time() - start:.0f}s', flush=True)
    digest = lambda f: hashlib.sha256(Path(f).read_bytes()).hexdigest()
    manifest = {'schemaVersion': 1, 'teacher': 'laya-ft', 'modelDir': str(model_dir),
                'weightsSha256': digest(model_dir / 'model.safetensors'), 'questions': labeler.QUESTIONS_VERSION,
                'rows': len(todo), 'split': 'train', 'promptsSha256': digest(data / 'prompts.jsonl'),
                'excludedScoredFrom': PROTECTED, 'outputSha256': digest(out), 'seconds': round(time.time() - start)}
    json.dump(manifest, open(out.with_name(out.stem + '-manifest.json'), 'w'), indent=2)
    print(json.dumps(manifest, indent=2))


if __name__ == '__main__':
    main()
