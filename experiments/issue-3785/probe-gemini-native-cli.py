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
parser.add_argument('--private-history', action='store_true')
parser.add_argument('--history-attack', choices=('symlink', 'hardlink', 'malformed', 'truncated', 'schema', 'foreign-project', 'invalid-session'))
parser.add_argument('--history-retention', choices=('empty', 'expired'))
parser.add_argument('--history-live-retention', action='store_true')
parser.add_argument('--history-delete', action='store_true')
parser.add_argument('--history-live-delete', action='store_true')
parser.add_argument('--history-archive-resume', action='store_true')
parser.add_argument('--history-archive-discovery', action='store_true')
parser.add_argument('--history-archive-attack', choices=('symlink', 'hardlink', 'malformed', 'truncated', 'schema', 'foreign-project', 'invalid-session'))
parser.add_argument('--history-archive-live-resume', action='store_true')
parser.add_argument('--history-archive-second-cycle', action='store_true')
args = parser.parse_args()
assert not args.expect_history_gap or args.history
assert not args.private_history or args.history
assert not args.history_retention or args.history and not (args.history_attack or args.private_history or args.expect_history_gap)
assert not args.history_live_retention or args.history and not (args.history_retention or args.history_attack or args.private_history or args.expect_history_gap)
assert not args.history_delete or args.history and not (args.history_retention or args.history_attack or args.private_history or args.expect_history_gap or args.history_live_retention or args.history_live_delete)
assert not args.history_live_delete or args.history and not (args.history_retention or args.history_attack or args.private_history or args.expect_history_gap or args.history_live_retention)
assert not args.history_attack or (args.history and not args.private_history and not args.expect_history_gap)
assert not args.history_archive_resume or args.history_delete
assert not args.history_archive_discovery or args.history_archive_resume
assert not args.history_archive_attack or args.history_archive_resume and not args.history_archive_discovery
assert not args.history_archive_live_resume or args.history_archive_resume and not args.history_archive_attack
assert not args.history_archive_second_cycle or args.history_archive_resume and not args.history_archive_attack
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
manager = package / 'bundle/chunk-DKZARV6U.js'
manager_hash = hashlib.sha256(manager.read_bytes()).hexdigest()
assert manager_hash in ('c52e6e574c9bd960a60a3a3364351be8eccf1d1236d933d44204ded015047792',
                        '6cb363864dca9a4756e66142b3e30244d59a0702a258c2e5279b87b07ff609b3',
                        '3062c3291a9a49d62177b20b8ef450c50f96a507cd4bdc168969a9dc45764970', '4b4daad35a3af8de066e49d866d14f163502a51234acb10c7c2b76a32213af64', '463cf8af6e9a06f2a1ff7ae2a484fcfa5d8d53f77c604f3e51344e71f3b1ed61')
history_adapter = manager_hash != 'c52e6e574c9bd960a60a3a3364351be8eccf1d1236d933d44204ded015047792'
root = Path(tempfile.mkdtemp(prefix='hive-3785-gemini-cli-'))
root.chmod(0o700)
children = []
requests = []
models = []
live_controls = []
errors = []
safe_cleanup = False
server = None
serving = None
first_prompt = 'SYNTHETIC-GEMINI-HISTORY-FIRST-PROMPT'
second_prompt = 'SYNTHETIC-GEMINI-HISTORY-SECOND-PROMPT'
third_prompt = 'SYNTHETIC-GEMINI-HISTORY-THIRD-PROMPT'
session = str(uuid.uuid4())


