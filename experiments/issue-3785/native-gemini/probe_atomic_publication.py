#!/usr/bin/env python3
"""Finite native proof link recovery and unsafe-proof refusal controls."""
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
parser.add_argument('--scenario', choices=('registry', 'prompt', 'checkpoint', 'artifact', 'blob', 'plan-first', 'plan-replacement'))
parser.add_argument('--point', choices=('proof-linked', 'proof-unlinked'))
attacks = ('alias-missing', 'alias-symlink', 'alias-inode', 'alias-extra-link', 'alias-mode',
           'alias-fifo', 'journal-substitution', 'journal-malformed', 'stage-inode',
           'stage-symlink', 'stage-mode', 'stage-content', 'target-collision')
parser.add_argument('--attack', choices=attacks)
parser.add_argument('--live-proof-replacement', choices=('inode', 'content'))
args = parser.parse_args()
assert not args.attack or args.scenario in (None, 'registry') and args.point in (None, 'proof-linked')
assert not args.live_proof_replacement or not args.attack and not args.scenario and not args.point
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
bundle = package / 'bundle'
for name, pin in {'chunk-DKZARV6U.js': '80152a26cf924992ac283a92e1b9b2252326cf6a417edc1c4b147088ca154733',
                  'hive-gemini-history.mjs': 'd522f9e84bffe3d7c9323596f3aa8914bd2ce74e73ff2be3233e6aff6b8729da',
                  'hive-gemini-publication.mjs': '3b2b4dbc2296e6da81d314879e466f100f211579ebee13a63a74d9129bae28d8'}.items():
    assert hashlib.sha256((bundle / name).read_bytes()).hexdigest() == pin, name
root = Path(tempfile.mkdtemp(prefix='hive-3785-gemini-atomic-proof-'))
root.chmod(0o700)
args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
children = []
safe_cleanup = False
try:
    def run(phase):
        private = fixture / ('private-' + phase)
        private.mkdir(mode=0o700)
        diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-' + scenario + '-' + point + '-' + phase + '.log')
        env = {'PATH': os.environ['PATH'], 'HOME': str(private), 'GEMINI_CLI_HOME': str(private),
               'GEMINI_HISTORY_HOME': str(fixture / 'canonical'), 'FIXTURE_ROOT': str(fixture),
               'NATIVE_MODULE': (bundle / 'chunk-DKZARV6U.js').as_uri(),
               'HISTORY_MODULE': (bundle / 'hive-gemini-history.mjs').as_uri()}
        with diagnostic.open('wb') as output:
            diagnostic.chmod(0o600)
            child = subprocess.Popen(['prlimit', '--data=2147483648', '--stack=16777216', '--core=0',
                                      '--', shutil.which('node'), '--max-old-space-size=256',
                                      str(Path(__file__).parent / 'atomic_publication_worker.mjs'), phase, scenario, point],
                                     env=env, stdin=subprocess.DEVNULL, stdout=output,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            children.append(child)
            try:
                deadline = time.monotonic() + 25
                while child.poll() is None:
                    assert time.monotonic() < deadline and os.fstat(output.fileno()).st_size <= 65536
                    time.sleep(0.02)
                assert child.returncode == (-signal.SIGKILL if phase == 'owner' else 0), 'Inspect bounded native proof diagnostics: ' + str(diagnostic)
            finally:
                stop_process_group(child)
        if phase == 'owner':
            saved = json.loads((fixture / 'death.json').read_text())
            assert Path(saved['journal']).stat().st_nlink == (2 if point == 'proof-linked' else 1)
            shutil.rmtree(private)
            print('PASS: actual native ' + scenario + ' reaches ' + point + ', dies and loses its complete private home.', flush=True)
        else:
            print(diagnostic.read_text().strip(), flush=True)

    def fingerprint():
        result = {}
        for file in (fixture / 'canonical').rglob('*'):
            info = file.lstat()
            if file.is_symlink():
                content = os.readlink(file)
            elif file.is_file():
                assert info.st_size <= 33554432
                content = hashlib.sha256(file.read_bytes()).hexdigest()
            else:
                content = None
            result[str(file)] = (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size, content)
        for file in fixture.glob('protected*'):
            info = file.lstat()
            result[str(file)] = (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size, hashlib.sha256(file.read_bytes()).hexdigest())
        return result

    def attack():
        saved = json.loads((fixture / 'death.json').read_text())
        alias, journal, stage, target = (Path(saved[name]) for name in ('alias', 'journal', 'staged', 'target'))
        if args.attack == 'alias-missing':
            os.link(alias, fixture / 'protected-proof')
            alias.unlink()
        elif args.attack in ('alias-symlink', 'alias-inode', 'alias-fifo'):
            content = alias.read_bytes()
            alias.unlink()
            if args.attack == 'alias-symlink': alias.symlink_to(journal)
            elif args.attack == 'alias-fifo': os.mkfifo(alias, 0o600)
            else: alias.write_bytes(content); alias.chmod(0o600)
        elif args.attack == 'alias-extra-link': os.link(alias, fixture / 'protected-proof')
        elif args.attack == 'alias-mode': alias.chmod(0o644)
        elif args.attack == 'journal-substitution':
            content = journal.read_bytes()
            journal.rename(fixture / 'protected-proof')
            journal.write_bytes(content)
            journal.chmod(0o600)
        elif args.attack == 'journal-malformed': journal.write_text('{"version":')
        elif args.attack == 'stage-inode':
            content = stage.read_bytes()
            stage.rename(fixture / 'protected-stage')
            stage.write_bytes(content)
            stage.chmod(0o600)
        elif args.attack == 'stage-symlink':
            stage.rename(fixture / 'protected-stage')
            stage.symlink_to(fixture / 'protected-stage')
        elif args.attack == 'stage-mode': stage.chmod(0o644)
        elif args.attack == 'stage-content': stage.write_text('SYNTHETIC MODIFIED STAGE')
        elif args.attack == 'target-collision': target.write_text('SYNTHETIC PROTECTED TARGET'); target.chmod(0o600)
        else: raise AssertionError(args.attack)

    if args.live_proof_replacement:
        scenario, point = 'registry', 'proof-linked'
        fixture = root / 'live-proof'
        fixture.mkdir(mode=0o700)
        (fixture / 'canonical').mkdir(mode=0o700)
        (fixture / 'workspace').mkdir(mode=0o700)
        run('live-' + args.live_proof_replacement)
    else:
        for scenario in (('registry',) if args.attack else (args.scenario,) if args.scenario else ('registry', 'prompt', 'checkpoint', 'artifact', 'blob', 'plan-first', 'plan-replacement')):
            for point in (('proof-linked',) if args.attack else (args.point,) if args.point else ('proof-linked', 'proof-unlinked')):
                fixture = root / (scenario + '-' + point)
                fixture.mkdir(mode=0o700)
                (fixture / 'canonical').mkdir(mode=0o700)
                (fixture / 'workspace').mkdir(mode=0o700)
                run('owner')
                if args.attack:
                    attack()
                    before = fingerprint()
                    run('unsafe')
                    assert fingerprint() == before, 'Unsafe proof recovery must preserve every canonical and protected identity and byte.'
                else:
                    run('peer')
    safe_cleanup = True
finally:
    for child in children:
        stop_process_group(child)
    if safe_cleanup:
        shutil.rmtree(root)
    else:
        print('Synthetic native atomic proof evidence retained in ' + str(root), file=sys.stderr)
