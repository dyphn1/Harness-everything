"""Stub scorer behind the real resident server code; never model-quality evidence."""
import importlib.util
from pathlib import Path
import sys
import time

sys.dont_write_bytecode = True  # never leave __pycache__ in the source tree that packaging copies
path = Path(__file__).resolve().parents[2] / 'harness-everything/scripts/system-one/cua_adapter.py'
spec = importlib.util.spec_from_file_location('adapter', path)
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def factory(weights, manifest):
    if manifest['modelId'] == 'stub-fail':
        raise ValueError('load-failed')

    def score(request):
        if manifest['modelId'] == 'stub-slow':
            time.sleep(3)
        return [1.0] + [0.0] * (len(request['options']) - 1)
    return score, {'context_tokens': 224, 'option_tokens': 96}


if __name__ == '__main__':
    if sys.argv[1:2] != ['--serve']:
        sys.exit(2)
    sys.exit(adapter.serve_main(sys.argv[2:], scorer_factory=factory))
