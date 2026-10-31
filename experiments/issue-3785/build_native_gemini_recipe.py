#!/usr/bin/env python3
"""Generate packaged, hash-checked native Gemini edits from the verified packages."""
import argparse
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tarfile

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('archive', type=Path)
parser.add_argument('upstream', type=Path)
parser.add_argument('tested', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()
integrity = 'B+flaYBNqX2zO71I5/gu7ZsnI38NlpOl654HWz+bK8I/P5sGILQsbkTOQ5a9V+w1Q6QO3wf9PlqtuMsl7XxpNQ=='
with args.archive.open('rb') as stream:
    assert base64.b64encode(hashlib.file_digest(stream, 'sha512').digest()).decode() == integrity
assert json.loads((args.upstream / 'package.json').read_text())['version'] == '0.65.0'
assert hashlib.sha256((args.tested / 'bundle/chunk-DKZARV6U.js').read_bytes()).hexdigest() == '80152a26cf924992ac283a92e1b9b2252326cf6a417edc1c4b147088ca154733'
assert hashlib.sha256((args.tested / 'bundle/hive-gemini-publication.mjs').read_bytes()).hexdigest() == '3b2b4dbc2296e6da81d314879e466f100f211579ebee13a63a74d9129bae28d8'
args.output.mkdir(parents=True, exist_ok=False)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def save(name, value):
    data = (json.dumps(value, ensure_ascii=False, indent=2) + '\n').encode()
    (args.output / name).write_bytes(data)
    return digest(data)


inventory = {}
with tarfile.open(args.archive) as archive:
    for member in sorted(archive.getmembers(), key=lambda item: item.name):
        if not member.isfile():
            continue
        name = member.name.removeprefix('package/')
        assert member.name.startswith('package/') and '..' not in Path(name).parts
        data = archive.extractfile(member).read()
        assert (args.upstream / name).read_bytes() == data
        inventory[name] = f'{digest(data)}:{len(data)}:{member.mode & 0o755}'


def edits(before, after):
    command = ['git', 'diff', '--no-index', '--no-ext-diff', '--no-textconv', '--diff-algorithm=myers', '--indent-heuristic', '--unified=0', '--', str(before), str(after)]
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    assert result.returncode == 1, result.stderr
    operations = []
    operation = None
    for line in (part + '\n' for part in result.stdout.split('\n')[:-1]):
        match = re.match(r'^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@', line)
        if match:
            count = int(match[2] or 1)
            operation = {'at': int(match[1]) - (1 if count else 0), 'remove': [], 'insert': []}
            operations.append(operation)
        elif operation is not None and line.startswith('-'):
            operation['remove'].append(line[1:])
        elif operation is not None and line.startswith('+'):
            operation['insert'].append(line[1:])
        elif line.startswith('\\ No newline'):
            raise AssertionError('Native recipe requires complete source lines.')
    text = before.read_bytes().decode('utf8')
    lines = [part + '\n' for part in text.split('\n')[:-1]]
    if not text.endswith('\n'):
        lines.append(text.split('\n')[-1])
    for operation in reversed(operations):
        start = operation['at']
        old = operation['remove']
        assert lines[start:start + len(old)] == old, (before.name, start)
        lines[start:start + len(old)] = operation['insert']
    assert ''.join(lines).encode() == after.read_bytes()
    return operations


patches = {}
for target in sorted((args.tested / 'bundle').rglob('*')):
    if not target.is_file():
        continue
    relative = str(target.relative_to(args.tested))
    before = args.upstream / relative
    data = target.read_bytes()
    if before.exists() and before.read_bytes() == data:
        continue
    if before.exists():
        payload = {'edits': edits(before, target)}
    else:
        lines = target.read_text().splitlines(keepends=True)
        # Preserve exact native bytes while keeping generated recipe files
        # within the repository's 1000-line contribution guideline.
        payload = {'lines': [''.join(lines[offset:offset + 2])
                             for offset in range(0, len(lines), 2)]}
    filename = target.name + '.json'
    patches[relative] = {'payload': filename, 'payloadSha256': save(filename, payload), 'sha256': digest(data), 'size': len(data)}
manifest = {'schema': 1, 'name': '@google/gemini-cli', 'version': '0.65.0', 'upstreamIntegrity': 'sha512-' + integrity, 'inventorySha256': save('upstream.json', inventory), 'patches': patches}
save('manifest.json', manifest)
repository = Path(__file__).resolve().parents[2]
prettier = repository / 'node_modules/prettier/bin/prettier.cjs'
formatter = ['node', '--max-old-space-size=128', str(prettier), '--config', str(repository / '.prettierrc'), '--write']
subprocess.run([*formatter, *map(str, sorted(args.output.glob('*.json')))], check=True)
manifest['inventorySha256'] = digest((args.output / 'upstream.json').read_bytes())
for patch in manifest['patches'].values():
    patch['payloadSha256'] = digest((args.output / patch['payload']).read_bytes())
save('manifest.json', manifest)
subprocess.run([*formatter, str(args.output / 'manifest.json')], check=True)
(args.output.parent / 'LICENSE.upstream').write_bytes((args.upstream / 'LICENSE').read_bytes())
print(f'PASS: {len(inventory)} locked source files and {len(patches)} exact native output files in the reproducible recipe.')
