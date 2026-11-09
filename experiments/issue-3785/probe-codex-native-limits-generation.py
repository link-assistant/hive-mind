#!/usr/bin/env python3
"""Check actual selected native account usage publication after auth changes."""
import argparse
import base64
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import itertools
import os
from pathlib import Path
import queue
import signal
import subprocess
import tempfile
import threading
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('binary', type=Path)
parser.add_argument('--mutation', choices=['none', 'logout', 'replace', 'malformed'], default='logout')
parser.add_argument('--expect-retired-response', action='store_true')
args = parser.parse_args()
assert not args.expect_retired_response or args.mutation != 'none'
binary = args.binary.resolve(strict=True)
entered, release = threading.Event(), threading.Event()
errors, observed = [], []


class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(3)

    def log_message(self, *_):
        pass

    def reply(self, status, value):
        body = json.dumps(value).encode()
        try:
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass  # A killed native background request may close its refusal early.

    def do_CONNECT(self):
        self.reply(403, {})  # Never forward a native background request.

    def do_GET(self):
        if self.path != '/backend-api/wham/usage':
            self.reply(404, {})
            return
        try:
            assert self.headers.get('Authorization') == 'Bearer SYNTHETIC-ACCESS-G0'
            assert self.headers.get('ChatGPT-Account-ID') == 'synthetic-account'
            observed.append('G0')
            assert len(observed) == 1
            entered.set()
            assert release.wait(8), 'Fixture did not release the pending usage response.'
            self.reply(200, {
                'account_id': 'synthetic-account', 'user_id': 'synthetic-user',
                'plan_type': 'plus', 'rate_limit': {
                    'allowed': True, 'limit_reached': False,
                    'primary_window': {'used_percent': 41, 'limit_window_seconds': 3600,
                                       'reset_after_seconds': 120, 'reset_at': 1800000000},
                },
            })
        except (AssertionError, OSError) as error:
            errors.append(type(error).__name__)

    def do_POST(self):
        length = int(self.headers.get('Content-Length', '0'))
        if not 0 <= length <= 262144:
            errors.append('UnboundedRequest')
            self.reply(400, {})
            return
        self.rfile.read(length)
        self.reply(404, {})


