#!/usr/bin/env python3
"""Check tracked formatter inputs in finite batches on a constrained host."""
from pathlib import Path
import resource
import subprocess
import sys


def main():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    names = subprocess.check_output(['git', 'ls-files', '-z']).split(b'\0')
    files = [name.decode() for name in names if name and Path(name.decode()).is_file()
             and Path(name.decode()).suffix in {'.js', '.mjs', '.json', '.md'}]
    command = ['node', '--max-old-space-size=256',
               'node_modules/prettier/bin/prettier.cjs', '--check',
               '--ignore-path', '.prettierignore']
    for offset in range(0, len(files), 64):
        batch = files[offset:offset + 64]
        print(f'Candidates {offset + 1}-{offset + len(batch)}/{len(files)}', flush=True)
        result = subprocess.run([*command, *batch], check=False)
        if result.returncode:
            return result.returncode
    print(f'PASS: all {len(files)} tracked formatter candidates in bounded batches.')
    return 0


if __name__ == '__main__':
    sys.exit(main())
