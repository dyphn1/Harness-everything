#!/usr/bin/env python3
"""Train the System One harness-routing-v1 tier scorer (docs/system-one-training.md).

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


def load_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip()]


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def catalog_from_holdout(path):
    """The fixed tier catalog, taken from the evaluation corpus so training and inference match."""
    corpus = json.loads(Path(path).read_text(encoding='utf-8'))
    return [{'id': o['id'], 'text': o['text']} for o in corpus['cases'][0]['request']['options']]


def label_index(gold, catalog):
    target = 'unclassified' if gold is None else gold
    for i, option in enumerate(catalog):
        if option['id'] == target:
            return i
    raise ValueError(f'unknown gold label: {gold!r}')


def join(prompts, labels, overrides):
    """Labeled examples in prompt order; owner overrides replace LLM labels; duplicates are an error."""
    gold = {}
    for row in labels:
        if row['id'] in gold:
            raise ValueError(f'duplicate label for {row["id"]}')
        gold[row['id']] = row['gold']
    for row in overrides:
        gold[row['id']] = row['gold']
    return [{'id': p['id'], 'split': p['split'], 'text': p['text'], 'gold': gold[p['id']]} for p in prompts if p['id'] in gold]


def class_weights(label_indices, num_classes):
    """Inverse-frequency weights that average to 1 over the examples; absent classes get 0."""
    counts = [0] * num_classes
    for i in label_indices:
        counts[i] += 1
    present = sum(1 for c in counts if c)
    total = len(label_indices)
    return [total / (present * c) if c else 0.0 for c in counts]


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
    catalog = catalog_from_holdout(args.holdout)
    overrides_path = data_dir / 'owner-overrides.jsonl'
    examples = join(load_jsonl(data_dir / 'prompts.jsonl'), load_jsonl(data_dir / 'labels.jsonl'),
                    load_jsonl(overrides_path) if overrides_path.exists() else [])
    options = tuple(o['text'] for o in catalog)
    split = {name: [e for e in examples if e['split'] == name] for name in ('train', 'validation')}
    config = {'encoder': 'tinyx', 'width': 128, 'rank': 128, 'layers': 2, 'heads': 4, 'dropout': 0.1,
              'context_tokens': args.context_tokens, 'option_tokens': 96}
    model, collator = make_system(config, 'cpu')

    def to_examples(rows):
        return [ChoiceExample(context=r['text'], options=options, label=label_index(r['gold'], catalog)) for r in rows]

    def lengths(rows):
        return [min(len(r['text'].encode('utf-8')), args.context_tokens) or 1 for r in rows]

    train_x, val_x = to_examples(split['train']), to_examples(split['validation'])
    train_batches = make_batches(lengths(split['train']), args.token_budget)
    val_batches = make_batches(lengths(split['validation']), args.token_budget)
    optimizer = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
    # Class balance counters the tier2-heavy labels; validation NLL stays unweighted so epochs remain comparable.
    weight = torch.tensor(class_weights([e.label for e in train_x], len(catalog)), dtype=torch.float) if args.balance else None

    def evaluate():
        model.eval()
        nll, correct, probs = 0.0, 0, [None] * len(val_x)
        with torch.inference_mode():
            for batch in val_batches:
                tensors = collator([val_x[i] for i in batch])
                logits = model(tensors)
                nll += torch.nn.functional.cross_entropy(logits, tensors['labels'], reduction='sum').item()
                p = logits.softmax(-1)
                correct += (p.argmax(-1) == tensors['labels']).sum().item()
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
            tensors = collator([train_x[i] for i in train_batches[b]])
            loss = torch.nn.functional.cross_entropy(model(tensors), tensors['labels'], weight=weight)
            optimizer.zero_grad()
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            optimizer.step()
            total += loss.item() * len(train_batches[b])
        metrics, probs = evaluate()
        history.append({'epoch': epoch, 'trainLoss': total / max(1, len(train_x)), **metrics})
        print(json.dumps(history[-1]), flush=True)
        if best is None or metrics['nll'] < best['metrics']['nll']:
            best = {'epoch': epoch, 'metrics': metrics, 'probs': probs,
                    'state': {k: v.detach().clone() for k, v in model.state_dict().items()}}

    model.load_state_dict(best['state'])
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    datasets = {name: sha256_file(data_dir / name) for name in ('prompts.jsonl', 'labels.jsonl')}
    if overrides_path.exists():
        datasets['owner-overrides.jsonl'] = sha256_file(overrides_path)
    metadata = {'domain': 'harness-routing-v1', 'bestEpoch': best['epoch'], 'validation': best['metrics'],
                'datasets': datasets, 'seed': args.seed, 'catalog': [o['id'] for o in catalog]}
    save_checkpoint(out / 'harness-routing-v1.safetensors', model, config, metadata)
    with (out / 'val-scores.jsonl').open('w', encoding='utf-8') as fh:
        for row, p in zip(split['validation'], best['probs']):
            fh.write(json.dumps({'id': row['id'], 'gold': row['gold'], 'probs': p}) + '\n')
    counts = {name: len(rows) for name, rows in split.items()}
    report = {'schemaVersion': 1, 'config': config, 'counts': counts, 'bestEpoch': best['epoch'], 'history': history,
              'datasets': datasets, 'seed': args.seed}
    (out / 'train-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'counts': counts, 'bestEpoch': best['epoch'], 'validation': best['metrics']}))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--holdout', default=str(DEFAULT_HOLDOUT))
    parser.add_argument('--epochs', type=int, default=12)
    parser.add_argument('--lr', type=float, default=1e-3)
    parser.add_argument('--seed', type=int, default=7)
    parser.add_argument('--threads', type=int, default=4)
    parser.add_argument('--context-tokens', type=int, default=1024)
    parser.add_argument('--token-budget', type=int, default=16384)
    parser.add_argument('--balance', action='store_true', help='inverse-frequency class weights in the training loss')
    train(parser.parse_args(argv))


if __name__ == '__main__':
    main()
