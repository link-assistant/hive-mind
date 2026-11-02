#!/usr/bin/env python3
"""Check actual native login status against a launcher-admitted directory.

Synthetic API-key credentials only; no provider request or native export edits.
The ignored-marker mode preserves the unpatched CLI's negative control.
"""
import argparse
import os
from pathlib import Path
import signal
import subprocess
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('binary', type=Path)
parser.add_argument('--expect-ignored-marker', action='store_true')
args = parser.parse_args()
binary = args.binary.resolve(strict=True)
marker = 'HIVE_MIND_CODEX_AUTH_IDENTITY'

for case in ('healthy', 'wrong', 'malformed', 'replaced', 'missing'):
    with tempfile.TemporaryDirectory(prefix='hive-codex-auth-identity-') as temporary:
        root = Path(temporary)
        home, config, canonical = [root / name for name in ('home', 'config', 'canonical')]
        for directory in (home, config, canonical):
            directory.mkdir(mode=0o700)
        auth = canonical / 'auth.json'
        auth.write_text('{"OPENAI_API_KEY":"sk-SYNTHETIC-IDENTITY"}')
        auth.chmod(0o600)
        admitted = canonical.stat()
        identity = f'{admitted.st_dev}:{admitted.st_ino}'
        if case == 'wrong':
            identity = '0:0'
        elif case == 'malformed':
            identity = ''
        elif case == 'replaced':
            canonical.rename(root / 'retired')
            canonical.mkdir(mode=0o700)
            auth.write_bytes((root / 'retired/auth.json').read_bytes())
            auth.chmod(0o600)
        env = {'PATH': os.defpath, 'HOME': str(home), 'CODEX_HOME': str(config),
               'CODEX_AUTH_HOME': str(canonical), marker: identity,
               'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': '/dev/null',
               'RUST_LOG': 'off', 'HTTP_PROXY': 'http://127.0.0.1:1',
               'HTTPS_PROXY': 'http://127.0.0.1:1', 'ALL_PROXY': 'http://127.0.0.1:1'}
        if case == 'missing':
            del env['CODEX_AUTH_HOME']
            (config / 'auth.json').write_bytes(auth.read_bytes())
            (config / 'auth.json').chmod(0o600)
        child = subprocess.Popen(['prlimit', '--data=536870912', '--stack=16777216',
                                  '--core=0', '--', str(binary), 'login', 'status'],
                                 cwd=home, env=env, stdin=subprocess.DEVNULL,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 start_new_session=True)
        try:
            code = child.wait(timeout=12)
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
            child.wait()
        assert code >= 0, 'Native login status was terminated by a signal.'
        if case == 'healthy' or args.expect_ignored_marker:
            assert code == 0, f'Healthy or ignored-marker control refused ({case}).'
        else:
            assert code != 0, 'Native Codex accepted a different admitted authentication directory.'
        assert auth.read_text() == '{"OPENAI_API_KEY":"sk-SYNTHETIC-IDENTITY"}'
        if case != 'missing':
            assert not (config / 'auth.json').exists(), 'Native status created a private credential copy.'
        print(f'PASS: actual native authentication directory identity ({case}).', flush=True)
