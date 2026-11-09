"""Hold a real canonical history lock during native terminal startup/resume."""
import fcntl
import json
import os
from pathlib import Path
import shutil

from gemini_restorable_tui import NativeTerminal


def waiting_native_lock(pid, expected):
    """Find only a bounded descendant flock using the inspected canonical inode."""
    pending = [pid]
    seen = set()
    while pending:
        child = pending.pop()
        if child in seen:
            continue
        seen.add(child)
        assert len(seen) <= 32, 'Bound native history lock descendant inspection.'
        try:
            proc = Path('/proc') / str(child)
            with (proc / 'cmdline').open('rb') as source:
                command = source.read(4097)
            assert len(command) <= 4096
            parts = command.rstrip(b'\0').split(b'\0')
            if parts == [b'flock', b'-x', b'-w', b'5', b'3']:
                info = (proc / 'fd/3').stat()
                if (info.st_dev, info.st_ino) == expected:
                    return child
            with (proc / 'task' / str(child) / 'children').open('r') as source:
                descendants = source.read(4097)
            assert len(descendants) <= 4096
            pending.extend(int(value) for value in descendants.split())
        except (FileNotFoundError, ProcessLookupError):
            continue
    return None


def verify_resume_interruption(*, invoke, native, root, home, workspace, history,
                               env, settings, diagnostics, models, first_prompt,
                               second_prompt, session, mode):
    witness = workspace / 'native-restorable-witness.txt'
    witness.write_text('SYNTHETIC BEFORE NATIVE EDIT 東京\n')
    code, output = invoke(diagnostics, env, ['--approval-mode', 'yolo', '--session-id', session,
                                           '--prompt', first_prompt])
    assert code == 0 and 'SYNTHETIC-GEMINI-COMPLETE' in output and len(models) == 2
    assert witness.read_text() == 'SYNTHETIC AFTER NATIVE EDIT café\n'
    audits = {p: p.read_bytes() for p in history.rglob('*.jsonl')
              if '.archive' not in p.parts and first_prompt in p.read_text()}
    assert len(audits) == 1
    metadata = {p: p.read_bytes() for p in history.rglob('prompt-history.json')}
    protected = witness.read_bytes()
    recording, = audits
    lock = recording.parent / '.history.lock'
    lock_fd = os.open(lock, os.O_RDWR | os.O_NOFOLLOW | os.O_NONBLOCK)
    info = os.fstat(lock_fd)
    expected = (info.st_dev, info.st_ino)
    assert info.st_size == 0 and info.st_nlink == 1 and info.st_mode & 0o077 == 0
    shutil.rmtree(home)

    def environment(name):
        peer = root / name
        private = peer / '.gemini'
        private.mkdir(parents=True, mode=0o700)
        (private / 'settings.json').write_text(json.dumps(settings))
        (private / 'settings.json').chmod(0o600)
        return {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                'XDG_CACHE_HOME': str(peer / '.cache')}

    terminal = None
    try:
        fcntl.flock(lock_fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
        terminal = NativeTerminal(native, workspace, environment('delayed-resume-home'),
                                  second_prompt, diagnostics.with_name(diagnostics.stem + '-terminal.log'),
                                  resume=session)
        previous = len(models)
        blocked = None
        while blocked is None:
            terminal.pump(0.01)
            blocked = waiting_native_lock(terminal.child.pid, expected)
        terminal.settle(0.3)
        assert len(models) == previous, 'Held canonical history admission must prevent automatic native inference.'
        assert all(p.read_bytes() == value for p, value in {**audits, **metadata}.items())
        assert witness.read_bytes() == protected
        diagnostics.with_name(diagnostics.stem + '-waiting.control.json').write_text(json.dumps({
            'native_pid': terminal.child.pid, 'waiting_flock_pid': blocked,
            'canonical_lock_identity': expected, 'mode': mode,
            'model_requests_before_release': len(models) - previous}, indent=2))
        print('PASS: actual terminal startup/resume waits on the inspected canonical lock without provider requests or protected project/audit changes.')
        if mode == 'release':
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            terminal.until(lambda: len(models) > previous and b'SYNTHETIC-GEMINI-COMPLETE' in terminal.output)
            terminal.settle()
            assert len(models) == previous + 1
            assert models[-1]['first_prompt'] and models[-1]['second_prompt'], 'A delayed actual terminal resume must preserve original model history.'
            assert b'Gemini canonical conversation history is unavailable or unsafe.' not in terminal.output
            assert all(p.read_bytes().startswith(value) for p, value in audits.items())
            assert witness.read_bytes() == protected
            print('PASS: releasing the actual history lock admits exactly one automatic terminal request with its original resumed model history and complete preceding audit.')
        else:
            assert mode == 'kill'
            os.write(terminal.master, b'SYNTHETIC-GEMINI-TYPED-DURING-INTERRUPTION\r')
    finally:
        try:
            if terminal is not None:
                terminal.close()
        finally:
            fcntl.flock(lock_fd, fcntl.LOCK_UN)
            os.close(lock_fd)
    assert (lock.stat().st_dev, lock.stat().st_ino) == expected
    if mode == 'kill':
        assert terminal.child.poll() is not None and len(models) == previous
        assert all(p.read_bytes() == value for p, value in {**audits, **metadata}.items())
        assert witness.read_bytes() == protected
        print('PASS: interrupted native admission is stopped and reaped before lock release, preserving all preceding project, metadata and audit bytes.')
        code, output = invoke(diagnostics.with_name(diagnostics.stem + '-recovery.log'),
                              environment('interrupted-resume-recovery-home'), ['--resume', session,
                              '--prompt', 'SYNTHETIC-GEMINI-RECOVER-INTERRUPTED-ADMISSION'])
        assert code == 0 and 'SYNTHETIC-GEMINI-COMPLETE' in output
        assert len(models) == previous + 1 and models[-1]['first_prompt']
        assert all(p.read_bytes().startswith(value) for p, value in audits.items())
        assert witness.read_bytes() == protected
        print('PASS: a fresh actual native CLI recovers interrupted history admission with the original model history and complete preceding audit.')
