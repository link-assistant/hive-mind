#!/usr/bin/env python3
"""Actual pinned Qwen completion/resume across disposable configurations.

This isolates the native runtime selector, using an explicit synthetic API key.
It does not establish canonical API-key storage, OAuth or production admission.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time
import uuid

from native_process_group import stop_process_group

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('package', type=Path)
parser.add_argument('--node', type=Path, required=True)
parser.add_argument('--diagnostics', type=Path, required=True)
parser.add_argument('--private-history', action='store_true')
parser.add_argument('--expect-history-gap', action='store_true')
args = parser.parse_args()
assert not args.expect_history_gap or args.private_history
package = args.package.resolve(strict=True)
node = args.node.resolve(strict=True)
manifest = json.loads((package / 'package.json').read_text())
assert manifest['name'] == '@qwen-code/qwen-code' and manifest['version'] == '0.26.1'
assert (package / 'cli-entry.js').is_file() and node.is_file()
requests, refused, children, blocked = [], [], [], []
prompt = 'SYNTHETIC-QWEN-HISTORY-FIRST-REQUEST'
session = str(uuid.uuid4())


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(3)

    def log_message(self, *_):
        pass

    def do_CONNECT(self):
        # This proxy never forwards a byte to the network.
        blocked.append(self.path[:200])
        if self.path != 'models.dev:443':
            refused.append(('CONNECT', self.path[:200]))
        self.send_error(403)

    def do_GET(self):
        refused.append(('GET', self.path[:200]))
        self.send_error(400)

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length', '0'))
            assert self.path == '/v1/chat/completions'
            assert self.headers.get('Authorization') == 'Bearer SYNTHETIC-QWEN-KEY'
            assert 0 < length <= 256 * 1024
            payload = json.loads(self.rfile.read(length))
            assert payload['stream'] is True and payload['model'] == 'synthetic-model'
            requests.append(payload)
            assert len(requests) <= 2
            self.send_response(200)
            self.send_header('Content-Type', 'text/event-stream')
            self.send_header('Connection', 'close')
            self.end_headers()
            for delta, finish in [({'role': 'assistant', 'content': 'Synthetic response.'}, None), ({}, 'stop')]:
                value = {'id': 'synthetic-completion', 'object': 'chat.completion.chunk',
                         'created': 1, 'model': 'synthetic-model',
                         'choices': [{'index': 0, 'delta': delta, 'finish_reason': finish}]}
                if finish:
                    value['usage'] = {'prompt_tokens': 1, 'completion_tokens': 1, 'total_tokens': 2}
                self.wfile.write(f'data: {json.dumps(value)}\n\n'.encode())
            self.wfile.write(b'data: [DONE]\n\n')
        except (AssertionError, ValueError, KeyError):
            refused.append(('POST', self.path[:200]))
            self.send_error(400)


with tempfile.TemporaryDirectory(prefix='hive-3785-qwen-history-') as temporary:
    root = Path(temporary)
    root.chmod(0o700)
    workspace, runtime = root / 'workspace', root / 'runtime'
    workspace.mkdir(mode=0o700)
    runtime.mkdir(mode=0o700)
    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    serving = threading.Thread(target=server.serve_forever)
    serving.start()
    endpoint = f'http://127.0.0.1:{server.server_port}'

    def invoke(name, resume=False):
        home, config = root / f'{name}-home', root / f'{name}-config'
        for directory in (home, config):
            directory.mkdir(mode=0o700)
        (config / 'settings.json').write_text(json.dumps({
            'general': {'enableAutoUpdate': False}, 'telemetry': {'enabled': False},
            'privacy': {'usageStatisticsEnabled': False}}))
        (config / 'settings.json').chmod(0o600)
        native_runtime = root / f'{name}-runtime' if args.private_history else runtime
        native_runtime.mkdir(mode=0o700, exist_ok=True)
        env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'QWEN_HOME': str(config),
               'QWEN_RUNTIME_DIR': str(native_runtime), 'CI': 'true', 'NO_COLOR': '1',
               'XDG_CONFIG_HOME': str(home / '.config'),
               'XDG_DATA_HOME': str(home / '.local/share'),
               'XDG_CACHE_HOME': str(home / '.cache'),
               'HTTP_PROXY': endpoint, 'HTTPS_PROXY': endpoint, 'ALL_PROXY': endpoint,
               'http_proxy': endpoint, 'https_proxy': endpoint, 'all_proxy': endpoint,
               'NO_PROXY': '127.0.0.1,localhost', 'no_proxy': '127.0.0.1,localhost',
               'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'}
        command = ['prlimit', '--data=2147483648', '--stack=16777216', '--fsize=262144',
                   '--core=0', '--', str(node), '--max-old-space-size=256',
                   str(package / 'cli-entry.js'), '--bare', '--safe-mode',
                   '--auth-type', 'openai', '--model', 'synthetic-model',
                   '--openai-api-key', 'SYNTHETIC-QWEN-KEY', '--openai-base-url', endpoint + '/v1',
                   '--chat-recording', 'true', '--max-session-turns', '2',
                   '--max-wall-time', '15s', '--max-tool-calls', '0', '--output-format', 'json',
                   '--prompt', 'SYNTHETIC-QWEN-HISTORY-SECOND-REQUEST' if resume else prompt]
        command.extend(['--resume' if resume else '--session-id', session])
        args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
        diagnostic = args.diagnostics.with_name(args.diagnostics.stem + f'-{name}.log')
        with diagnostic.open('w+b') as output:
            diagnostic.chmod(0o600)
            child = subprocess.Popen(command, cwd=workspace, env=env, stdin=subprocess.DEVNULL,
                                     stdout=output, stderr=subprocess.STDOUT, start_new_session=True)
            children.append(child)
            started = time.monotonic()
            try:
                while child.poll() is None:
                    assert time.monotonic() - started < 30, 'Finite native Qwen deadline exceeded.'
                    assert os.fstat(output.fileno()).st_size <= 256 * 1024
                    time.sleep(0.05)
            finally:
                stop_process_group(child)
            output.seek(0)
            result = output.read(256 * 1024).decode('utf-8', errors='replace')
        events = []
        for line in result.splitlines():
            try:
                value = json.loads(line)
                if isinstance(value, list):
                    events.extend(value)
            except ValueError:
                pass
        if child.returncode == 0:
            completed = [value for value in events if isinstance(value, dict) and value.get('type') == 'result']
            assert len(completed) == 1 and completed[0].get('is_error') is False
            assert completed[0].get('subtype') == 'success'
            assert completed[0].get('session_id') == session, 'Native completion must preserve the requested session identity.'
        return child.returncode, result, (home, config, native_runtime)

    try:
        code, output, private = invoke('first')
        assert code == 0, 'The first actual native Qwen request must succeed.'
        assert 'Synthetic response.' in output
        assert len(requests) == 1 and prompt in json.dumps(requests[0])
        # Delete fixture-owned private state only after the whole group is reaped.
        for directory in private[:2] + (private[2:] if args.private_history else ()):
            shutil.rmtree(directory)
        code, output, _ = invoke('peer', resume=True)
        assert not refused, f'Only declared loopback endpoints may be used: {refused!r}.'
        if args.private_history:
            assert code != 0 and len(requests) == 1
            assert f'No saved session found with ID {session}.' in output, 'Negative control must reach native missing-session discovery.'
        if args.expect_history_gap:
            print('REPRODUCED: actual Qwen cannot resume after private runtime disposal; model_requests=1.')
        else:
            assert code == 0, 'A fresh native Qwen peer must resume persisted history.'
            assert len(requests) == 2 and prompt in json.dumps(requests[1]), 'Resumed native model request must contain the first user message.'
            files = [p for p in runtime.rglob('*') if p.is_file()]
            assert len(files) <= 100 and all(p.stat().st_size <= 1024 * 1024 for p in files)
            transcripts = [p for p in files if p.suffix in ('.json', '.jsonl') and prompt in p.read_text()]
            assert transcripts, 'Canonical runtime must retain the native transcript.'
            print('PASS: actual native Qwen completes, disposes private roots, resumes with prior messages and retains its transcript; model_requests=2.')
        print(f'PASS: fixture forwards no external tunnels; refused {len(blocked)} native model-catalog requests before TLS.')
    finally:
        for child in children:
            stop_process_group(child)
        server.shutdown()
        serving.join()
        server.server_close()
