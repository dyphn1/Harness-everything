#!/usr/bin/env python3
"""Trial build of the relevance-native System One readout (#233), for local testing.

Implements the stage order of docs/system-one-suggestion-gates.md on one
prompt at a time, from the current prompt text only:

  1. validity  invalid at or above 0.5 -> no suggestion, hand off to the host agent
  2. intent    every intent at or above its threshold, highest first, capped at 3
  3. tier      tier3 when feature or refactor fired; else the tier scorer's pick
               (highest tier score at or above 0.5); else abstain

Not included: the deterministic structural floor, explicit workflow requests
and every policy gate; those stay in the Harness router. This is a research
trial, not a production provider: thresholds were fit on validation, and the
models are single-seed.

  build  --build-dir DIR --data-dir DIR   fit intent thresholds and write trial-manifest.json
  score  --build-dir DIR [PROMPT ...]     score prompts (argv, or one per stdin line)
  eval   --build-dir DIR --cases FILE     score labeled cases and report aggregates
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys
import time

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
CAP = 3
GATE_TAU = 0.5
TIER_TAU = 0.5
TIER3_INTENTS = ('feature', 'refactor')


def readout(gate_p, intent_p, tier_p, taus, catalog, tiers):
    """Pure readout from the three score vectors; see the module docstring."""
    if gate_p >= GATE_TAU:
        return {'validity': 'invalid', 'invalidScore': round(gate_p, 3), 'handoff': 'host-agent',
                'intents': [], 'tier': None}
    fired = sorted((c for c in catalog if intent_p[c] >= taus[c]), key=lambda c: -intent_p[c])
    tier3 = [c for c in TIER3_INTENTS if intent_p[c] >= taus[c]]
    if tier3:
        tier, source = 'tier3', 'intent:' + '+'.join(tier3)
    else:
        best = max(range(len(tiers)), key=lambda k: tier_p[k])
        tier, source = (tiers[best], 'tier-scorer') if tier_p[best] >= TIER_TAU else (None, 'abstain')
    return {'validity': 'actionable', 'invalidScore': round(gate_p, 3),
            'intents': [{'id': c, 'p': round(intent_p[c], 3)} for c in fired[:CAP]],
            'tier': tier, 'tierSource': source, 'tierScores': dict(zip(tiers, (round(x, 3) for x in tier_p)))}


def sha256(path):
    h = hashlib.sha256()
    with open(path, 'rb') as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()


def paths(root, intent_variant='valid-only'):
    return {'gate': root / 'gate' / 'control.safetensors', 'intent': root / 'intent' / f'{intent_variant}.safetensors',
            'tier': root / 'tier' / 'curriculum.safetensors'}


def build(args):
    """Fit per-intent thresholds on the valid validation rows (max F1 vs teacher >= 0.4) and write the manifest."""
    intent_exp = __import__('system-one-intent-stage-experiment')
    trainer = __import__('system-one-train')
    root = Path(args.build_dir)
    probs = json.load(open(root / 'intent' / 'val-probs-private.json'))[args.intent_variant]
    scores = {r['id']: r.get('scores', {}) for r in trainer.load_jsonl(Path(args.data_dir) / 'labels-intent-scores.jsonl')}
    ids = [i for i in probs if i in scores]
    taus = {c: intent_exp.fit_tau([probs[i][c] for i in ids], [scores[i].get(c, 0.0) >= 0.4 for i in ids])
            for c in intent_exp.CATALOG}
    manifest = {'schemaVersion': 1, 'kind': 'system-one-trial', 'built': time.strftime('%Y-%m-%d'),
                'stages': ['validity', 'intent', 'tier'], 'gateTau': GATE_TAU, 'tierTau': TIER_TAU, 'cap': CAP,
                'intentTaus': taus, 'intentTausFitOn': f'{len(ids)} validation rows (in-sample for the trial)',
                'intentVariant': args.intent_variant,
                'checkpoints': {k: {'path': str(v.relative_to(root)), 'sha256': sha256(v)} for k, v in paths(root, args.intent_variant).items()},
                'notIncluded': ['structural floor', 'explicit workflow requests', 'policy gates']}
    json.dump(manifest, open(root / 'trial-manifest.json', 'w'), indent=2)
    print(json.dumps(manifest, indent=2))


def summarize(cases, results):
    """Aggregates for labeled cases {text, lang, tier, intent}: all cases are actionable by construction."""
    tiers = ('tier1', 'tier2', 'tier3')
    out = {}
    for lang in ['all'] + sorted({c['lang'] for c in cases}):
        pairs = [(c, r) for c, r in zip(cases, results) if lang == 'all' or c['lang'] == lang]
        acted = [(c, r) for c, r in pairs if r['validity'] == 'actionable']
        picks = [(tiers.index(c['tier']), tiers.index(r['tier'])) for c, r in acted if r['tier']]
        n = max(1, len(picks))
        out[lang] = {'cases': len(pairs), 'wronglyInvalid': 1 - len(acted) / max(1, len(pairs)),
                     'tierCoverage': len(picks) / max(1, len(acted)),
                     'tierAcceptable': sum(1 for g, k in picks if k in (g, g + 1)) / n,
                     'tierExact': sum(1 for g, k in picks if k == g) / n,
                     'tierUnder': sum(1 for g, k in picks if k < g) / n,
                     'primaryIntentInTop3': sum(1 for c, r in acted if c['intent'] in [i['id'] for i in r['intents']])
                     / max(1, len(acted))}
    return out


def score(args):
    import torch
    from cua_s1.model import ChoiceExample, load_checkpoint
    noise = __import__('system-one-noise-experiment')
    intent_exp = __import__('system-one-intent-stage-experiment')
    tier_exp = __import__('system-one-tier-stage-experiment')
    root = Path(args.build_dir)
    manifest = json.load(open(root / 'trial-manifest.json'))
    for name, meta in manifest['checkpoints'].items():
        if sha256(root / meta['path']) != meta['sha256']:
            raise SystemExit(f'{name} checkpoint hash mismatch')
    torch.set_num_threads(max(1, args.threads))
    models = {k: load_checkpoint(root / v['path'], 'cpu')[:2] for k, v in manifest['checkpoints'].items()}
    options = {
        'gate': tuple(t for _, t in noise.OPTIONS_MERGED),
        'intent': tuple(f'{c}: {d}' for c, d in zip(intent_exp.CATALOG, intent_exp.DEFAULT_OPTIONS)),
        'tier': tier_exp.OPTIONS,
    }

    def run(stage, text):
        model, collator = models[stage]
        model.eval()
        with torch.no_grad():
            return model(collator([ChoiceExample(context=text, options=options[stage], label=0)])).sigmoid()[0].tolist()

    if getattr(args, 'cases', None):
        cases = [json.loads(l) for l in open(args.cases, encoding='utf-8') if l.strip()]
        results = []
        for c in cases:
            gate_p = run('gate', c['text'])[1]
            intent_p = dict(zip(intent_exp.CATALOG, run('intent', c['text'])))
            results.append(readout(gate_p, intent_p, run('tier', c['text']), manifest['intentTaus'],
                                   intent_exp.CATALOG, tier_exp.TIERS))
        print(json.dumps(summarize(cases, results), indent=2))
        return
    prompts = args.prompts or [line.rstrip('\n') for line in sys.stdin if line.strip()]
    for text in prompts:
        if len(text.encode('utf-8')) > 1024:
            print(json.dumps({'prompt': text[:40], 'validity': 'too-long', 'handoff': 'lexical'}, ensure_ascii=False))
            continue
        start = time.perf_counter()
        gate_p = run('gate', text)[1]
        intent_p = dict(zip(intent_exp.CATALOG, run('intent', text)))
        tier_p = run('tier', text)
        result = readout(gate_p, intent_p, tier_p, manifest['intentTaus'], intent_exp.CATALOG, tier_exp.TIERS)
        result['latencyMs'] = round((time.perf_counter() - start) * 1000, 1)
        print(json.dumps({'prompt': text, **result}, ensure_ascii=False))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    sub = ap.add_subparsers(dest='cmd', required=True)
    b = sub.add_parser('build')
    b.add_argument('--build-dir', required=True)
    b.add_argument('--data-dir', required=True)
    b.add_argument('--intent-variant', default='valid-only')
    s = sub.add_parser('score')
    s.add_argument('--build-dir', required=True)
    s.add_argument('--threads', type=int, default=1)
    s.add_argument('prompts', nargs='*')
    e = sub.add_parser('eval')
    e.add_argument('--build-dir', required=True)
    e.add_argument('--cases', required=True)
    e.add_argument('--threads', type=int, default=1)
    args = ap.parse_args(argv)
    (build if args.cmd == 'build' else score)(args)


if __name__ == '__main__':
    main()
