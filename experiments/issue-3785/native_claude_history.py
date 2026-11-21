"""Actual native history discovery/resume across disposable configurations."""
import json
import os
import shutil
import subprocess
import time

from native_process_group import stop_process_group


def reply(handler, number):
    message = {'id': f'synthetic-message-{number}', 'type': 'message',
               'role': 'assistant', 'content': [], 'model': 'synthetic-model',
               'stop_reason': None, 'stop_sequence': None,
               'usage': {'input_tokens': 1, 'output_tokens': 0}}
    events = [
        ('message_start', {'type': 'message_start', 'message': message}),
        ('content_block_start', {'type': 'content_block_start', 'index': 0,
                                 'content_block': {'type': 'text', 'text': ''}}),
        ('content_block_delta', {'type': 'content_block_delta', 'index': 0,
                                 'delta': {'type': 'text_delta', 'text': 'Synthetic response.'}}),
        ('content_block_stop', {'type': 'content_block_stop', 'index': 0}),
        ('message_delta', {'type': 'message_delta', 'delta': {
            'stop_reason': 'end_turn', 'stop_sequence': None}, 'usage': {'output_tokens': 1}}),
        ('message_stop', {'type': 'message_stop'}),
    ]
    data = ''.join(f'event: {kind}\ndata: {json.dumps(value)}\n\n'
                   for kind, value in events).encode()
    handler.send_response(200)
    handler.send_header('Content-Type', 'text/event-stream')
    handler.send_header('Content-Length', str(len(data)))
    handler.send_header('Connection', 'close')
    handler.end_headers()
    handler.wfile.write(data)


def run(binary, root, env, settings, args, model_requests, errors):
    workspace = root / 'workspace'
    workspace.mkdir(mode=0o700)
    history = root / 'history'
    history.mkdir(mode=0o700)
    for name in ('projects', 'sessions'):
        (history / name).mkdir(mode=0o700)
    first_prompt = 'SYNTHETIC-HISTORY-FIRST-REQUEST'

    def invoke(name, resume=None):
        home, config = root / f'{name}-home', root / f'{name}-config'
        for directory in (home, config):
            directory.mkdir(mode=0o700)
            state = directory / '.claude.json'
            state.write_text(json.dumps(settings))
            state.chmod(0o600)
        if not args.private_history:
            for entry in ('projects', 'sessions'):
                (config / entry).symlink_to(history / entry, target_is_directory=True)
        native_env = {**env, 'HOME': str(home), 'CLAUDE_CONFIG_DIR': str(config)}
        command = ['prlimit', '--data=1073741824', '--stack=16777216', '--fsize=262144',
                   '--core=0', '--', str(binary), '-p',
                   'SYNTHETIC-HISTORY-SECOND-REQUEST' if resume else first_prompt,
                   '--output-format', 'json', '--max-turns', '1', '--tools', '',
                   '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}']
        if resume:
            command.extend(['--resume', resume])
        diagnostic_file = args.diagnostics.with_name(args.diagnostics.stem + f'-{name}.log')
        args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
        with diagnostic_file.open('w+b') as diagnostics:
            diagnostic_file.chmod(0o600)
            child = subprocess.Popen(command, cwd=workspace, env=native_env,
                                     stdin=subprocess.DEVNULL, stdout=diagnostics,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            started = time.monotonic()
            try:
                while child.poll() is None:
                    assert time.monotonic() - started < 25, 'Finite native history deadline exceeded.'
                    assert os.fstat(diagnostics.fileno()).st_size <= 256 * 1024
                    time.sleep(0.05)
            finally:
                stop_process_group(child)
            diagnostics.seek(0)
            output = diagnostics.read(256 * 1024).decode('utf-8', errors='replace')
        result = None
        for line in output.splitlines():
            try:
                value = json.loads(line)
                if isinstance(value, dict) and value.get('type') == 'result':
                    result = value
            except ValueError:
                pass
        assert not (config / '.credentials.json').exists()
        return child.returncode, result, home, config, output

    code, result, home, config, _ = invoke('first')
    assert code == 0 and result and result.get('is_error') is False, 'Native first request must complete successfully.'
    session = result['session_id']
    assert len(model_requests) == 1
    assert first_prompt in json.dumps(model_requests[0])
    # Disposal happens after the entire native process group is reaped. Keep
    # canonical auth/history, remove only these two fixture-owned private roots.
    shutil.rmtree(home)
    shutil.rmtree(config)
    code, resumed, _, _, output = invoke('peer', session)
    assert not errors
    if args.private_history:
        assert code != 0 and len(model_requests) == 1
        assert f'No conversation found with session ID: {session}' in output, 'Negative control must reach native session discovery.'
    if args.expect_history_gap:
        assert args.private_history
        print('REPRODUCED: native peer cannot resume after private history is disposed; model_requests=1.')
        return
    assert code == 0 and resumed and resumed.get('is_error') is False, 'A fresh native peer must resume persisted history.'
    assert resumed['session_id'] == session
    assert len(model_requests) == 2
    assert first_prompt in json.dumps(model_requests[1]), 'Resumed native request must contain the persisted first message.'
    transcripts = list((history / 'projects').glob(f'**/{session}.jsonl'))
    assert len(transcripts) == 1 and transcripts[0].is_file()
    assert first_prompt in transcripts[0].read_text()
    print('PASS: actual native Claude completes, persists a transcript, disposes both private roots, and resumes with prior messages in a fresh peer; model_requests=2.')
