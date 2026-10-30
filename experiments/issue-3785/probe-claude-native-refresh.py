#!/usr/bin/env python3
"""Exercise pinned native Claude refresh against a loopback-only HTTP proxy.

The proxy never forwards requests. Only disposable synthetic OAuth state is
passed to the native process. This is a host probe, not a container attestation.
"""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import ssl
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlsplit

from native_process_group import stop_process_group
from native_claude_history import reply as history_reply, run as run_history

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('binary', type=Path)
modes = parser.add_mutually_exclusive_group()
modes.add_argument('--expired', action='store_true')
modes.add_argument('--concurrent', action='store_true')
modes.add_argument('--owner-death', action='store_true')
modes.add_argument('--replace-login', action='store_true')
modes.add_argument('--logout', action='store_true')
modes.add_argument('--history', action='store_true')
parser.add_argument('--private-history', action='store_true')
parser.add_argument('--expect-history-gap', action='store_true')
parser.add_argument('--expect-predecessor-reuse', action='store_true')
parser.add_argument('--diagnostics', type=Path, required=True)
args = parser.parse_args()
binary = args.binary.resolve(strict=True)
assert binary.is_file()
observed = []
requests = []
errors = []
model_entered = threading.Event()
refresh_entered = threading.Event()
owner_stopped = threading.Event()
owner_response_finished = threading.Event()
second_refresh = threading.Event()
release_refresh = threading.Event()
model_auth = []
model_requests = []
children = []
assert not args.expect_predecessor_reuse or args.owner_death
assert not args.private_history or args.history
assert not args.expect_history_gap or (args.history and args.private_history)
expired = args.expired or args.concurrent or args.owner_death or args.replace_login or args.logout

