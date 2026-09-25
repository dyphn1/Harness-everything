"""Print the trainer's n-gram features for texts on stdin (JSON list) so the Node provider can be compared exactly."""
import importlib.util
import json
from pathlib import Path
import sys

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('ngram_trainer', ROOT / 'scripts' / 'system-one-train-ngram.py')
trainer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(trainer)
assert 'torch' not in sys.modules, 'importing the ngram trainer must not import torch'

request = json.loads(sys.stdin.read())
out = []
for text in request['texts']:
    feats = trainer.featurize(text, request['nmax'], request['dim'])
    out.append({str(k): v for k, v in sorted(feats.items())})
print(json.dumps({'hash': [trainer.fnv1a32(s) for s in request['hashes']], 'features': out}))
