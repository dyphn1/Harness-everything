#!/usr/bin/env python3
"""Write per-option sigmoid scores for a fixed System One holdout."""

import argparse
import json
import os
from pathlib import Path
import sys

sys.dont_write_bytecode = True
INVALID_OPTION = {'id': 'invalid', 'text': 'Needs previous conversation context to understand; the current text alone is insufficient.'}


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
    corpus = json.loads(Path(args.holdout).read_text(encoding='utf-8'))
    cases = [case for case in corpus.get('cases', []) if case.get('split') == 'holdout']
    if not cases:
        raise ValueError('holdout has no holdout cases')
    rows = []
    with torch.inference_mode():
        for start in range(0, len(cases), 32):
            batch = cases[start:start + 32]
            examples = []
            for case in batch:
                request = case.get('request', {})
                if not isinstance(request.get('context'), str):
                    raise ValueError('holdout case has no request.context')
                options = [INVALID_OPTION] if args.task == 'validity' else request.get('options')
                if not isinstance(options, list) or not options:
                    raise ValueError('holdout case has no options')
                examples.append(ChoiceExample(context=request['context'], options=tuple(option['text'] for option in options), label=0))
            scores = model(collator(examples)).sigmoid().tolist()
            for case, options, values in zip(batch, ([INVALID_OPTION] if args.task == 'validity' else c['request']['options'] for c in batch), scores, strict=True):
                gold = ('invalid' if case['gold'] is None else 'actionable') if args.task == 'validity' else case['gold']
                rows.append({'id': case['id'], 'gold': gold, 'scores': {option['id']: value for option, value in zip(options, values, strict=True)}})

    output = Path(args.out)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(''.join(json.dumps(row, separators=(',', ':')) + '\n' for row in rows), encoding='utf-8')
    if os.name != 'nt': output.chmod(0o600)
    print(json.dumps({'task': args.task, 'rows': len(rows)}))


if __name__ == '__main__':
    main()
