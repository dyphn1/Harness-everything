#!/usr/bin/env python3
"""Stdlib tests for scripts/system-one-tier-stage-experiment.py (no torch)."""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
exp = __import__('system-one-tier-stage-experiment')

assert all(len(o.encode()) <= 96 for o in exp.OPTIONS), 'option text fits option_tokens'
prompts = [
    {'id': 'a', 'split': 'validation', 'text': 'add a --verbose flag to the CLI parser and tests'},
    {'id': 'b', 'split': 'validation', 'text': 'go next'},
    {'id': 'c', 'split': 'validation', 'text': 'commit and push the docs branch please'},
    {'id': 'd', 'split': 'validation', 'text': '這份應該就是呼應剛剛的機制'},
]
rows = {r['id']: r for r in exp.tier_rows(prompts, {'a': 'tier2', 'b': 'tier2', 'c': 'tier1', 'd': None}, set())}
assert rows['a']['valid'] and rows['a']['tierTargets'] == [0.0, 1.0, 0.0]
assert not rows['b']['valid'] and rows['b']['tierTargets'] == [0.0, 0.0, 0.0], 'a rule continuation is invalid'
assert not rows['d']['valid'] and rows['d']['tierTargets'] == [0.0, 0.0, 0.0]
assert exp.pick([0.2, 0.7, 0.6]) == 1 and exp.pick([0.1, 0.4, 0.3]) is None

order = [rows[k] for k in 'abcd']
m = exp.tier_metrics(order, [[0.1, 0.1, 0.9], [0.1, 0.2, 0.1], [0.9, 0.1, 0.1], [0.6, 0.1, 0.1]])
assert m['validRows'] == 2 and m['invalidRows'] == 2
assert m['coverage'] == 1.0 and m['exactPrecision'] == 0.5, m
assert m['acceptablePrecision'] == 1.0 and m['underRate'] == 0.0, 'tier3 for tier2 gold is one above: acceptable'
assert m['invalidAbstainRate'] == 0.5
assert m['perTier']['tier1']['recall'] == 1.0

print('system-one tier stage experiment tests passed')

pipe = __import__('system-one-pipeline-eval')
tiers = {'a': [0.1, 0.9, 0.1], 'b': [0.1, 0.9, 0.1], 'c': [0.8, 0.1, 0.1], 'd': [0.1, 0.1, 0.1]}
no_gate = pipe.pipeline_metrics(order, None, tiers)
assert no_gate['invalidGotTier'] == 0.5 and no_gate['invalidHandedOff'] == 0.0, 'b gets a tier without a gate'
assert no_gate['suggestionPrecisionAllRows'] == 2 / 3
gated = pipe.pipeline_metrics(order, {'a': 0.1, 'b': 0.9, 'c': 0.6, 'd': 0.2}, tiers, gate_tau=0.5)
assert gated['invalidHandedOff'] == 0.5 and gated['invalidGotTier'] == 0.0
assert gated['validHandedOff'] == 0.5 and gated['validCoverage'] == 0.5, 'c is wrongly handed off'
assert gated['suggestionPrecisionAllRows'] == 1.0

print('system-one pipeline eval tests passed')
