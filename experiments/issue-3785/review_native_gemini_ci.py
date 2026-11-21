#!/usr/bin/env python3
"""Review preserved synthetic native diagnostics in bounded line chunks."""
import argparse
import hashlib
import itertools
import json
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('runner_log', type=Path)
parser.add_argument('artifacts', type=Path)
parser.add_argument('output', type=Path)
args = parser.parse_args()


def review(file):
    digest = hashlib.sha256()
    chunks = 0
    lines = 0
    passes = 0
    annotations = []
    assertions = []
    with file.open('rb') as stream:
        while part := list(itertools.islice(stream, 1500)):
            chunks += 1
            for raw in part:
                digest.update(raw)
                lines += 1
                line = raw.decode('utf8', errors='replace').rstrip()
                passes += 'PASS' in line
                if '##[error]' in line:
                    annotations.append({'line': lines, 'message': line})
                if 'AssertionError' in line:
                    assertions.append({'line': lines, 'message': line})
    return {'lines': lines, 'chunks': chunks, 'sha256': digest.hexdigest(), 'passes': passes,
            'annotations': annotations, 'assertions': assertions}


expected_network_before = {
    'native-gemini-tracker-history-experiment/gemini-tracker-admission-before.network.json',
    'native-gemini-tracker-history-experiment/gemini-tracker-cli-before.network.json',
}
report = {'runner': review(args.runner_log), 'files': {}, 'networkErrors': [], 'expectedNetworkBefore': []}
for file in sorted(args.artifacts.rglob('*')):
    if not file.is_file():
        continue
    relative = str(file.relative_to(args.artifacts))
    report['files'][relative] = review(file)
    if file.name.endswith('.network.json'):
        data = json.loads(file.read_bytes())
        assert 'errors' in data, relative
        if data['errors']:
            key = 'expectedNetworkBefore' if relative in expected_network_before and data['errors'] == ['AssertionError'] else 'networkErrors'
            report[key].append({'file': relative, 'errors': data['errors']})
report['unexpectedAssertionFiles'] = [name for name, item in report['files'].items()
                                      if item['assertions'] and 'before' not in name and 'regression' not in name]
args.output.write_text(json.dumps(report, indent=2) + '\n')
assert not report['runner']['annotations'], 'Runner has failing annotations; inspect the preserved review.'
assert not report['networkErrors'], 'Native network diagnostics failed; inspect the preserved review.'
assert not report['unexpectedAssertionFiles'], 'Unexpected positive-control assertion; inspect the preserved review.'
print(json.dumps({'runnerLines': report['runner']['lines'], 'runnerChunks': report['runner']['chunks'],
                  'artifactFiles': len(report['files']),
                  'artifactChunks': sum(item['chunks'] for item in report['files'].values()),
                  'networkFiles': sum(name.endswith('.network.json') for name in report['files']),
                  'expectedAssertionFiles': sum(bool(item['assertions']) for item in report['files'].values()),
                  'expectedNetworkBefore': report['expectedNetworkBefore'],
                  'unexpectedAssertionFiles': report['unexpectedAssertionFiles'],
                  'runnerErrors': report['runner']['annotations'], 'networkErrors': report['networkErrors']}, indent=2))
