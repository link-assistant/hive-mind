#!/usr/bin/env python3
"""Compile the exact storage/intent modules without the full native dependency graph."""
from pathlib import Path
import shutil
import subprocess
import tempfile

package = Path(__file__).resolve().parent
with tempfile.TemporaryDirectory(prefix='hive-refresh-intent-build-') as temporary:
    directory = Path(temporary)
    storage = (package / 'canonical_auth.rs').read_text()
    storage += '\n#[path = "canonical_refresh_intent.rs"]\nmod refresh_intent;\n'
    (directory / 'canonical_auth.rs').write_text(storage)
    for name in ['canonical_refresh_intent.rs', 'canonical_refresh_intent_tests.rs']:
        shutil.copyfile(package / name, directory / name)
    binary = directory / 'intent-tests'
    subprocess.run(['rustc', '+1.99.1', '--edition', '2024', '--test',
                    str(directory / 'canonical_refresh_intent_tests.rs'), '-o', str(binary)], check=True)
    subprocess.run(['prlimit', '--data=134217728', '--stack=8388608', '--core=0', '--',
                    str(binary), '--test-threads=1'], check=True)
