"""Replace a live actual conversation with an older valid native generation."""
def live_audit_tool(contents, history, root, workspace, state):
    recording, = [p for p in history.rglob('*.jsonl') if '.archive' not in p.parts]
    if not state:
        state.update(recording=recording, initial=recording.read_bytes())
        return {'id': 'synthetic-audit-edit', 'name': 'write_file',
                'args': {'file_path': str(workspace / 'native-audit-witness.txt'),
                         'content': 'SYNTHETIC AFTER AUDIT EDIT café\n'}}
    assert 'complete' not in state, 'Bound the actual native audit test to two model requests.'
    responses = [part['functionResponse'] for turn in contents for part in turn.get('parts', [])
                 if part.get('functionResponse', {}).get('id') == 'synthetic-audit-edit']
    assert len(responses) == 1 and 'error' not in responses[0].get('response', {})
    assert (workspace / 'native-audit-witness.txt').read_text() == 'SYNTHETIC AFTER AUDIT EDIT café\n'
    complete = recording.read_bytes()
    assert len(complete) > len(state['initial']) and complete.startswith(state['initial'])
    assert b'synthetic-audit-edit' in complete
    protected = root / 'protected-complete-native-audit.jsonl'
    recording.rename(protected)
    recording.write_bytes(state['initial'])
    recording.chmod(0o600)
    state.update(complete=complete, protected=protected,
                 replacement_identity=(recording.stat().st_dev, recording.stat().st_ino),
                 identity=(protected.stat().st_dev, protected.stat().st_ino))
    print('PASS: actual native CLI completes its healthy write_file and records its real tool call/result before an older valid audit generation is atomically substituted.')
    return None


def verify_live_audit(*, invoke, env, diagnostics, models, workspace, state, session, first_prompt):
    witness = workspace / 'native-audit-witness.txt'
    witness.write_text('SYNTHETIC BEFORE AUDIT EDIT 東京\n')
    code, output = invoke(diagnostics, env, ['--approval-mode', 'yolo', '--session-id', session,
                                           '--prompt', first_prompt])
    assert len(models) == 2 and 'complete' in state
    assert witness.read_text() == 'SYNTHETIC AFTER AUDIT EDIT café\n'
    protected = state['protected']
    assert protected.read_bytes() == state['complete']
    assert (protected.stat().st_dev, protected.stat().st_ino) == state['identity']
    recording = state['recording']
    if code == 0:
        assert 'SYNTHETIC-GEMINI-COMPLETE' in output
        assert not recording.read_bytes().startswith(state['complete'])
        assert b'synthetic-audit-edit' not in recording.read_bytes()
        print('REPRODUCED: actual native inference completes after valid audit rollback, silently losing its previously recorded tool call/result from the selected conversation.')
    assert code != 0 and 'Gemini canonical conversation history is unavailable or unsafe.' in output, 'Actual native recording must refuse a valid rollback of its previously observed complete conversation.'
    assert recording.read_bytes() == state['initial'], 'Refused native recording must leave the substituted evidence unchanged.'
    assert (recording.stat().st_dev, recording.stat().st_ino) == state['replacement_identity']
    print('PASS: actual native recording refuses the substituted valid generation without another model request or alteration of protected audit/project evidence.')
