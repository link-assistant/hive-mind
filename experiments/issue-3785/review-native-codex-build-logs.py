#!/usr/bin/env python3
"""Index preserved CI text diagnostics in chunks of at most 1,500 lines.

This is a diagnostic index, not an artifact or test-success admission gate.
Never pass credential files or diagnostic executable directories to this tool.
"""
import argparse
import hashlib
import itertools
import json
from pathlib import Path
import re

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('paths', nargs='+', type=Path)
parser.add_argument('--output', required=True, type=Path)
args = parser.parse_args()
pattern = re.compile(r'##\[error\]|^(?:Traceback|ValueError:|AssertionError:|error:|error\[E\d)|Finished `release`|^FAIL:')
report = {}
for supplied in args.paths:
    files = sorted(supplied.rglob('*')) if supplied.is_dir() else [supplied]
    for file in files:
        if not file.is_file() or file.suffix not in ('.log', '.json'):
            continue
        digest = hashlib.sha256()
        lines = chunks = commands = compiles = 0
        findings = []
        with file.open('rb') as stream:
            while part := list(itertools.islice(stream, 1500)):
                chunks += 1
                for raw in part:
                    lines += 1
                    digest.update(raw)
                    line = raw.decode('utf8', errors='replace').rstrip()
                    commands += line.lstrip().startswith('Running `')
                    compiles += line.lstrip().startswith('Compiling ')
                    if pattern.search(line):
                        findings.append({'line': lines, 'message': line[:2048]})
        report[str(file)] = {'lines': lines, 'chunks': chunks, 'sha256': digest.hexdigest(),
                             'verboseCommands': commands, 'compiles': compiles,
                             'findings': findings}
args.output.write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'files': len(report), 'lines': sum(item['lines'] for item in report.values()),
                  'chunks': sum(item['chunks'] for item in report.values()),
                  'findings': {name: item['findings'] for name, item in report.items() if item['findings']}}, indent=2))
