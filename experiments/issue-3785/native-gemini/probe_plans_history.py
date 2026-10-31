#!/usr/bin/env python3
"""Bound actual native plan storage, fresh readers and unsafe-data refusal."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from native_process_group import stop_process_group

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('package', type=Path)
parser.add_argument('--diagnostics', type=Path, required=True)
attacks = ('symlink', 'hardlink', 'unsafe-mode', 'missing', 'content', 'invalid-utf8',
           'oversized', 'parent-replacement', 'root-replacement', 'changed-selector',
           'journal-schema', 'unknown', 'filename', 'reserved')
scenarios = ('lifetime', 'generations', 'peer', 'concurrent', 'same-file', 'separation',
             'missing-unacknowledged', 'policy', 'private') + tuple('unsafe-' + attack for attack in attacks)
parser.add_argument('--scenario', choices=scenarios)
args = parser.parse_args()
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
module = package / 'bundle/chunk-DKZARV6U.js'
assert hashlib.sha256(module.read_bytes()).hexdigest() == '80152a26cf924992ac283a92e1b9b2252326cf6a417edc1c4b147088ca154733'
helper = package / 'bundle/hive-gemini-history.mjs'
assert helper.read_bytes().endswith((Path(__file__).parent / 'plans_history.mjs').read_bytes())
suite_root = Path(tempfile.mkdtemp(prefix='hive-3785-gemini-plans-'))
suite_root.chmod(0o700)
children = []
safe_cleanup = False
args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
try:
    def start(phase):
        private = root / ('private-' + phase)
        private.mkdir(mode=0o700)
        diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-' + scenario + '-' + phase + '.log')
        env = {'PATH': os.environ['PATH'], 'HOME': str(private), 'GEMINI_CLI_HOME': str(private),
               'FIXTURE_ROOT': str(root), 'NATIVE_SCENARIO': scenario,
               'NATIVE_MODULE': module.as_uri(), 'NATIVE_HELPER': helper.as_uri(),
               'NODE_ENV': 'production'}
        if scenario != 'private':
            env['GEMINI_HISTORY_HOME'] = str(root / 'canonical')
        if os.environ.get('GEMINI_HISTORY_DEBUG') == '1':
            env['GEMINI_HISTORY_DEBUG'] = '1'
        output = diagnostic.open('wb')
        diagnostic.chmod(0o600)
        try:
            child = subprocess.Popen(['prlimit', '--data=2147483648', '--stack=16777216', '--core=0',
                                      '--', shutil.which('node'), '--max-old-space-size=256',
                                      str(Path(__file__).parent / 'plans_worker.mjs'), phase],
                                     env=env, stdin=subprocess.DEVNULL, stdout=output,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            children.append(child)
            return child, output, diagnostic, time.monotonic() + 25
        except BaseException:
            output.close()
            raise

    def finish(running):
        child, output, diagnostic, deadline = running
        try:
            while child.poll() is None:
                assert time.monotonic() < deadline and os.fstat(output.fileno()).st_size <= 65536
                time.sleep(0.02)
            assert child.returncode == 0, 'Inspect bounded native plan diagnostics: ' + str(diagnostic)
        finally:
            stop_process_group(child)
            output.close()
        print(diagnostic.read_text().strip(), flush=True)

    def barrier(pattern, running):
        deadline = time.monotonic() + 15
        while not list(root.glob(pattern)):
            assert time.monotonic() < deadline and all(child.poll() is None for child, *_ in running)
            time.sleep(0.02)

    for scenario in scenarios:
        if args.scenario and args.scenario != scenario:
            continue
        root = suite_root / scenario
        root.mkdir(mode=0o700)
        for name in ('workspace', 'canonical'):
            (root / name).mkdir(mode=0o700)
        if scenario in ('concurrent', 'same-file'):
            writers = [start('writer-' + str(index)) for index in range(2)]
            for index in range(2):
                barrier('writer-' + str(index) + '.ready', writers)
            (root / 'go').write_text('go')
            for writer in writers:
                finish(writer)
            for index in range(2):
                shutil.rmtree(root / ('private-writer-' + str(index)))
            finish(start('verify'))
        elif scenario == 'peer':
            owner = start('owner')
            barrier('owner.ready', [owner])
            finish(start('peer-writer'))
            finish(owner)
        else:
            finish(start('owner'))
            if scenario == 'lifetime':
                shutil.rmtree(root / 'private-owner')
                finish(start('reopen'))
    safe_cleanup = True
finally:
    try:
        for child in children:
            stop_process_group(child)
    except BaseException:
        safe_cleanup = False
        raise
    finally:
        if safe_cleanup:
            shutil.rmtree(suite_root)
        else:
            print('Synthetic native plan evidence retained in', suite_root)
