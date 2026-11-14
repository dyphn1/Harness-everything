#!/usr/bin/env python3
"""Train the System One harness-routing-v1 scorer (docs/system-one-training.md).

Run with the System One venv Python (torch + pinned cua_s1). Data handling is stdlib-only so it is
tested without torch; torch and cua_s1 are imported only inside train().
"""
import argparse
import hashlib
import json
from pathlib import Path
import random
import sys

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[1]
DEFAULT_HOLDOUT = REPO / 'benchmarks' / 'fixtures' / 'system-one-holdout.json'
DEFAULT_INTENT_HOLDOUT = REPO / 'benchmarks' / 'fixtures' / 'system-one-intent-holdout.json'
TIER_IDS = ('tier1', 'tier2', 'tier3')


def load_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip()]


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def catalog_from_holdout(path):
    """Read the fixed option catalog from the evaluation corpus."""
    corpus = json.loads(Path(path).read_text(encoding='utf-8'))
    return [{'id': o['id'], 'text': o['text']} for o in corpus['cases'][0]['request']['options']]


def catalog_for(task, holdout=None):
    if task == 'validity':
        return [{'id': 'invalid', 'text': 'Needs previous conversation context to understand; the current text alone is insufficient.'}]
    if task not in ('intent', 'tier'):
        raise ValueError(f'unknown task: {task!r}')
    path = holdout or (DEFAULT_INTENT_HOLDOUT if task == 'intent' else DEFAULT_HOLDOUT)
    catalog = catalog_from_holdout(path)
    if task == 'tier':
        catalog = [option for option in catalog if option['id'] in TIER_IDS]
        if tuple(option['id'] for option in catalog) != TIER_IDS:
            raise ValueError('tier holdout must define tier1, tier2, and tier3')
    return catalog


def join(prompts, labels):
    """Join prompt text to its label row; duplicate label ids are an error."""
    by_id = {}
    for row in labels:
        if row['id'] in by_id:
            raise ValueError(f'duplicate label for {row["id"]}')
        by_id[row['id']] = row
    return [{**p, **by_id[p['id']]} for p in prompts if p['id'] in by_id]


def eligible_rows(rows, task):
    return rows if task == 'validity' else [row for row in rows if row['gold'] is not None]


def build_targets(row, catalog, task, target='label'):
    ids = [option['id'] for option in catalog]
    if task == 'validity':
        if row['gold'] is not None and row['gold'] not in TIER_IDS:
            raise ValueError(f'unknown tier gold label: {row["gold"]!r}')
        return [float(row['gold'] is None)]
    if row['gold'] is None:
        raise ValueError(f'null gold is not eligible for {task}')
    if task == 'tier':
        if row['gold'] not in ids:
            raise ValueError(f'unknown gold label: {row["gold"]!r}')
        return [float(option == row['gold']) for option in ids]
    if task != 'intent':
        raise ValueError(f'unknown task: {task!r}')
    if target == 'scores':
        scores = row.get('scores') or {}
        values = [float(scores.get(option, 0.0)) for option in ids]
        if any(not 0.0 <= value <= 1.0 for value in values):
            raise ValueError('intent scores must be between 0 and 1')
        return values
    if target != 'label':
        raise ValueError(f'unknown target: {target!r}')
    positive = {row['gold'], *row.get('secondary', [])}
    if not positive.issubset(ids):
        raise ValueError(f'unknown intent label: {sorted(positive - set(ids))!r}')
    return [float(option in positive) for option in ids]


def target_gold(row, task):
    return ('invalid' if row['gold'] is None else 'actionable') if task == 'validity' else row['gold']


def validation_record(row, catalog, probabilities, task):
    return {'id': row['id'], 'gold': target_gold(row, task),
            'scores': dict(zip((option['id'] for option in catalog), probabilities))}


def make_batches(lengths, token_budget):
    """Length-bucketed batches: each batch's size times its longest item stays within the budget."""
    order = sorted(range(len(lengths)), key=lambda i: (lengths[i], i))
    batches, current, longest = [], [], 0
    for i in order:
        longest_if_added = max(longest, lengths[i])
        if current and (len(current) + 1) * longest_if_added > token_budget:
            batches.append(current)
            current, longest_if_added = [], lengths[i]
        current.append(i)
        longest = longest_if_added
    if current:
        batches.append(current)
    return batches


