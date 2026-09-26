#!/usr/bin/env python3
"""Stdlib tests for scripts/system-one-noise-experiment.py (no torch)."""
import sys
from pathlib import Path

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
exp = __import__('system-one-noise-experiment')

for text in ('go', 'go next', 'OK go next', '好', '完成了', '請繼續', 'continue', 'yes do it', 'A', '1, 2', '方案 2',
             'OK\r\n選B', 'try again', 'creatorComment', 'D:\\super.h2o.ide\\a\\b.csproj'):
    assert exp.rule(text) == 'continuation', (text, exp.rule(text))
for text in ('hi', 'THX', '[Request interrupted by user]', '<subagent_notification>\n{}',
             '```\nParse error on line 4:\n...', '$ git fetch-all\nexpansion failed'):
    assert exp.rule(text) == 'no-request', (text, exp.rule(text))
for text in ('修正這問題', 'git status', 'commit & push', 'fix the flaky parser test',
             'D:\\BIOS\\AVM5.7\n我剛測試這包 編譯成功後找不到檔案\n幫我確認',
             '$ npm test\nFAIL parser\nplease fix this', '先改文件再派發'):
    assert exp.rule(text) is None, (text, exp.rule(text))

prompts = [
    {'id': 'a', 'split': 'train', 'text': 'go next'},
    {'id': 'b', 'split': 'train', 'text': 'add a --verbose flag to the CLI parser'},
    {'id': 'c', 'split': 'train', 'text': '修正一下'},
    {'id': 'd', 'split': 'train', 'text': '這份應該就是呼應剛剛的機制'},
    {'id': 'e', 'split': 'validation', 'text': 'hello'},
    {'id': 'x', 'split': 'train', 'text': 'excluded'},
]
tiers = {'a': 'tier2', 'b': 'tier2', 'c': 'tier2', 'd': None, 'e': None, 'x': 'tier1'}
rows = {r['id']: r for r in exp.label_rows(prompts, tiers, {'x'})}
assert set(rows) == {'a', 'b', 'c', 'd', 'e'}
assert rows['a']['bucket'] == 'rule-continuation' and rows['a']['targets'] == [0.0, 1.0, 0.0], 'rule beats a tier label'
assert rows['b']['bucket'] == 'tier-long' and rows['b']['seed']
assert rows['c']['bucket'] == 'tier-short' and not rows['c']['seed']
assert rows['d']['bucket'] == 'null-unruled' and rows['d']['mask'] == [1, 0, 0], 'unknown subtype is masked'
assert rows['e']['bucket'] == 'rule-no-request'

assert exp.auroc([0.9, 0.8, 0.1], [True, True, False]) == 1.0
assert exp.auroc([0.5, 0.5], [True, False]) == 0.5
assert exp.auroc([0.1], [True]) is None
assert exp.ece([1.0, 0.0], [1, 0]) == 0.0
m = exp.gate_metrics([rows['a'], rows['b']], [[0.1, 0.8, 0.1], [0.9, 0.05, 0.05]])
assert m['auroc'] == 1.0 and m['confidentNoise'] == 1.0 and m['confidentActionable'] == 1.0
assert m['subtypeAccuracyOnRuleRows'] == 1.0

print('system-one noise experiment tests passed')
