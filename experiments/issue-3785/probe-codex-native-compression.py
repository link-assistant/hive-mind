#!/usr/bin/env python3
"""Bounded actual compression and peer discovery across private configurations."""
import argparse
import fcntl
import json
import os
from pathlib import Path
import queue
import shutil
import sqlite3
import subprocess
import sys
import tempfile
import threading
import time
import uuid

from native_network_fixture import environment
from native_process_group import stop_process_group


class NativeFailure(Exception):
    def __init__(self, error):
        super().__init__('Native history operation must succeed.')
        self.error = error


class Native:
    def __init__(self, binary, root, canonical, name, selected, path_selected=True):
        self.config = root / name
        self.config.mkdir(mode=0o700)
        for entry in ('sessions', 'archived_sessions', 'thread-writer-locks'):
            (self.config / entry).symlink_to(canonical / entry, target_is_directory=True)
        (self.config / 'config.toml').write_text('''model = "synthetic"
model_provider = "offline"
[features]
remote_plugin = false
apps = false
[model_providers.offline]
name = "Offline"
base_url = "http://127.0.0.1:1/v1"
model_catalog_url = "http://127.0.0.1:1/v1/models"
wire_api = "responses"
requires_openai_auth = false
''')
        env = {**environment(1), 'PATH': os.environ['PATH'], 'HOME': str(self.config),
               'CODEX_HOME': str(self.config), 'CODEX_SQLITE_HOME': str(canonical),
               'CODEX_SESSION_INDEX_HOME': str(canonical), 'TOKIO_WORKER_THREADS': '2',
               'RUST_LOG': 'codex_rollout::compression=debug',
               'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'}
        if selected:
            env['CODEX_ROLLOUT_MAINTENANCE_HOME'] = str(canonical)
        if path_selected:
            env['CODEX_ROLLOUT_HOME'] = str(canonical)
        self.diagnostics = tempfile.TemporaryFile()
        self.child = subprocess.Popen(
            ['prlimit', '--data=536870912', '--stack=16777216',
             '--core=0', '--', str(binary), 'app-server'], cwd=root, env=env,
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=self.diagnostics,
            text=True, encoding='utf-8', start_new_session=True)
        self.replies = queue.Queue(maxsize=32)
        self.sequence = 0
        self.failure = None
        self.stopped = False
        self.reader = threading.Thread(target=self.read)
        self.reader.start()

    def read(self):
        try:
            while True:
                line = self.child.stdout.readline(256 * 1024 + 1)
                if not line:
                    return
                assert len(line) <= 256 * 1024, 'Finite native protocol line limit exceeded.'
                value = json.loads(line)
                if 'id' in value:
                    self.replies.put_nowait(value)
        except (AssertionError, ValueError, queue.Full) as error:
            self.failure = error

    def send(self, method, params):
        self.sequence += 1
        self.child.stdin.write(json.dumps({'id': self.sequence, 'method': method, 'params': params}) + '\n')
        self.child.stdin.flush()
        return self.sequence

    def receive(self, identifier):
        try:
            result = self.replies.get(timeout=8)
        except queue.Empty:
            if os.environ.get('CODEX_PROBE_DIAGNOSTICS') == '1':
                print(self.diagnostic(), file=sys.stderr, flush=True)
            raise AssertionError(f'Native protocol deadline exceeded; exit={self.child.poll()}; reader_failed={self.failure is not None}.') from None
        assert self.failure is None
        if 'error' in result and os.environ.get('CODEX_PROBE_DIAGNOSTIC_FILE'):
            destination = Path(os.environ['CODEX_PROBE_DIAGNOSTIC_FILE'])
            destination.write_text(json.dumps(result['error']))
            destination.chmod(0o600)
        assert result['id'] == identifier, 'Native protocol must preserve request identity.'
        if 'error' in result:
            raise NativeFailure(result['error'])
        return result['result']

    def request(self, method, params):
        return self.receive(self.send(method, params))

    def initialize(self):
        result = self.request('initialize', {'clientInfo': {'name': 'hive-3785-compression', 'version': '0.0.0'},
                                             'capabilities': {'experimentalApi': True}})
        assert '0.164.0' in result['userAgent'], 'Require the pinned actual native CLI.'
        self.child.stdin.write('{"method":"initialized"}\n')
        self.child.stdin.flush()

    def diagnostic(self):
        size = os.fstat(self.diagnostics.fileno()).st_size
        assert size <= 256 * 1024, 'Finite native diagnostic limit exceeded.'
        return os.pread(self.diagnostics.fileno(), size, 0).decode('utf-8', errors='replace')

    def stop(self):
        if self.stopped:
            return
        stop_process_group(self.child)
        self.reader.join(timeout=5)
        assert not self.reader.is_alive(), 'Native reader must stop before fixture disposal.'
        self.child.stdin.close()
        self.child.stdout.close()
        self.diagnostics.close()
        self.stopped = True


