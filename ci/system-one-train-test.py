"""Stdlib-only tests for the System One trainer's data handling (no torch needed)."""
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

catalog = trainer.catalog_from_holdout(ROOT / 'benchmarks' / 'fixtures' / 'system-one-holdout.json')
assert [o['id'] for o in catalog] == ['tier1', 'tier2', 'tier3', 'unclassified'], catalog
assert all(o['text'] for o in catalog)
assert trainer.label_index('tier2', catalog) == 1
assert trainer.label_index(None, catalog) == 3
try:
    trainer.label_index('tier9', catalog)
    raise SystemExit('unknown gold must be rejected')
except ValueError:
    pass

prompts = [
    {'id': 'a', 'family': 'f1', 'source': 'claude', 'split': 'train', 'text': 'commit'},
    {'id': 'b', 'family': 'f2', 'source': 'vscode', 'split': 'validation', 'text': 'fix the parser'},
    {'id': 'c', 'family': 'f3', 'source': 'codex', 'split': 'train', 'text': 'unlabeled prompt'},
    {'id': 'd', 'family': 'f4', 'source': 'codex', 'split': 'train', 'text': 'owner override'},
]
labels = [{'id': 'a', 'gold': 'tier1'}, {'id': 'b', 'gold': None}, {'id': 'd', 'gold': 'tier3'}]
overrides = [{'id': 'd', 'gold': 'tier2'}]
examples = trainer.join(prompts, labels, overrides)
assert [(e['id'], e['split'], e['gold']) for e in examples] == [('a', 'train', 'tier1'), ('b', 'validation', None), ('d', 'train', 'tier2')], examples
try:
    trainer.join(prompts, labels + [{'id': 'a', 'gold': 'tier2'}], [])
    raise SystemExit('duplicate labels must be rejected')
except ValueError:
    pass

lengths = [10, 1024, 300, 5, 700, 1024, 50] * 20
batches = trainer.make_batches(lengths, token_budget=4096)
flat = sorted(i for b in batches for i in b)
assert flat == list(range(len(lengths))), 'every example exactly once'
assert all(len(b) * max(lengths[i] for i in b) <= 4096 or len(b) == 1 for b in batches), 'budget respected'
assert batches == trainer.make_batches(lengths, token_budget=4096), 'deterministic'

with tempfile.TemporaryDirectory() as tmp:
    p = Path(tmp) / 'rows.jsonl'
    p.write_text('\n'.join(json.dumps(r) for r in prompts) + '\n', encoding='utf-8')
    assert trainer.load_jsonl(p) == prompts
    assert len(trainer.sha256_file(p)) == 64

print('system-one trainer data tests passed')
