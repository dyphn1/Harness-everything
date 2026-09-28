#!/usr/bin/env python3
"""Calibrate Laya zero-shot scores to teacher relevance (#255 Phase 3 prep).

Per-intent isotonic (PAVA, monotone non-decreasing) mapping from Laya
zero-shot scores to the sonnet teacher's scaled relevance, plus a null-cutoff
sweep. Honest estimate via K-fold CV with FIXED derive bands; the shipped
artifact (knots + cutoff) is fit on all overlap rows and clearly labeled
in-sample. Stdlib only; no model is loaded -- this runs in seconds.
"""
import argparse
import hashlib
import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve()
INTENTS = ['explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor',
           'review', 'test', 'docs', 'plan', 'investigate']

_compare_spec = importlib.util.spec_from_file_location(
    'laya_compare', HERE.parent / 'system-one-compare-laya.py')
_compare = importlib.util.module_from_spec(_compare_spec)
_compare_spec.loader.exec_module(_compare)
graded = _compare.graded


def isotonic_fit(xs, ys):
    """PAVA isotonic regression. Returns knots as [[x, y], ...] sorted by x."""
    by_x = {}
    for x, y in zip(xs, ys):
        by_x.setdefault(float(x), []).append(float(y))
    points = sorted((x, sum(v) / len(v)) for x, v in by_x.items())
    blocks = [[x, y, 1] for x, y in points]  # x, mean, weight
    i = 0
    while i < len(blocks) - 1:
        if blocks[i][1] <= blocks[i + 1][1]:
            i += 1
            continue
        x0, m0, w0 = blocks[i]
        x1, m1, w1 = blocks[i + 1]
        blocks[i] = [(x0 * w0 + x1 * w1) / (w0 + w1), (m0 * w0 + m1 * w1) / (w0 + w1), w0 + w1]
        del blocks[i + 1]
        if i > 0:
            i -= 1
    return [[b[0], b[1]] for b in blocks]


def isotonic_predict(knots, x):
    """Piecewise-linear interpolation over knots, clamped outside the range."""
    x = float(x)
    if x <= knots[0][0]:
        return knots[0][1]
    if x >= knots[-1][0]:
        return knots[-1][1]
    for (x0, y0), (x1, y1) in zip(knots, knots[1:]):
        if x0 <= x <= x1:
            t = (x - x0) / (x1 - x0) if x1 > x0 else 0.0
            return y0 + t * (y1 - y0)
    return knots[-1][1]


def apply_mapping(raw_scores, mappings):
    """Map raw per-intent scores through per-intent knots (identity when absent)."""
    out = {}
    for intent in INTENTS:
        knots = mappings.get(intent)
        out[intent] = isotonic_predict(knots, raw_scores[intent]) if knots else float(raw_scores[intent])
    return out


def derive_calibrated(raw_scores, mappings, null_cutoff):
    """Bands on calibrated scores: abstain when the max is at/below the cutoff."""
    scores = apply_mapping(raw_scores, mappings)
    top = max(scores[intent] for intent in INTENTS)
    if top <= null_cutoff:
        return {'gold': None, 'secondary': []}
    gold = max(INTENTS, key=lambda i: (scores[i], -INTENTS.index(i)))
    secondary = sorted((i for i in INTENTS if i != gold and scores[i] >= 0.4),
                       key=lambda i: (-scores[i], INTENTS.index(i)))
    return {'gold': gold, 'secondary': secondary}


