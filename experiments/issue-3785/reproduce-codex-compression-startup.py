#!/usr/bin/env python3
"""Preserve startup diagnostics from the bounded synthetic compression fixture."""
import argparse
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('binary', type=Path)
args = parser.parse_args()
directory = Path(__file__).resolve().parent
sys.path.insert(0, str(directory))
spec = importlib.util.spec_from_file_location('compression_probe', directory / 'probe-codex-native-compression.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
initialize = module.Native.initialize


def diagnosed_initialize(self):
    try:
        return initialize(self)
    except Exception:
        print(self.diagnostic(), file=sys.stderr, flush=True)
        raise


module.Native.initialize = diagnosed_initialize
module.run(SimpleNamespace(binary=args.binary.resolve(strict=True), without_selector=False,
                           without_path_selector=False, expect_independent_locks=False,
                           expect_private_metadata=False))