def wait_for(predicate, children):
    deadline = time.monotonic() + 8
    while not predicate():
        for child in children:
            assert child.failure is None and child.child.poll() is None, 'Native process must remain healthy.'
            child.diagnostic()
        assert time.monotonic() < deadline, 'Finite native compression deadline exceeded.'
        time.sleep(0.02)


def rollout(canonical, archived):
    identifier = str(uuid.uuid4())
    stamp = '2026-10-01T00:00:00Z'
    marker = 'Synthetic archived prior conversation.' if archived else 'Synthetic active prior conversation.'
    records = [
        {'timestamp': stamp, 'type': 'session_meta', 'payload': {
            'id': identifier, 'session_id': identifier, 'timestamp': stamp,
            'cwd': str(canonical.parent), 'originator': 'codex', 'cli_version': '0.164.0',
            'source': 'cli', 'model_provider': 'offline', 'base_instructions': None}},
        {'timestamp': stamp, 'type': 'response_item', 'payload': {'type': 'message',
            'role': 'user', 'content': [{'type': 'input_text', 'text': marker}]}},
        {'timestamp': stamp, 'type': 'event_msg', 'payload': {'type': 'user_message',
            'message': marker, 'text_elements': [], 'local_images': []}},
    ]
    directory = canonical / ('archived_sessions' if archived else 'sessions') / '2026' / '10' / '01'
    directory.mkdir(parents=True, mode=0o700)
    target = directory / f'rollout-2026-10-01T00-00-00-{identifier}.jsonl'
    target.write_text(''.join(json.dumps(record) + '\n' for record in records))
    target.chmod(0o600)
    old = time.time() - 8 * 24 * 60 * 60
    os.utime(target, (old, old))
    return identifier, marker, target, target.read_bytes()