with tempfile.TemporaryDirectory(prefix='hive-3785-claude-refresh-') as temporary:
    root = Path(temporary)
    root.chmod(0o700)
    home, config, canonical = [root / name for name in ('home', 'config', 'canonical')]
    for directory in (home, config, canonical):
        directory.mkdir(mode=0o700)
    certificate, key = root / 'ca.pem', root / 'key.pem'
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                    '-subj', '/CN=platform.claude.com', '-addext',
                    'subjectAltName=DNS:platform.claude.com,DNS:api.anthropic.com',
                    '-keyout', str(key), '-out', str(certificate)],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    key.chmod(0o600)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate, key)

    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(3)

        def log_message(self, *_):
            pass

        def send(self, status, value, *, abandoned_owner=False):
            data = json.dumps(value).encode()
            try:
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.send_header('Connection', 'close')
                self.end_headers()
                self.wfile.write(data)
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError, ssl.SSLEOFError):
                if not abandoned_owner:
                    errors.append('UnexpectedDisconnectedClient')

        def do_CONNECT(self):
            requests.append(('CONNECT', self.path))
            if self.path not in ('platform.claude.com:443', 'api.anthropic.com:443'):
                self.send(502, {'error': 'Synthetic proxy refuses this origin'})
                return
            self.send_response(200)
            self.end_headers()
            self.wfile.flush()
            try:
                with context.wrap_socket(self.connection, server_side=True) as secure:
                    Handler(secure, self.client_address, self.server)
            except (ssl.SSLError, OSError) as error:
                errors.append(type(error).__name__)
            self.close_connection = True

        def do_POST(self):
            endpoint = urlsplit(self.path)
            requests.append(('POST', endpoint.path))
            try:
                length = int(self.headers.get('Content-Length', '0'))
                assert 0 <= length <= 256 * 1024
                payload = json.loads(self.rfile.read(length)) if length else {}
                if endpoint.path == '/v1/oauth/token':
                    assert payload['grant_type'] == 'refresh_token'
                    generation = payload['refresh_token']
                    assert generation in ('SYNTHETIC-REFRESH-G0', 'SYNTHETIC-REFRESH-G1')
                    observed.append(generation)
                    exchange_index = len(observed)
                    assert len(observed) <= 3
                    if args.concurrent or args.owner_death or args.replace_login or args.logout:
                        if exchange_index == 1:
                            refresh_entered.set()
                            assert release_refresh.wait(8)
                        else:
                            second_refresh.set()
                            self.send(400, {'error': 'invalid_grant', 'error_description': 'Synthetic predecessor already consumed'})
                            return
                    try:
                        self.send(200, {'access_token': 'SYNTHETIC-ACCESS-G1',
                                        'refresh_token': 'SYNTHETIC-REFRESH-G1',
                                        'expires_in': 3600, 'scope': 'user:inference user:profile'},
                                  abandoned_owner=args.owner_death and exchange_index == 1
                                  and owner_stopped.is_set())
                    finally:
                        if exchange_index == 1:
                            owner_response_finished.set()
                elif endpoint.path == '/v1/messages':
                    assert self.headers.get('Authorization') in (
                        'Bearer SYNTHETIC-ACCESS-G0', 'Bearer SYNTHETIC-ACCESS-G1', 'Bearer SYNTHETIC-ACCESS-G2')
                    model_auth.append(self.headers.get('Authorization'))
                    model_requests.append(payload)
                    model_entered.set()
                    if args.history:
                        assert len(model_requests) <= 2
                        history_reply(self, len(model_requests))
                        return
                    self.send(503, {'type': 'error', 'error': {
                        'type': 'overloaded_error', 'message': 'Synthetic model unavailable'}})
                else:
                    self.send(404, {'error': 'Synthetic endpoint unavailable'})
            except (AssertionError, ValueError, KeyError):
                errors.append('InvalidSyntheticRequest')
                self.send(400, {})

        def do_GET(self):
            endpoint = urlsplit(self.path)
            requests.append(('GET', endpoint.path))
            self.send(404, {'error': 'Synthetic endpoint unavailable'})

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    serving = threading.Thread(target=server.serve_forever)
    serving.start()
    expires = int(time.time() * 1000) + (-60000 if expired else 3600000)
    credentials = {'claudeAiOauth': {'accessToken': 'SYNTHETIC-ACCESS-G0',
                    'refreshToken': 'SYNTHETIC-REFRESH-G0', 'expiresAt': expires,
                    'scopes': ['user:inference', 'user:profile'], 'subscriptionType': 'max',
                    'rateLimitTier': 'default_claude_max_5x'}}
    auth = canonical / '.credentials.json'
    auth.write_text(json.dumps(credentials))
    auth.chmod(0o600)
    settings = {'hasCompletedOnboarding': True, 'numStartups': 3,
                'oauthAccount': {'accountUuid': 'synthetic-account',
                                 'emailAddress': 'synthetic@example.invalid'}}
    for state in (home / '.claude.json', config / '.claude.json'):
        state.write_text(json.dumps(settings))
        state.chmod(0o600)
    proxy = f'http://127.0.0.1:{server.server_port}'
    env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'CLAUDE_CONFIG_DIR': str(config),
           'CLAUDE_SECURESTORAGE_CONFIG_DIR': str(canonical),
           'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1', 'DISABLE_TELEMETRY': '1',
           'DISABLE_ERROR_REPORTING': '1', 'ANTHROPIC_BASE_URL': proxy,
           'HTTP_PROXY': proxy, 'HTTPS_PROXY': proxy, 'ALL_PROXY': proxy,
           'http_proxy': proxy, 'https_proxy': proxy, 'all_proxy': proxy,
           'NO_PROXY': '127.0.0.1,localhost', 'no_proxy': '127.0.0.1,localhost',
           'NODE_EXTRA_CA_CERTS': str(certificate), 'MAX_RETRIES': '0',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1'}
    child = None
    peer_diagnostics = None
    if args.history:
        try:
            run_history(binary, root, env, settings, args, model_requests, errors)
            assert observed == [], 'Healthy native history controls must not refresh.'
            assert model_auth == ['Bearer SYNTHETIC-ACCESS-G0'] * len(model_requests)
            assert json.loads(auth.read_text()) == credentials
        finally:
            server.shutdown()
            serving.join()
            server.server_close()
        raise SystemExit(0)
    try:
        args.diagnostics.parent.mkdir(parents=True, exist_ok=True)
        with args.diagnostics.open('wb') as diagnostics:
            args.diagnostics.chmod(0o600)
            child = subprocess.Popen(['prlimit', '--data=1073741824', '--stack=16777216', '--core=0',
                                      '--', str(binary), '-p', 'Synthetic refresh control. Do not invoke tools.',
                                      '--output-format', 'json', '--max-turns', '1', '--tools', '',
                                      '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'],
                                     env=env, cwd=home, stdin=subprocess.DEVNULL, stdout=diagnostics,
                                     stderr=subprocess.STDOUT, start_new_session=True)
            children.append(child)
            started = time.monotonic()
            if args.concurrent or args.owner_death or args.replace_login or args.logout:
                assert refresh_entered.wait(8), 'First native CLI did not enter refresh.'
                if args.logout:
                    auth.unlink()
                    release_refresh.set()
                elif args.replace_login:
                    replacement = json.loads(json.dumps(credentials))
                    replacement['claudeAiOauth'].update({'accessToken': 'SYNTHETIC-ACCESS-G2',
                        'refreshToken': 'SYNTHETIC-REFRESH-G2', 'expiresAt': int(time.time()*1000)+3600000})
                    pending = canonical / '.credentials.next'
                    pending.write_text(json.dumps(replacement))
                    pending.chmod(0o600)
                    pending.replace(auth)
                    release_refresh.set()
            if args.concurrent or args.owner_death:
                if args.owner_death:
                    stop_process_group(child)
                    owner_stopped.set()
                peer_home, peer_config = root / 'peer-home', root / 'peer-config'
                for directory in (peer_home, peer_config):
                    directory.mkdir(mode=0o700)
                    state = directory / '.claude.json'
                    state.write_text(json.dumps(settings))
                    state.chmod(0o600)
                peer_env = {**env, 'HOME': str(peer_home), 'CLAUDE_CONFIG_DIR': str(peer_config)}
                peer_diagnostics = tempfile.TemporaryFile()
                peer = subprocess.Popen(child.args, env=peer_env, cwd=peer_home, stdin=subprocess.DEVNULL,
                                        stdout=peer_diagnostics, stderr=subprocess.STDOUT, start_new_session=True)
                children.append(peer)
                if args.concurrent:
                    second_refresh.wait(3)
                release_refresh.set()
                if args.owner_death:
                    child = peer
            if args.owner_death:
                while not second_refresh.wait(0.05) and child.poll() is None:
                    assert time.monotonic() - started < 90, 'Finite native owner-death deadline exceeded.'
                    assert os.fstat(diagnostics.fileno()).st_size <= 256 * 1024
                    assert os.fstat(peer_diagnostics.fileno()).st_size <= 256 * 1024
                assert owner_response_finished.wait(3), 'Abandoned response handler did not finish.'
                if args.expect_predecessor_reuse:
                    assert observed == ['SYNTHETIC-REFRESH-G0'] * 2, 'The native peer must reproduce uncertain predecessor reuse.'
                else:
                    assert observed == ['SYNTHETIC-REFRESH-G0'], 'A peer must refuse the consumed predecessor after owner death.'
                    assert model_auth == [], 'Uncertain canonical state must not execute a model request.'
            while not args.owner_death and not model_entered.wait(0.05):
                if child.poll() is not None and args.logout:
                    break
                assert child.poll() is None, 'Native CLI exited before the model request control.'
                assert time.monotonic() - started < 20, 'Finite native refresh control deadline exceeded.'
                assert os.fstat(diagnostics.fileno()).st_size <= 256 * 1024
            if args.concurrent:
                assert observed == ['SYNTHETIC-REFRESH-G0'], 'Distinct private configurations must coordinate the same credential authority.'
                while len(model_auth) < 2:
                    assert time.monotonic() - started < 20
                    time.sleep(0.05)
                assert model_auth == ['Bearer SYNTHETIC-ACCESS-G1'] * 2
            elif not args.owner_death:
                assert observed == (['SYNTHETIC-REFRESH-G0'] if expired else [])
                if not (args.logout or args.replace_login):
                    expected_model = 'G1' if expired else 'G0'
                    assert model_auth == [f'Bearer SYNTHETIC-ACCESS-{expected_model}']
            assert not errors, f'Synthetic request validation failed: {errors!r}'
            if args.logout:
                assert not auth.exists(), 'A pending refresh must not recreate logged-out credentials.'
                assert model_auth == [], 'Native execution must refuse after canonical logout.'
            else:
                final = json.loads(auth.read_text())
                expected = 'G2' if args.replace_login else 'G1' if expired and not args.owner_death else 'G0'
                assert final['claudeAiOauth']['refreshToken'] == f'SYNTHETIC-REFRESH-{expected}'
                if args.replace_login:
                    assert model_auth == ['Bearer SYNTHETIC-ACCESS-G2'], 'A pending refresh must not replace or execute as an old login.'
            for private in (config, root / 'peer-config'):
                assert not (private / '.credentials.json').exists()
            for output in (diagnostics, peer_diagnostics):
                if output is not None:
                    assert os.fstat(output.fileno()).st_size <= 256 * 1024
            print(f'PASS: native Claude {"owner-death predecessor-reuse reproduction" if args.expect_predecessor_reuse else "owner-death refusal" if args.owner_death else "concurrent" if args.concurrent else "replacement-login" if args.replace_login else "logout" if args.logout else "expired" if expired else "healthy"} control; '
                  f'refresh_exchanges={len(observed)}, model_requests={len(model_auth)}, private_auth_absent=true')
    finally:
        release_refresh.set()
        for active in children:
            stop_process_group(active)
        if peer_diagnostics is not None:
            peer_diagnostics.close()
        server.shutdown()
        serving.join()
        server.server_close()
        print('Synthetic endpoint trace:', json.dumps(requests))
