#!/usr/bin/env python3
"""Intent-stage improvement experiment for #233 (feeds the tier3 composition).

CUA-S1 tinyx scores the 12 intents with independent sigmoids trained on the
teacher's dense relevance scores (labels-intent-scores.jsonl), as in PR #264.
Variants, same seeds and epoch budget:

  all          every scored row (the #264 baseline setup)
  valid-only   drop rows the validity stage calls invalid; their intent scores
               were given with session context the model never sees
  staged       valid rows first, then invalid rows with all-zero targets
  valid-large  valid-only with a wider, deeper encoder

Evaluation on validation rows with teacher scores, thresholds fit per intent
by 2-fold cross-validation (never in-sample): micro-F1 against teacher >= 0.4,
feature/refactor precision and recall, and the downstream composed tier
(tier3 when feature or refactor fires, else the old-rules tier model). The
holdout is never read.
"""
import argparse
import json
from pathlib import Path
import random
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
noise = __import__('system-one-noise-experiment')
tier_exp = __import__('system-one-tier-stage-experiment')
CATALOG = ('explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor', 'review', 'test', 'docs', 'plan',
           'investigate')
BAND = 0.4
INVALID_BUCKETS = ('rule-continuation', 'rule-no-request', 'owner-invalid', 'null-unruled')


