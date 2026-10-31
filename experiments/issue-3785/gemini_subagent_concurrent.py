"""Require overlapping real child requests and retain both native histories."""
import json
import shutil
import threading


CHILDREN = ('A', 'B')


def result(name):
    return 'SYNTHETIC-CONCURRENT-CHILD-' + name + '-COMPLETE'


def request(name):
    return 'SYNTHETIC-CONCURRENT-CHILD-' + name + '-REQUEST'


def witness(workspace, name):
    return workspace / ('native-concurrent-child-' + name + '.txt')


def responses(contents, identifier):
    return [part['functionResponse'] for turn in contents for part in turn.get('parts', [])
            if part.get('functionResponse', {}).get('id') == identifier]


def concurrent_tool_calls(contents, first_prompt, workspace, phases):
    content = json.dumps(contents)
    if first_prompt in content:
        if not phases.get('root'):
            phases.update(root=True, condition=threading.Condition(), children={}, arrived=set())
            return [{'id': 'synthetic-delegate-' + name, 'name': 'invoke_agent',
                     'args': {'agent_name': 'generalist', 'prompt': request(name),
                              'wait_for_previous': False}} for name in CHILDREN]
        for name in CHILDREN:
            returned = responses(contents, 'synthetic-delegate-' + name)
            assert len(returned) == 1 and result(name) in json.dumps(returned[0])
        return None
    names = [name for name in CHILDREN if request(name) in content]
    assert len(names) == 1, 'Require a distinct actual native child request.'
    name, = names
    with phases['condition']:
        step = phases['children'].get(name, 0)
        phases['children'][name] = step + 1
        if step == 0:
            phases['arrived'].add(name)
            phases['condition'].notify_all()
            assert phases['condition'].wait_for(lambda: len(phases['arrived']) == 2, timeout=5), 'Both actual child model requests must overlap before either provider response.'
    if step == 0:
        return [{'id': 'synthetic-child-edit-' + name, 'name': 'write_file',
                 'args': {'file_path': str(witness(workspace, name)),
                          'content': 'SYNTHETIC AFTER CHILD ' + name + ' café\n'}}]
    assert step == 1, 'Each actual child must finish after its own single real edit.'
    returned = responses(contents, 'synthetic-child-edit-' + name)
    assert len(returned) == 1 and 'error' not in returned[0].get('response', {})
    assert witness(workspace, name).read_text() == 'SYNTHETIC AFTER CHILD ' + name + ' café\n'
    return [{'id': 'synthetic-child-complete-' + name, 'name': 'complete_task',
             'args': {'result': {'response': result(name)}}}]


def verify_concurrent_children(*, invoke, root, home, workspace, history, env, settings,
                               diagnostics, models, first_prompt, session, phases, **_):
    for name in CHILDREN:
        witness(workspace, name).write_text('SYNTHETIC BEFORE CHILD ' + name + ' 東京\n')
    code, output = invoke(diagnostics, env, ['--approval-mode', 'yolo', '--session-id', session,
                                           '--prompt', first_prompt])
    assert code == 0 and 'SYNTHETIC-GEMINI-COMPLETE' in output
    assert phases['arrived'] == set(CHILDREN) and phases['children'] == dict.fromkeys(CHILDREN, 2)
    assert len(models) == 6
    assert models[-1]['concurrent_child_a'] and models[-1]['concurrent_child_b']
    print('PASS: two actual native generalists overlap their provider requests before either response, edit different real files and return both results to their parent.')
    source = history if 'GEMINI_HISTORY_HOME' in env else home
    records = {p: p.read_bytes() for p in source.rglob('*.jsonl')
               if json.loads(p.read_text().splitlines()[0]).get('kind') in ('main', 'subagent')}
    assert len(records) == 3
    children = {p: content for p, content in records.items()
                if json.loads(content.splitlines()[0]).get('kind') == 'subagent'}
    assert len(children) == 2
    for name in CHILDREN:
        matching = [content for content in children.values() if request(name).encode() in content]
        assert len(matching) == 1 and result(name).encode() in matching[0]
        assert ('synthetic-child-edit-' + name).encode() in matching[0]
        assert request('B' if name == 'A' else 'A').encode() not in matching[0]
    if source == home:
        assert not list(history.rglob('*'))
        print('PASS: unselected concurrent native children retain their separate private conversations without canonical history writes.')
        return
    assert not list(home.rglob('*.jsonl'))
    checkpoints = []
    for journal in history.rglob('prompt-history.json'):
        for row in json.loads(journal.read_text()):
            if row['type'] == 'restorable-tool':
                saved = json.loads(row['message'])
                data = json.loads(saved['content'])
                if data.get('toolCall', {}).get('args', {}).get('file_path') in [str(witness(workspace, name)) for name in CHILDREN]:
                    checkpoints.append((saved['name'], data))
    assert len(checkpoints) == 2 and len({name for name, _ in checkpoints}) == 2
    assert {data['toolCall']['args']['file_path'] for _, data in checkpoints} == {str(witness(workspace, name)) for name in CHILDREN}
    assert all(data['commitHash'] and first_prompt in json.dumps(data['clientHistory']) for _, data in checkpoints)
    assert not list(home.rglob('checkpoints/*.json'))
    print('PASS: concurrent native children retain both distinct full canonical conversations and acknowledged edit checkpoints without private transcript or checkpoint copies.')
    shutil.rmtree(home)
    peer = root / 'concurrent-child-resume-home'
    private = peer / '.gemini'
    private.mkdir(parents=True, mode=0o700)
    (private / 'settings.json').write_text(json.dumps(settings))
    (private / 'settings.json').chmod(0o600)
    peer_env = {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                'XDG_CACHE_HOME': str(peer / '.cache')}
    code, output = invoke(diagnostics.with_name(diagnostics.stem + '-list.log'), peer_env, ['--list-sessions'])
    assert code == 0 and session[:8] in output
    assert len(models) == 7 and models[-1]['operation'] == 'generateContent' and models[-1]['session_summary']
    assert all(p.read_bytes().startswith(content) for p, content in records.items())
    assert all(p.read_bytes() == content for p, content in children.items())
    code, output = invoke(diagnostics.with_name(diagnostics.stem + '-resume.log'), peer_env,
                          ['--resume', session, '--prompt', 'SYNTHETIC-GEMINI-AFTER-CONCURRENT-CHILDREN'])
    assert code == 0 and 'SYNTHETIC-GEMINI-COMPLETE' in output
    assert len(models) == 8 and models[-1]['operation'] == 'streamGenerateContent' and models[-1]['first_prompt']
    assert models[-1]['concurrent_child_a'] and models[-1]['concurrent_child_b']
    assert all(p.read_bytes().startswith(content) for p, content in records.items())
    for name in CHILDREN:
        assert witness(workspace, name).read_text() == 'SYNTHETIC AFTER CHILD ' + name + ' café\n'
    print('PASS: fresh actual native discovery and parent resume retain both child results, both edits and all three audit prefixes after whole private-home disposal.')
