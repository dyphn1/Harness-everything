#!/usr/bin/env python3
"""Train the System One ngram tier scorer (docs/system-one-training.md, docs/system-one-routing.md "N-gram provider").

Featurization is stdlib-only and must match harness-everything/scripts/system-one/ngram.js exactly
(ci/mechanism-system-one-ngram.test.js compares them). torch is imported only inside train() for the optimizer.
"""
import argparse
import hashlib
import json
import math
from pathlib import Path
import struct
import sys

sys.dont_write_bytecode = True
REPO = Path(__file__).resolve().parents[1]
DEFAULT_HOLDOUT = REPO / 'benchmarks' / 'fixtures' / 'system-one-holdout.json'
INTENT_HOLDOUT = REPO / 'benchmarks' / 'fixtures' / 'system-one-intent-holdout.json'


def fnv1a32(text):
    h = 0x811c9dc5
    for byte in text.encode('utf-8'):
        h ^= byte
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def featurize(text, nmax, dim):
    """bucket -> weight: log(1 + count) per code-point n-gram, one length bucket, L2-normalized."""
    t = ' '.join(text.lower().split())
    counts = {}
    for n in range(1, nmax + 1):
        for i in range(len(t) - n + 1):
            gram = t[i:i + n]
            if not gram.strip():
                continue
            b = fnv1a32(f'{n}:{gram}') % dim
            counts[b] = counts.get(b, 0) + 1
    k = min(8, int(math.floor(math.log2(len(t.encode('utf-8')) + 1))))
    counts[fnv1a32(f'len:{k}') % dim] = 1
    feats = {b: math.log1p(c) for b, c in counts.items()}
    norm = math.sqrt(sum(v * v for v in feats.values()))
    return {b: v / norm for b, v in feats.items()}


def load_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip()]


