#!/usr/bin/env python3
"""Compose tier3 from intent scores instead of learning it (#233 experiment).

Tier rules v2 make a prompt tier3 when its primary intent is `feature` or
`refactor`. The intent stage already scores those intents, so a composed
readout can take tier3 from intent and leave the tier model to the rest:

  composed pick = tier3 if the intent readout says feature/refactor,
                  else the old-rules tier model's pick (breadth-based tier3 kept)

It is compared with the tier model trained directly on rules-v2 labels, on the
valid validation rows that have intent scores, against rules-v2 truth. Intent
thresholds come from their own saved per-intent fits (fit on the teacher, not
on tier truth); nothing here is tuned on tier labels. Holdout never read.
"""
import argparse
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))
tier_exp = __import__('system-one-tier-stage-experiment')
CATALOG = ('explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor', 'review', 'test', 'docs', 'plan',
           'investigate')
TIER3_INTENTS = ('feature', 'refactor')


def intent_says_tier3(scores, taus, mode):
    """primary: feature/refactor is the top intent; fires: either is at or above its threshold."""
    if mode == 'primary':
        return max(CATALOG, key=lambda c: scores.get(c, 0.0)) in TIER3_INTENTS
    return any(scores.get(c, 0.0) >= taus[c] for c in TIER3_INTENTS)


def composed_pick(tier_probs, intent_scores, taus, mode, tau=0.5):
    if intent_says_tier3(intent_scores, taus, mode):
        return 2
    return tier_exp.pick(tier_probs, tau)


def score_picks(golds, picks):
    made = [(g, k) for g, k in zip(golds, picks) if k is not None]
    n = max(1, len(made))
    t3 = [(g, k) for g, k in zip(golds, picks) if g == 2]
    return {'rows': len(golds), 'coverage': len(made) / max(1, len(golds)),
            'acceptablePrecision': sum(1 for g, k in made if k in (g, g + 1)) / n,
            'exactPrecision': sum(1 for g, k in made if k == g) / n,
            'underRate': sum(1 for g, k in made if k < g) / n,
            'tier3Recall': sum(1 for g, k in t3 if k == 2) / max(1, len(t3)),
            'tier3Precision': sum(1 for g, k in made if k == 2 and g == 2) / max(1, sum(1 for _, k in made if k == 2))}


def load_intents(kind, path):
    if kind == 'laya':
        return json.load(open(path))
    out = {}
    for line in open(path):
        r = json.loads(line)
        out[r['id']] = dict(zip(CATALOG, r['probs'][:12]))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--data-dir', required=True)
    ap.add_argument('--owner-validity', required=True)
    ap.add_argument('--old-tier-probs', nargs='+', required=True, help='val-probs-private.json per seed, tier rules v1')
    ap.add_argument('--v2-tier-probs', nargs='+', required=True, help='val-probs-private.json per seed, tier rules v2')
    ap.add_argument('--variant', default='curriculum-3of3')
    ap.add_argument('--intent', action='append', required=True, help='name:kind:scores:taus (kind laya|cua)')
    ap.add_argument('--out', required=True)
    args = ap.parse_args(argv)
    trainer = __import__('system-one-train')
    noise = __import__('system-one-noise-experiment')
    data = Path(args.data_dir)
    tiers = {r['id']: r['gold'] for r in trainer.load_jsonl(data / 'labels.jsonl')}
    for r in trainer.load_jsonl(data / 'owner-overrides.jsonl'):
        tiers[r['id']] = r['gold']
    excluded = {r['id'] for r in trainer.load_jsonl(data / 'owner-excluded.jsonl')}
    intents_gold = {r['id']: r['gold'] for r in trainer.load_jsonl(data / 'labels-intent.jsonl')}
    rows = [r for r in tier_exp.tier_rows(trainer.load_jsonl(data / 'prompts.jsonl'), tiers, excluded,
                                          owner_validity=noise.load_owner_validity(args.owner_validity),
                                          intents=intents_gold)
            if r['split'] == 'validation' and r['valid']]
    sources = {}
    for spec in args.intent:
        name, kind, scores, taus = spec.split(':')
        sources[name] = (load_intents(kind, scores), json.load(open(taus))['taus'])
    common = set.intersection(*[set(s[0]) for s in sources.values()])
    rows = [r for r in rows if r['id'] in common]
    golds = [tier_exp.TIERS.index(r['tier']) for r in rows]
    report = {'rows': len(rows), 'tier3Rows': golds.count(2), 'seeds': []}
    for old_path, v2_path in zip(args.old_tier_probs, args.v2_tier_probs):
        old = json.load(open(old_path))[args.variant]
        v2 = json.load(open(v2_path))[args.variant]
        seed = {'learnedV2': score_picks(golds, [tier_exp.pick(v2[r['id']]) for r in rows]),
                'oldRulesOnly': score_picks(golds, [tier_exp.pick(old[r['id']]) for r in rows])}
        for name, (scores, taus) in sources.items():
            for mode in ('primary', 'fires'):
                seed[f'composed-{name}-{mode}'] = score_picks(
                    golds, [composed_pick(old[r['id']], scores[r['id']], taus, mode) for r in rows])
        report['seeds'].append(seed)
    json.dump(report, open(args.out, 'w'), indent=2)
    print(json.dumps(report['seeds'][0], indent=1))


if __name__ == '__main__':
    main()
