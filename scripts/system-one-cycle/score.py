#!/usr/bin/env python3
"""Write per-option sigmoid scores for a fixed System One holdout.

Options come from the same catalog the trainer built for the task (scripts/system-one-train.py) and are
ordered by the version manifest, so the score keys match what the stage was trained on. The fixture
supplies only request.context and the gold label. A holdout case whose gold is not a catalog id (for
example a tier case with no tier) is skipped and counted in the printed `skipped` field.
"""

import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

sys.dont_write_bytecode = True


def validate_manifest(manifest):
    node = os.environ.get('HARNESS_SYSTEM_ONE_NODE') or shutil.which('node')
    validator = Path(__file__).resolve().parents[2] / 'harness-everything' / 'scripts' / 'system-one' / 'manifest.js'
    if not node:
        raise ValueError('version manifest is invalid')
    try:
        result = subprocess.run([node, str(validator)], input=json.dumps(manifest), text=True,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5,
                                shell=False, check=False)
    except (OSError, subprocess.SubprocessError):
        raise ValueError('version manifest is invalid') from None
    if result.returncode != 0:
        raise ValueError('version manifest is invalid')


def trained_catalog(weights, task, holdout):
    """Option id/text pairs the stage was trained on, in the version manifest's option order."""
    trainer_path = Path(__file__).resolve().parents[2] / 'scripts' / 'system-one-train.py'
    spec = importlib.util.spec_from_file_location('system_one_train', trainer_path)
    trainer = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(trainer)
    texts = {option['id']: option['text'] for option in trainer.catalog_for(task, holdout)}
    manifest = json.loads((Path(weights).parent / 'manifest.json').read_text(encoding='utf-8'))
    validate_manifest(manifest)
    ids = manifest['stages'][task]['options']
    missing = [option_id for option_id in ids if option_id not in texts]
    if missing:
        raise ValueError(f'{task} manifest options are not in the trained catalog: {missing!r}')
    return [{'id': option_id, 'text': texts[option_id]} for option_id in ids]


def eligible(case, task, ids):
    """A case is scored when its gold label is a catalog id; validity always scores."""
    if task == 'validity':
        return True
    gold = case.get('gold')
    labels = gold if isinstance(gold, list) else [gold]
    return bool(labels) and all(label in ids for label in labels)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--weights', required=True)
    parser.add_argument('--holdout', required=True)
    parser.add_argument('--task', choices=['validity', 'intent', 'tier'], required=True)
    parser.add_argument('--out', required=True)
    args = parser.parse_args()

    import torch
    from cua_s1.model import ChoiceExample, load_checkpoint

    torch.set_num_threads(1)
    torch.use_deterministic_algorithms(True)
    model, collator, _ = load_checkpoint(args.weights, 'cpu')
    model.eval()
    catalog = trained_catalog(args.weights, args.task, args.holdout)
    ids = {option['id'] for option in catalog}
    options = tuple(option['text'] for option in catalog)

    corpus = json.loads(Path(args.holdout).read_text(encoding='utf-8'))
    cases = [case for case in corpus.get('cases', []) if case.get('split') == 'holdout']
    if not cases:
        raise ValueError('holdout has no holdout cases')
    scored = [case for case in cases if eligible(case, args.task, ids)]
    skipped = len(cases) - len(scored)
    rows = []
    with torch.inference_mode():
        for start in range(0, len(scored), 32):
            batch = scored[start:start + 32]
            examples = []
            for case in batch:
                request = case.get('request', {})
                if not isinstance(request.get('context'), str):
                    raise ValueError('holdout case has no request.context')
                examples.append(ChoiceExample(context=request['context'], options=options, label=0))
            scores = model(collator(examples)).sigmoid().tolist()
            for case, values in zip(batch, scores, strict=True):
                gold = ('invalid' if case['gold'] is None else 'actionable') if args.task == 'validity' else case['gold']
                rows.append({'id': case['id'], 'gold': gold, 'scores': {option['id']: value for option, value in zip(catalog, values, strict=True)}})

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(''.join(json.dumps(row, separators=(',', ':')) + '\n' for row in rows), encoding='utf-8')
    if os.name != 'nt': output.chmod(0o600)
    print(json.dumps({'task': args.task, 'rows': len(rows), 'skipped': skipped}))


if __name__ == '__main__':
    main()