def sha256_file(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def train(args):
    import torch

    torch.manual_seed(args.seed)
    data = Path(args.data_dir)
    intent = args.task == 'intent'
    scored = args.target == 'scores'
    holdout = args.holdout or (INTENT_HOLDOUT if intent else DEFAULT_HOLDOUT)
    corpus = json.loads(Path(holdout).read_text(encoding='utf-8'))
    catalog = [o['id'] for o in corpus['cases'][0]['request']['options']]
    labels_file = data / ('labels-intent-scores.jsonl' if scored else 'labels-intent.jsonl' if intent else 'labels.jsonl')
    if not labels_file.exists():
        sys.exit(f'missing {labels_file.name}')
    overrides = data / ('owner-overrides-intent.jsonl' if intent else 'owner-overrides.jsonl')
    labeled = load_jsonl(labels_file)
    gold = {r['id']: r['gold'] for r in labeled}
    secondary = {r['id']: r.get('secondary', []) for r in labeled} if intent else {}
    relevance = {r['id']: r['scores'] for r in labeled} if scored else {}
    if overrides.exists():
        for r in load_jsonl(overrides):
            gold[r['id']] = r['gold']
            if intent:
                secondary[r['id']] = r.get('secondary', [])
            if scored:
                # An override without scores counts as 0.6 for its primary and 0.4 for its secondary intents.
                relevance[r['id']] = r.get('scores') or {s: 0.6 if s == r['gold'] else 0.4 for s in [r['gold'], *r.get('secondary', [])] if s is not None}
    excluded = data / 'owner-excluded.jsonl'
    skip = {r['id'] for r in load_jsonl(excluded)} if excluded.exists() else set()
    rows = [p for p in load_jsonl(data / 'prompts.jsonl') if p['id'] in gold and p['id'] not in skip]
    index = lambda g: catalog.index('unclassified' if g is None else g)
    split = {name: [r for r in rows if r['split'] == name] for name in ('train', 'validation')}

    def matrix(items):
        ii, jj, vv = [], [], []
        for r, item in enumerate(items):
            for b, v in featurize(item['text'], args.nmax, args.dim).items():
                ii.append(r); jj.append(b); vv.append(v)
        return torch.sparse_coo_tensor([ii, jj], vv, (len(items), args.dim), dtype=torch.float32).coalesce()

    x_train, x_val = matrix(split['train']), matrix(split['validation'])
    y_train = torch.tensor([index(gold[r['id']]) for r in split['train']])
    # Intent targets are soft: the primary alone gets 1.0; with secondaries it gets 0.6 and they share 0.4.
    target = y_train
    if scored:
        # Scored intent labels: each intent is its own binary target with its relevance score as the soft value.
        target = torch.tensor([[(0.6 if gold[r['id']] is None else 0.0) if c == 'unclassified' else float(relevance[r['id']].get(c, 0.0))
                                for c in catalog] for r in split['train']], dtype=torch.float32)
    elif intent:
        rows_t = []
        for r in split['train']:
            t = [0.0] * len(catalog)
            sec = [s for s in secondary.get(r['id'], []) if s in catalog]
            if gold[r['id']] is None or not sec:
                t[index(gold[r['id']])] = 1.0
            else:
                t[index(gold[r['id']])] = 0.6
                for s in sec:
                    t[catalog.index(s)] += 0.4 / len(sec)
            rows_t.append(t)
        target = torch.tensor(rows_t, dtype=torch.float32)
    # Class mass counts the soft targets, so an intent seen only as secondary still carries weight.
    counts = target.sum(0) if intent or scored else torch.bincount(y_train, minlength=len(catalog)).float()
    inverse = torch.where(counts > 0, counts.sum() / (len(catalog) * counts.clamp_min(1e-6)), torch.zeros_like(counts))
    weight = {'none': None, 'sqrt': inverse.sqrt(), 'full': inverse}[args.balance]
    W = torch.zeros(args.dim, len(catalog), requires_grad=True)
    bias = torch.zeros(len(catalog), requires_grad=True)
    optimizer = torch.optim.Adam([W, bias], lr=args.lr)
    for _ in range(args.epochs):
        optimizer.zero_grad()
        logits = torch.sparse.mm(x_train, W) + bias
        if scored:
            per = torch.nn.functional.binary_cross_entropy_with_logits(logits, target, reduction='none')
            fit = (per * (weight if weight is not None else 1.0)).mean()
        else:
            fit = torch.nn.functional.cross_entropy(logits, target, weight=weight)
        loss = fit + args.weight_decay * (W ** 2).sum()
        loss.backward()
        optimizer.step()
    with torch.no_grad():
        # The provider returns the softmax over the logits for either loss (docs/system-one-training.md).
        probs = torch.softmax(torch.sparse.mm(x_val, W) + bias, 1)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    weights = W.detach().contiguous().view(-1).tolist()
    (out / 'harness-routing-v1.bin').write_bytes(struct.pack(f'<{len(weights)}f', *weights))
    datasets = {name: sha256_file(data / name) for name in ('prompts.jsonl', labels_file.name)}
    if overrides.exists():
        datasets[overrides.name] = sha256_file(overrides)
    sidecar = {'format': 'harness-ngram', 'formatVersion': 1, 'dim': args.dim, 'nmax': args.nmax, 'hash': 'fnv1a32', 'catalog': catalog,
               'bias': [float(v) for v in bias.detach().tolist()],
               'metadata': {'domain': 'harness-routing-v1', 'task': args.task, 'balance': args.balance, 'weightDecay': args.weight_decay, 'epochs': args.epochs,
                            'seed': args.seed, 'datasets': datasets, 'counts': {k: len(v) for k, v in split.items()},
                            **({'target': 'scores', 'loss': 'bce'} if scored else {})}}
    (out / 'harness-routing-v1.json').write_text(json.dumps(sidecar), encoding='utf-8')
    with (out / 'val-scores.jsonl').open('w', encoding='utf-8') as fh:
        for r, p in zip(split['validation'], probs.tolist()):
            row = {'id': r['id'], 'gold': gold[r['id']], 'probs': p}
            if intent:
                row['secondary'] = secondary.get(r['id'], [])
            fh.write(json.dumps(row) + '\n')
    y_val = torch.tensor([index(gold[r['id']]) for r in split['validation']])
    accuracy = (probs.argmax(1) == y_val).float().mean().item() if len(y_val) else 0.0
    print(json.dumps({'counts': sidecar['metadata']['counts'], 'validationAccuracy': accuracy}))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--task', choices=['tier', 'intent'], default='tier')
    parser.add_argument('--target', choices=['label', 'scores'], default='label', help='scores: per-intent relevance targets from labels-intent-scores.jsonl (intent only)')
    parser.add_argument('--holdout', default=None, help='source of the fixed catalog only (defaults to the task holdout); holdout rows are never trained on')
    parser.add_argument('--dim', type=int, default=1 << 16)
    parser.add_argument('--nmax', type=int, default=3)
    parser.add_argument('--balance', choices=['none', 'sqrt', 'full'], default='sqrt')
    parser.add_argument('--weight-decay', type=float, default=1e-4)
    parser.add_argument('--epochs', type=int, default=60)
    parser.add_argument('--lr', type=float, default=0.01)
    parser.add_argument('--seed', type=int, default=7)
    args = parser.parse_args(argv)
    if args.target == 'scores' and args.task != 'intent':
        parser.error('--target scores needs --task intent')
    train(args)


if __name__ == '__main__':
    main()