def fit_tau(scores, truth, grid=tuple(i / 20 for i in range(1, 20))):
    """Threshold with the best F1 for one intent; among ties, the median of the tied thresholds."""
    f1s = []
    for t in grid:
        tp = sum(1 for s, y in zip(scores, truth) if s >= t and y)
        fp = sum(1 for s, y in zip(scores, truth) if s >= t and not y)
        fn = sum(1 for s, y in zip(scores, truth) if s < t and y)
        f1s.append(2 * tp / max(1, 2 * tp + fp + fn))
    best = [t for t, f in zip(grid, f1s) if f == max(f1s)]
    return best[len(best) // 2]


def cv_taus(ids, probs, truth, folds=2):
    """Per-row thresholds: each row gets taus fit on the other fold (split by position in sorted ids)."""
    order = sorted(ids)
    fold = {i: k % folds for k, i in enumerate(order)}
    out = {}
    for f in range(folds):
        train = [i for i in ids if fold[i] != f]
        taus = {c: fit_tau([probs[i][k] for i in train], [truth[i][k] for i in train]) for k, c in enumerate(CATALOG)}
        for i in ids:
            if fold[i] == f:
                out[i] = taus
    return out


def intent_metrics(ids, probs, truth, taus):
    tp = fp = fn = 0
    per = {c: [0, 0, 0] for c in CATALOG}
    for i in ids:
        for k, c in enumerate(CATALOG):
            fired, y = probs[i][k] >= taus[i][c], truth[i][k]
            tp += fired and y
            fp += fired and not y
            fn += (not fired) and y
            per[c][0] += fired and y
            per[c][1] += fired and not y
            per[c][2] += (not fired) and y
    out = {'rows': len(ids), 'microF1': 2 * tp / max(1, 2 * tp + fp + fn), 'precision': tp / max(1, tp + fp),
           'recall': tp / max(1, tp + fn), 'meanFires': (tp + fp) / max(1, len(ids))}
    for c in ('feature', 'refactor'):
        a, b, d = per[c]
        out[c] = {'precision': a / max(1, a + b), 'recall': a / max(1, a + d), 'support': a + d}
    return out


def run(args):
    import torch
    from cua_s1.model import ChoiceExample, make_system, save_checkpoint
    trainer = __import__('system-one-train')
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.set_num_threads(max(1, args.threads))
    data = Path(args.data_dir)
    load = trainer.load_jsonl
    tiers = {r['id']: r['gold'] for r in load(data / 'labels.jsonl')}
    for r in load(data / 'owner-overrides.jsonl'):
        tiers[r['id']] = r['gold']
    excluded = {r['id'] for r in load(data / 'owner-excluded.jsonl')}
    prompts = load(data / 'prompts.jsonl')
    validity = noise.load_owner_validity(args.owner_validity)
    buckets = {r['id']: r['bucket'] for r in noise.label_rows(prompts, tiers, excluded, rules=2, owner_validity=validity)}
    scores = {r['id']: r.get('scores', {}) for r in load(data / 'labels-intent-scores.jsonl')}
    source = {i: 'sonnet' for i in scores}
    if args.extra_teacher:
        for r in load(Path(args.extra_teacher)):
            if r['id'] not in scores:
                scores[r['id']], source[r['id']] = r.get('scores', {}), 'laya'
    rows = [{'id': p['id'], 'split': p['split'], 'text': p['text'], 'teacher': source[p['id']],
             'targets': [float(scores[p['id']].get(c, 0.0)) for c in CATALOG],
             'invalid': buckets[p['id']] in INVALID_BUCKETS}
            for p in prompts if p['id'] in scores and p['id'] in buckets
            and not (p['split'] == 'validation' and source[p['id']] != 'sonnet')]
    if args.synthetic:
        rows += synthetic_intent_rows(noise.load_synthetic(args.synthetic))
    train_rows = [r for r in rows if r['split'] == 'train']
    val_rows = [r for r in rows if r['split'] == 'validation']
    options = tuple(f'{c}: {d}' for c, d in zip(CATALOG, args.option_text))

    def lengths(rs):
        return [min(len(r['text'].encode('utf-8')), 1024) or 1 for r in rs]

    def examples(rs):
        return [ChoiceExample(context=r['text'], options=options, label=0) for r in rs]

    def score(model, collator, rs):
        model.eval()
        xs, probs = examples(rs), [None] * len(rs)
        with torch.no_grad():
            for batch in trainer.make_batches(lengths(rs), args.token_budget):
                p = model(collator([xs[i] for i in batch])).sigmoid()
                for k, i in enumerate(batch):
                    probs[i] = p[k].tolist()
        return probs

    weights = parse_weights(args.intent_weights)

    def fit(model, collator, rs, epochs, label, zero_invalid=False, weighted=False):
        opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=0.01)
        pos = torch.tensor([weights.get(c, 1.0) for c in CATALOG]) if weighted else None
        xs = examples(rs)
        tg = torch.tensor([[0.0] * len(CATALOG) if zero_invalid and r['invalid'] else r['targets'] for r in rs])
        batches = trainer.make_batches(lengths(rs), args.token_budget)
        for epoch in range(epochs):
            model.train()
            random.shuffle(batches)
            total = 0.0
            for b in batches:
                loss = torch.nn.functional.binary_cross_entropy_with_logits(model(collator([xs[i] for i in b])), tg[b],
                                                                            pos_weight=pos)
                opt.zero_grad()
                loss.backward()
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                opt.step()
                total += loss.item() * len(b)
            print(f'  [{label}] epoch {epoch + 1}/{epochs} loss {total / max(1, len(rs)):.4f}', flush=True)

    def config(width, layers):
        return {'encoder': 'tinyx', 'width': width, 'rank': width, 'layers': layers, 'heads': 4, 'dropout': 0.1,
                'context_tokens': 1024, 'option_tokens': 96}

    valid_train = [r for r in train_rows if not r['invalid']]
    invalid_train = [r for r in train_rows if r['invalid']]
    val_probs, results = {}, {}

    def record(name, model, collator):
        probs = score(model, collator, val_rows)
        val_probs[name] = {r['id']: dict(zip(CATALOG, p)) for r, p in zip(val_rows, probs)}

    variants = args.variants.split(',')
    if 'all' in variants:
        torch.manual_seed(args.seed)
        m, c = make_system(config(128, 2), 'cpu')
        fit(m, c, train_rows, args.epochs, 'all')
        record('all', m, c)
    if 'valid-only' in variants:
        torch.manual_seed(args.seed)
        m, c = make_system(config(128, 2), 'cpu')
        fit(m, c, valid_train, args.epochs, 'valid-only')
        record('valid-only', m, c)
        Path(args.out).mkdir(parents=True, exist_ok=True)
        save_checkpoint(Path(args.out) / 'valid-only.safetensors', m, config(128, 2),
                        {'domain': 'harness-intent-exp', 'options': list(CATALOG)})
    sonnet_valid = [r for r in valid_train if r['teacher'] == 'sonnet']
    for name, rs, weighted in (('valid-sonnet', sonnet_valid, False), ('valid-laya', valid_train, False),
                               ('valid-sonnet-weighted', sonnet_valid, True), ('valid-laya-weighted', valid_train, True)):
        if name in variants:
            torch.manual_seed(args.seed)
            m, c = make_system(config(128, 2), 'cpu')
            fit(m, c, rs, args.epochs, name, weighted=weighted)
            record(name, m, c)
            Path(args.out).mkdir(parents=True, exist_ok=True)
            save_checkpoint(Path(args.out) / f'{name}.safetensors', m, config(128, 2),
                            {'domain': 'harness-intent-exp', 'options': list(CATALOG)})
    if 'staged' in variants:
        torch.manual_seed(args.seed)
        m, c = make_system(config(128, 2), 'cpu')
        fit(m, c, valid_train, args.epochs - 4, 'staged valid')
        random.shuffle(invalid_train)
        half = len(invalid_train) // 2
        fit(m, c, valid_train + invalid_train[:half], 2, 'staged +1/2', zero_invalid=True)
        fit(m, c, train_rows, 2, 'staged +2/2', zero_invalid=True)
        record('staged', m, c)
    if 'valid-large' in variants:
        torch.manual_seed(args.seed)
        m, c = make_system(config(256, 4), 'cpu')
        fit(m, c, valid_train, args.epochs, 'valid-large')
        record('valid-large', m, c)

    # Evaluate on valid validation rows (the ones the intent stage would see).
    eval_ids = [r['id'] for r in val_rows if not r['invalid']]
    truth = {r['id']: [t >= BAND for t in r['targets']] for r in val_rows}
    tier_probs = json.load(open(args.tier_probs))[args.tier_variant] if args.tier_probs else None
    tier_rows = {r['id']: r for r in tier_exp.tier_rows(prompts, tiers, excluded, owner_validity=validity,
                                                        intents={r['id']: r['gold'] for r in load(data / 'labels-intent.jsonl')})
                 if r['split'] == 'validation' and r['valid']}
    for name, vp in val_probs.items():
        probs = {i: [vp[i][c] for c in CATALOG] for i in eval_ids}
        taus = cv_taus(eval_ids, probs, truth)
        res = {'intent': intent_metrics(eval_ids, probs, truth, taus)}
        if tier_probs:
            ids = [i for i in eval_ids if i in tier_rows]
            golds = [tier_exp.TIERS.index(tier_rows[i]['tier']) for i in ids]
            comp = __import__('system-one-tier-compose-eval')
            picks = [2 if any(vp[i][c] >= taus[i][c] for c in ('feature', 'refactor')) else tier_exp.pick(tier_probs[i])
                     for i in ids]
            res['composedTier'] = comp.score_picks(golds, picks)
        results[name] = res
        print(name, json.dumps(res), flush=True)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    json.dump({'schemaVersion': 1, 'seed': args.seed, 'epochs': args.epochs,
               'counts': {'trainValid': len(valid_train), 'trainInvalid': len(invalid_train), 'validationEval': len(eval_ids)},
               'results': results}, open(out / 'report.json', 'w'), indent=2)
    json.dump(val_probs, open(out / 'val-probs-private.json', 'w'))


