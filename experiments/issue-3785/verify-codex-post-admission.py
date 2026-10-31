#!/usr/bin/env python3
"""Run existing bounded native controls against one preserved compiled CLI.

This does not rebuild native source or replace Docker/installed-package checks.
Each control gets independent synthetic state and a separate preserved log.
"""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('binary', type=Path)
parser.add_argument('logs', type=Path)
args = parser.parse_args()
binary = args.binary.resolve(strict=True)
logs = args.logs.absolute()
logs.mkdir(mode=0o700)
directory = Path(__file__).resolve().parent
repository = directory.parents[1]
controls = []


def add(name, probe, *flags):
    runtime = [sys.executable] if probe.endswith('.py') else [
        'prlimit', '--data=536870912', '--stack=16777216', '--core=0',
        '--', 'node', '--jitless', '--max-old-space-size=96']
    controls.append((name, runtime + [str(directory / probe), str(binary), *flags]))


add('compression', 'probe-codex-native-compression.py')
add('compression-unselected', 'probe-codex-native-compression.py', '--without-path-selector', '--expect-private-metadata')
add('migration', 'probe-codex-native-migration.py')
add('migration-compressed', 'probe-codex-native-migration.py', '--compressed')
for alias in ('symlink', 'hardlink'):
    add('migration-journal-' + alias, 'probe-codex-native-migration.py', '--journal-attack', alias)
    add('migration-stage-' + alias, 'probe-codex-native-migration.py', '--stage-attack', alias)
    add('migration-head-' + alias, 'probe-codex-native-migration.py', '--stage-attack', alias, '--stage-kind', 'head', '--subagent')
    for kind in ('decompressed', 'compressed'):
        add('migration-' + kind + '-' + alias, 'probe-codex-native-migration.py', '--stage-attack', alias, '--stage-kind', kind, '--compressed')
add('tui-history', 'probe-codex-native-tui-history.py')
add('tui-history-unselected', 'probe-codex-native-tui-history.py', '--without-selector', '--expect-private-history', '--expect-unsafe-execution')
add('identity', 'probe-codex-native-agent-identity.py')
add('refresh-owner-death', 'probe-codex-native-refresh-crash.mjs')
add('refresh-repair', 'probe-codex-native-refresh-crash.mjs', '--repair-malformed')
add('request', 'probe-codex-native-request-auth.mjs')
add('request-overrides', 'probe-codex-native-request-auth.mjs', '--provider-overrides')
add('request-constructors', 'probe-codex-native-request-auth.mjs', '--provider-constructors')
add('capability', 'probe-codex-native-capability-auth.mjs', '--unpackaged-development')
add('catalogue', 'probe-codex-native-model-catalogue.mjs', '--unpackaged-development')

environment = {key: value for key, value in os.environ.items() if key != 'NODE_OPTIONS'}
environment.update(PYTHONDONTWRITEBYTECODE='1', CODEX_PROBE_DIAGNOSTICS='1')
results = []
for name, command in controls:
    with (logs / (name + '.log')).open('x') as output:
        result = subprocess.run(command, cwd=repository, env=environment,
                                stdout=output, stderr=subprocess.STDOUT)
    results.append({'control': name, 'exitCode': result.returncode})
    print(('PASS: ' if result.returncode == 0 else 'FAIL: ') + name, flush=True)
(logs / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
if any(item['exitCode'] != 0 for item in results):
    raise SystemExit('Native controls failed; inspect their preserved logs.')
print(f'All {len(results)} existing native control invocations passed.')
