"""Exercise real terminal resume refusal while a native peer owns the session."""
import json
import os
import shutil
import time

from gemini_restorable_acp import NativeAcp
from gemini_restorable_tui import NativeTerminal


def verify_resume_refusal(*, invoke, native, root, home, workspace, history, env,
                          settings, diagnostics, models, first_prompt, second_prompt, session):
    witness = workspace / 'native-restorable-witness.txt'
    witness.write_text('SYNTHETIC BEFORE NATIVE EDIT 東京\n')
    code, output = invoke(diagnostics, env, ['--approval-mode', 'yolo', '--session-id', session,
                                           '--prompt', first_prompt])
    assert code == 0 and 'SYNTHETIC-GEMINI-COMPLETE' in output
    assert len(models) == 2 and witness.read_text() == 'SYNTHETIC AFTER NATIVE EDIT café\n'
    print('PASS: actual native CLI first completes its healthy edit and canonical conversation.')
    shutil.rmtree(home)

    def fresh_environment(name):
        peer = root / name
        private = peer / '.gemini'
        private.mkdir(parents=True, mode=0o700)
        (private / 'settings.json').write_text(json.dumps(settings))
        (private / 'settings.json').chmod(0o600)
        return {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                'XDG_CACHE_HOME': str(peer / '.cache')}

    def permission(_):
        raise AssertionError('A resumed owner must not request edit permission.')

    owner = NativeAcp(native, workspace, fresh_environment('resume-owner-home'),
                      diagnostics.with_name(diagnostics.stem + '-owner.log'), permission)
    try:
        owner.call('initialize', {'protocolVersion': 1, 'clientCapabilities': {}})
        owner.call('session/load', {'sessionId': session, 'cwd': str(workspace), 'mcpServers': []})
        result = owner.call('session/prompt', {'sessionId': session,
                            'prompt': [{'type': 'text', 'text': 'SYNTHETIC-GEMINI-ACTIVE-RESUME-OWNER'}]})
        assert result['stopReason'] == 'end_turn'
        assert len(models) == 3 and models[-1]['first_prompt']
        audit = {p: p.read_bytes() for p in history.rglob('*.jsonl')
                 if '.archive' not in p.parts and first_prompt in p.read_text()}
        assert len(audit) == 1
        metadata = {p: p.read_bytes() for p in history.rglob('prompt-history.json')}
        protected = witness.read_bytes()
        previous = len(models)
        print('PASS: an actual fresh ACP resumes the conversation and retains its native writer claim.')
        terminal = NativeTerminal(native, workspace, fresh_environment('resume-contender-home'),
                                  second_prompt, diagnostics.with_name(diagnostics.stem + '-contender.log'),
                                  resume=session)
        try:
            refusal = b'Gemini canonical conversation history is unavailable or unsafe.'
            while terminal.child.poll() is None and refusal not in terminal.output and len(models) == previous:
                terminal.pump(allow_exit=True)
            deadline = time.monotonic() + 1
            while terminal.child.poll() is None and time.monotonic() < deadline:
                terminal.pump(allow_exit=True)
            assert len(models) == previous, 'A refused native terminal resume must prevent its automatic provider request.'
            assert refusal in terminal.output, 'The actual native terminal must display its canonical resume refusal.'
            assert all(p.read_bytes() == content for p, content in audit.items())
            assert all(p.read_bytes() == content for p, content in metadata.items())
            assert witness.read_bytes() == protected
            if terminal.child.poll() is None:
                os.write(terminal.master, b'SYNTHETIC-GEMINI-MANUAL-AFTER-REFUSAL\r')
                deadline = time.monotonic() + 1
                while terminal.child.poll() is None and time.monotonic() < deadline:
                    terminal.pump(allow_exit=True)
                assert len(models) == previous, 'A refused native terminal resume must keep typed prompts disabled.'
                assert all(p.read_bytes() == content for p, content in audit.items())
                assert all(p.read_bytes() == content for p, content in metadata.items())
                assert witness.read_bytes() == protected
                print('PASS: the refused actual terminal keeps typed prompts disabled.')
            else:
                print('PASS: the refused actual terminal exits before accepting interactive input.')
            print('PASS: actual terminal resume refuses provider requests while the owner lives, preserving project, metadata and audit bytes.')
        finally:
            terminal.close()
    finally:
        owner.close()
    previous = len(models)
    code, output = invoke(diagnostics.with_name(diagnostics.stem + '-recovery.log'),
                          fresh_environment('resume-recovery-home'), ['--resume', session,
                          '--prompt', 'SYNTHETIC-GEMINI-RESUME-AFTER-OWNER-EXIT'])
    assert code == 0 and 'SYNTHETIC-GEMINI-COMPLETE' in output
    assert len(models) == previous + 1 and models[-1]['first_prompt']
    assert all(p.read_bytes().startswith(content) for p, content in audit.items())
    assert witness.read_bytes() == protected
    print('PASS: after the actual owner is stopped and reaped, a fresh native CLI resumes with original model history and retained prior audit.')
