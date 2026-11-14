"""Stdlib-only tests for CUA-S1 targets and data handling (no torch needed)."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('trainer', ROOT / 'scripts' / 'system-one-train.py')
trainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trainer)
assert 'torch' not in sys.modules, 'importing the trainer must not import torch'

tier_catalog = trainer.catalog_for('tier')
intent_catalog = trainer.catalog_for('intent')
validity_catalog = trainer.catalog_for('validity')
assert [o['id'] for o in tier_catalog] == ['tier1', 'tier2', 'tier3'], tier_catalog
assert [o['id'] for o in intent_catalog][-1] == 'unclassified', intent_catalog
assert [o['id'] for o in validity_catalog] == ['invalid'], validity_catalog

validity_rows = [
    {'id': 'valid', 'gold': 'tier2'},
    {'id': 'invalid', 'gold': None},
]
assert [trainer.build_targets(r, validity_catalog, 'validity') for r in validity_rows] == [[0.0], [1.0]]
print('PASS validity target: all labeled rows; invalid iff tier gold is null')

intent_row = {'id': 'intent', 'gold': 'fix', 'secondary': ['test']}
intent_ids = [o['id'] for o in intent_catalog]
intent_targets = trainer.build_targets(intent_row, intent_catalog, 'intent')
assert intent_targets[intent_ids.index('fix')] == 1.0
assert intent_targets[intent_ids.index('test')] == 1.0
assert sum(intent_targets) == 2.0
assert intent_targets[intent_ids.index('unclassified')] == 0.0
print('PASS intent target: hard multi-hot for gold and secondary')

tier_row = {'id': 'tier', 'gold': 'tier2'}
tier_targets = trainer.build_targets(tier_row, tier_catalog, 'tier')
assert tier_targets == [0.0, 1.0, 0.0]
print('PASS tier target: three-way one-hot on valid rows')

scores_row = {'id': 'scored', 'gold': 'fix', 'secondary': ['test'],
              'scores': {'fix': 0.9, 'test': 0.55}}
scores_targets = trainer.build_targets(scores_row, intent_catalog, 'intent', target='scores')
assert scores_targets[intent_ids.index('fix')] == 0.9
assert scores_targets[intent_ids.index('test')] == 0.55
assert scores_targets[intent_ids.index('git')] == 0.0
print('PASS intent target: soft scores from labels-intent-scores rows')

intent_rows = [{'id': 'valid', 'gold': 'fix', 'secondary': []},
               {'id': 'invalid', 'gold': None, 'secondary': []}]
assert trainer.eligible_rows(validity_rows, 'validity') == validity_rows
assert trainer.eligible_rows(intent_rows, 'intent') == [intent_rows[0]]
assert trainer.eligible_rows(validity_rows, 'tier') == [validity_rows[0]]
assert trainer.build_targets(validity_rows[1], validity_catalog, 'validity') == [1.0]
assert trainer.target_gold(validity_rows[0], 'validity') == 'actionable'
assert trainer.target_gold(validity_rows[1], 'validity') == 'invalid'
print('PASS null handling: validity keeps null; intent and tier exclude it')

record = trainer.validation_record(tier_row, tier_catalog, [0.1, 0.8, 0.2], 'tier')
assert record == {'id': 'tier', 'gold': 'tier2', 'scores': {'tier1': 0.1, 'tier2': 0.8, 'tier3': 0.2}}
print('PASS validation score rows use independent option-keyed scores')

prompts = [
    {'id': 'a', 'family': 'f1', 'source': 'claude', 'split': 'train', 'text': 'commit'},
    {'id': 'b', 'family': 'f2', 'source': 'vscode', 'split': 'validation', 'text': 'fix the parser'},
    {'id': 'c', 'family': 'f3', 'source': 'codex', 'split': 'train', 'text': 'unlabeled prompt'},
    {'id': 'd', 'family': 'f4', 'source': 'codex', 'split': 'train', 'text': 'owner override'},
]
labels = [{'id': 'a', 'gold': 'tier1'}, {'id': 'b', 'gold': None}, {'id': 'd', 'gold': 'tier3'}]
examples = trainer.join(prompts, labels)
assert [(e['id'], e['split'], e['gold']) for e in examples] == [
    ('a', 'train', 'tier1'), ('b', 'validation', None), ('d', 'train', 'tier3')], examples
try:
    trainer.join(prompts, labels + [{'id': 'a', 'gold': 'tier2'}])
    raise SystemExit('duplicate labels must be rejected')
except ValueError:
    pass

lengths = [10, 1024, 300, 5, 700, 1024, 50] * 20
assert trainer.TOKEN_BUDGET == 16384, trainer.TOKEN_BUDGET


def batch_cost(items, lengths, n_options):
    return len(items) * (max(lengths[i] for i in items) + n_options * trainer.OPTION_TOKENS)


intent_batches = trainer.make_batches(lengths, 16384, 12, trainer.OPTION_TOKENS)
flat = sorted(i for b in intent_batches for i in b)
assert flat == list(range(len(lengths))), 'every example exactly once'
assert all(batch_cost(b, lengths, 12) <= 16384 for b in intent_batches), 'whole forward pass within the budget'
assert intent_batches == trainer.make_batches(lengths, 16384, 12, trainer.OPTION_TOKENS), 'deterministic'
print('PASS batches: 12 options count toward the budget, every example once, deterministic')

# Default budget caps long-prompt batches tightly: a 1024-token prompt plus every option pass must fit.
long_prompts = [1024] * 64
one_option = trainer.make_batches(long_prompts, trainer.TOKEN_BUDGET, 1, trainer.OPTION_TOKENS)
twelve_options = trainer.make_batches(long_prompts, trainer.TOKEN_BUDGET, 12, trainer.OPTION_TOKENS)
assert max(len(b) for b in one_option) == 16384 // (1024 + 96), max(len(b) for b in one_option)
assert max(len(b) for b in twelve_options) == 16384 // (1024 + 1152), max(len(b) for b in twelve_options)
assert all(batch_cost(b, long_prompts, 1) <= trainer.TOKEN_BUDGET for b in one_option)
assert all(batch_cost(b, long_prompts, 12) <= trainer.TOKEN_BUDGET for b in twelve_options)
print('PASS batches: default 16384 budget caps 1024-token prompts at 14 examples (1 option) and 7 (12 options)')

with tempfile.TemporaryDirectory() as tmp:
    p = Path(tmp) / 'rows.jsonl'
    p.write_text('\n'.join(json.dumps(r) for r in prompts) + '\n', encoding='utf-8')
    assert trainer.load_jsonl(p) == prompts
    assert len(trainer.sha256_file(p)) == 64

# Holdout scoring must key scores by the trained catalog in manifest order, not the fixture's own options.
score_spec = importlib.util.spec_from_file_location('scorer', ROOT / 'scripts' / 'system-one-cycle' / 'score.py')
scorer = importlib.util.module_from_spec(score_spec)
score_spec.loader.exec_module(scorer)
assert 'torch' not in sys.modules, 'importing the scorer must not import torch'

stage_options = {'validity': ['invalid'], 'intent': [o['id'] for o in intent_catalog], 'tier': ['tier1', 'tier2', 'tier3']}
holdouts = {'validity': trainer.DEFAULT_HOLDOUT, 'intent': trainer.DEFAULT_INTENT_HOLDOUT, 'tier': trainer.DEFAULT_HOLDOUT}
with tempfile.TemporaryDirectory() as tmp:
    manifest = Path(tmp) / 'manifest.json'
    version_manifest = {
        'schemaVersion': 1,
        'version': 'fixture-v1',
        'createdAt': '2026-01-01T00:00:00.000Z',
        'stages': {task: {
            'weights': f'{task}.safetensors',
            'config': f'{task}.json',
            'sha256': '0' * 64,
            'options': ids,
            'thresholds': {option_id: 0.5 for option_id in ids},
        } for task, ids in stage_options.items()},
        'evaluation': None,
    }
    manifest.write_text(json.dumps(version_manifest), encoding='utf-8')
    weights = str(Path(tmp) / 'tier.safetensors')
    for task, options in stage_options.items():
        catalog = scorer.trained_catalog(weights, task, str(holdouts[task]))
        assert [o['id'] for o in catalog] == options, (task, catalog)
        assert {o['id']: o['text'] for o in catalog} == {
            o['id']: o['text'] for o in trainer.catalog_for(task, str(holdouts[task]))
        }, task
    tier_ids = set(stage_options['tier'])
    tier_cases = json.loads(trainer.DEFAULT_HOLDOUT.read_text(encoding='utf-8'))['cases']
    assert all(scorer.eligible(c, 'tier', tier_ids) == (c['gold'] in tier_ids) for c in tier_cases)
    assert any(not scorer.eligible(c, 'tier', tier_ids) for c in tier_cases), 'tier holdout must carry skipped cases'
    intent_ids = set(stage_options['intent'])
    intent_cases = json.loads(trainer.DEFAULT_INTENT_HOLDOUT.read_text(encoding='utf-8'))['cases']
    assert all(scorer.eligible(c, 'intent', intent_ids) for c in intent_cases)
    assert scorer.eligible({'gold': None}, 'validity', set())
print('PASS holdout scores use the trained catalog in manifest order; non-catalog golds are skipped')

print('system-one trainer data tests passed')