def fold_of(idx, k):
    return idx % k


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--teacher', default='labels-intent-scores.jsonl')
    parser.add_argument('--cand', required=True, help='candidate labels file')
    parser.add_argument('--out', required=True, help='calibration artifact json path')
    parser.add_argument('--folds', type=int, default=5)
    args = parser.parse_args(argv)
    data = Path(args.data_dir)
    teacher = {r['id']: r for r in map(json.loads, (data / args.teacher).read_text(encoding='utf-8').splitlines()) if True}
    cand = {r['id']: r for r in map(json.loads, (data / args.cand).read_text(encoding='utf-8').splitlines()) if True}
    ids = sorted(set(teacher) & set(cand))
    n = len(ids)

    def fit_mappings(train_ids):
        mappings = {}
        for intent in INTENTS:
            xs = [cand[i]['scores'][intent] for i in train_ids]
            ys = [teacher[i]['scores'][intent] for i in train_ids]
            mappings[intent] = isotonic_fit(xs, ys)
        return mappings

    # Honest CV with fixed bands (null iff calibrated max <= 0.2).
    cv_exact, cv_graded, cv_mae = [], [], []
    for f in range(args.folds):
        held = [i for idx, i in enumerate(ids) if fold_of(idx, args.folds) == f]
        train = [i for idx, i in enumerate(ids) if fold_of(idx, args.folds) != f]
        mappings = fit_mappings(train)
        exact = sum(1 for i in held
                    if derive_calibrated(cand[i]['scores'], mappings, 0.2)['gold'] == teacher[i]['gold'])
        grades = [graded(derive_calibrated(cand[i]['scores'], mappings, 0.2)['gold'],
                         derive_calibrated(cand[i]['scores'], mappings, 0.2)['secondary'],
                         teacher[i]['gold'], teacher[i].get('secondary', [])) for i in held]
        mae = sum(abs(apply_mapping(cand[i]['scores'], mappings)[k] - teacher[i]['scores'][k])
                  for i in held for k in INTENTS) / (len(held) * len(INTENTS))
        cv_exact.append(exact / len(held))
        cv_graded.append(sum(grades) / len(grades))
        cv_mae.append(mae)

    # Full-fit artifact + null-cutoff sweep (in-sample, labeled as such).
    full = fit_mappings(ids)
    sweep = {}
    for step in range(0, 75, 5):
        cutoff = step / 100
        grades = [graded(*_derive_pair(cand[i]['scores'], full, cutoff, teacher[i])) for i in ids]
        sweep[f'{cutoff:.2f}'] = sum(grades) / len(grades)
    best_cutoff = max(sweep, key=lambda c: (sweep[c], -float(c)))
    mae_full = sum(abs(apply_mapping(cand[i]['scores'], full)[k] - teacher[i]['scores'][k])
                   for i in ids for k in INTENTS) / (n * len(INTENTS))
    raw_mae = sum(abs(cand[i]['scores'][k] - teacher[i]['scores'][k])
                  for i in ids for k in INTENTS) / (n * len(INTENTS))

    artifact = {'candidate': args.cand,
                'candidateSha256': hashlib.sha256((data / args.cand).read_bytes()).hexdigest(),
                'teacher': args.teacher,
                'teacherSha256': hashlib.sha256((data / args.teacher).read_bytes()).hexdigest(),
                'n': n, 'folds': args.folds,
                'cv': {'exactMean': sum(cv_exact) / len(cv_exact), 'gradedMean': sum(cv_graded) / len(cv_graded),
                       'maeMean': sum(cv_mae) / len(cv_mae)},
                'inSample': {'maeRaw': raw_mae, 'maeCalibrated': mae_full,
                             'nullCutoffSweep': sweep, 'bestCutoff': best_cutoff},
                'mappings': full}
    Path(args.out).write_text(json.dumps(artifact, indent=2), encoding='utf-8')
    print(json.dumps({'n': n, 'cvExact': round(artifact['cv']['exactMean'], 3),
                      'cvGraded': round(artifact['cv']['gradedMean'], 3),
                      'cvMAE': round(artifact['cv']['maeMean'], 4),
                      'rawMAE': round(raw_mae, 4), 'bestCutoff': best_cutoff,
                      'bestSweepGraded': round(sweep[best_cutoff], 3)}))
    return 0


def _derive_pair(raw_scores, mappings, cutoff, teacher_row):
    d = derive_calibrated(raw_scores, mappings, cutoff)
    return d['gold'], d['secondary'], teacher_row['gold'], teacher_row.get('secondary', [])


if __name__ == '__main__':
    sys.exit(main())
