"""Bound a real native child-agent edit and inspect its retained conversations."""
import difflib
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat

CHILD_REQUEST = 'SYNTHETIC-GEMINI-CHILD-EDIT-REQUEST'
CHILD_OUTPUT = 'SYNTHETIC-GEMINI-CHILD-EDIT-COMPLETE'


def fingerprint(root):
    result = {}
    for item in (root, *root.rglob('*')):
        info = item.lstat()
        result[str(item)] = (info.st_dev, info.st_ino, info.st_mode, info.st_nlink,
                             os.readlink(item) if stat.S_ISLNK(info.st_mode) else
                             hashlib.sha256(item.read_bytes()).hexdigest() if stat.S_ISREG(info.st_mode) else None)
    return result


def child_tool_call(contents, first_prompt, workspace, phases, *, attack=None, history=None, session=None, root=None):
    if phases.get('restoring'):
        return None
    content = json.dumps(contents)
    root_request = first_prompt in content
    if root_request:
        if not phases.get('root'):
            phases['root'] = True
            if attack:
                chats, = history.rglob('chats')
                child = chats / session
                protected = root / 'protected-child-directory'
                protected.mkdir(mode=0o700)
                sentinel = protected / 'sentinel'
                sentinel.write_text('SYNTHETIC PROTECTED CHILD DIRECTORY 東京\n')
                sentinel.chmod(0o600)
                if attack == 'symlink':
                    child.symlink_to(protected, target_is_directory=True)
                elif attack == 'unsafe-mode':
                    child.mkdir(mode=0o755)
                    child.chmod(0o755)
                else:
                    retired = chats.with_name('protected-original-chats')
                    chats.rename(retired)
                    chats.mkdir(mode=0o700)
                phases['protected'] = {chats.parent: fingerprint(chats.parent), protected: fingerprint(protected)}
                phases['audit'] = {p: p.read_bytes() for p in chats.parent.rglob('*.jsonl')}
            return {'id': 'synthetic-delegate-edit', 'name': 'invoke_agent',
                    'args': {'agent_name': 'generalist', 'prompt': CHILD_REQUEST}}
        responses = [part['functionResponse'] for turn in contents for part in turn.get('parts', [])
                     if part.get('functionResponse', {}).get('id') == 'synthetic-delegate-edit']
        assert len(responses) == 1 and CHILD_OUTPUT in json.dumps(responses[0])
        return None
    assert CHILD_REQUEST in content, 'Require the actual child agent model request.'
    step = phases.get('child', 0)
    phases['child'] = step + 1
    if step == 0:
        return {'id': 'synthetic-child-edit', 'name': 'write_file',
                'args': {'file_path': str(workspace / 'native-child-witness.txt'),
                         'content': 'SYNTHETIC AFTER CHILD EDIT café\n'}}
    assert step == 1, 'The actual child agent must finish after its single real edit.'
    responses = [part['functionResponse'] for turn in contents for part in turn.get('parts', [])
                 if part.get('functionResponse', {}).get('id') == 'synthetic-child-edit']
    assert len(responses) == 1 and 'error' not in responses[0].get('response', {})
    assert (workspace / 'native-child-witness.txt').read_text() == 'SYNTHETIC AFTER CHILD EDIT café\n'
    return {'id': 'synthetic-child-complete', 'name': 'complete_task',
            'args': {'result': {'response': CHILD_OUTPUT}}}


