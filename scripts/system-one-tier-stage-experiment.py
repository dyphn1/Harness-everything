#!/usr/bin/env python3
"""Stage 2 of the noise-gate plan for #233: tier scoring on valid prompts only.

The validity stage (scripts/system-one-noise-experiment.py) hands invalid
prompts to the host agent, so the tier scorer only has to separate tier1,
tier2 and tier3 on prompts whose text carries the request. Three independent
per-tier sigmoids (BCE); a pick is the highest tier at or above 0.5, else
abstain.

Variants, every one scored on the same fixed validation split:
  valid-only   train on valid rows only
  curriculum   valid rows first, then invalid rows (all-zero targets) added in
               stages, so the final model also scores invalid prompts low
  mixed        all rows at once from scratch (invalid rows all-zero)
The holdout is never read. Metrics and labels are stdlib-only.
"""
import argparse
import json
import math
from pathlib import Path
import random
import sys
import time

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
noise = __import__('system-one-noise-experiment')
TIERS = ('tier1', 'tier2', 'tier3')
OPTIONS = (
    'tier1: Git operation, status check, lookup, report or direct answer; no code change',
    'tier2: bounded code, config or docs change in one tool; run tests; most bug fixes',
    'tier3: behavior change with tests, cross-repo or cross-component work, refactor, redefinition',
)


def tier_rows(prompts, tier_labels, excluded, rules=2):
    """Noise-gate rows plus tier targets: one-hot for valid rows, all-zero for invalid ones."""
    out = []
    for r in noise.label_rows(prompts, tier_labels, excluded, rules=rules):
        valid = r['bucket'] in ('tier-long', 'tier-short')
        targets = [1.0 if valid and r['tier'] == t else 0.0 for t in TIERS]
        out.append({**r, 'valid': valid, 'tierTargets': targets})
    return out


def pick(probs, tau=0.5):
    """Highest tier at or above tau, else None (abstain)."""
    best = max(range(len(probs)), key=lambda k: probs[k])
    return best if probs[best] >= tau else None


def tier_metrics(rows, probs, tau=0.5, confident=0.8):
    valid = [(r, p) for r, p in zip(rows, probs) if r['valid']]
    invalid = [p for r, p in zip(rows, probs) if not r['valid']]
    picks = [(TIERS.index(r['tier']), pick(p, tau), max(p)) for r, p in valid]
    made = [(g, k, m) for g, k, m in picks if k is not None]
    conf = [(g, k) for g, k, m in made if m >= confident]
    out = {
        'validRows': len(valid), 'invalidRows': len(invalid),
        'coverage': len(made) / max(1, len(valid)),
        'exactPrecision': sum(1 for g, k, _ in made if k == g) / max(1, len(made)),
        'acceptablePrecision': sum(1 for g, k, _ in made if k in (g, g + 1)) / max(1, len(made)),
        'underRate': sum(1 for g, k, _ in made if k < g) / max(1, len(made)),
        'confidentCoverage': len(conf) / max(1, len(valid)),
        'confidentAcceptablePrecision': sum(1 for g, k in conf if k in (g, g + 1)) / max(1, len(conf)),
        'invalidAbstainRate': sum(1 for p in invalid if max(p) < tau) / max(1, len(invalid)),
        'invalidMeanMaxScore': sum(max(p) for p in invalid) / max(1, len(invalid)),
        'perTier': {},
    }
    for k, t in enumerate(TIERS):
        scores = [p[k] for _, p in valid]
        labels = [r['tier'] == t for r, _ in valid]
        tp = sum(1 for g, kk, _ in made if kk == k and g == k)
        out['perTier'][t] = {'support': sum(labels), 'auroc': noise.auroc(scores, labels),
                             'precision': tp / max(1, sum(1 for _, kk, _ in made if kk == k)),
                             'recall': tp / max(1, sum(labels))}
    return out


