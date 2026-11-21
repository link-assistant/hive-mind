"""Allow a real native discovery peer to append metadata beside a live writer."""
import json

from gemini_restorable_tui import NativeTerminal


def verify_live_summary(*, invoke, native, root, home, workspace, history, env,
                        settings, diagnostics, models, first_prompt, second_prompt):
    witness = workspace / 'native-summary-witness.txt'
    witness.write_text('SYNTHETIC UNCHANGED LIVE SUMMARY 東京\n')
    terminal = NativeTerminal(native, workspace, env, first_prompt, diagnostics)
    try:
        terminal.until(lambda: b'SYNTHETIC-GEMINI-COMPLETE' in terminal.output)
        terminal.settle()
        assert len(models) == 1 and models[0]['first_prompt']
        recording, = [p for p in history.rglob('*.jsonl') if first_prompt in p.read_text()]
        initial = recording.read_bytes()
        identity = (recording.stat().st_dev, recording.stat().st_ino)
        session = json.loads(initial.splitlines()[0])['sessionId']
        peer = root / 'live-summary-peer-home'
        private = peer / '.gemini'
        private.mkdir(parents=True, mode=0o700)
        (private / 'settings.json').write_text(json.dumps(settings))
        (private / 'settings.json').chmod(0o600)
        peer_env = {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                    'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                    'XDG_CACHE_HOME': str(peer / '.cache')}
        code, output = invoke(diagnostics.with_name(diagnostics.stem + '-list.log'), peer_env, ['--list-sessions'])
        assert code == 0 and session[:8] in output
        assert len(models) == 2 and models[-1]['operation'] == 'generateContent' and models[-1]['session_summary']
        summarized = recording.read_bytes()
        assert summarized.startswith(initial) and len(summarized) > len(initial)
        assert (recording.stat().st_dev, recording.stat().st_ino) == identity
        assert not list(peer.rglob('*.jsonl')) and not list(home.rglob('*.jsonl'))
        print('PASS: a real native discovery peer appends its existing session summary while the original terminal retains its conversation writer claim and complete prior audit.')
        terminal.send(second_prompt.encode())
        terminal.send(b'\r')
        terminal.until(lambda: len(models) == 3 and b'SYNTHETIC-GEMINI-COMPLETE' in recording.read_bytes()[len(summarized):])
        terminal.settle()
        assert len(models) == 3 and models[-1]['operation'] == 'streamGenerateContent'
        assert all(models[-1][key] for key in ('first_prompt', 'second_prompt', 'prior_response'))
        assert b'Gemini canonical conversation history is unavailable or unsafe.' not in terminal.output
        assert recording.read_bytes().startswith(summarized)
        assert (recording.stat().st_dev, recording.stat().st_ino) == identity
        assert witness.read_text() == 'SYNTHETIC UNCHANGED LIVE SUMMARY 東京\n'
        print('PASS: the original actual native terminal accepts the append-only peer metadata and completes its next inference with original model history, retaining the full preceding audit and peer summary.')
    finally:
        terminal.close()
