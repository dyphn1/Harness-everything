#!/usr/bin/env python3
"""No model calls: the same offline helper gate used locally and by CI."""
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
for file in sorted(HERE.glob('*.py')):
    compile(file.read_text(), str(file), 'exec')
for file in sorted(HERE.glob('*.test.py')):
    subprocess.run([sys.executable, str(file)], check=True)
for name in ('host-hook.cjs', 'hook.test.cjs', 'grader.cjs', 'grader.test.cjs'):
    subprocess.run(['node', '--check', str(HERE/name)], check=True)
for name in ('hook.test.cjs', 'grader.test.cjs'):
    subprocess.run(['node', str(HERE/name)], check=True)
subprocess.run([sys.executable, str(HERE/'replay.py'), '--check'], check=True)
subprocess.run([sys.executable, str(HERE/'export.py'), '--scan-only',
                *[str(HERE/name) for name in ('evidence.tar.gz', 'evidence', 'verification', 'preflight')]], check=True)
print('pilot offline helper gate PASS')
