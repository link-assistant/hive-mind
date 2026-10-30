#!/usr/bin/env python3
"""Run the actual pinned Gemini CLI against a loopback-only TLS provider.

No native module exports or SDK methods are instrumented. The proxy never
forwards traffic, and every credential, account and conversation is synthetic.
"""
import argparse
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import shutil
import ssl
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlsplit
import uuid

from native_process_group import stop_process_group

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('package', type=Path)
parser.add_argument('--diagnostics', type=Path, required=True)
parser.add_argument('--history', action='store_true')
parser.add_argument('--expect-history-gap', action='store_true')
args = parser.parse_args()
assert not args.expect_history_gap or args.history
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
manager = package / 'bundle/chunk-DKZARV6U.js'
assert hashlib.sha256(manager.read_bytes()).hexdigest() == 'c52e6e574c9bd960a60a3a3364351be8eccf1d1236d933d44204ded015047792'
root = Path(tempfile.mkdtemp(prefix='hive-3785-gemini-cli-'))
root.chmod(0o700)
children = []
requests = []
models = []
errors = []
safe_cleanup = False
server = None
serving = None
first_prompt = 'SYNTHETIC-GEMINI-HISTORY-FIRST-PROMPT'
second_prompt = 'SYNTHETIC-GEMINI-HISTORY-SECOND-PROMPT'
session = str(uuid.uuid4())

