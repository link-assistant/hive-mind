#!/usr/bin/env python3
"""Interrupt an actual bounded native migration, dispose its scope and recover."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import time

from native_network_fixture import environment
from native_process_group import stop_process_group


spec = importlib.util.spec_from_file_location(
    'native_compression', Path(__file__).with_name('probe-codex-native-compression.py'))
compression = importlib.util.module_from_spec(spec)
spec.loader.exec_module(compression)
REPOSITORY = Path(__file__).resolve().parents[2]


def project(canonical, private, without_journal=False):
    script = '''import { shareScopedCodexSessions } from './src/codex-sessions.lib.mjs';
const result = await shareScopedCodexSessions({baseCodexHome: process.argv[1], codexHome: process.argv[2]});
if (!['shared', 'already-shared'].includes(result.status)) process.exit(1);
'''
    subprocess.run(['node', '--input-type=module', '-e', script, str(canonical), str(private)],
                   cwd=REPOSITORY, check=True, timeout=10, capture_output=True)
    if without_journal and (private / 'rollout-migrations').is_symlink():
        (private / 'rollout-migrations').unlink()


def migrate(binary, root, canonical, private, identifier, output, diagnostics, limited):
    env = {**environment(1), 'PATH': os.environ['PATH'], 'HOME': str(private),
           'CODEX_HOME': str(private), 'CODEX_SQLITE_HOME': str(canonical),
           'CODEX_SESSION_INDEX_HOME': str(canonical), 'CODEX_ROLLOUT_HOME': str(canonical),
           'CODEX_ROLLOUT_MAINTENANCE_HOME': str(canonical), 'TOKIO_WORKER_THREADS': '2',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'}
    arguments = ['prlimit', '--data=536870912', '--stack=16777216', '--fsize=16777216', '--core=0', '--',
                 str(binary), 'migrate-rollouts', '--apply', '--thread', identifier, '--json']
    if limited:
        arguments.extend(['--max-mib-per-second', '1'])
    return subprocess.Popen(arguments, cwd=root, env=env, stdout=output, stderr=diagnostics,
                            start_new_session=True)


def wait_for(predicate, child):
    deadline = time.monotonic() + 10
    while not predicate():
        assert child.poll() is None, 'Native migration must reach its interrupted stage.'
        assert time.monotonic() < deadline, 'Finite migration-stage deadline exceeded.'
        time.sleep(0.01)


def check_target_safety(args, root, canonical, owner, identifier, rollout, processes):
    foreign = root / 'foreign-history'
    foreign.write_bytes(b'synthetic unrelated conversation evidence')
    foreign.chmod(0o600)
    before = foreign.stat()
    stage = bool(args.stage_attack)
    attack = args.stage_attack or args.journal_attack
    label = 'staged rollout' if stage else 'pending journal'
    suffix = {'paginated': 'paginated.tmp', 'decompressed': 'decompressed.tmp', 'compressed': 'paginated.zst.tmp'}[args.stage_kind]
    journal = rollout.with_name(f'.{rollout.name}.{suffix}') if stage else canonical / 'rollout-migrations' / f'{identifier}.pending'
    if attack == 'symlink':
        journal.symlink_to(foreign)
    else:
        os.link(foreign, journal)
    original = rollout.read_bytes()
    with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as diagnostics:
        child = migrate(args.binary, root, canonical, owner.config, identifier,
                        output, diagnostics, False)
        processes.append(child)
        child.wait(timeout=20)
        stop_process_group(child)
        processes.remove(child)
        if args.expect_unsafe_journal or args.expect_unsafe_stage:
            if stage:
                assert foreign.read_bytes() != b'synthetic unrelated conversation evidence', 'Require actual native mutation through the unsafe staging target.'
                if args.stage_kind == 'compressed':
                    assert foreign.read_bytes().startswith(b'\x28\xb5\x2f\xfd')
                elif args.stage_kind == 'paginated':
                    assert b'"history_mode":"paginated"' in foreign.read_bytes()
                else:
                    assert b'Synthetic active prior conversation.' in foreign.read_bytes()
            else:
                assert foreign.read_bytes() == b'', 'Require actual native truncation through the unsafe journal.'
            assert foreign.stat().st_ino == before.st_ino
            print(f'REPRODUCED: actual native migration overwrites unrelated synthetic evidence through a {attack} {label}.')
            return
        assert foreign.read_bytes() == b'synthetic unrelated conversation evidence', 'Unsafe native migration target must not overwrite unrelated evidence.'
        assert (foreign.stat().st_dev, foreign.stat().st_ino) == (before.st_dev, before.st_ino)
        assert rollout.read_bytes() == original, 'Unsafe migration storage must refuse before transcript publication.'
        if attack == 'symlink':
            assert journal.is_symlink(), 'Admission refusal must preserve the unsafe entry for diagnosis.'
        else:
            assert journal.stat().st_nlink == 2
        assert os.fstat(output.fileno()).st_size < 64 * 1024
        assert os.fstat(diagnostics.fileno()).st_size < 64 * 1024
        if child.returncode:
            diagnostic = os.pread(diagnostics.fileno(), 64 * 1024, 0)
            assert any(message in diagnostic for message in [b'Canonical migration journal storage is unavailable or unsafe.', b'Canonical migration staging storage is unavailable or unsafe.'])
        else:
            report = json.loads(os.pread(output.fileno(), 64 * 1024, 0))
            assert len(report['outcomes']) == 1
            assert report['outcomes'][0]['status'] == 'failed'
        print(f'PASS: actual native migration refuses a {attack} {label} ({args.stage_kind if stage else "receipt"}) before changing unrelated evidence or publishing history.')


def run(args):
    root = Path(tempfile.mkdtemp(prefix='hive-3785-native-migration-'))
    canonical = root / 'canonical'
    canonical.mkdir(mode=0o700)
    for name in ('sessions', 'archived_sessions', 'thread-writer-locks'):
        (canonical / name).mkdir(mode=0o700)
    servers = []
    processes = []
    try:
        owner = compression.Native(args.binary, root, canonical, 'owner', True)
        servers.append(owner)
        project(canonical, owner.config, args.without_journal_projection)
        owner.initialize()
        identifier, marker, rollout, _ = compression.rollout(canonical, False)
        # Ignored JSON fields keep the actual input finite (~4 MiB) while the
        # published conversation and protocol replies remain small. Native
        # throughput limiting exposes a stable pre-publication kill boundary.
        padding = json.dumps({'timestamp': '2026-10-01T00:00:00Z', 'type': 'event_msg',
                              'payload': {'type': 'token_count', 'info': None, 'rate_limits': None},
                              'probe_padding': 'x' * 65536}) + '\n'
        with rollout.open('a') as target:
            for _ in range(64):
                target.write(padding)
        original = rollout.read_bytes()
        assert len(original) < 5 * 1024 * 1024
        owner.request('thread/read', {'threadId': identifier, 'includeTurns': False})
        if args.compressed:
            old = time.time() - 8 * 24 * 60 * 60
            os.utime(rollout, (old, old))
            owner.request('rollout/compress', {})
            compressed = Path(str(rollout) + '.zst')
            compression.wait_for(lambda: compressed.is_file() and not rollout.exists(), [owner])
            rollout = compressed
            original = rollout.read_bytes()
        owner.stop()
        if args.journal_attack or args.stage_attack:
            check_target_safety(args, root, canonical, owner, identifier, rollout, processes)
            return
        journal = owner.config / 'rollout-migrations' / f'{identifier}.pending'
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as diagnostics:
            child = migrate(args.binary, root, canonical, owner.config, identifier,
                            output, diagnostics, True)
            processes.append(child)
            wait_for(journal.is_file, child)
            identity = journal.stat()
            assert journal.read_bytes() == b'', 'Require the actual durable native pending journal.'
            stop_process_group(child)
            processes.remove(child)
            assert rollout.read_bytes() == original, 'Interrupt before publishing the migrated transcript.'
        shutil.rmtree(owner.config)
        retained = canonical / 'rollout-migrations' / journal.name
        if args.expect_private_journal:
            assert not retained.exists()
            assert not journal.exists()
            assert rollout.read_bytes() == original
            print('REPRODUCED: actual native migration creates its recovery journal in a disposable configuration; killing the owner and deleting that scope loses the journal while canonical history survives.')
            return
        assert retained.is_file(), 'Native migration journal must survive private configuration disposal.'
        assert (retained.stat().st_dev, retained.stat().st_ino) == (identity.st_dev, identity.st_ino)
        peer = compression.Native(args.binary, root, canonical, 'peer', True)
        servers.append(peer)
        project(canonical, peer.config)
        assert (peer.config / 'rollout-migrations' / journal.name).stat().st_ino == identity.st_ino
        # Stop the app server before the separate native migration command; it
        # has not initialized or opened this synthetic thread.
        peer.stop()
        with tempfile.TemporaryFile() as output, tempfile.TemporaryFile() as diagnostics:
            child = migrate(args.binary, root, canonical, peer.config, identifier,
                            output, diagnostics, False)
            processes.append(child)
            child.wait(timeout=20)
            stop_process_group(child)
            processes.remove(child)
            assert child.returncode == 0, 'A fresh native owner must complete the interrupted migration.'
            assert os.fstat(output.fileno()).st_size < 64 * 1024
            report = json.loads(os.pread(output.fileno(), 64 * 1024, 0))
            assert len(report['outcomes']) == 1
            assert report['outcomes'][0]['status'] == 'migrated'
        assert not retained.exists(), 'Only successful native publication may clear the journal.'
        if args.compressed:
            assert rollout.read_bytes().startswith(b'\x28\xb5\x2f\xfd')
        else:
            assert marker.encode() in rollout.read_bytes()
            with rollout.open() as published:
                first = json.loads(published.readline(256 * 1024))
            assert first['payload']['history_mode'] == 'paginated'
        fresh = compression.Native(args.binary, root, canonical, 'fresh', True)
        servers.append(fresh)
        project(canonical, fresh.config)
        fresh.initialize()
        databases = list(canonical.glob('state_*.sqlite'))
        assert len(databases) == 1
        with sqlite3.connect(f'file:{databases[0]}?mode=ro', uri=True) as database:
            stored = Path(database.execute('SELECT rollout_path FROM threads WHERE id = ?',
                                           (identifier,)).fetchone()[0])
        if args.expect_private_metadata:
            assert stored.is_relative_to(owner.config) and not stored.exists()
        else:
            assert stored.is_relative_to(canonical), 'Migrated SQLite metadata must retain canonical rollout paths.'
        try:
            resumed = fresh.request('thread/resume', {'threadId': identifier, 'modelProvider': 'offline',
                                                       'approvalPolicy': 'never', 'sandbox': 'read-only'})
        except compression.NativeFailure as error:
            assert args.expect_private_metadata
            assert error.error['code'] == -32600
            assert error.error['message'] == f'no rollout found for thread id {identifier}'
            print('REPRODUCED: canonical native journal survives owner disposal and a peer completes migration, but fresh resume still fails because pre-repair SQLite metadata retains the deleted owner alias.')
            return
        assert not args.expect_private_metadata, 'Require the declared private-metadata negative control.'
        assert marker in json.dumps(resumed['thread']['turns'])
        assert not list(root.glob('*/auth.json')), 'Migration must not manufacture private credentials.'
        label = 'compressed' if args.compressed else 'plain'
        print(f'PASS: an actual killed {label} native migration retains one canonical journal across private-scope disposal; a peer completes publication and fresh native resume retains the prior conversation.')
    finally:
        failures = []
        for child in processes:
            try:
                stop_process_group(child)
            except Exception as error:
                failures.append(error)
        for server in servers:
            try:
                server.stop()
            except Exception as error:
                failures.append(error)
        if failures:
            raise RuntimeError('Native migration cleanup failed; fixture retained.') from failures[0]
        shutil.rmtree(root)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('binary', type=lambda value: Path(value).resolve(strict=True))
    parser.add_argument('--expect-private-journal', action='store_true')
    parser.add_argument('--without-journal-projection', action='store_true')
    parser.add_argument('--expect-private-metadata', action='store_true')
    parser.add_argument('--journal-attack', choices=['symlink', 'hardlink'])
    parser.add_argument('--expect-unsafe-journal', action='store_true')
    parser.add_argument('--stage-attack', choices=['symlink', 'hardlink'])
    parser.add_argument('--expect-unsafe-stage', action='store_true')
    parser.add_argument('--stage-kind', choices=['paginated', 'decompressed', 'compressed'], default='paginated')
    parser.add_argument('--compressed', action='store_true')
    arguments = parser.parse_args()
    assert not arguments.expect_private_journal or arguments.without_journal_projection
    assert not arguments.expect_private_metadata or not arguments.without_journal_projection
    assert not arguments.expect_unsafe_journal or arguments.journal_attack
    assert not arguments.journal_attack or not (arguments.without_journal_projection or arguments.expect_private_metadata)
    assert not arguments.expect_unsafe_stage or arguments.stage_attack
    assert not arguments.stage_attack or not (arguments.journal_attack or arguments.without_journal_projection or arguments.expect_private_metadata)
    assert arguments.stage_kind == 'paginated' or (arguments.stage_attack and arguments.compressed)
    run(arguments)