def run(args):
    children = []
    root = Path(tempfile.mkdtemp(prefix='hive-3785-native-compression-'))
    canonical = root / 'canonical'
    canonical.mkdir(mode=0o700)
    for entry in ('sessions', 'archived_sessions', 'thread-writer-locks'):
        (canonical / entry).mkdir(mode=0o700)
    lock = canonical / 'rollout-maintenance.lock'
    lock.touch(mode=0o600)
    identity = lock.stat()
    try:
        for name in ('first', 'second'):
            child = Native(args.binary, root, canonical, name, not args.without_selector,
                           not args.without_path_selector)
            children.append(child)
            child.initialize()
        fixtures = [rollout(canonical, False), rollout(canonical, True)]
        with lock.open('r+b') as owner:
            fcntl.flock(owner, fcntl.LOCK_EX)
            children[0].request('rollout/compress', {})
            wait_for(lambda: 'rollout maintenance is already running' in children[0].diagnostic()
                     or any(Path(str(item[2]) + '.zst').exists() for item in fixtures), children)
            if args.expect_independent_locks:
                wait_for(lambda: all(Path(str(item[2]) + '.zst').exists() for item in fixtures), children)
                print('REPRODUCED: actual native compression ignores the separately held canonical maintenance lock without its selector.')
                return
            assert 'rollout maintenance is already running' in children[0].diagnostic(), \
                'Actual native compression must obey the canonical maintenance owner.'
            for _, _, target, original in fixtures:
                assert target.read_bytes() == original and not Path(str(target) + '.zst').exists()
        requests = [child.send('rollout/compress', {}) for child in children]
        for child, identifier in zip(children, requests):
            child.receive(identifier)
        wait_for(lambda: all(Path(str(item[2]) + '.zst').exists() for item in fixtures), children)
        for identifier, marker, target, _ in fixtures:
            assert not target.exists(), 'Native compression must publish and retire its plain representation.'
            result = children[1].request('thread/read', {'threadId': identifier, 'includeTurns': True})
            assert result['thread']['id'] == identifier and marker in json.dumps(result['thread']['turns'])
            assert Path(str(target) + '.zst').stat().st_mode & 0o777 == 0o600
        databases = list(canonical.glob('state_*.sqlite'))
        assert len(databases) == 1, 'Native operations must retain their shared SQLite metadata.'
        with sqlite3.connect(f'file:{databases[0]}?mode=ro', uri=True) as database:
            rows = dict(database.execute('SELECT id, rollout_path FROM threads').fetchall())
        assert set(rows) == {item[0] for item in fixtures}, 'Both native thread rows must be persisted.'
        if not args.expect_private_metadata:
            assert all(Path(value).is_relative_to(canonical) for value in rows.values()), \
                'Native SQLite must persist canonical rollout paths rather than disposable aliases.'
        disposed = [str(child.config) for child in children]
        for child in children:
            child.stop()
            shutil.rmtree(child.config)
        children.clear()
        fresh = Native(args.binary, root, canonical, 'fresh', True,
                       not args.without_path_selector)
        children.append(fresh)
        fresh.initialize()
        identifier, marker, _, _ = fixtures[0]
        try:
            resumed = fresh.request('thread/resume', {'threadId': identifier, 'modelProvider': 'offline',
                                                       'approvalPolicy': 'never', 'sandbox': 'read-only'})
        except NativeFailure as failure:
            assert args.expect_private_metadata, 'Fresh native resume must survive disposal of both private configurations.'
            assert failure.error['code'] == -32600
            assert any(value in failure.error['message'] for value in disposed)
            assert 'file does not exist' in failure.error['message']
            assert all(Path(str(item[2]) + '.zst').is_file() for item in fixtures)
            print('REPRODUCED: actual native compression and peer reads succeed, but shared SQLite retains a deleted private alias and fresh resume fails despite intact canonical history.')
            return
        assert not args.expect_private_metadata, 'The private-metadata negative control must reproduce its declared failure.'
        assert resumed['thread']['id'] == identifier and marker in json.dumps(resumed['thread']['turns'])
        archived_id, archived_marker, _, _ = fixtures[1]
        archived = fresh.request('thread/read', {'threadId': archived_id, 'includeTurns': True})
        assert archived_marker in json.dumps(archived['thread']['turns'])
        assert (lock.stat().st_dev, lock.stat().st_ino) == (identity.st_dev, identity.st_ino)
        assert not (fresh.config / '.tmp' / 'rollout-maintenance.lock').exists()
        assert not list(root.glob('*/auth.json')), 'History operations must not create private credentials.'
        print('PASS: actual native compression respects canonical exclusion, publishes active/archived history, permits peer reads and fresh resume after private-root disposal; lock identity is preserved.')
    finally:
        failures = []
        for child in children:
            try:
                child.stop()
            except Exception as error:
                failures.append(error)
        if failures:
            raise RuntimeError('Native cleanup failed; private fixture retained.') from failures[0]
        shutil.rmtree(root)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=lambda value: Path(value).resolve(strict=True))
    parser.add_argument('--without-selector', action='store_true')
    parser.add_argument('--expect-independent-locks', action='store_true')
    parser.add_argument('--without-path-selector', action='store_true')
    parser.add_argument('--expect-private-metadata', action='store_true')
    arguments = parser.parse_args()
    assert not arguments.expect_independent_locks or arguments.without_selector
    assert not arguments.expect_private_metadata or not arguments.without_selector
    run(arguments)
