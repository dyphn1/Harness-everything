#!/usr/bin/env python3
"""Compare Laya zero-shot dense labels against the teacher scores (#255 Phase 2 evidence).

Reads the private training dir only; the printed/written report holds aggregate
metrics, hashes and score distributions -- never prompt text -- so it can join
the public evidence bundle. Graded agreement mirrors
harness-everything/scripts/system-one/intent.js gradedAgreement; --self-check
asserts the mirror against the owner's S1-I05 grade table on every run.
"""
import argparse
import hashlib
import json
import sys
from pathlib import Path

INTENTS = ['explain', 'discuss', 'git', 'fix', 'edit', 'feature', 'refactor',
           'review', 'test', 'docs', 'plan', 'investigate']

# (gold_a, sec_a, gold_b, sec_b, want) from ci/mechanism-system-one-intent.test.js S1-I05.
GRADE_TABLE = [
    (('fix', ['test']), ('fix', ['docs', 'review']), 1),
    (('fix', ['test']), ('test', ['fix']), 0.6),
    (('fix', ['test', 'docs', 'review', 'plan']), ('test', ['fix']), 0.3),
    (('fix', ['test', 'docs', 'review']), ('test', ['fix']), 0.6),
    (('fix', ['test']), ('test', []), 0.3),
    (('fix', []), ('docs', ['review']), 0),
    ((None, []), (None, []), 1),
    ((None, []), ('fix', []), 0),
]


def graded(a_gold, a_sec, b_gold, b_sec):
    """Mirror of intent.js gradedAgreement."""
    if a_gold is None or b_gold is None:
        return 1 if (a_gold is None and b_gold is None) else 0
    fa = {a_gold, *a_sec}
    fb = {b_gold, *b_sec}
    if a_gold == b_gold:
        return 1
    if a_gold in fb and b_gold in fa:
        return 0.6 if abs(len(a_sec) - len(b_sec)) < 3 else 0.3
    if a_gold in fb or b_gold in fa:
        return 0.3
    return 0


def self_check():
    for (ag, ase), (bg, bse), want in GRADE_TABLE:
        got = graded(ag, ase, bg, bse)
        assert got == want, f'graded mirror drift: {(ag, ase, bg, bse)} -> {got}, want {want}'
        assert graded(bg, bse, ag, ase) == want, 'graded mirror must be symmetric'


def is_zh(text):
    return any('\u4e00' <= ch <= '\u9fff' for ch in text)


def spearman(xs, ys):
    n = len(xs)
    if n < 2:
        return None
    rx = sorted(range(n), key=lambda i: xs[i])
    ry = sorted(range(n), key=lambda i: ys[i])
    rank_x = [0] * n
    rank_y = [0] * n
    for r, i in enumerate(rx):
        rank_x[i] = r
    for r, i in enumerate(ry):
        rank_y[i] = r
    mean = (n - 1) / 2
    cov = sum((rank_x[i] - mean) * (rank_y[i] - mean) for i in range(n))
    var = sum((rank_x[i] - mean) ** 2 for i in range(n))
    return cov / var if var else None


def load_jsonl(path):
    return [json.loads(line) for line in Path(path).read_text(encoding='utf-8').splitlines() if line.strip()]


def main(argv=None):
    self_check()
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--data-dir', required=True)
    parser.add_argument('--teacher', default='labels-intent-scores.jsonl')
    parser.add_argument('--cand', nargs='+', required=True, help='candidate labels files to compare')
    parser.add_argument('--out', required=True, help='report json path')
    args = parser.parse_args(argv)
    data = Path(args.data_dir)
    prompts = {r['id']: r['text'] for r in load_jsonl(data / 'prompts.jsonl')}
    teacher = {r['id']: r for r in load_jsonl(data / args.teacher)}
    report = {'teacher': args.teacher,
              'teacherSha256': hashlib.sha256((data / args.teacher).read_bytes()).hexdigest(),
              'candidates': {}}
    cands = {name: {r['id']: r for r in load_jsonl(data / name)} for name in args.cand}
    common = set(teacher) & set(prompts)
    for name in args.cand:
        common &= set(cands[name])
    common = sorted(common)
    report['compared'] = len(common)
    for name in args.cand:
        rows = cands[name]
        exact = sum(1 for i in common if rows[i]['gold'] == teacher[i]['gold'])
        grades = [graded(rows[i]['gold'], rows[i].get('secondary', []),
                         teacher[i]['gold'], teacher[i].get('secondary', [])) for i in common]
        scored = [rows[i]['scores'] for i in common]
        dist = {intent: sum(s[intent] for s in scored) / len(scored) for intent in INTENTS}
        top_mean = sum(max(s.values()) for s in scored) / len(scored)
        rank_corr = {intent: spearman([rows[i]['scores'][intent] for i in common],
                                      [teacher[i]['scores'][intent] for i in common]) for intent in INTENTS}
        slices = {}
        for lang, pred in (('zh', is_zh), ('en', lambda t: not is_zh(t))):
            ids = [i for i in common if pred(prompts[i])]
            if ids:
                slices[lang] = {'n': len(ids),
                                'exact': sum(1 for i in ids if rows[i]['gold'] == teacher[i]['gold']) / len(ids),
                                'graded': sum(graded(rows[i]['gold'], rows[i].get('secondary', []),
                                                     teacher[i]['gold'], teacher[i].get('secondary', [])) for i in ids) / len(ids)}
        report['candidates'][name] = {
            'sha256': hashlib.sha256((data / name).read_bytes()).hexdigest(),
            'n': len(common), 'primaryExact': exact / len(common),
            'gradedMean': sum(grades) / len(grades),
            'meanTopScore': top_mean, 'meanScoreByIntent': dist,
            'rankCorrByIntent': rank_corr,
            'nullRate': sum(1 for i in common if rows[i]['gold'] is None) / len(common),
            'teacherNullRate': sum(1 for i in common if teacher[i]['gold'] is None) / len(common),
            'slices': slices,
            'routing': {},
        }
        for i in common:
            routed = (rows[i].get('labeler') or {}).get('routing', 'unknown')
            report['candidates'][name]['routing'][routed] = \
                report['candidates'][name]['routing'].get(routed, 0) + 1
    # Backend parity over shared ids.
    if len(args.cand) == 2:
        a, b = (cands[args.cand[0]], cands[args.cand[1]])
        same_route = sum(1 for i in common
                         if (a[i].get('labeler') or {}).get('routing') == (b[i].get('labeler') or {}).get('routing'))
        same_gold = sum(1 for i in common if a[i]['gold'] == b[i]['gold'])
        deltas = [max(abs(a[i]['scores'][k] - b[i]['scores'][k]) for k in INTENTS) for i in common]
        report['parity'] = {'pair': list(args.cand), 'n': len(common),
                            'routingAgreement': same_route / len(common),
                            'derivedGoldAgreement': same_gold / len(common),
                            'maxAbsDeltaMean': sum(deltas) / len(deltas),
                            'maxAbsDeltaP95': sorted(deltas)[int(len(deltas) * 0.95)]}
    Path(args.out).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({k: v for k, v in report.items() if k != 'candidates'}, indent=2))
    for name, c in report['candidates'].items():
        print(f"{name}: exact={c['primaryExact']:.3f} graded={c['gradedMean']:.3f} "
              f"top={c['meanTopScore']:.3f} null={c['nullRate']:.3f} routing={c['routing']} slices={c['slices']}")
    if 'parity' in report:
        print('parity:', json.dumps(report['parity']))
    return 0


if __name__ == '__main__':
    sys.exit(main())