def completions():
    return [record for record in models if record['operation'] == 'streamGenerateContent']

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
    history = root / 'history'
    history.mkdir(mode=0o700)
    private = home / '.gemini'
    private.mkdir(mode=0o700)
    settings = {'security': {'auth': {'selectedType': 'oauth-personal'}},
                'privacy': {'usageStatisticsEnabled': False},
                'model': {'maxSessionTurns': 1},
                'telemetry': {'enabled': False},
                'advanced': {'autoConfigureMemory': False},
                'general': {'disableAutoUpdate': True}}
    if args.history_retention or args.history_live_retention or args.history_live_delete:
        settings['general']['sessionRetention'] = {'enabled': True, 'maxAge': '1d'}
    (private / 'settings.json').write_text(json.dumps(settings))
    (private / 'settings.json').chmod(0o600)
    managed = root / 'managed.json'
    auth = canonical / 'oauth_creds.json'
    credentials = {'access_token': 'synthetic-access-G0', 'refresh_token': 'synthetic-refresh-G0',
                   'token_type': 'Bearer', 'expiry_date': int(time.time()*1000) + 3600000}
    auth.write_text(json.dumps(credentials))
    auth.chmod(0o600)
    auth_identity = (auth.stat().st_dev, auth.stat().st_ino)
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
                                       'third_prompt': third_prompt in content,
                                       'prior_response': 'SYNTHETIC-GEMINI-COMPLETE' in content})
                        if (args.history_live_retention or args.history_live_delete) and operation == 'streamGenerateContent' and not live_controls:
                            live_controls.append(False)
                            live_controls[0] = check_live_retention()
                        if args.history_archive_live_resume and operation == 'streamGenerateContent' and models[-1]['second_prompt'] and not live_controls:
                            live_controls.append(False)
                            live_controls[0] = check_live_archive_resume()
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
    if args.history and not args.private_history:
        env['GEMINI_HISTORY_HOME'] = str(history)
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

    def check_live_retention():
        transcripts = [p for p in history.rglob('*.jsonl') if first_prompt in p.read_text()]
        assert len(transcripts) == 1
        record = transcripts[0]
        lines = [json.loads(line) for line in record.read_text().splitlines()]
        lines[0]['summary'] = 'SYNTHETIC-LIVE-WRITER-RETENTION'
        for row in lines:
            for value in (row, row.get('$set', {})):
                for field in ('startTime', 'lastUpdated'):
                    if field in value:
                        value[field] = '2020-01-01T00:00:00.000Z'
        record.write_text(''.join(json.dumps(row) + '\n' for row in lines))
        before = record.read_bytes()
        identity = (record.stat().st_dev, record.stat().st_ino)
        peer = root / 'live-peer'
        peer.mkdir(mode=0o700)
        private_peer = peer / '.gemini'
        private_peer.mkdir(mode=0o700)
        (private_peer / 'settings.json').write_text(json.dumps(settings))
        (private_peer / 'settings.json').chmod(0o600)
        peer_env = {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                    'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                    'XDG_CACHE_HOME': str(peer / '.cache')}
        diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-live-peer.log')
        code, output = invoke(diagnostic, peer_env, ['--delete-session', session] if args.history_live_delete else ['--list-sessions'])
        evidence = {'peer_completed': code == 0, 'source_present': record.exists(),
                    'prior_bytes_preserved': record.exists() and record.read_bytes().startswith(before),
                    'same_inode': record.exists() and (record.stat().st_dev, record.stat().st_ino) == identity}
        if args.history_live_delete:
            evidence['busy_refusal'] = 'Gemini conversation is currently being written.' in output
        diagnostic.with_suffix('.control.json').write_text(json.dumps(evidence))
        return all(evidence.values())

    def check_live_archive_resume():
        transcripts = [p for p in history.rglob('*.jsonl') if '.archive' not in p.parts and first_prompt in p.read_text()]
        assert len(transcripts) == 1
        record = transcripts[0]
        before = record.read_bytes()
        identity = (record.stat().st_dev, record.stat().st_ino)
        peer = root / 'archive-live-peer'
        peer.mkdir(mode=0o700)
        private_peer = peer / '.gemini'
        private_peer.mkdir(mode=0o700)
        (private_peer / 'settings.json').write_text(json.dumps(settings))
        (private_peer / 'settings.json').chmod(0o600)
        peer_env = {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                    'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                    'XDG_CACHE_HOME': str(peer / '.cache')}
        diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-archive-live-peer.log')
        previous = len(completions())
        code, output = invoke(diagnostic, peer_env, ['--resume', session, '--prompt', 'SYNTHETIC-CONCURRENT-ARCHIVE-PEER'])
        evidence = {'peer_refused': code != 0 and 'Gemini canonical conversation history is unavailable or unsafe.' in output,
                    'no_peer_inference': len(completions()) == previous,
                    'source_present': record.exists(),
                    'prior_bytes_preserved': record.exists() and record.read_bytes().startswith(before),
                    'same_inode': record.exists() and (record.stat().st_dev, record.stat().st_ino) == identity}
        diagnostic.with_suffix('.control.json').write_text(json.dumps(evidence))
        return all(evidence.values())

    flags = ['--prompt', first_prompt if args.history else 'Synthetic native request control. Do not invoke tools.']
    if args.history:
        flags.extend(['--session-id', session])
    code, output = invoke(args.diagnostics, env, flags)
    assert code == 0, 'Native CLI did not complete successfully; inspect bounded diagnostics.'
    assert not errors, errors
    assert models, 'Require a real native CLI model request.'
    assert 'SYNTHETIC-GEMINI-COMPLETE' in args.diagnostics.read_text()
    if args.history_live_retention or args.history_live_delete:
        assert live_controls == [True], "Native retention must leave a live writer's canonical conversation in place."
        print('PASS: actual native peer preserves a live canonical writer during ' + ('explicit deletion.' if args.history_live_delete else 'automatic retention.'))
    assert json.loads(auth.read_text()) == credentials
    assert (auth.stat().st_dev, auth.stat().st_ino) == auth_identity
    assert not (private / 'oauth_creds.json').exists()
    assert not (private / 'google_accounts.json').exists()
    assert json.loads((canonical / 'google_accounts.json').read_text())['active'] == 'synthetic@example.invalid'
    if args.history:
        assert len(completions()) == 1 and completions()[0]['first_prompt']
        assert session in output
        transcripts = [p for base in (private, history) for p in base.rglob('*.jsonl') if first_prompt in p.read_text()]
        assert transcripts, 'The healthy native CLI must first persist its real conversation.'
        if history_adapter and not args.private_history:
            assert all(history in p.parents for p in transcripts)
            assert not list(private.rglob('*.jsonl'))
            assert set(p.name for p in history.iterdir()) == {'projects', 'projects.json', '.history.lock'}
        # The whole native process group has exited before private state disposal.
        shutil.rmtree(home)
        retained_bytes = None
        if args.history_retention:
            assert history_adapter and len(transcripts) == 1
            lines = [json.loads(line) for line in transcripts[0].read_text().splitlines()]
            lines[0]['summary'] = 'SYNTHETIC-NATIVE-RETENTION-AUDIT'
            if args.history_retention == 'empty':
                lines = [lines[0]]
            else:
                for record in lines:
                    for value in (record, record.get('$set', {})):
                        for field in ('startTime', 'lastUpdated'):
                            if field in value:
                                value[field] = '2020-01-01T00:00:00.000Z'
            transcripts[0].write_text(''.join(json.dumps(record) + '\n' for record in lines))
            retained_bytes = transcripts[0].read_bytes()
            retained_identity = (transcripts[0].stat().st_dev, transcripts[0].stat().st_ino)
        protected = None
        if args.history_attack:
            assert history_adapter and len(transcripts) == 1
            protected = root / 'protected-history'
            transcripts[0].rename(protected)
            protected_bytes = protected.read_bytes()
            protected_identity = (protected.stat().st_dev, protected.stat().st_ino)
            if args.history_attack == 'symlink':
                transcripts[0].symlink_to(protected)
            elif args.history_attack == 'hardlink':
                os.link(protected, transcripts[0])
            elif args.history_attack == 'malformed':
                transcripts[0].write_text('{malformed-native-conversation\n')
                transcripts[0].chmod(0o600)
            elif args.history_attack == 'truncated':
                transcripts[0].write_bytes(protected_bytes + b'{"$set":')
                transcripts[0].chmod(0o600)
            else:
                lines = protected_bytes.decode().splitlines()
                metadata = json.loads(lines[0])
                if args.history_attack == 'schema':
                    metadata['projectHash'] = None
                elif args.history_attack == 'foreign-project':
                    metadata['projectHash'] = '0' * 64
                else:
                    metadata['sessionId'] = 37
                lines[0] = json.dumps(metadata)
                transcripts[0].write_text('\n'.join(lines) + '\n')
                transcripts[0].chmod(0o600)
            attacked_bytes = transcripts[0].read_bytes()
            attacked_identity = (transcripts[0].lstat().st_dev, transcripts[0].lstat().st_ino)
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
        if args.history_retention:
            assert code == 0 and len(models) == 1
            retained = [p for p in history.rglob('*.jsonl') if p.read_bytes() == retained_bytes]
            assert len(retained) == 1, 'Native retention must preserve canonical conversation audit evidence.'
            assert (retained[0].stat().st_dev, retained[0].stat().st_ino) == retained_identity
            assert session not in listed, 'Native retention must still remove the session from the active listing.'
            assert json.loads(auth.read_text()) == credentials
            assert (auth.stat().st_dev, auth.stat().st_ino) == auth_identity
            assert not errors, errors
            print('PASS: actual Gemini retention removes inactive history from active listing while preserving canonical audit bytes/inode: ' + args.history_retention)
            safe_cleanup = True
            raise SystemExit(0)
        if args.history_attack:
            assert code != 0 and len(models) == 1
            assert 'Gemini canonical conversation history is unavailable or unsafe.' in listed
            assert protected.read_bytes() == protected_bytes
            assert (protected.stat().st_dev, protected.stat().st_ino) == protected_identity
            assert transcripts[0].read_bytes() == attacked_bytes
            assert (transcripts[0].lstat().st_dev, transcripts[0].lstat().st_ino) == attacked_identity
            assert json.loads(auth.read_text()) == credentials
            assert (auth.stat().st_dev, auth.stat().st_ino) == auth_identity
            assert not (private / 'oauth_creds.json').exists()
            assert not (private / 'google_accounts.json').exists()
            assert not errors, errors
            print('PASS: actual Gemini CLI refuses unsafe canonical history before additional inference; protected bytes and inode remain unchanged: ' + args.history_attack)
            safe_cleanup = True
            raise SystemExit(0)
        assert code == 0 and len(completions()) == 1
        if args.history_delete:
            assert session in listed
            before = transcripts[0].read_bytes()
            identity = (transcripts[0].stat().st_dev, transcripts[0].stat().st_ino)
            diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-delete.log')
            code, output = invoke(diagnostic, peer_env, ['--delete-session', session])
            assert code == 0 and 'Deleted session' in output
            diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-deleted-list.log')
            code, output = invoke(diagnostic, peer_env, ['--list-sessions'])
            assert code == 0 and session not in output, 'Native deletion must remove the canonical active conversation.'
            retained = [p for p in history.rglob('*.jsonl') if p.read_bytes() == before]
            assert len(retained) == 1, 'Native deletion must preserve canonical conversation audit evidence.'
            assert (retained[0].stat().st_dev, retained[0].stat().st_ino) == identity
            assert len(completions()) == 1 and not errors
            assert json.loads(auth.read_text()) == credentials
            assert (auth.stat().st_dev, auth.stat().st_ino) == auth_identity
            print('PASS: actual native session deletion removes the active conversation and preserves canonical audit bytes/inode.')
            if args.history_archive_resume:
                archived = retained[0]
                shutil.rmtree(peer)
                third = root / 'archive-reader'
                third.mkdir(mode=0o700)
                private_third = third / '.gemini'
                private_third.mkdir(mode=0o700)
                (private_third / 'settings.json').write_text(json.dumps(settings))
                (private_third / 'settings.json').chmod(0o600)
                third_env = {**env, 'HOME': str(third), 'GEMINI_CLI_HOME': str(third),
                             'XDG_CONFIG_HOME': str(third / '.config'), 'XDG_DATA_HOME': str(third / '.local/share'),
                             'XDG_CACHE_HOME': str(third / '.cache')}
                if args.history_archive_attack:
                    protected_archive = root / 'protected-archive'
                    archived.rename(protected_archive)
                    if args.history_archive_attack == 'symlink':
                        archived.symlink_to(protected_archive)
                    elif args.history_archive_attack == 'hardlink':
                        os.link(protected_archive, archived)
                    else:
                        content = before.decode()
                        if args.history_archive_attack == 'malformed':
                            content = '{malformed-native-archive\n'
                        elif args.history_archive_attack == 'truncated':
                            content += '{"$set":'
                        else:
                            lines = content.splitlines()
                            metadata = json.loads(lines[0])
                            if args.history_archive_attack == 'schema':
                                metadata['projectHash'] = None
                            elif args.history_archive_attack == 'foreign-project':
                                metadata['projectHash'] = '0' * 64
                            else:
                                metadata['sessionId'] = 37
                            lines[0] = json.dumps(metadata)
                            content = '\n'.join(lines) + '\n'
                        archived.write_text(content)
                        archived.chmod(0o600)
                    attacked_archive = archived.read_bytes()
                    attacked_identity = (archived.lstat().st_dev, archived.lstat().st_ino)
                if args.history_archive_discovery:
                    diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-archive-list.log')
                    requests_before = len(models)
                    code, output = invoke(diagnostic, third_env, ['--list-archived-sessions'])
                    assert code == 0 and session in output and 'Available archived sessions' in output, 'A fresh native CLI must discover canonical archived conversations.'
                    assert len(models) == requests_before
                    assert archived.read_bytes() == before
                    assert (archived.stat().st_dev, archived.stat().st_ino) == identity
                    assert not transcripts[0].exists(), 'Archive discovery must not reactivate retired conversations.'
                    print('PASS: actual native CLI discovers canonical archive generations without reactivation or inference.')
                diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-archive-resume.log')
                code, output = invoke(diagnostic, third_env, ['--resume', session, '--prompt', second_prompt])
                if args.history_archive_attack:
                    assert code != 0 and len(completions()) == 1
                    assert 'Gemini canonical conversation history is unavailable or unsafe.' in output
                    assert protected_archive.read_bytes() == before
                    assert (protected_archive.stat().st_dev, protected_archive.stat().st_ino) == identity
                    assert archived.read_bytes() == attacked_archive
                    assert (archived.lstat().st_dev, archived.lstat().st_ino) == attacked_identity
                    assert not transcripts[0].exists()
                    assert json.loads(auth.read_text()) == credentials
                    assert (auth.stat().st_dev, auth.stat().st_ino) == auth_identity
                    assert not list(private_third.rglob('*.jsonl'))
                    assert not errors, errors
                    print('PASS: actual native CLI refuses unsafe archived history without mutation or additional inference: ' + args.history_archive_attack)
                    safe_cleanup = True
                    raise SystemExit(0)
                assert code == 0 and len(completions()) == 2, 'A fresh native CLI must resume a canonical archived conversation by UUID.'
                if args.history_archive_live_resume:
                    assert live_controls == [True], 'A native peer must refuse a conversation that is being resumed by another writer.'
                    print('PASS: actual native archive resume excludes a concurrent writer without additional inference or loss of existing bytes.')
                assert completions()[1]['first_prompt'] and completions()[1]['second_prompt'] and completions()[1]['prior_response']
                assert archived.read_bytes() == before
                assert (archived.stat().st_dev, archived.stat().st_ino) == identity
                assert not list(private_third.rglob('*.jsonl'))
                assert not (private_third / 'oauth_creds.json').exists()
                assert not (private_third / 'google_accounts.json').exists()
                assert not errors, errors
                print('PASS: actual native CLI resumes archived user/model content after private home disposal while preserving the audit generation.')
                if args.history_archive_second_cycle:
                    diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-archive-delete-again.log')
                    code, output = invoke(diagnostic, third_env, ['--delete-session', session])
                    assert code == 0 and 'Deleted session' in output
                    archives = [p for p in history.rglob('*.jsonl') if '.archive' in p.parts and json.loads(p.read_text().splitlines()[0]).get('sessionId') == session]
                    assert sum(first_prompt in p.read_text() for p in archives) == 2
                    generations = [(p, p.read_bytes(), (p.stat().st_dev, p.stat().st_ino)) for p in archives]
                    assert any(second_prompt in content.decode() for _, content, _ in generations)
                    shutil.rmtree(third)
                    fourth = root / 'latest-archive-reader'
                    fourth.mkdir(mode=0o700)
                    private_fourth = fourth / '.gemini'
                    private_fourth.mkdir(mode=0o700)
                    (private_fourth / 'settings.json').write_text(json.dumps(settings))
                    (private_fourth / 'settings.json').chmod(0o600)
                    fourth_env = {**env, 'HOME': str(fourth), 'GEMINI_CLI_HOME': str(fourth),
                                  'XDG_CONFIG_HOME': str(fourth / '.config'), 'XDG_DATA_HOME': str(fourth / '.local/share'),
                                  'XDG_CACHE_HOME': str(fourth / '.cache')}
                    diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-archive-list-again.log')
                    previous = len(models)
                    code, output = invoke(diagnostic, fourth_env, ['--list-archived-sessions'])
                    assert code == 0 and output.count(session) == len(generations)
                    assert len(models) == previous
                    diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-archive-resume-latest.log')
                    code, output = invoke(diagnostic, fourth_env, ['--resume', session, '--prompt', third_prompt])
                    assert code == 0 and len(completions()) == 3
                    assert all(completions()[2][key] for key in ('first_prompt', 'second_prompt', 'third_prompt', 'prior_response'))
                    for path, content, original_identity in generations:
                        assert path.read_bytes() == content
                        assert (path.stat().st_dev, path.stat().st_ino) == original_identity
                    assert not list(private_fourth.rglob('*.jsonl'))
                    assert not errors, errors
                    print('PASS: actual native CLI discovers all archived generations and resumes the latest conversation while preserving every audit generation.')
            safe_cleanup = True
            raise SystemExit(0)
        resumed = args.diagnostics.with_name(args.diagnostics.stem + '-resume.log')
        code, output = invoke(resumed, peer_env, ['--resume', session, '--prompt', second_prompt])
        if args.expect_history_gap:
            assert session not in listed
            assert code != 0 and len(completions()) == 1
            assert 'Error resuming session: No previous sessions found for this project.' in output, 'Require native missing-session discovery, not an arbitrary startup failure.'
            print('REPRODUCED: actual Gemini CLI loses conversation discovery/resume after private configuration disposal; model_requests=1.')
        else:
            assert session in listed, 'A fresh native CLI must discover canonical conversation history.'
            assert code == 0 and len(completions()) == 2, 'A fresh native CLI must resume the saved conversation.'
            assert completions()[1]['first_prompt'] and completions()[1]['second_prompt'] and completions()[1]['prior_response']
            assert any(first_prompt in p.read_text() and second_prompt in p.read_text() for p in history.rglob('*.jsonl'))
            assert not list(private.rglob('*.jsonl'))
            print('PASS: actual Gemini CLI discovers and resumes prior user/model content after private configuration disposal; conversation_requests=2.')
        assert not (private / 'oauth_creds.json').exists()
        assert not (private / 'google_accounts.json').exists()
    else:
        print('PASS: actual Gemini CLI completes a TLS-verified native OAuth model request with separate canonical auth and private configuration.')
    assert not errors, errors
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
