"""Kill the whole real CLI at finite native plan filesystem boundaries."""
import json
from pathlib import Path
import shutil
import signal
import subprocess

from gemini_plan_history import PLAN, UPDATED_PLAN


def recovered_plan_tool_call(contents, file, phases):
    step = phases.get('recovery', 0)
    phases['recovery'] = step + 1
    if step == 0:
        phases['recovery_file'] = file
        if phases.get('retry_partial_plan'):
            return {'id': 'synthetic-plan-retry', 'name': 'write_file', 'args': {'file_path': str(file), 'content': phases['recovery_expected']}}
        return {'id': 'synthetic-plan-recovery', 'name': 'read_file', 'args': {'file_path': str(file)}}
    if phases.get('retry_partial_plan') and step == 1:
        responses = [part['functionResponse'] for turn in contents for part in turn.get('parts', [])
                     if part.get('functionResponse', {}).get('id') == 'synthetic-plan-retry']
        assert len(responses) == 1 and 'error' not in responses[0].get('response', {})
        assert file.read_text() == phases['recovery_expected']
        return {'id': 'synthetic-plan-recovery', 'name': 'read_file', 'args': {'file_path': str(file)}}
    assert step == (2 if phases.get('retry_partial_plan') else 1)
    responses = [part['functionResponse'] for turn in contents for part in turn.get('parts', [])
                 if part.get('functionResponse', {}).get('id') == 'synthetic-plan-recovery']
    assert len(responses) == 1 and 'error' not in responses[0].get('response', {})
    expected = phases['recovery_expected']
    assert file.read_text() == expected
    delivered = json.dumps(responses[0], ensure_ascii=False)
    assert all(line in delivered for line in expected.splitlines() if line)
    return None


def verify_plan_interruption(*, invoke, root, home, workspace, history, env, settings,
                             diagnostics, models, first_prompt, session, phases,
                             scenario, point):
    library = root / 'synthetic-plan-fsync.so'
    source = Path(__file__).parent / 'native-gemini/plan_fsync_death.c'
    command = ['prlimit', '--data=536870912', '--stack=16777216', '--core=0', '--',
               'gcc', '-shared', '-fPIC', '-O2', '-Wall', '-Wextra', '-Werror',
               '-o', str(library), str(source), '-ldl']
    with diagnostics.with_suffix('.compiler.log').open('wb') as output:
        subprocess.run(command, check=True, stdout=output, stderr=subprocess.STDOUT, timeout=30)
    marker = root / 'synthetic-plan-owner-death'
    crash = {**env, 'LD_PRELOAD': str(library),
             'SYNTHETIC_GEMINI_PLAN_CRASH_ROOT': str(history),
             'SYNTHETIC_GEMINI_PLAN_CRASH_POINT': point,
             'SYNTHETIC_GEMINI_PLAN_CRASH_MARKER': str(marker),
             'SYNTHETIC_GEMINI_PLAN_CRASH_NEEDLE': 'Preserve the complete plan' if scenario == 'first' else 'Retain the resumed replacement generation'}
    if scenario == 'replacement':
        code, output = invoke(diagnostics.with_name(diagnostics.stem + '-initial.log'), env,
                              ['--approval-mode', 'plan', '--session-id', session, '--prompt', first_prompt])
        assert code == 0 and phases['initial'] == 2 and len(models) == 2
        assert phases['initial_file'].read_text() == PLAN
        flags = ['--approval-mode', 'plan', '--resume', session, '--prompt', 'SYNTHETIC-GEMINI-PLAN-REOPEN']
    else:
        flags = ['--approval-mode', 'plan', '--session-id', session, '--prompt', first_prompt]
    code, output = invoke(diagnostics.with_name(diagnostics.stem + '-owner.log'), crash, flags)
    assert code == -signal.SIGKILL, 'The complete actual CLI must reach the bounded filesystem owner-death point.'
    assert marker.read_text() == point
    assert len(models) == (1 if scenario == 'first' else 4)
    file = phases['initial_file']
    original_audits = {p: p.read_bytes() for p in history.rglob('*.jsonl')}
    assert original_audits and not list(home.rglob('*.jsonl'))
    expected = PLAN if scenario == 'first' else UPDATED_PLAN
    journals = list(history.rglob('prompt-history.json'))
    assert len(journals) <= 1
    before = [] if not journals else [json.loads(row['message'])['content'] for row in json.loads(journals[0].read_text()) if row['type'] == 'plan-document']
    previous = [] if scenario == 'first' else [PLAN]
    assert before == previous + ([] if point in ('after-intent', 'partial-intent-journal') else [expected])
    partial_proof = None
    if point == 'partial-intent-journal':
        candidates = [p for p in file.parent.iterdir()
                      if p.name.startswith('.publish-') or p.name.endswith('.journal.tmp')]
        assert len(candidates) == 1
        partial_proof = candidates[0]
        partial_bytes = partial_proof.read_bytes()
        partial_inode = partial_proof.stat().st_ino
        try:
            json.loads(partial_bytes)
        except json.JSONDecodeError:
            pass
        else:
            raise AssertionError('The bounded native write must leave an actually incomplete proof.')
        assert file.exists() == (scenario == 'replacement')
        if file.exists():
            assert file.read_text() == PLAN
    shutil.rmtree(home)
    print('PASS: the complete actual native Plan Mode CLI reaches ' + scenario + ' ' + point + ', is killed and reaped, and loses its whole private home before acknowledgement.', flush=True)
    peer = root / 'native-plan-recovery-home'
    private = peer / '.gemini'
    private.mkdir(parents=True, mode=0o700)
    (private / 'settings.json').write_text(json.dumps(settings))
    (private / 'settings.json').chmod(0o600)
    peer_env = {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                'XDG_CACHE_HOME': str(peer / '.cache')}
    phases['recovery_expected'] = expected
    phases['retry_partial_plan'] = point == 'partial-intent-journal'
    previous = len(models)
    code, output = invoke(diagnostics.with_name(diagnostics.stem + '-recovery.log'), peer_env,
                          ['--approval-mode', 'plan', '--resume', session, '--prompt', 'SYNTHETIC-GEMINI-PLAN-RECOVER'])
    assert code == 0 and 'SYNTHETIC-GEMINI-COMPLETE' in output, 'Fresh complete native CLI must recover the interrupted plan and resume its canonical session.'
    recovery_requests = 3 if phases['retry_partial_plan'] else 2
    assert len(models) == previous + recovery_requests and phases['recovery'] == recovery_requests
    assert file.read_text() == expected and phases['recovery_file'] == file
    assert all(p.read_bytes().startswith(content) for p, content in original_audits.items())
    assert not list(peer.rglob('synthetic-retained-plan.md'))
    journal = next(history.rglob('prompt-history.json'))
    after = [json.loads(row['message'])['content'] for row in json.loads(journal.read_text()) if row['type'] == 'plan-document']
    assert after == ([PLAN] if scenario == 'first' else [PLAN, UPDATED_PLAN])
    if not phases['retry_partial_plan']:
        assert not any(p.name.startswith('.plan-') for p in file.parent.iterdir())
    else:
        assert partial_proof.stat().st_ino == partial_inode
        assert partial_proof.read_bytes() == partial_bytes
        assert not (file.parent / '.plan-transaction.json').exists()
        assert not any(p.name.startswith('.publish-') for p in file.parent.iterdir())
    print('PASS: a fresh complete actual native CLI resumes the killed owner session and delivers the complete recovered plan through its real read_file result, retaining every full generation and preceding audit.', flush=True)
