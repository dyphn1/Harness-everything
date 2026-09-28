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
    corpus = json.loads(Path(args.holdout).read_text(encoding='utf-8'))
    catalog = [o['id'] for o in corpus['cases'][0]['request']['options']]
    gold = {r['id']: r['gold'] for r in load_jsonl(data / 'labels.jsonl')}
    overrides = data / 'owner-overrides.jsonl'
    if overrides.exists():
        gold.update({r['id']: r['gold'] for r in load_jsonl(overrides)})
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
    counts = torch.bincount(y_train, minlength=len(catalog)).float()
    inverse = torch.where(counts > 0, counts.sum() / (len(catalog) * counts.clamp_min(1)), torch.zeros_like(counts))
    weight = {'none': None, 'sqrt': inverse.sqrt(), 'full': inverse}[args.balance]
    W = torch.zeros(args.dim, len(catalog), requires_grad=True)
    bias = torch.zeros(len(catalog), requires_grad=True)
    optimizer = torch.optim.Adam([W, bias], lr=args.lr)
    for _ in range(args.epochs):
        optimizer.zero_grad()
        loss = torch.nn.functional.cross_entropy(torch.sparse.mm(x_train, W) + bias, y_train, weight=weight) + args.weight_decay * (W ** 2).sum()
        loss.backward()
        optimizer.step()
    with torch.no_grad():
        probs = torch.softmax(torch.sparse.mm(x_val, W) + bias, 1)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    weights = W.detach().contiguous().view(-1).tolist()
    (out / 'harness-routing-v1.bin').write_bytes(struct.pack(f'<{len(weights)}f', *weights))
    datasets = {name: sha256_file(data / name) for name in ('prompts.jsonl', 'labels.jsonl')}
    if overrides.exists():
        datasets['owner-overrides.jsonl'] = sha256_file(overrides)
    sidecar = {'format': 'harness-ngram', 'formatVersion': 1, 'dim': args.dim, 'nmax': args.nmax, 'hash': 'fnv1a32', 'catalog': catalog,
               'bias': [float(v) for v in bias.detach().tolist()],
               'metadata': {'domain': 'harness-routing-v1', 'balance': args.balance, 'weightDecay': args.weight_decay, 'epochs': args.epochs,
                            'seed': args.seed, 'datasets': datasets, 'counts': {k: len(v) for k, v in split.items()}}}
    (out / 'harness-routing-v1.json').write_text(json.dumps(sidecar), encoding='utf-8')
    with (out / 'val-scores.jsonl').open('w', encoding='utf-8') as fh:
        for r, p in zip(split['validation'], probs.tolist()):
            fh.write(json.dumps({'id': r['id'], 'gold': gold[r['id']], 'probs': p}) + '\n')
    y_val = torch.tensor([index(gold[r['id']]) for r in split['validation']])
    accuracy = (probs.argmax(1) == y_val).float().mean().item() if len(y_val) else 0.0
    print(json.dumps({'counts': sidecar['metadata']['counts'], 'validationAccuracy': accuracy}))


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--holdout', default=str(DEFAULT_HOLDOUT), help='source of the fixed catalog only; holdout rows are never trained on')
    parser.add_argument('--dim', type=int, default=1 << 16)
    parser.add_argument('--nmax', type=int, default=3)
    parser.add_argument('--balance', choices=['none', 'sqrt', 'full'], default='sqrt')
    parser.add_argument('--weight-decay', type=float, default=1e-4)
    parser.add_argument('--epochs', type=int, default=60)
    parser.add_argument('--lr', type=float, default=0.01)
    parser.add_argument('--seed', type=int, default=7)
    train(parser.parse_args(argv))


if __name__ == '__main__':
    main()