def train(args):
    import torch
    from cua_s1.model import ChoiceExample, make_system, save_checkpoint

    random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, args.threads))
    data_dir = Path(args.data_dir)
    catalog = catalog_for(args.task, args.holdout)
    labels_file = ('labels-intent-scores.jsonl' if args.target == 'scores' else 'labels-intent.jsonl') \
        if args.task == 'intent' else 'labels.jsonl'
    examples = eligible_rows(join(load_jsonl(data_dir / 'prompts.jsonl'), load_jsonl(data_dir / labels_file)), args.task)
    options = tuple(o['text'] for o in catalog)
    split = {name: [e for e in examples if e['split'] == name] for name in ('train', 'validation')}
    config = {'encoder': 'tinyx', 'width': 128, 'rank': 128, 'layers': 2, 'heads': 4, 'dropout': 0.1,
              'context_tokens': args.context_tokens, 'option_tokens': 96}
    model, collator = make_system(config, 'cpu')

    def to_examples(rows):
        examples = []
        for row in rows:
            targets = build_targets(row, catalog, args.task, args.target)
            examples.append(ChoiceExample(context=row['text'], options=options, label=targets.index(max(targets))))
        return examples

    def lengths(rows):
        return [min(len(r['text'].encode('utf-8')), args.context_tokens) or 1 for r in rows]

    train_x, val_x = to_examples(split['train']), to_examples(split['validation'])
    train_targets = torch.tensor([build_targets(r, catalog, args.task, args.target) for r in split['train']], dtype=torch.float)
    val_targets = torch.tensor([build_targets(r, catalog, args.task, args.target) for r in split['validation']], dtype=torch.float)
    train_batches = make_batches(lengths(split['train']), args.token_budget)
    val_batches = make_batches(lengths(split['validation']), args.token_budget)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)

    def evaluate():
        model.eval()
        nll, correct, probs = 0.0, 0, [None] * len(val_x)
        with torch.inference_mode():
            for batch in val_batches:
                tensors = collator([val_x[i] for i in batch])
                logits = model(tensors)
                targets = val_targets[batch]
                nll += torch.nn.functional.binary_cross_entropy_with_logits(logits, targets, reduction='sum').item()
                p = logits.sigmoid()
                correct += ((p >= 0.5) == targets.bool()).all(dim=-1).sum().item()
                for row, i in enumerate(batch):
                    probs[i] = p[row].tolist()
        n = max(1, len(val_x))
        return {'nll': nll / n, 'accuracy': correct / n}, probs

    history, best = [], None
    for epoch in range(1, args.epochs + 1):
        model.train()
        order = list(range(len(train_batches)))
        random.shuffle(order)
        total = 0.0
        for b in order:
            batch = train_batches[b]
            tensors = collator([train_x[i] for i in batch])
            loss = torch.nn.functional.binary_cross_entropy_with_logits(model(tensors), train_targets[batch])
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total += loss.item() * len(batch)
        metrics, probs = evaluate()
        history.append({'epoch': epoch, 'trainLoss': total / max(1, len(train_x)), **metrics})
        print(json.dumps(history[-1]), flush=True)
        if best is None or metrics['nll'] < best['metrics']['nll']:
            best = {'epoch': epoch, 'metrics': metrics, 'scores': probs,
                    'state': {k: v.detach().clone() for k, v in model.state_dict().items()}}

    model.load_state_dict(best['state'])
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    datasets = {name: sha256_file(data_dir / name) for name in ('prompts.jsonl', labels_file)}
    metadata = {'domain': 'harness-routing-v1', 'bestEpoch': best['epoch'], 'validation': best['metrics'],
                'datasets': datasets, 'seed': args.seed, 'catalog': [o['id'] for o in catalog],
                'task': args.task, 'target': args.target, 'loss': 'binary_cross_entropy'}
    save_checkpoint(out / 'harness-routing-v1.safetensors', model, config, metadata)
    with (out / 'val-scores.jsonl').open('w', encoding='utf-8') as fh:
        for row, scores in zip(split['validation'], best['scores']):
            fh.write(json.dumps(validation_record(row, catalog, scores, args.task)) + '\n')
    counts = {name: len(rows) for name, rows in split.items()}
    report = {'schemaVersion': 1, 'config': config, 'counts': counts, 'bestEpoch': best['epoch'], 'history': history,
              'datasets': datasets, 'seed': args.seed, 'task': args.task, 'target': args.target}
    (out / 'train-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'counts': counts, 'bestEpoch': best['epoch'], 'validation': best['metrics']}))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--holdout', help='fixed option catalog source (defaults to the task holdout)')
    parser.add_argument('--epochs', type=int, default=12)
    parser.add_argument('--lr', type=float, default=1e-3)
    parser.add_argument('--seed', type=int, default=7)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--context-tokens', type=int, default=1024)
    parser.add_argument('--token-budget', type=int, default=16384)
    parser.add_argument('--task', choices=['validity', 'intent', 'tier'], default='tier')
    parser.add_argument('--target', choices=['label', 'scores'], default='label',
                        help='scores: per-intent soft labels from labels-intent-scores.jsonl (intent only)')
    args = parser.parse_args(argv)
    if args.target == 'scores' and args.task != 'intent':
        parser.error('--target scores needs --task intent')
    train(args)


if __name__ == '__main__':
    main()
