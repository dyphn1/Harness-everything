#!/usr/bin/env python3
"""End-to-end validation of the two-stage System One plan for #233 on all rows.

Stage 1, validity (scripts/system-one-noise-experiment.py --merge-invalid):
invalid prompts go to the host agent with no suggestion. Stage 2, tier
(scripts/system-one-tier-stage-experiment.py): a tier pick for the rest.
This combines saved validation scores of both stages over every validation
row, valid and invalid, and reports what the user would see. The holdout is
never read; outputs hold aggregates only.
"""
import argparse
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
tier_exp = __import__('system-one-tier-stage-experiment')


def pipeline_metrics(rows, gate, tiers, gate_tau=0.5, tier_tau=0.5):
    """rows: validation rows from tier_rows; gate: id -> p(invalid) or None (no gate); tiers: id -> [p1, p2, p3]."""
    out = {'rows': len(rows)}
    valid = [r for r in rows if r['valid']]
    invalid = [r for r in rows if not r['valid']]

    def handed(r):
        return gate is not None and gate[r['id']] >= gate_tau

    picks = []
    for r in valid:
        if handed(r):
            continue
        k = tier_exp.pick(tiers[r['id']], tier_tau)
        if k is not None:
            picks.append((tier_exp.TIERS.index(r['tier']), k))
    wrong_on_invalid = sum(1 for r in invalid if not handed(r) and tier_exp.pick(tiers[r['id']], tier_tau) is not None)
    out['invalidHandedOff'] = sum(1 for r in invalid if handed(r)) / max(1, len(invalid))
    out['invalidGotTier'] = wrong_on_invalid / max(1, len(invalid))
    out['validHandedOff'] = sum(1 for r in valid if handed(r)) / max(1, len(valid))
    out['validCoverage'] = len(picks) / max(1, len(valid))
    out['validAcceptablePrecision'] = sum(1 for g, k in picks if k in (g, g + 1)) / max(1, len(picks))
    out['validUnderRate'] = sum(1 for g, k in picks if k < g) / max(1, len(picks))
    shown = len(picks) + wrong_on_invalid
    out['suggestionPrecisionAllRows'] = sum(1 for g, k in picks if k in (g, g + 1)) / max(1, shown)
    out['suggestionsShown'] = shown / max(1, len(rows))
    return out


def gate_scores(checkpoint, rows, token_budget=16384):
    import torch
    from cua_s1.model import ChoiceExample, load_checkpoint
    noise = __import__('system-one-noise-experiment')
    trainer = __import__('system-one-train')
    model, collator, _ = load_checkpoint(checkpoint, 'cpu')
    model.eval()
    options = tuple(t for _, t in noise.OPTIONS_MERGED)
    xs = [ChoiceExample(context=r['text'], options=options, label=0) for r in rows]
    lengths = [min(len(r['text'].encode('utf-8')), 1024) or 1 for r in rows]
    out = {}
    with torch.no_grad():
        for batch in trainer.make_batches(lengths, token_budget):
            p = model(collator([xs[i] for i in batch])).sigmoid()
            for k, i in enumerate(batch):
                out[rows[i]['id']] = p[k][1].item()
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument('--data-dir', required=True)
    ap.add_argument('--gate-checkpoint', required=True, help='noise-gate --merge-invalid checkpoint (.safetensors)')
    ap.add_argument('--tier-probs', required=True, help='val-probs-private.json from the tier stage experiment')
    ap.add_argument('--out', required=True)
    ap.add_argument('--owner-validity')
    ap.add_argument('--tier-rules', type=int, choices=[1, 2], default=1)
    args = ap.parse_args(argv)
    trainer = __import__('system-one-train')
    data = Path(args.data_dir)
    tiers = {r['id']: r['gold'] for r in trainer.load_jsonl(data / 'labels.jsonl')}
    for r in trainer.load_jsonl(data / 'owner-overrides.jsonl'):
        tiers[r['id']] = r['gold']
    excluded = {r['id'] for r in trainer.load_jsonl(data / 'owner-excluded.jsonl')}
    noise = __import__('system-one-noise-experiment')
    intents = ({r['id']: r['gold'] for r in trainer.load_jsonl(data / 'labels-intent.jsonl')}
               if args.tier_rules == 2 else None)
    rows = [r for r in tier_exp.tier_rows(trainer.load_jsonl(data / 'prompts.jsonl'), tiers, excluded,
                                          owner_validity=noise.load_owner_validity(args.owner_validity),
                                          intents=intents)
            if r['split'] == 'validation']
    gate = gate_scores(args.gate_checkpoint, rows)
    variants = json.load(open(args.tier_probs))
    report = {}
    for name, probs in variants.items():
        report[name] = {'noGate': pipeline_metrics(rows, None, probs)}
        for tau in (0.5, 0.8):
            report[name][f'gate@{tau}'] = pipeline_metrics(rows, gate, probs, gate_tau=tau)
    json.dump({'schemaVersion': 1, 'variants': report}, open(args.out, 'w'), indent=2)
    print(json.dumps(report, indent=1))


if __name__ == '__main__':
    main()