DEFAULT_OPTIONS = (
    'answer or explain without changing anything',
    'weigh options or give an opinion on work in progress',
    'Git or GitHub housekeeping: commit, push, branch, PR',
    'repair wrong behavior: bug, crash, failing test or build',
    'change an existing value, setting, text or behavior on request',
    'add new behavior: command, option, format, endpoint, script',
    'restructure existing code without new behavior; rename, move, unify',
    'evaluate an existing artifact against a standard',
    'run tests or builds, or write tests as the deliverable',
    'write or edit documentation as the main deliverable',
    'produce a plan, spec, roadmap or breakdown before implementing',
    'find facts or a cause and report back without changing anything',
)


def synthetic_intent_rows(synthetic):
    """Intent rows for synthetic prompts: 0.8 for the primary intent, 0.5 for each secondary."""
    out = []
    for r in synthetic:
        scores = {r['intent']: 0.8, **{c: 0.5 for c in r['secondary'] if c != r['intent']}}
        out.append({'id': r['id'], 'split': 'train', 'text': r['text'], 'teacher': 'synthetic', 'invalid': False,
                    'targets': [scores.get(c, 0.0) for c in CATALOG]})
    return out


def parse_weights(spec):
    """'feature=2,refactor=2' -> {'feature': 2.0, 'refactor': 2.0}; BCE positive weights per intent."""
    out = {}
    for part in filter(None, (spec or '').split(',')):
        name, value = part.split('=')
        if name not in CATALOG:
            raise ValueError(f'unknown intent {name}')
        out[name] = float(value)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--data-dir', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--owner-validity', required=True)
    ap.add_argument('--tier-probs', help='old-rules tier val-probs-private.json for the downstream composition')
    ap.add_argument('--tier-variant', default='curriculum-3of3')
    ap.add_argument('--variants', default='all,valid-only,staged,valid-large')
    ap.add_argument('--synthetic', help='synthetic command prompts (train only)')
    ap.add_argument('--extra-teacher', help='extra dense-score rows for unscored train prompts (e.g. labels-intent-laya-ft.jsonl)')
    ap.add_argument('--intent-weights', default='feature=2,refactor=2')
    ap.add_argument('--seed', type=int, default=0)
    ap.add_argument('--threads', type=int, default=8)
    ap.add_argument('--epochs', type=int, default=12)
    ap.add_argument('--token-budget', type=int, default=16384)
    ap.add_argument('--lr', type=float, default=1e-3)
    args = ap.parse_args(argv)
    args.option_text = DEFAULT_OPTIONS
    run(args)


if __name__ == '__main__':
    main()
