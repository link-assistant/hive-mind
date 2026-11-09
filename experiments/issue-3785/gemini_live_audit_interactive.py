"""Exercise live audit rollback through actual terminal and ACP dispatch."""
import json

from gemini_restorable_acp import NativeAcp
from gemini_restorable_tui import NativeTerminal

REFUSAL = 'Gemini canonical conversation history is unavailable or unsafe.'
COMPLETE = 'SYNTHETIC-GEMINI-COMPLETE'


def verify_interactive_audit(*, native, env, diagnostics, models, workspace, state,
                             first_prompt, mode):
    witness = workspace / 'native-audit-witness.txt'
    witness.write_text('SYNTHETIC BEFORE AUDIT EDIT 東京\n')
    client = None
    try:
        if mode == 'terminal':
            client = NativeTerminal(native, workspace, env, first_prompt, diagnostics)
            client.until(lambda: b'Apply this change?' in client.output or REFUSAL.encode() in client.output)
            assert witness.read_text() == 'SYNTHETIC BEFORE AUDIT EDIT 東京\n'
            client.send(b'\r')
            client.until(lambda: REFUSAL.encode() in client.output or COMPLETE.encode() in client.output)
            client.settle()
            output = client.output.decode(errors='replace')
            completed = COMPLETE in output
        else:
            client = NativeAcp(native, workspace, env, diagnostics, lambda _: 'allow_once')
            assert client.call('initialize', {'protocolVersion': 1, 'clientCapabilities': {}})['protocolVersion'] == 1
            session = client.call('session/new', {'cwd': str(workspace), 'mcpServers': []})['sessionId']
            response = client.call('session/prompt', {'sessionId': session,
                                   'prompt': [{'type': 'text', 'text': first_prompt}]}, allow_error=True)
            output = json.dumps(client.messages) + diagnostics.read_text()
            completed = COMPLETE in output
        assert len(models) == 2 and 'complete' in state, 'Require healthy actual native editing and its subsequent model request before rollback refusal.'
        assert witness.read_text() == 'SYNTHETIC AFTER AUDIT EDIT café\n'
        protected = state['protected']
        assert protected.read_bytes() == state['complete']
        assert (protected.stat().st_dev, protected.stat().st_ino) == state['identity']
        recording = state['recording']
        if completed:
            assert not recording.read_bytes().startswith(state['complete'])
            assert b'synthetic-audit-edit' not in recording.read_bytes()
            print('REPRODUCED: actual native inference completes after valid audit rollback, silently losing its previously recorded tool call/result from the selected conversation.')
        assert not completed and REFUSAL in output, 'Actual native recording must refuse a valid rollback of its previously observed complete conversation.'
        followup = 'SYNTHETIC-AUDIT-REFUSAL-FOLLOWUP'
        if mode == 'terminal':
            start = len(client.output)
            client.send(followup.encode())
            client.send(b'\r')
            client.until(lambda: REFUSAL.encode() in client.output[start:] or len(models) > 2)
            client.settle()
            assert REFUSAL.encode() in client.output[start:]
        else:
            assert 'error' in response
            response = client.call('session/prompt', {'sessionId': session,
                                   'prompt': [{'type': 'text', 'text': followup}]}, allow_error=True)
            assert 'error' in response and REFUSAL in json.dumps(response)
        assert len(models) == 2, 'Refused native streaming must prevent subsequent inference.'
        assert witness.read_text() == 'SYNTHETIC AFTER AUDIT EDIT café\n'
        assert protected.read_bytes() == state['complete']
        assert (protected.stat().st_dev, protected.stat().st_ino) == state['identity']
        assert recording.read_bytes() == state['initial']
        assert (recording.stat().st_dev, recording.stat().st_ino) == state['replacement_identity']
        print('PASS: actual native ' + mode + ' refuses valid audit rollback with its healthy edit and complete protected audit intact, leaving substituted bytes and inode unchanged.')
        print('PASS: actual native ' + mode + ' promptly refuses its subsequent prompt without another model request or project/audit changes.')
    finally:
        if client is not None:
            client.close()
