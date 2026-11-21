"""Require an actual headless native edit to acknowledge its native checkpoint."""
import json
import shutil

from gemini_restorable_acp import NativeAcp


def verify_headless_checkpoint(*, invoke, native, root, settings, env, home, history, workspace,
                               diagnostics, models, first_prompt, second_prompt, session,
                               attack=None, live_damage=None):
    witness = workspace / 'native-restorable-witness.txt'
    companion = workspace / 'native-restorable-companion.txt'
    before = 'SYNTHETIC BEFORE NATIVE EDIT 東京\n'
    after = 'SYNTHETIC AFTER NATIVE EDIT café\n'
    witness.write_text(before)
    companion.write_text(before)
    code, output = invoke(diagnostics, env, ['--approval-mode', 'yolo', '--prompt', first_prompt,
                                           '--session-id', session])
    assert code == 0, 'Healthy headless native edit must first finish successfully.'
    assert witness.read_text() == after, 'Healthy headless native edit must first change its requested file.'
    assert len(models) == 2 and models[0].get('tool_call') and not models[1].get('tool_call')
    assert 'SYNTHETIC-GEMINI-COMPLETE' in output
    assert 'Gemini canonical conversation history is unavailable or unsafe.' not in output
    print('PASS: actual headless native CLI completes its real write_file edit and subsequent inference.')
    if 'GEMINI_HISTORY_HOME' not in env:
        assert not list(history.rglob('*'))
        assert any(first_prompt in p.read_text() for p in home.rglob('session-*.jsonl'))
        print('PASS: unselected actual headless CLI preserves private recording and its original edit behavior.')
        return
    checkpoints = []
    for file in history.rglob('prompt-history.json'):
        for record in json.loads(file.read_text()):
            if record['type'] == 'restorable-tool':
                saved = json.loads(record['message'])
                data = json.loads(saved['content'])
                if data.get('toolCall', {}).get('args', {}).get('file_path') == str(witness):
                    checkpoints.append((saved['name'], data))
    assert len(checkpoints) == 1, 'Actual headless native edits must acknowledge their canonical restorable checkpoint.'
    name, data = checkpoints[0]
    assert name.endswith('-write_file.json') and data['commitHash'] and data['clientHistory']
    assert first_prompt in json.dumps(data['clientHistory'])
    assert not list(home.rglob('checkpoints/*.json')), 'Selected headless checkpoint metadata must remain canonical.'
    print('PASS: actual headless native edit retains its canonical checkpoint and original model history.')
    audit = {path: path.read_bytes() for path in history.rglob('*.jsonl')
             if '.archive' not in path.parts and first_prompt in path.read_text()}
    assert len(audit) == 1
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

    peer, peer_env = fresh_environment('headless-acp-restore-home')
    if attack == 'live-metadata-schema':
        protected = 'SYNTHETIC LIVE HEADLESS PROTECTED 東京\n'
        witness.write_text(protected)
        count = len(models)
        code, output = invoke(diagnostics.with_name(diagnostics.stem + '-live-refusal.log'), peer_env,
                              ['--approval-mode', 'yolo', '--resume', session, '--prompt', second_prompt])
        assert code != 0 and 'Gemini canonical conversation history is unavailable or unsafe.' in output
        assert len(models) == count + 1 and models[-1].get('tool_call'), 'Live headless metadata damage must prevent inference after its returned edit request.'
        assert len(live_damage) == 1 and live_damage[0][0].read_bytes() == live_damage[0][1]
        assert witness.read_text() == protected and companion.read_text() == after
        print('PASS: actual headless native CLI refuses its returned edit and further inference after metadata damage during a real model request, preserving project and audit bytes.')
        return
    if attack == 'startup-metadata-schema':
        journal, = history.rglob('prompt-history.json')
        rows = json.loads(journal.read_text())
        row = next(row for row in rows if row['type'] == 'restorable-tool')
        saved = json.loads(row['message'])
        data = json.loads(saved['content'])
        data['history'] = [{'type': 'user', 'id': 'SYNTHETIC INVALID HISTORY ID'}]
        saved['content'] = json.dumps(data)
        row['message'] = json.dumps(saved)
        journal.write_text(json.dumps(rows))
        damaged = journal.read_bytes()
        count = len(models)
        code, output = invoke(diagnostics.with_name(diagnostics.stem + '-refusal.log'), peer_env,
                              ['--resume', session, '--prompt', second_prompt])
        assert code != 0 and 'Gemini canonical conversation history is unavailable or unsafe.' in output
        assert len(models) == count, 'Unsafe headless metadata must refuse before further inference.'
        assert witness.read_text() == after and companion.read_text() == after
        assert journal.read_bytes() == damaged
        print('PASS: a fresh actual headless CLI refuses unsafe checkpoint metadata before inference or project changes and preserves damaged audit bytes.')
        return
    def permission(_):
        raise AssertionError('Headless checkpoint restore must not request edit permission.')
    client = NativeAcp(native, workspace, peer_env,
                       diagnostics.with_name(diagnostics.stem + '-restore.log'), permission)
    def prompt(text):
        return client.call('session/prompt', {'sessionId': session, 'prompt': [{'type': 'text', 'text': text}]})
    try:
        assert client.call('initialize', {'protocolVersion': 1, 'clientCapabilities': {}})['protocolVersion'] == 1
        client.call('session/load', {'sessionId': session, 'cwd': str(workspace), 'mcpServers': []})
        assert prompt(second_prompt)['stopReason'] == 'end_turn'
        assert models[-1]['first_prompt'] and models[-1]['second_prompt']
        count = len(models)
        assert prompt('/restore ' + name.removesuffix('.json'))['stopReason'] == 'end_turn'
        assert witness.read_text() == before and companion.read_text() == before
        assert len(models) == count, 'Headless checkpoint restore must use retained native Git and metadata without inference.'
        assert prompt('SYNTHETIC-GEMINI-HEADLESS-RESTORED')['stopReason'] == 'end_turn'
        assert models[-1]['first_prompt'] and not models[-1]['second_prompt']
        assert all(path.read_bytes().startswith(content) for path, content in audit.items())
        print('PASS: a fresh actual ACP restores the headless checkpoint and actual model history after complete private-home disposal.')
    finally:
        client.close()
    shutil.rmtree(peer)
    _, final_env = fresh_environment('headless-after-restore-home')
    count = len(models)
    code, output = invoke(diagnostics.with_name(diagnostics.stem + '-reopen.log'), final_env,
                          ['--resume', session, '--prompt', 'SYNTHETIC-GEMINI-HEADLESS-REOPEN'])
    assert code == 0 and 'SYNTHETIC-GEMINI-COMPLETE' in output
    assert 'Gemini canonical conversation history is unavailable or unsafe.' not in output
    assert len(models) == count + 1 and models[-1]['first_prompt'] and not models[-1]['second_prompt']
    assert witness.read_text() == before and companion.read_text() == before
    assert all(path.read_bytes().startswith(content) for path, content in audit.items())
    print('PASS: a third actual headless CLI resumes restored model history and retains the prior audit after a second private-home disposal.')
