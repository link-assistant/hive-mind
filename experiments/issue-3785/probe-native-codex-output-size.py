#!/usr/bin/env python3
"""Check a preserved compiler output against the actual packaging size bound.

This checks bounded copy, ELF identity and pinned version, not source provenance
or complete artifact admission. Keep unadmitted diagnostic binaries separate.
"""
import argparse
import importlib.util
from pathlib import Path
import sys
import tempfile

sys.dont_write_bytecode = True
root = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location('native_build', root / 'scripts/build-native-codex.py')
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('binary', type=Path)
parser.add_argument('--platform', choices=('linux-x64', 'linux-arm64'), required=True)
parser.add_argument('--sha256', required=True)
parser.add_argument('--expect-size-refusal', action='store_true')
parser.add_argument('--copy-only', action='store_true', help='Inspect a foreign-platform ELF without executing it.')
args = parser.parse_args()
source = args.binary.resolve(strict=True)
assert build.sha256(source) == args.sha256, 'Preserved diagnostic binary changed.'
recipe, _ = build.load_recipe()
before = source.stat()
with tempfile.TemporaryDirectory(prefix='hive-native-size-') as temporary:
    copied = Path(temporary) / 'codex'
    if args.expect_size_refusal:
        try:
            build.copy_compiler_binary(source, copied, recipe['maxBinaryBytes'])
        except ValueError as error:
            assert str(error) == 'Compiler output size is outside the admitted bound.'
        else:
            raise AssertionError('The preserved size failure no longer reproduces.')
        assert not copied.exists(), 'Size refusal published an executable.'
        print(f'PASS: observed {before.st_size} bytes exceeds old {recipe["maxBinaryBytes"]}-byte bound.')
    else:
        build.copy_compiler_binary(source, copied, recipe['maxBinaryBytes'])
        identity = build.inspect_binary(copied, recipe, args.platform)
        assert identity == {'bytes': before.st_size, 'sha256': args.sha256}
        assert copied.stat().st_nlink == 1 and copied.stat().st_ino != before.st_ino
        if not args.copy_only:
            build.verify_version(copied, recipe)
        checked = 'copies and hashes' if args.copy_only else 'copies, hashes and reports the pinned native version'
        print(f'PASS: actual {before.st_size}-byte optimized output {checked} within {recipe["maxBinaryBytes"]} bytes.')
after = source.stat()
assert all(getattr(after, name) == getattr(before, name) for name in
           ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink', 'st_uid', 'st_mode')), 'Compiler output was mutated.'
