"""Bounded actual terminal edit/checkpoint/restore across private-home disposal."""
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import shutil
import struct
import subprocess
import termios
import time

from native_process_group import stop_process_group


class NativeTerminal:
    """Drive an actual native CLI process through a finite PTY session."""

    def __init__(self, native, workspace, env, prompt, diagnostic, *, resume=None):
        self.master, slave = pty.openpty()
        self.child = None
        self.output = bytearray()
        self.deadline = time.monotonic() + 45
        self.log = diagnostic.open('wb')
        diagnostic.chmod(0o600)
        try:
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
            self.child = subprocess.Popen(
                ['prlimit', '--data=2147483648', '--stack=16777216', '--core=0', '--',
                 shutil.which('node'), '--max-old-space-size=256', str(native / 'bundle/gemini.js'),
                 '--model', 'gemini-2.5-flash', '--skip-trust',
                 *(['--resume', resume] if resume else []),
                 *(['--prompt-interactive', prompt] if prompt is not None else [])],
                env={**env, 'TERM': 'xterm-256color', 'COLUMNS': '120', 'LINES': '40'},
                cwd=workspace, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
        except BaseException:
            self.close()
            raise
        finally:
            os.close(slave)

    def pump(self, seconds=0.1, *, allow_exit=False):
        assert time.monotonic() < self.deadline, 'Finite native restorable TUI deadline exceeded.'
        if select.select([self.master], [], [], seconds)[0]:
            try:
                data = os.read(self.master, 65536)
            except OSError:
                data = b''
            self.log.write(data)
            self.log.flush()
            self.output.extend(data)
            assert len(self.output) <= 1024 * 1024, 'Native restorable TUI diagnostics exceeded their bound.'
            if b'\x1b[6n' in data:
                os.write(self.master, b'\x1b[1;1R')
        assert allow_exit or self.child.poll() is None, 'Native restorable TUI exited early; inspect bounded diagnostics.'

    def until(self, condition):
        while not condition():
            self.pump()

    def settle(self, seconds=0.4):
        until = time.monotonic() + seconds
        while time.monotonic() < until:
            self.pump(max(0, min(0.1, until - time.monotonic())))

    def send(self, value):
        os.write(self.master, value)
        self.settle()

    def close(self):
        try:
            if self.child is not None:
                stop_process_group(self.child)
        finally:
            try:
                os.close(self.master)
            finally:
                self.log.close()


def verify_restorable_lifetime(*, native, root, home, workspace, history, env,
                               settings, diagnostics, models, first_prompt, second_prompt, attack=None, reopen=False):
    witness = workspace / 'native-restorable-witness.txt'
    companion = workspace / 'native-restorable-companion.txt'
    before = 'SYNTHETIC BEFORE NATIVE EDIT 東京\n'
    after = 'SYNTHETIC AFTER NATIVE EDIT café\n'
    witness.write_text(before)
    companion.write_text(before)

    def damage_metadata():
        files = list(history.rglob('prompt-history.json'))
        assert len(files) == 1
        journal = files[0]
        records = json.loads(journal.read_text())
        row = next(record for record in records if record['type'] == 'restorable-tool')
        saved = json.loads(row['message'])
        data = json.loads(saved['content'])
        data['history'][0]['id'] = 'SYNTHETIC INVALID NATIVE HISTORY ID'
        saved['content'] = json.dumps(data)
        row['message'] = json.dumps(saved)
        journal.write_text(json.dumps(records))
        return journal, journal.read_bytes()

    def checkpoints():
        result = []
        for file in home.rglob('*.json'):
            if file.parent.name == 'checkpoints':
                try:
                    result.append((file.name, json.loads(file.read_text())))
                except (ValueError, OSError):
                    pass
        for file in history.rglob('prompt-history.json'):
            for record in json.loads(file.read_text()):
                if record['type'] == 'restorable-tool':
                    saved = json.loads(record['message'])
                    result.append((saved['name'], json.loads(saved['content'])))
        return [(name, value) for name, value in result
                if value.get('toolCall', {}).get('name') == 'write_file'
                and value['toolCall'].get('args', {}).get('file_path') == str(witness)]

    terminal = NativeTerminal(native, workspace, env, first_prompt, diagnostics)
    try:
        terminal.until(lambda: b'Allow once' in terminal.output and bool(checkpoints()))
        saved = checkpoints()
        assert len(saved) == 1, 'Healthy native TUI must first write exactly one actual restorable checkpoint.'
        name, data = saved[0]
        assert data['commitHash'] and data['history'] and data['clientHistory']
        assert witness.read_text() == before, 'Checkpoint must precede native edit approval.'
        if attack == 'live-metadata-schema':
            journal, damaged = damage_metadata()
            previous = len(models)
            terminal.send(b'\r')
            terminal.until(lambda: witness.read_text() != before
                           or b'Gemini canonical conversation history is unavailable or unsafe.' in terminal.output)
            terminal.settle(1)
            assert witness.read_text() == before, 'Unsafe native restore metadata must prevent the approved native edit.'
            assert len(models) == previous, 'Unsafe native restore metadata must prevent another inference.'
            assert journal.read_bytes() == damaged, 'Refused native edit must preserve damaged metadata for recovery.'
            print('PASS: actual native TUI refuses the approved edit and further inference after live restore-metadata damage.')
            return
        terminal.send(b'\r')
        terminal.until(lambda: witness.read_text() == after and b'SYNTHETIC-GEMINI-COMPLETE' in terminal.output)
        terminal.settle()
        assert sum(record['operation'] == 'streamGenerateContent' for record in models) == 2
        companion.write_text(after)
        print('PASS: actual native TUI records its restorable checkpoint before approval and completes the real write_file edit.')
    finally:
        terminal.close()

    shutil.rmtree(home)
    peer = root / 'restorable-peer'
    private = peer / '.gemini'
    private.mkdir(parents=True, mode=0o700)
    (private / 'settings.json').write_text(json.dumps(settings))
    (private / 'settings.json').chmod(0o600)
    peer_env = {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                'XDG_CACHE_HOME': str(peer / '.cache')}
    if attack == 'startup-metadata-schema':
        journal, damaged = damage_metadata()
    previous = len(models)
    terminal = NativeTerminal(native, workspace, peer_env, second_prompt,
                              diagnostics.with_name(diagnostics.stem + '-restorable-peer.log'))
    try:
        if attack == 'startup-metadata-schema':
            # A failed startup may exit without displaying an interactive prompt.
            while terminal.child.poll() is None and b'Gemini canonical conversation history is unavailable or unsafe.' not in terminal.output:
                terminal.pump(allow_exit=True)
            if b'Gemini canonical conversation history is unavailable or unsafe.' not in terminal.output:
                terminal.pump(allow_exit=True)
            assert b'Gemini canonical conversation history is unavailable or unsafe.' in terminal.output
            assert len(models) == previous, 'Unsafe native restore metadata must refuse startup before inference.'
            assert witness.read_text() == after and companion.read_text() == after
            assert journal.read_bytes() == damaged
            print('PASS: fresh actual native TUI refuses unsafe restore metadata before inference or project changes.')
            return
        terminal.until(lambda: b'SYNTHETIC-GEMINI-COMPLETE' in terminal.output)
        terminal.settle()
        if reopen:
            audit = {path: path.read_bytes() for path in history.rglob('*.jsonl')
                     if '.archive' not in path.parts and second_prompt in path.read_text()}
            assert len(audit) == 1, 'Identify the actual terminal conversation audit before restore.'
            recording = next(iter(audit))
            peer_session = json.loads(recording.read_text().splitlines()[0])['sessionId']
        previous = len(models)
        terminal.send(('/restore ' + name.removesuffix('.json')).encode())
        terminal.send(b'\r')
        terminal.until(lambda: b'Restored project to the state before the tool call.' in terminal.output
                       or b'File not found:' in terminal.output)
        assert companion.read_text() == before, 'Fresh native TUI must restore its actual pre-edit checkpoint after private-home disposal.'
        assert b'Restored project to the state before the tool call.' in terminal.output
        # Native client-initiated slash tools are automatically replayed. Observe
        # that existing behavior, while the untouched companion proves Git undo.
        terminal.until(lambda: witness.read_text() == after and b'Accepted' in terminal.output)
        assert companion.read_text() == before
        assert first_prompt.encode() in terminal.output, 'Native restore must load the saved original conversation.'
        assert len(models) == previous, 'Native restore must use retained metadata and Git objects before another model request.'
        print('PASS: fresh actual native TUI restores the original project and conversation, then replays its stored native tool after complete private-home disposal.')
    finally:
        terminal.close()

    if not reopen:
        return
    assert all(path.read_bytes().startswith(content) for path, content in audit.items()), 'Native terminal restore must retain the prior conversation audit.'
    shutil.rmtree(peer)
    final_home = root / 'restorable-after-restore-home'
    final_private = final_home / '.gemini'
    final_private.mkdir(parents=True, mode=0o700)
    (final_private / 'settings.json').write_text(json.dumps(settings))
    (final_private / 'settings.json').chmod(0o600)
    final_env = {**peer_env, 'HOME': str(final_home), 'GEMINI_CLI_HOME': str(final_home),
                 'XDG_CONFIG_HOME': str(final_home / '.config'), 'XDG_DATA_HOME': str(final_home / '.local/share'),
                 'XDG_CACHE_HOME': str(final_home / '.cache')}
    previous = len(models)
    terminal = NativeTerminal(native, workspace, final_env, None,
                              diagnostics.with_name(diagnostics.stem + '-reopen.log'), resume=peer_session)
    try:
        # The native resume effect and automatic initial prompt run separately.
        # Wait for the resumed UI before submitting a real interactive turn.
        def resumed_input_ready():
            restored = terminal.output.rfind(b'Restored project to the state before the tool call.')
            ready = terminal.output.rfind(b'Type your message or @path/to/file')
            return restored >= 0 and ready > restored and ready > terminal.output.rfind(b'Resuming session...')
        terminal.until(resumed_input_ready)
        terminal.settle()
        assert len(models) == previous, 'Native terminal resume must not require inference.'
        terminal.send(b'SYNTHETIC-GEMINI-TUI-REOPEN-RESTORE')
        terminal.send(b'\r')
        terminal.until(lambda: len(models) > previous and b'SYNTHETIC-GEMINI-COMPLETE' in terminal.output)
        terminal.settle()
        assert models[-1]['first_prompt'] and not models[-1]['second_prompt'], 'A third native terminal must resume its restored original model history.'
        assert len(models) == previous + 1, 'Resuming and submitting one terminal turn must make exactly one model request.'
        assert b'Gemini canonical conversation history is unavailable or unsafe.' not in terminal.output
        assert witness.read_text() == after and companion.read_text() == before
        assert all(path.read_bytes().startswith(content) for path, content in audit.items())
        assert any(saved_name == name for saved_name, _ in checkpoints())
        print('PASS: a third actual native terminal resumes the restored model history and preserves the complete prior audit after a second private-home disposal.')
    finally:
        terminal.close()