def run(args):
    import torch
    from cua_s1.model import ChoiceExample, make_system
    trainer = __import__('system-one-train')
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, args.threads))
    data = Path(args.data_dir)
    tiers = {r['id']: r['gold'] for r in trainer.load_jsonl(data / 'labels.jsonl')}
    for r in trainer.load_jsonl(data / 'owner-overrides.jsonl'):
        tiers[r['id']] = r['gold']
    excluded = {r['id'] for r in trainer.load_jsonl(data / 'owner-excluded.jsonl')}
    rows = tier_rows(trainer.load_jsonl(data / 'prompts.jsonl'), tiers, excluded)
    train_rows = [r for r in rows if r['split'] == 'train']
    val_rows = [r for r in rows if r['split'] == 'validation']
    config = {'encoder': 'tinyx', 'width': args.width, 'rank': args.width, 'layers': args.layers, 'heads': 4,
              'dropout': 0.1, 'context_tokens': 1024, 'option_tokens': 96}

    def lengths(rs):
        return [min(len(r['text'].encode('utf-8')), 1024) or 1 for r in rs]

    def score(model, collator, rs):
        model.eval()
        xs = [ChoiceExample(context=r['text'], options=OPTIONS, label=0) for r in rs]
        probs = [None] * len(rs)
        with torch.no_grad():
            for batch in trainer.make_batches(lengths(rs), args.token_budget):
                p = model(collator([xs[i] for i in batch])).sigmoid()
                for k, i in enumerate(batch):
                    probs[i] = p[k].tolist()
        return probs

    def fit(model, collator, rs, epochs, label):
        opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
        xs = [ChoiceExample(context=r['text'], options=OPTIONS, label=0) for r in rs]
        tg = torch.tensor([r['tierTargets'] for r in rs])
        batches = trainer.make_batches(lengths(rs), args.token_budget)
        for epoch in range(epochs):
            model.train()
            random.shuffle(batches)
            total = 0.0
            for b in batches:
                loss = torch.nn.functional.binary_cross_entropy_with_logits(model(collator([xs[i] for i in b])), tg[b])
                opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step()
                total += loss.item() * len(b)
            print(f'  [{label}] epoch {epoch + 1}/{epochs} loss {total / max(1, len(rs)):.4f}', flush=True)

    rounds = []
    val_probs = {}

    def record(name, model, collator, n):
        probs = score(model, collator, val_rows)
        val_probs[name] = {r['id']: p for r, p in zip(val_rows, probs)}
        m = tier_metrics(val_rows, probs)
        rounds.append({'round': name, 'trainRows': n, 'validation': m})
        print(f"{name}: train={n} cov={m['coverage']:.3f} acc={m['acceptablePrecision']:.3f} exact={m['exactPrecision']:.3f} "
              f"under={m['underRate']:.3f} confCov={m['confidentCoverage']:.3f} invAbstain={m['invalidAbstainRate']:.3f}", flush=True)

    valid_train = [r for r in train_rows if r['valid']]
    invalid_train = [r for r in train_rows if not r['valid']]
    total_epochs = args.base_epochs + args.stages * args.stage_epochs

    torch.manual_seed(args.seed)
    model, collator = make_system(config, 'cpu')
    fit(model, collator, valid_train, args.base_epochs, 'valid-only')
    record('valid-only', model, collator, len(valid_train))
    current = list(valid_train)
    random.shuffle(invalid_train)
    step = math.ceil(len(invalid_train) / args.stages)
    for k in range(args.stages):
        current += invalid_train[k * step:(k + 1) * step]
        fit(model, collator, current, args.stage_epochs, f'curriculum {k + 1}')
        record(f'curriculum-{k + 1}of{args.stages}', model, collator, len(current))

    torch.manual_seed(args.seed)
    valid_long, vc = make_system(config, 'cpu')
    fit(valid_long, vc, valid_train, total_epochs, 'valid-only-long')
    record('valid-only-same-epochs', valid_long, vc, len(valid_train))

    torch.manual_seed(args.seed)
    mixed, mc = make_system(config, 'cpu')
    fit(mixed, mc, train_rows, total_epochs, 'mixed')
    record('mixed-all-at-once', mixed, mc, len(train_rows))

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    json.dump({'schemaVersion': 1, 'config': config, 'options': list(TIERS),
               'args': {k: v for k, v in vars(args).items() if k not in ('data_dir', 'out')},
               'counts': {'trainValid': len(valid_train), 'trainInvalid': len(invalid_train),
                          'validationValid': sum(r['valid'] for r in val_rows),
                          'validationInvalid': sum(not r['valid'] for r in val_rows)},
               'rounds': rounds}, open(out / 'report.json', 'w'), indent=2)
    # Per-row validation scores keyed by prompt id, for the end-to-end evaluation; private runs dir only.
    json.dump(val_probs, open(out / 'val-probs-private.json', 'w'))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--data-dir', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--threads', type=int, default=8)
    ap.add_argument('--width', type=int, default=128)
    ap.add_argument('--layers', type=int, default=2)
    ap.add_argument('--token-budget', type=int, default=16384)
    ap.add_argument('--lr', type=float, default=1e-3)
    ap.add_argument('--base-epochs', type=int, default=6)
    ap.add_argument('--stages', type=int, default=3)
    ap.add_argument('--stage-epochs', type=int, default=3)
    run(ap.parse_args(argv))


if __name__ == '__main__':
    main()