def verify_subagent_history(*, invoke, root, home, workspace, history, env, settings,
                            diagnostics, models, first_prompt, session, phases, attack,
                            restore=False, native=None, second_prompt=None):
    witness = workspace / 'native-child-witness.txt'
    witness.write_text('SYNTHETIC BEFORE CHILD EDIT 東京\n')
    if restore:
        (workspace / 'native-child-companion.txt').write_text('SYNTHETIC BEFORE CHILD EDIT 東京\n')
    code, output = invoke(diagnostics, env, ['--approval-mode', 'yolo', '--session-id', session,
                                           '--prompt', first_prompt])
    if attack:
        assert len(models) == 1 and phases.get('root') and 'child' not in phases, 'Unsafe child storage must refuse before child inference or further root requests.'
        assert code != 0 and 'Gemini canonical conversation history is unavailable or unsafe.' in output
        assert witness.read_text() == 'SYNTHETIC BEFORE CHILD EDIT 東京\n'
        actual = {str(path): {'before': expected, 'after': fingerprint(path)} for path, expected in phases['protected'].items()}
        diagnostics.with_name(diagnostics.stem + '-protected.control.json').write_text(json.dumps(actual, indent=2))
        audits = {str(p): value for p, value in phases['audit'].items()}
        assert len(audits) == 1
        for record in actual.values():
            assert record['before'].keys() == record['after'].keys(), 'Unsafe child storage must not add or delete protected paths.'
            for name, before in record['before'].items():
                after = record['after'][name]
                if name in audits:
                    assert before[:4] == after[:4] and Path(name).read_bytes().startswith(audits[name]), 'Retain the complete preceding root audit while recording its native delegation.'
                else:
                    assert before == after, 'Unsafe child storage must preserve protected directory identities and audit bytes.'
        print('PASS: actual native child refuses ' + attack + ' before child inference, edits or further root inference, preserving protected directories and audit bytes.')
        return
    assert code == 0 and 'SYNTHETIC-GEMINI-COMPLETE' in output, 'Healthy actual native child execution must retain canonical recording without refusing delegation.'
    assert phases == {'root': True, 'child': 2}
    assert len(models) == 4 and witness.read_text() == 'SYNTHETIC AFTER CHILD EDIT café\n'
    print('PASS: actual native root invokes a real generalist child that edits and completes its task, then the root completes inference.')
    source = history if 'GEMINI_HISTORY_HOME' in env else home
    records = {p: p.read_bytes() for p in source.rglob('*.jsonl')
               if json.loads(p.read_text().splitlines()[0]).get('kind') in ('main', 'subagent')}
    assert len(records) == 2, 'Both actual root and child conversations must be retained.'
    child = [p for p in records if json.loads(p.read_text().splitlines()[0]).get('kind') == 'subagent']
    assert len(child) == 1, 'Identify the actual native child conversation.'
    assert CHILD_REQUEST in child[0].read_text() and CHILD_OUTPUT in child[0].read_text()
    assert 'synthetic-child-edit' in child[0].read_text()
    if source == home:
        assert not list(history.rglob('*'))
        print('PASS: unselected actual child editing retains original private root/child recording without canonical writes.')
        return
    assert not list(home.rglob('*.jsonl')), 'Selected child transcripts must not have a private copy.'
    print('PASS: both actual root and child full conversations, including the native child tool call and final result, reside in canonical history.')
    if restore:
        from gemini_subagent_restore import verify_child_restore
        verify_child_restore(invoke=invoke, native=native, root=root, home=home, workspace=workspace,
                             history=history, env=env, settings=settings, diagnostics=diagnostics,
                             models=models, first_prompt=first_prompt, second_prompt=second_prompt,
                             session=session, phases=phases, records=records)
        return
    shutil.rmtree(home)
    peer = root / 'subagent-resume-home'
    private = peer / '.gemini'
    private.mkdir(parents=True, mode=0o700)
    (private / 'settings.json').write_text(json.dumps(settings))
    (private / 'settings.json').chmod(0o600)
    peer_env = {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                'XDG_CACHE_HOME': str(peer / '.cache')}
    code, output = invoke(diagnostics.with_name(diagnostics.stem + '-list.log'), peer_env, ['--list-sessions'])
    assert code == 0 and session[:8] in output
    summaries = models[4:]
    assert len(summaries) == 1 and summaries[0]['operation'] == 'generateContent' and summaries[0]['session_summary'], 'Native discovery may generate only its existing native session summary.'
    for p, value in records.items():
        if not p.read_bytes().startswith(value) or p == child[0] and p.read_bytes() != value:
            difference = ''.join(difflib.unified_diff(value.decode().splitlines(True), p.read_text().splitlines(True)))
            diagnostics.with_name(diagnostics.stem + '-discovery-audit.diff').write_text(difference[:65536])
            raise AssertionError('Native discovery must preserve the complete existing root/child audit bytes.')
    code, output = invoke(diagnostics.with_name(diagnostics.stem + '-resume.log'), peer_env,
                          ['--resume', session, '--prompt', 'SYNTHETIC-GEMINI-AFTER-CHILD-REOPEN'])
    assert code == 0 and 'SYNTHETIC-GEMINI-COMPLETE' in output
    assert len(models) == 6 and models[-1]['operation'] == 'streamGenerateContent' and models[-1]['first_prompt']
    assert all(p.read_bytes().startswith(value) for p, value in records.items())
    assert witness.read_text() == 'SYNTHETIC AFTER CHILD EDIT café\n'
    print('PASS: fresh native discovery and root resume retain the child result and complete prior root/child audit after whole private-home disposal.')
