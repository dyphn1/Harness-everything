#!/usr/bin/env python3
"""Per-intent Bernoulli evaluation for Laya relevance scores (#255 Phase 3).

Each intent is its own binary decision with its own threshold, fit to the
owner's secondary band (teacher score >= 0.4). No simplex, no single winner:
this matches how owner intents actually look (about 2.5 secondaries per
prompt) and how Laya noul heads natively behave (independent P(true)).

Honest estimate via 2-fold CV; the shipped taus artifact is fit on all rows
and labeled in-sample. Stdlib only; runs in seconds on saved predictions.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

INTENTS = ['explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor',
           'review', 'test', 'docs', 'plan', 'investigate']

GRID = [round(x / 100, 2) for x in range(5, 100, 5)]


def binarize(scores, band=0.4):
    """Intents whose score reaches the positive band."""
    return {i for i in INTENTS if scores.get(i, 0.0) >= band}


def sweep_threshold(scores, truth):
    """Best F1 threshold on paired lists; ties break toward silence."""
    best = (0.95, 0.0, 0.0, 0.0)
    for tau in GRID:
        tp = sum(1 for s, t in zip(scores, truth) if s >= tau and t)
        fp = sum(1 for s, t in zip(scores, truth) if s >= tau and not t)
        fn = sum(1 for s, t in zip(scores, truth) if s < tau and t)
        p = tp / (tp + fp) if (tp + fp) else 0.0
        r = tp / (tp + fn) if (tp + fn) else 0.0
        f = 2 * p * r / (p + r) if (p + r) else 0.0
        if (f, tau) > (best[3], best[0]):
            best = (tau, p, r, f)
    return best


def micro(per):
    """Micro-averaged P/R/F1 over {intent: (tp, fp, fn)}; empty scores zero."""
    tp = sum(v[0] for v in per.values())
    fp = sum(v[1] for v in per.values())
    fn = sum(v[2] for v in per.values())
    p = tp / (tp + fp) if (tp + fp) else 0.0
    r = tp / (tp + fn) if (tp + fn) else 0.0
    return {'precision': p, 'recall': r, 'f1': 2 * p * r / (p + r) if (p + r) else 0.0}


def evaluate(ids, preds, truth_sets, taus):
    """Multi-label metrics for one id list under fixed taus."""
    per = {i: [0, 0, 0] for i in INTENTS}
    abstain, fires_total, truth_total, exact = 0, 0, 0, 0
    for pid in ids:
        fired = {i for i in INTENTS if preds[pid].get(i, 0.0) >= taus[i]}
        truth = truth_sets[pid]
        fires_total += len(fired)
        truth_total += len(truth)
        abstain += not fired
        exact += fired == truth
        for i in INTENTS:
            if i in fired and i in truth:
                per[i][0] += 1
            elif i in fired:
                per[i][1] += 1
            elif i in truth:
                per[i][2] += 1
    n = len(ids)
    return {'n': n, 'micro': micro({i: tuple(v) for i, v in per.items()}),
            'abstainRate': abstain / n if n else 0.0,
            'meanFires': fires_total / n if n else 0.0,
            'meanTruth': truth_total / n if n else 0.0,
            'exactSetMatch': exact / n if n else 0.0,
            'perIntent': {i: {'tau': taus[i], 'tp': per[i][0], 'fp': per[i][1], 'fn': per[i][2],
                              'support': per[i][0] + per[i][2]} for i in INTENTS}}


def fit_taus(ids, preds, truth_sets):
    """Max-F1 threshold per intent on the given ids."""
    taus = {}
    for i in INTENTS:
        taus[i] = sweep_threshold([preds[pid].get(i, 0.0) for pid in ids],
                                  [i in truth_sets[pid] for pid in ids])[0]
    return taus


def stage_split(ids, teacher, preds):
    """Three-stage validation slicing (research protocol, deterministic).

    Confidence comes from the MODEL's top score: stage 1 keeps rows where
    the model is confident (max >= 0.6) and the teacher marks classifiable.
    Stage 2 accumulates the remaining classifiable rows class by class in
    catalog order. Stage 3 (last) adds the unclassifiable (null gold) rows.
    Returns (confident, [(intent, cumulative_ids)], nulls).
    """
    conf_of = {pid: max(preds[pid].values()) for pid in ids}
    confident = [pid for pid in ids
                 if teacher[pid]['gold'] is not None and conf_of[pid] >= 0.6]
    nulls = [pid for pid in ids if teacher[pid]['gold'] is None]
    rest = [pid for pid in ids if pid not in confident and pid not in nulls]
    steps = []
    seen = list(confident)
    for intent in INTENTS:
        group = [pid for pid in rest if teacher[pid]['gold'] == intent]
        if group:
            seen = seen + group
            steps.append([intent, list(seen)])
    return confident, steps, nulls


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preds', required=True, help='saved predictions json {id: {intent: score}}')
    parser.add_argument('--teacher', required=True, help='teacher scores jsonl')
    parser.add_argument('--band', type=float, default=0.4, help='teacher positive band')
    parser.add_argument('--out', required=True, help='report json path')
    parser.add_argument('--taus', required=True, help='threshold artifact json path')
    parser.add_argument('--stages', action='store_true', help='add three-stage validation slicing')
    args = parser.parse_args(argv)
    preds = json.loads(Path(args.preds).read_text(encoding='utf-8'))
    teacher = {r['id']: r for r in
               (json.loads(line) for line in Path(args.teacher).read_text(encoding='utf-8').splitlines() if line.strip())}
    ids = sorted(set(preds) & set(teacher))
    truth_sets = {pid: binarize(teacher[pid]['scores'], args.band) for pid in ids}
    halves = ([i for k, i in enumerate(ids) if k % 2 == 0], [i for k, i in enumerate(ids) if k % 2 == 1])
    cv = [evaluate(halves[1], preds, truth_sets, fit_taus(halves[0], preds, truth_sets)),
          evaluate(halves[0], preds, truth_sets, fit_taus(halves[1], preds, truth_sets))]
    full_taus = fit_taus(ids, preds, truth_sets)
    in_sample = evaluate(ids, preds, truth_sets, full_taus)
    report = {'n': len(ids), 'band': args.band,
              'cvMicroF1': sum(c['micro']['f1'] for c in cv) / 2,
              'cv': [{'micro': c['micro'], 'abstainRate': c['abstainRate'],
                       'meanFires': c['meanFires'], 'exactSetMatch': c['exactSetMatch']} for c in cv],
              'inSample': {'micro': in_sample['micro'], 'abstainRate': in_sample['abstainRate'],
                           'meanFires': in_sample['meanFires'], 'meanTruth': in_sample['meanTruth'],
                           'exactSetMatch': in_sample['exactSetMatch'],
                           'perIntent': in_sample['perIntent']}}
    if args.stages:
        teacher_rows = {r['id']: r for r in
                        (json.loads(line) for line in Path(args.teacher).read_text(encoding='utf-8').splitlines()
                         if line.strip())}
        confident, steps, nulls = stage_split(ids, teacher_rows, preds)
        staged = [{'stage': 'confident', 'n': len(confident),
                   'micro': evaluate(confident, preds, truth_sets, full_taus)['micro'] if confident else None}]
        for intent, cumulative in steps:
            staged.append({'stage': f'+{intent}', 'n': len(cumulative),
                           'micro': evaluate(cumulative, preds, truth_sets, full_taus)['micro']})
        staged.append({'stage': '+null', 'n': len(ids),
                       'micro': evaluate(ids, preds, truth_sets, full_taus)['micro']})
        report['stages'] = staged
    Path(args.out).write_text(json.dumps(report, indent=2), encoding='utf-8')
    Path(args.taus).write_text(json.dumps(
        {'taus': full_taus, 'band': args.band, 'inSample': True,
         'predsSha256': hashlib.sha256(Path(args.preds).read_bytes()).hexdigest(),
         'teacherSha256': hashlib.sha256(Path(args.teacher).read_bytes()).hexdigest()},
        indent=2), encoding='utf-8')
    m = report['inSample']['micro']
    print(json.dumps({'n': len(ids), 'cvF1': round(report['cvMicroF1'], 3),
                      'inSampleF1': round(m['f1'], 3), 'inSampleP': round(m['precision'], 3),
                      'inSampleR': round(m['recall'], 3),
                      'fires': round(in_sample['meanFires'], 2),
                      'truth': round(in_sample['meanTruth'], 2),
                      'abstain': round(in_sample['abstainRate'], 3)}))
    return 0


if __name__ == '__main__':
    sys.exit(main())
