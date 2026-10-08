#!/usr/bin/env python3
"""Run the CLI regression against the base revision, restoring the working file."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
config = root / 'src/solve.config.lib.mjs'
current = config.read_bytes()
base = sys.argv[1] if len(sys.argv) > 1 else 'origin/main'
try:
    config.write_bytes(subprocess.check_output(
        ['git', 'show', f'{base}:src/solve.config.lib.mjs'], cwd=root))
    result = subprocess.run([
        'node', '--test', '--test-name-pattern', 'CLI accepts|hive accepts',
        'tests/auto-base-branch-creation-1771.test.mjs',
    ], cwd=root)
finally:
    config.write_bytes(current)
sys.exit(result.returncode)
