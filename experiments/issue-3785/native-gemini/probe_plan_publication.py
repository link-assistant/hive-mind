#!/usr/bin/env python3
"""Bound actual native plan owner death and fresh-process publication recovery."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import signal
import subprocess
import sys
import tempfile
import time

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from native_process_group import stop_process_group

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('package', type=Path)
parser.add_argument('--diagnostics', type=Path, required=True)
parser.add_argument('--scenario', choices=('first', 'replacement'))
parser.add_argument('--point', choices=('after-intent', 'after-journal', 'after-publish'))
attacks = ('intent-symlink', 'intent-hardlink', 'intent-mode', 'intent-malformed', 'intent-schema',
           'intent-utf8', 'intent-oversized', 'intent-name', 'intent-scope', 'intent-digest',
           'intent-revision', 'intent-stage-name', 'stage-symlink', 'stage-hardlink', 'stage-mode', 'stage-content',
           'stage-missing', 'target-symlink', 'target-hardlink', 'target-mode', 'target-content',
           'target-missing', 'journal-conflict')
parser.add_argument('--attack', choices=attacks)
parser.add_argument('--live-stage-replacement', action='store_true')
args = parser.parse_args()
if args.live_stage_replacement and any((args.attack, args.point, args.scenario)):
    parser.error('Live staging replacement is a separate bounded control.')
if args.attack and (args.scenario not in (None, 'replacement') or args.point not in (None, 'after-journal')):
    parser.error('Unsafe evidence requires replacement after-journal.')
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
module = package / 'bundle/chunk-DKZARV6U.js'
assert hashlib.sha256(module.read_bytes()).hexdigest() == '80152a26cf924992ac283a92e1b9b2252326cf6a417edc1c4b147088ca154733'
helper = package / 'bundle/hive-gemini-history.mjs'
assert hashlib.sha256(helper.read_bytes()).hexdigest() in ('316d864e6ba63b15c6685b7da7f86f831652eedfbc0c1c62ed01edc619a31688', 'd522f9e84bffe3d7c9323596f3aa8914bd2ce74e73ff2be3233e6aff6b8729da')
root = Path(tempfile.mkdtemp(prefix='hive-3785-gemini-plan-publication-'))
root.chmod(0o700)
children = []
safe_cleanup = False
args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
try:
    def run(phase):
        private = fixture / ('private-' + phase)
        private.mkdir(mode=0o700)
        diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-' + scenario + '-' + point + '-' + phase + '.log')
        env = {'PATH': os.environ['PATH'], 'HOME': str(private), 'GEMINI_CLI_HOME': str(private),
               'FIXTURE_ROOT': str(fixture), 'NATIVE_MODULE': module.as_uri(),
               'GEMINI_HISTORY_HOME': str(fixture / 'canonical'), 'NODE_ENV': 'production'}
        if os.environ.get('GEMINI_HISTORY_DEBUG') == '1':
            env['GEMINI_HISTORY_DEBUG'] = '1'
        with diagnostic.open('wb') as output:
            diagnostic.chmod(0o600)
            child = subprocess.Popen(['prlimit', '--data=2147483648', '--stack=16777216', '--core=0',
                                      '--', shutil.which('node'), '--max-old-space-size=256',
                                      str(Path(__file__).parent / 'plan_publication_worker.mjs'), phase, scenario, point],
                                     env=env, stdin=subprocess.DEVNULL, stdout=output,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            children.append(child)
            deadline = time.monotonic() + 25
            try:
                while child.poll() is None:
                    assert time.monotonic() < deadline and os.fstat(output.fileno()).st_size <= 65536
                    time.sleep(0.02)
                assert child.returncode == (-signal.SIGKILL if phase == 'owner' else 0), 'Inspect bounded native plan publication diagnostics: ' + str(diagnostic)
            finally:
                stop_process_group(child)
        if phase == 'owner':
            assert json.loads((fixture / 'death.json').read_text())['point'] == point
            shutil.rmtree(private)
            print('PASS: actual native plan owner reaches ' + scenario + ' ' + point + ' before forced death and whole private-home disposal.', flush=True)
        else:
            print(diagnostic.read_text().strip(), flush=True)

    def fingerprint():
        result = {}
        for file in tuple((fixture / 'canonical').rglob('*')) + (fixture / 'protected.md',):
            info = file.lstat()
            if file.is_symlink():
                content = os.readlink(file)
            elif file.is_file():
                assert info.st_size <= 33554433
                with file.open('rb') as stream:
                    content = hashlib.file_digest(stream, 'sha256').hexdigest()
            else:
                continue
            result[str(file)] = (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size, content)
        return result

    def attack():
        target = Path(json.loads((fixture / 'death.json').read_text())['file'])
        intent = target.parent / '.plan-transaction.json'
        record = json.loads(intent.read_text())
        stage = target.parent / record['staged']['name']
        protected = fixture / 'protected.md'
        protected.write_text('SYNTHETIC PROTECTED PLAN EVIDENCE\n')
        protected.chmod(0o600)
        family, operation = args.attack.split('-', 1)
        selected = {'intent': intent, 'stage': stage, 'target': target}.get(family)
        if operation in ('symlink', 'hardlink'):
            selected.unlink()
            if operation == 'symlink':
                selected.symlink_to(protected)
            else:
                os.link(protected, selected)
        elif operation == 'mode':
            selected.chmod(0o644)
        elif operation == 'missing':
            selected.unlink()
        elif operation == 'malformed':
            selected.write_text('{')
        elif operation == 'schema':
            selected.write_text('{"version":2}')
        elif operation == 'utf8':
            selected.write_bytes(b'\xff')
        elif operation == 'oversized':
            with selected.open('r+b') as stream:
                stream.truncate(33554433)
        elif operation == 'content':
            selected.write_text('SYNTHETIC SUBSTITUTED PLAN\n')
        elif operation in ('name', 'scope', 'digest', 'revision', 'stage-name'):
            if operation == 'name': record['name'] = '../outside.md'
            elif operation == 'scope': record['scope'] += '-foreign'
            elif operation == 'digest': record['next']['hash'] = '0' * 64
            elif operation == 'stage-name': record['staged']['name'] = [record['staged']['name']]
            else: record['next']['revision'] += 1
            intent.write_text(json.dumps(record))
        elif args.attack == 'journal-conflict':
            journal = next((fixture / 'canonical').rglob('prompt-history.json'))
            records = json.loads(journal.read_text())
            message = json.loads(records[-1]['message'])
            message['content'] = 'SYNTHETIC CONFLICTING GENERATION'
            message['hash'] = hashlib.sha256(message['content'].encode()).hexdigest()
            records[-1]['message'] = json.dumps(message)
            journal.write_text(json.dumps(records))
        else:
            raise AssertionError('Unknown bounded native plan publication attack.')

    for scenario in ('first', 'replacement'):
        if args.live_stage_replacement and scenario != 'first':
            continue
        if args.scenario and args.scenario != scenario:
            continue
        if args.attack and scenario != 'replacement':
            continue
        for point in ('after-intent', 'after-journal', 'after-publish'):
            if args.live_stage_replacement and point != 'after-intent':
                continue
            if args.point and args.point != point:
                continue
            if args.attack and point != 'after-journal':
                continue
            fixture = root / (scenario + '-' + point)
            fixture.mkdir(mode=0o700)
            for name in ('canonical', 'workspace'):
                (fixture / name).mkdir(mode=0o700)
            if args.live_stage_replacement:
                run('live')
                continue
            run('owner')
            if args.attack:
                attack()
                before = fingerprint()
                run('unsafe')
                assert fingerprint() == before, 'Unsafe plan recovery must preserve every canonical and protected file.'
            else:
                run('peer')
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
            shutil.rmtree(root)
        else:
            print('Synthetic native plan publication evidence retained in', root)
