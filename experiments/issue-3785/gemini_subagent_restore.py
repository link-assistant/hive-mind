"""Restore a real child edit through fresh native parent sessions."""
import json
import shutil

from gemini_restorable_acp import NativeAcp


def verify_child_restore(*, invoke, native, root, home, workspace, history, env, settings,
                         diagnostics, models, first_prompt, second_prompt, session, phases, records):
    witness = workspace / 'native-child-witness.txt'
    companion = workspace / 'native-child-companion.txt'
    before = 'SYNTHETIC BEFORE CHILD EDIT 東京\n'
    after = 'SYNTHETIC AFTER CHILD EDIT café\n'
    checkpoints = []
    for journal in history.rglob('prompt-history.json'):
        for row in json.loads(journal.read_text()):
            if row['type'] == 'restorable-tool':
                saved = json.loads(row['message'])
                data = json.loads(saved['content'])
                if data.get('toolCall', {}).get('args', {}).get('file_path') == str(witness):
                    checkpoints.append((saved['name'], data))
    assert len(checkpoints) == 1, 'A healthy actual child edit must acknowledge its canonical native checkpoint.'
    name, data = checkpoints[0]
    assert data['commitHash'] and first_prompt in json.dumps(data['clientHistory'])
    assert data['toolCall']['name'] == 'write_file' and data['toolCall']['args']['content'] == after
    assert not list(home.rglob('checkpoints/*.json'))
    assert witness.read_text() == after and companion.read_text() == before
    print('PASS: actual native child edit acknowledges its canonical pre-edit checkpoint with parent model history and no private metadata copy.')
    companion.write_text(after)
    shutil.rmtree(home)

    def fresh_environment(name):
        peer = root / name
        private = peer / '.gemini'
        private.mkdir(parents=True, mode=0o700)
        (private / 'settings.json').write_text(json.dumps(settings))
        (private / 'settings.json').chmod(0o600)
        return peer, {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                      'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                      'XDG_CACHE_HOME': str(peer / '.cache')}

    peer, peer_env = fresh_environment('child-checkpoint-restore-home')

    def permission(_):
        raise AssertionError('Restoring a retained child checkpoint must not request edit permission.')

    client = NativeAcp(native, workspace, peer_env,
                       diagnostics.with_name(diagnostics.stem + '-restore.log'), permission)

    def prompt(text):
        return client.call('session/prompt', {'sessionId': session,
                          'prompt': [{'type': 'text', 'text': text}]})

    try:
        assert client.call('initialize', {'protocolVersion': 1, 'clientCapabilities': {}})['protocolVersion'] == 1
        client.call('session/load', {'sessionId': session, 'cwd': str(workspace), 'mcpServers': []})
        assert prompt(second_prompt)['stopReason'] == 'end_turn'
        assert models[-1]['first_prompt'] and models[-1]['second_prompt'] and models[-1]['child_result']
        count = len(models)
        assert prompt('/restore ' + name.removesuffix('.json'))['stopReason'] == 'end_turn'
        assert len(models) == count, 'Child checkpoint restore must use retained native metadata and Git without inference.'
        assert witness.read_text() == before and companion.read_text() == before
        phases['restoring'] = True
        assert prompt('SYNTHETIC-GEMINI-CHILD-CHECKPOINT-RESTORED')['stopReason'] == 'end_turn'
        assert len(models) == count + 1 and models[-1]['first_prompt']
        assert not models[-1]['second_prompt'] and not models[-1]['child_result']
        assert all(path.read_bytes().startswith(content) for path, content in records.items())
        print('PASS: a fresh actual ACP restores the child edit and companion plus pre-edit parent model history after whole private-home disposal, retaining both complete audit prefixes.')
    finally:
        client.close()
    shutil.rmtree(peer)
    _, final_env = fresh_environment('child-checkpoint-reopen-home')
    count = len(models)
    code, output = invoke(diagnostics.with_name(diagnostics.stem + '-reopen.log'), final_env,
                          ['--resume', session, '--prompt', 'SYNTHETIC-GEMINI-CHILD-CHECKPOINT-REOPEN'])
    assert code == 0 and 'SYNTHETIC-GEMINI-COMPLETE' in output
    assert len(models) == count + 1 and models[-1]['first_prompt']
    assert not models[-1]['second_prompt'] and not models[-1]['child_result']
    assert witness.read_text() == before and companion.read_text() == before
    assert all(path.read_bytes().startswith(content) for path, content in records.items())
    print('PASS: a third actual native CLI resumes restored parent history after a second private-home disposal, keeping the restored project and complete root/child audit prefixes.')
