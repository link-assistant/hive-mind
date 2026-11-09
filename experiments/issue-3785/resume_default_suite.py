#!/usr/bin/env python3
"""Resume the serial default suite without overriding native worker heap limits."""
import os
import subprocess
import sys


def main():
    previous = sys.argv[1]
    environment = dict(os.environ)
    environment.pop('NODE_OPTIONS', None)
    files = subprocess.check_output(
        ['node', 'scripts/run-tests.mjs', '--suite', 'default', '--list'],
        env=environment, text=True,
    ).splitlines()
    start = files.index(previous)
    for index in range(start, len(files)):
        file = files[index]
        print(f'[{index + 1}/{len(files)}] {file}', flush=True)
        result = subprocess.run(['node', file], env=environment, check=False)
        if result.returncode:
            return result.returncode
    print(f'PASS: all {len(files) - start} remaining default test files.', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