try:
    # Copy entrypoints and chunks: symlinked JS would resolve imports against
    # the original package and silently bypass the inspected adapter.
    native = root / 'native'
    native.mkdir(mode=0o700)
    shutil.copyfile(package / 'package.json', native / 'package.json')
    shutil.copytree(package / 'bundle', native / 'bundle', symlinks=False)
    home, canonical, workspace = [root / name for name in ('home', 'canonical', 'workspace')]
    for directory in (home, canonical, workspace):
        directory.mkdir(mode=0o700)
    private = home / '.gemini'
    private.mkdir(mode=0o700)
    settings = {'security': {'auth': {'selectedType': 'oauth-personal'}},
                'privacy': {'usageStatisticsEnabled': False},
                'model': {'maxSessionTurns': 1},
                'telemetry': {'enabled': False},
                'advanced': {'autoConfigureMemory': False},
                'general': {'disableAutoUpdate': True}}
    (private / 'settings.json').write_text(json.dumps(settings))
    (private / 'settings.json').chmod(0o600)
    managed = root / 'managed.json'
    auth = canonical / 'oauth_creds.json'
    credentials = {'access_token': 'synthetic-access-G0', 'refresh_token': 'synthetic-refresh-G0',
                   'token_type': 'Bearer', 'expiry_date': int(time.time()*1000) + 3600000}
    auth.write_text(json.dumps(credentials))
    auth.chmod(0o600)
    certificate, key = root / 'ca.pem', root / 'key.pem'
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
                    '-subj', '/CN=cloudcode-pa.googleapis.com', '-addext',
                    'subjectAltName=DNS:cloudcode-pa.googleapis.com,DNS:oauth2.googleapis.com,DNS:www.googleapis.com',
                    '-keyout', str(key), '-out', str(certificate)],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    key.chmod(0o600)
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    context.load_cert_chain(certificate, key)

    class Handler(BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.1'

        def setup(self):
            super().setup()
            self.connection.settimeout(4)

        def log_message(self, *_):
            pass

        def send(self, status, value, *, stream=False):
            data = (('data: ' + json.dumps(value) + '\n\n') if stream else json.dumps(value)).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'text/event-stream' if stream else 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Connection', 'close')
            self.end_headers()
            self.wfile.write(data)
            self.wfile.flush()
            self.close_connection = True

        def do_CONNECT(self):
            requests.append(['CONNECT', self.path[:200]])
            if len(requests) > 128 or self.path not in ('cloudcode-pa.googleapis.com:443', 'oauth2.googleapis.com:443', 'www.googleapis.com:443'):
                self.send(403, {'error': 'Synthetic fixture refuses this origin.'})
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

        def handle_provider(self):
            target = urlsplit(self.path)
            requests.append([self.command, target.path[:200]])
            try:
                assert len(requests) <= 128
                length = int(self.headers.get('Content-Length', '0'))
                assert 0 <= length <= 512 * 1024
                body = self.rfile.read(length)
                if target.path == '/tokeninfo':
                    assert not body and not target.query
                    assert self.headers.get('Authorization') == 'Bearer synthetic-access-G0'
                    self.send(200, {'expires_in': 3600, 'scope': 'https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/userinfo.email'})
                elif target.path == '/oauth2/v2/userinfo':
                    assert self.headers.get('Authorization') == 'Bearer synthetic-access-G0'
                    self.send(200, {'email': 'synthetic@example.invalid'})
                elif target.path.startswith('/v1internal:'):
                    assert self.headers.get('Authorization') == 'Bearer synthetic-access-G0'
                    operation = target.path.split(':', 1)[1]
                    payload = json.loads(body) if body else {}
                    if operation == 'loadCodeAssist':
                        self.send(200, {'cloudaicompanionProject': 'synthetic-project', 'currentTier': {'id': 'free-tier', 'name': 'Free'}})
                    elif operation == 'countTokens':
                        self.send(200, {'totalTokens': 1})
                    elif operation in ('generateContent', 'streamGenerateContent'):
                        assert payload.get('request', {}).get('contents')
                        content = json.dumps(payload['request']['contents'])
                        models.append({'operation': operation, 'first_prompt': first_prompt in content,
                                       'second_prompt': second_prompt in content,
                                       'prior_response': 'SYNTHETIC-GEMINI-COMPLETE' in content})
                        self.send(200, {'response': {'candidates': [{'index': 0, 'content': {'role': 'model', 'parts': [{'text': 'SYNTHETIC-GEMINI-COMPLETE'}]}, 'finishReason': 'STOP'}], 'usageMetadata': {'promptTokenCount': 1, 'candidatesTokenCount': 1, 'totalTokenCount': 2}, 'modelVersion': 'gemini-2.5-flash'}, 'traceId': 'synthetic-response'}, stream=operation == 'streamGenerateContent')
                    elif operation == 'retrieveUserQuota':
                        self.send(200, {'buckets': []})
                    elif operation == 'listExperiments':
                        self.send(200, {'experiments': []})
                    elif operation in ('recordCodeAssistMetrics', 'getCodeAssistGlobalUserSetting', 'fetchAdminControls'):
                        self.send(200, {})
                    else:
                        errors.append('UnexpectedProviderOperation:' + operation[:100])
                        self.send(400, {'error': {'message': 'Unexpected synthetic operation.'}})
                else:
                    errors.append('UnexpectedProviderPath:' + target.path[:100])
                    self.send(400, {'error': {'message': 'Unexpected synthetic path.'}})
            except (AssertionError, ValueError, OSError) as error:
                errors.append(type(error).__name__)
                self.send(400, {'error': {'message': 'Synthetic provider validation refused.'}})

        do_GET = handle_provider
        do_POST = handle_provider

    server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    server.daemon_threads = True
    serving = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': 0.1}, daemon=True)
    serving.start()
    proxy = f'http://127.0.0.1:{server.server_port}'
    env = {'PATH': os.environ['PATH'], 'HOME': str(home), 'GEMINI_CLI_HOME': str(home),
           'GEMINI_AUTH_HOME': str(canonical), 'GEMINI_CLI_NO_RELAUNCH': '1',
           'GEMINI_CLI_SYSTEM_SETTINGS_PATH': str(managed), 'GEMINI_CLI_SYSTEM_DEFAULTS_PATH': str(managed),
           'CI': '1', 'NO_COLOR': '1', 'NODE_EXTRA_CA_CERTS': str(certificate), 'NODE_USE_ENV_PROXY': '1',
           'HTTP_PROXY': proxy, 'HTTPS_PROXY': proxy, 'ALL_PROXY': proxy,
           'http_proxy': proxy, 'https_proxy': proxy, 'all_proxy': proxy,
           'NO_PROXY': '127.0.0.1,localhost', 'no_proxy': '127.0.0.1,localhost',
           'GIT_CONFIG_GLOBAL': '/dev/null', 'GIT_CONFIG_NOSYSTEM': '1',
           'XDG_CONFIG_HOME': str(home / '.config'), 'XDG_DATA_HOME': str(home / '.local/share'),
           'XDG_CACHE_HOME': str(home / '.cache')}
    args.diagnostics.parent.mkdir(parents=True, exist_ok=True)

    def invoke(diagnostic, child_env, flags):
        with diagnostic.open('wb') as diagnostics:
            diagnostic.chmod(0o600)
            child = subprocess.Popen(['prlimit', '--data=2147483648', '--stack=16777216', '--core=0', '--',
                                      shutil.which('node'), '--max-old-space-size=256', str(native / 'bundle/gemini.js'),
                                      '--output-format', 'json', '--model', 'gemini-2.5-flash', '--skip-trust', *flags],
                                     env=child_env, cwd=workspace, stdin=subprocess.DEVNULL,
                                     stdout=diagnostics, stderr=subprocess.STDOUT, start_new_session=True)
            children.append(child)
            deadline = time.monotonic() + 45
            try:
                while child.poll() is None:
                    assert time.monotonic() < deadline, 'Finite native Gemini CLI deadline exceeded.'
                    assert os.fstat(diagnostics.fileno()).st_size <= 256 * 1024, 'Native CLI diagnostics exceeded their bound.'
                    time.sleep(0.05)
            finally:
                stop_process_group(child)
            return child.returncode, diagnostic.read_text()

    flags = ['--prompt', first_prompt if args.history else 'Synthetic native request control. Do not invoke tools.']
    if args.history:
        flags.extend(['--session-id', session])
    code, output = invoke(args.diagnostics, env, flags)
    assert code == 0, 'Native CLI did not complete successfully; inspect bounded diagnostics.'
    assert not errors, errors
    assert models, 'Require a real native CLI model request.'
    assert 'SYNTHETIC-GEMINI-COMPLETE' in args.diagnostics.read_text()
    assert json.loads(auth.read_text()) == credentials
    assert not (private / 'oauth_creds.json').exists()
    assert not (private / 'google_accounts.json').exists()
    assert json.loads((canonical / 'google_accounts.json').read_text())['active'] == 'synthetic@example.invalid'
    if args.history:
        assert len(models) == 1 and models[0]['first_prompt']
        assert session in output
        transcripts = [p for p in private.rglob('*.jsonl') if first_prompt in p.read_text()]
        assert transcripts, 'The healthy native CLI must first persist its real conversation.'
        # The whole native process group has exited before private state disposal.
        shutil.rmtree(home)
        peer = root / 'peer-home'
        peer.mkdir(mode=0o700)
        private = peer / '.gemini'
        private.mkdir(mode=0o700)
        (private / 'settings.json').write_text(json.dumps(settings))
        (private / 'settings.json').chmod(0o600)
        peer_env = {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                    'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                    'XDG_CACHE_HOME': str(peer / '.cache')}
        listing = args.diagnostics.with_name(args.diagnostics.stem + '-list.log')
        code, listed = invoke(listing, peer_env, ['--list-sessions'])
        assert code == 0 and len(models) == 1
        resumed = args.diagnostics.with_name(args.diagnostics.stem + '-resume.log')
        code, output = invoke(resumed, peer_env, ['--resume', session, '--prompt', second_prompt])
        if args.expect_history_gap:
            assert session not in listed
            assert code != 0 and len(models) == 1
            assert 'Error resuming session: No previous sessions found for this project.' in output, 'Require native missing-session discovery, not an arbitrary startup failure.'
            print('REPRODUCED: actual Gemini CLI loses conversation discovery/resume after private configuration disposal; model_requests=1.')
        else:
            assert session in listed, 'A fresh native CLI must discover canonical conversation history.'
            assert code == 0 and len(models) == 2, 'A fresh native CLI must resume the saved conversation.'
            assert models[1]['first_prompt'] and models[1]['second_prompt'] and models[1]['prior_response']
            print('PASS: actual Gemini CLI discovers and resumes prior user/model content after private configuration disposal; model_requests=2.')
        assert not (private / 'oauth_creds.json').exists()
        assert not (private / 'google_accounts.json').exists()
    else:
        print('PASS: actual Gemini CLI completes a TLS-verified native OAuth model request with separate canonical auth and private configuration.')
    safe_cleanup = True
finally:
    try:
        for child in children:
            stop_process_group(child)
    except BaseException:
        safe_cleanup = False
        raise
    finally:
        if server:
            server.shutdown()
            serving.join(5)
            server.server_close()
        trace = args.diagnostics.with_suffix('.network.json')
        trace.write_text(json.dumps({'requests': requests, 'models': models, 'errors': errors}, indent=2))
        trace.chmod(0o600)
        if safe_cleanup:
            shutil.rmtree(root)
        else:
            print('Synthetic native CLI evidence retained in', root)