server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
serving = threading.Thread(target=server.serve_forever)
serving.start()
try:
    with tempfile.TemporaryDirectory(prefix='hive-3785-native-limits-') as temporary:
        root = Path(temporary)
        root.chmod(0o700)
        home, config, canonical = [root / name for name in ('home', 'config', 'canonical')]
        for directory in (home, config, canonical):
            directory.mkdir(mode=0o700)
        endpoint = f'http://127.0.0.1:{server.server_port}'
        (config / 'config.toml').write_text(
            f'chatgpt_base_url="{endpoint}/backend-api"\n'
            '[features]\nremote_plugin=false\napps=false\n')
        (config / 'config.toml').chmod(0o600)

        def part(value):
            return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b'=').decode()

        identity = part({'email': 'synthetic@example.invalid', 'https://api.openai.com/auth': {
            'chatgpt_account_id': 'synthetic-account', 'chatgpt_user_id': 'synthetic-user',
            'chatgpt_plan_type': 'plus'}})
        auth = canonical / 'auth.json'

        def commit(generation):
            value = {'auth_mode': 'chatgpt', 'last_refresh': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
                     'tokens': {'id_token': f'{part({"alg": "none"})}.{identity}.synthetic',
                                'access_token': f'SYNTHETIC-ACCESS-{generation}',
                                'refresh_token': f'SYNTHETIC-REFRESH-{generation}',
                                'account_id': 'synthetic-account', 'login_owner_id': 'synthetic-login'}}
            replacement = canonical / 'auth.next'
            replacement.write_text(json.dumps(value))
            replacement.chmod(0o600)
            replacement.replace(auth)

        commit('G0')
        env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'CODEX_HOME': str(config),
               'CODEX_AUTH_HOME': str(canonical), 'GIT_CONFIG_GLOBAL': '/dev/null',
               'GIT_CONFIG_NOSYSTEM': '1', 'TOKIO_WORKER_THREADS': '2', 'RUST_LOG': 'off',
               'HTTP_PROXY': endpoint, 'HTTPS_PROXY': endpoint, 'ALL_PROXY': endpoint,
               'NO_PROXY': '127.0.0.1,localhost',
               'CODEX_REFRESH_TOKEN_URL_OVERRIDE': f'{endpoint}/forbidden-refresh',
               'CODEX_AUTHAPI_BASE_URL': f'{endpoint}/forbidden-auth',
               'CODEX_AGENT_IDENTITY_AUTHAPI_BASE_URL': f'{endpoint}/forbidden-identity',
               'CODEX_AGENT_IDENTITY_JWKS_BASE_URL': f'{endpoint}/forbidden-jwks'}
        child = subprocess.Popen(['prlimit', '--data=536870912', '--stack=16777216', '--core=0',
                                  '--', str(binary), 'app-server'], cwd=root, env=env,
                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                 text=True, start_new_session=True)
        output = queue.Queue()

        def read():
            total = 0
            try:
                while line := child.stdout.readline(524289):
                    total += len(line)
                    if total > 524288:
                        output.put({'probe_error': 'Native protocol output limit exceeded.'})
                        break
                    output.put(json.loads(line))
            except (ValueError, OSError):
                output.put({'probe_error': 'Invalid native protocol output.'})
            finally:
                output.put({'probe_error': 'Native protocol closed.'})

        reading = threading.Thread(target=read)
        reading.start()
        sequence = itertools.count(1)

        def request(method, params):
            identifier = next(sequence)
            child.stdin.write(json.dumps({'id': identifier, 'method': method, 'params': params}) + '\n')
            child.stdin.flush()
            return identifier

        def response(identifier):
            deadline = time.monotonic() + 10
            while True:
                message = output.get(timeout=max(0.01, deadline - time.monotonic()))
                assert 'probe_error' not in message, message.get('probe_error')
                if message.get('id') == identifier:
                    return message
                assert time.monotonic() < deadline, 'Finite native protocol deadline exceeded.'

        try:
            initialization = response(request('initialize', {
                'clientInfo': {'name': 'hive-3785-limits-generation', 'version': '0.0.0'},
                'capabilities': {'experimentalApi': True}}))
            assert 'result' in initialization, 'Actual native initialization failed.'
            child.stdin.write('{"method":"initialized"}\n')
            child.stdin.flush()
            identifier = request('account/rateLimits/read', {'excludeResetCreditDetails': True})
            assert entered.wait(8), 'Actual native usage request did not reach the fixture.'
            if args.mutation == 'logout':
                auth.unlink()
            elif args.mutation == 'replace':
                commit('G1')
            elif args.mutation == 'malformed':
                auth.write_text('{malformed synthetic authority')
            expected_auth = auth.read_bytes() if auth.exists() else None
            release.set()
            result = response(identifier)
            assert not errors, errors
            assert observed == ['G0'], 'Expected exactly one native G0 usage request.'
            if args.mutation == 'none' or args.expect_retired_response:
                assert result.get('result', {}).get('rateLimits', {}).get('primary', {}).get('usedPercent') == 41, 'Expected the actual G0 usage snapshot.'
            else:
                assert 'error' in result, 'Retired native authentication generation published its usage response.'
                assert result['error']['message'] == 'canonical authentication changed while reading account usage', 'Expected the native generation admission error.'
            assert (auth.read_bytes() if auth.exists() else None) == expected_auth, 'Usage publication must preserve the current canonical authority.'
            print(f'PASS: native usage {args.mutation}: ' + (
                'healthy snapshot' if args.mutation == 'none' else
                'reproduced retired response' if args.expect_retired_response else 'refused retired response'))
        finally:
            release.set()
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
            child.stdin.close()
            reading.join()
            child.stdout.close()
            assert not (config / 'auth.json').exists(), 'Private credentials must never be created.'
finally:
    release.set()
    server.shutdown()
    serving.join()
    server.server_close()
