"""Exercise real native plan writes before disposing private configuration."""
import json
import re
import shutil


PLAN = '# SYNTHETIC RETAINED NATIVE PLAN 東京\n\n- Preserve the complete plan café.\n'
UPDATED_PLAN = PLAN + '- Retain the resumed replacement generation 🐝.\n'


def plan_tool_call(payload, first_prompt, workspace, phases):
    contents = payload['request']['contents']
    content = json.dumps(contents)
    system = json.dumps(payload['request'].get('systemInstruction', {}))
    # The actual native Plan Mode system prompt supplies its effective directory.
    match = re.search(r'(?:produce an implementation plan in|Save your plans as Markdown \(\.md\) files ONLY within:) `([^`]+)`', system)
    assert match, 'Require the actual native Plan Mode system instruction.'
    directory = (workspace / match[1]).resolve()
    file = directory / 'synthetic-retained-plan.md'
    assert first_prompt in content
    if 'SYNTHETIC-GEMINI-PLAN-RECOVER' in content:
        from gemini_plan_interruption import recovered_plan_tool_call
        return recovered_plan_tool_call(contents, file, phases)
    phase = 'resume' if 'SYNTHETIC-GEMINI-PLAN-REOPEN' in content else 'initial'
    step = phases.get(phase, 0)
    phases[phase] = step + 1
    if step == 0:
        phases[phase + '_file'] = file
        return {'id': 'synthetic-native-plan-' + phase,
                'name': 'write_file' if phase == 'initial' else 'read_file',
                'args': {'file_path': str(file), **({'content': PLAN} if phase == 'initial' else {})}}
    assert step == 1 or phase == 'resume' and step == 2
    identifier = 'synthetic-native-plan-' + phase + ('-replace' if step == 2 else '')
    responses = [part['functionResponse'] for turn in contents for part in turn.get('parts', [])
                 if part.get('functionResponse', {}).get('id') == identifier]
    assert len(responses) == 1 and 'error' not in responses[0].get('response', {})
    if phase == 'resume' and step == 1:
        assert 'SYNTHETIC RETAINED NATIVE PLAN' in json.dumps(responses[0])
        assert file.read_text() == PLAN
        return {'id': 'synthetic-native-plan-resume-replace', 'name': 'replace',
                'args': {'file_path': str(file), 'old_string': PLAN, 'new_string': UPDATED_PLAN,
                         'instruction': 'Append the synthetic resumed plan generation.'}}
    assert file.read_text() == (UPDATED_PLAN if phase == 'resume' else PLAN)
    return None


def verify_plan_history(*, invoke, root, home, workspace, history, env, settings,
                        diagnostics, models, first_prompt, session, phases, attack=None):
    code, output = invoke(diagnostics, env, ['--approval-mode', 'plan', '--session-id', session,
                                           '--prompt', first_prompt])
    assert code == 0 and 'SYNTHETIC-GEMINI-COMPLETE' in output
    assert phases['initial'] == 2 and len(models) == 2
    file = phases['initial_file']
    assert file.read_text() == PLAN
    print('PASS: actual native Plan Mode writes and acknowledges its complete implementation plan before private-home disposal.')
    if 'GEMINI_HISTORY_HOME' not in env:
        assert home in file.parents and not list(history.rglob('*.jsonl'))
        print('PASS: unselected actual native Plan Mode preserves its original private plan directory and recording.')
        return
    selected_file = file.resolve()
    records = {p: p.read_bytes() for p in history.rglob('*.jsonl')}
    assert records and not list(home.rglob('*.jsonl'))
    shutil.rmtree(home)
    if not selected_file.exists():
        print('REPRODUCED: actual native Plan Mode acknowledges its complete plan, then whole private-home disposal deletes that plan despite selected canonical history.')
    assert selected_file.exists() and history in selected_file.parents, 'Actual native plans must survive private-home disposal in canonical history.'
    protected = root / 'protected-plan.md'
    protected.write_text('SYNTHETIC PROTECTED PLAN\n')
    protected.chmod(0o600)
    protected_before = (protected.stat().st_ino, protected.read_bytes())
    if attack == 'missing':
        selected_file.unlink()
    elif attack == 'content-change':
        selected_file.write_text('SYNTHETIC SUBSTITUTED PLAN\n')
    elif attack == 'symlink':
        selected_file.unlink()
        selected_file.symlink_to(protected)
    elif attack == 'unsafe-mode':
        selected_file.chmod(0o644)
    damaged = None if not selected_file.exists() else (selected_file.lstat().st_ino, selected_file.read_bytes())
    peer = root / 'native-plan-resume-home'
    private = peer / '.gemini'
    private.mkdir(parents=True, mode=0o700)
    (private / 'settings.json').write_text(json.dumps(settings))
    (private / 'settings.json').chmod(0o600)
    peer_env = {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                'XDG_CACHE_HOME': str(peer / '.cache')}
    code, output = invoke(diagnostics.with_name(diagnostics.stem + '-resume.log'), peer_env,
                          ['--approval-mode', 'plan', '--resume', session, '--prompt', 'SYNTHETIC-GEMINI-PLAN-REOPEN'])
    if attack:
        assert code != 0 and 'Gemini canonical conversation history is unavailable or unsafe.' in output
        assert 'SYNTHETIC-GEMINI-COMPLETE' not in output and len(models) == 3
        assert all(p.read_bytes().startswith(content) for p, content in records.items())
        assert (protected.stat().st_ino, protected.read_bytes()) == protected_before
        assert (None if not selected_file.exists() else (selected_file.lstat().st_ino, selected_file.read_bytes())) == damaged
        print('PASS: fresh actual native read refuses ' + attack + ' without delivering substituted plan content or further inference, preserving protected data and prior audit.')
        return
    assert code == 0 and 'SYNTHETIC-GEMINI-COMPLETE' in output
    assert len(models) == 5 and phases['resume'] == 3
    assert phases['resume_file'].resolve() == selected_file and selected_file.read_text() == UPDATED_PLAN
    assert all(p.read_bytes().startswith(content) for p, content in records.items())
    assert not list(peer.rglob('synthetic-retained-plan.md'))
    print('PASS: fresh actual native Plan Mode resumes and reads its complete retained plan after whole private-home disposal, preserving the preceding audit.')
    generations = [json.loads(row['message'])['content'] for journal in history.rglob('prompt-history.json')
                   for row in json.loads(journal.read_text()) if row['type'] == 'plan-document']
    assert generations == [PLAN, UPDATED_PLAN]
    print('PASS: actual native replace in the resumed Plan Mode acknowledges the complete updated plan while retaining both full journal generations.')
