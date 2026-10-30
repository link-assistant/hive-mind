#!/usr/bin/env python3
"""Run the actual pinned Gemini CLI against a loopback-only TLS provider.

No native module exports or SDK methods are instrumented. The proxy never
forwards traffic, and every credential, account and conversation is synthetic.
"""
import argparse
import base64
import fcntl
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import pty
import select
import shutil
import ssl
import struct
import subprocess
import tempfile
import termios
import threading
import time
from urllib.parse import urlsplit
import uuid

from native_process_group import stop_process_group

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('package', type=Path)
parser.add_argument('--diagnostics', type=Path, required=True)
parser.add_argument('--history', action='store_true')
parser.add_argument('--shell-history', action='store_true')
parser.add_argument('--shell-history-attack', choices=('symlink', 'hardlink', 'unsafe-mode', 'malformed', 'invalid-utf8', 'oversized', 'command-schema'))
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
parser.add_argument('--history-tool-output', action='store_true')
parser.add_argument('--history-blob', action='store_true')
parser.add_argument('--history-blob-attack', choices=('symlink', 'hardlink', 'unsafe-mode', 'content-change', 'oversized', 'missing', 'parent-replacement'))
parser.add_argument('--history-tool-output-attack', choices=('symlink', 'hardlink', 'unsafe-mode', 'invalid-utf8', 'content-change', 'oversized', 'missing', 'parent-replacement'))
parser.add_argument('--session-identifier')
parser.add_argument('--history-import', choices=('canonical', 'export', 'legacy-export'))
parser.add_argument('--history-import-attack', choices=('symlink', 'hardlink', 'malformed', 'truncated', 'schema', 'invalid-session', 'invalid-project', 'unsafe-mode', 'unsafe-parent'))
args = parser.parse_args()
assert not args.shell_history or args.history and not any(value for name, value in vars(args).items() if name not in ('package', 'diagnostics', 'history', 'shell_history', 'shell_history_attack'))
assert not args.shell_history_attack or args.shell_history
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
assert not args.session_identifier or args.history
assert not args.history_import or args.history and not (args.history_attack or args.history_delete or args.history_retention or args.expect_history_gap or args.private_history)
assert not args.history_import_attack or args.history_import == 'export'
assert not args.history_tool_output or args.history and not (args.history_attack or args.history_delete or args.history_import or args.history_retention or args.expect_history_gap or args.private_history)
assert not args.history_tool_output_attack or args.history_tool_output
assert not args.history_blob or args.history and not (args.history_tool_output or args.history_attack or args.history_delete or args.history_import or args.history_retention or args.expect_history_gap or args.private_history)
assert not args.history_blob_attack or args.history_blob
tool_mode = args.history_tool_output or args.history_blob
artifact_attack = args.history_tool_output_attack or args.history_blob_attack
package = args.package.resolve(strict=True)
assert json.loads((package / 'package.json').read_text())['version'] == '0.65.0'
manager = package / 'bundle/chunk-DKZARV6U.js'
manager_hash = hashlib.sha256(manager.read_bytes()).hexdigest()
assert manager_hash in ('c52e6e574c9bd960a60a3a3364351be8eccf1d1236d933d44204ded015047792',
                        '6cb363864dca9a4756e66142b3e30244d59a0702a258c2e5279b87b07ff609b3',
                        '3062c3291a9a49d62177b20b8ef450c50f96a507cd4bdc168969a9dc45764970', '4b4daad35a3af8de066e49d866d14f163502a51234acb10c7c2b76a32213af64', '463cf8af6e9a06f2a1ff7ae2a484fcfa5d8d53f77c604f3e51344e71f3b1ed61', '0c70897032c0ad76419b3149d783567280dfd972ef2c04e258cbebccc9575c42', 'ce32eec6ab27f4d9fbf1449a5bdc70ad9b06fde0aff84b560ac1540a9106a9fa', '236c3faf39cbe2a022409be5ee3ee3147ac1686d146336d0126f6e23f0b465b2', '439a87bb21b7c5f172d959f99629d74637cf847a4ddb9a684dbffa280b7cc68b')
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
session = args.session_identifier or str(uuid.uuid4())
tool_phases = set()
artifact_file = None
artifact_bytes = None
artifact_identity = None
artifact_attack_evidence = []
tool_middle = 'SYNTHETIC-GEMINI-TOOL-MIDDLE'
tool_content = 'SYNTHETIC-GEMINI-TOOL-START\n' + ('x' * 96 + '\n') * 128 + tool_middle + '\n' + ('z' * 96 + '\n') * 128 + 'SYNTHETIC-GEMINI-TOOL-END\n'
blob_data = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6HVkAAAAASUVORK5CYII='


def completions():
    return [record for record in models if record['operation'] == 'streamGenerateContent' and not record.get('tool_call')]


def native_blob_response(contents):
    for turn in contents:
        parts = turn.get('parts', [])
        for index, part in enumerate(parts):
            response = part.get('functionResponse', {})
            if response.get('id') != 'synthetic-artifact-resume' or response.get('name') != 'read_file' or response.get('response', {}).get('output') != 'Binary content provided (1 item(s)).':
                continue
            # Native conversion embeds multimodal parts or returns them directly
            # after this function response. Earlier image parts do not qualify.
            images = response.get('parts', []) or parts[index + 1:index + 2]
            if any(image.get('inlineData', {}) == {'data': blob_data, 'mimeType': 'image/png'} for image in images):
                return True
    return False


synthetic_response = {'functionResponse': {'id': 'synthetic-artifact-resume', 'name': 'read_file', 'response': {'output': 'Binary content provided (1 item(s)).'}}}
synthetic_image = {'inlineData': {'data': blob_data, 'mimeType': 'image/png'}}
assert not native_blob_response([{'parts': [synthetic_image, synthetic_response]}])
assert not native_blob_response([{'parts': [synthetic_response, {'text': 'unrelated'}, synthetic_image]}])
assert native_blob_response([{'parts': [synthetic_response, synthetic_image]}])
assert native_blob_response([{'parts': [{'functionResponse': {**synthetic_response['functionResponse'], 'parts': [synthetic_image]}}]}])


def attack_artifact():
    protected = artifact_file
    if artifact_attack in ('symlink', 'hardlink', 'missing'):
        protected = root / 'protected-tool-output'
        artifact_file.rename(protected)
        if artifact_attack == 'symlink':
            artifact_file.symlink_to(protected)
        elif artifact_attack == 'hardlink':
            os.link(protected, artifact_file)
    elif artifact_attack == 'unsafe-mode':
        artifact_file.chmod(0o644)
    elif artifact_attack == 'invalid-utf8':
        artifact_file.write_bytes(b'\xff')
    elif artifact_attack == 'content-change':
        artifact_file.write_text('SYNTHETIC-REPLACEMENT-OUTPUT')
    elif artifact_attack == 'oversized':
        with artifact_file.open('r+b') as output:
            output.truncate(32 * 1024 * 1024 + 1)
    elif artifact_attack == 'parent-replacement':
        previous = artifact_file.parent
        retired = previous.with_name(previous.name + '-protected')
        previous.rename(retired)
        previous.mkdir(mode=0o700)
        artifact_file.write_text('SYNTHETIC-REPLACEMENT-OUTPUT')
        artifact_file.chmod(0o600)
        protected = retired / artifact_file.name
    else:
        raise AssertionError('Unknown synthetic artifact attack.')
    original = protected.stat()
    artifact_attack_evidence.append((protected, None if artifact_attack == 'oversized' else protected.read_bytes(), (original.st_dev, original.st_ino, original.st_size)))

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
    if tool_mode:
        settings['model']['maxSessionTurns'] = 4
    if args.history_tool_output:
        settings['tools'] = {'truncateToolOutputThreshold': 1024}
        (workspace / 'bounded-output.txt').write_text(tool_content)
    if args.history_blob:
        settings['experimental'] = {'generalistProfile': True}
        (workspace / 'bounded.png').write_bytes(base64.b64decode(blob_data))
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
                                       'prior_response': 'SYNTHETIC-GEMINI-COMPLETE' in content,
                                       'artifact_reference': '/tool-outputs/' in content,
                                       'full_artifact': tool_middle in content,
                                       'blob_reference': '/degraded-blobs/' in content,
                                       'native_blob_response': native_blob_response(payload['request']['contents'])})
                        phase = 'resume' if second_prompt in content else 'initial'
                        if tool_mode and operation == 'streamGenerateContent' and phase not in tool_phases:
                            tool_phases.add(phase)
                            models[-1]['tool_call'] = True
                            if phase == 'resume' and artifact_attack:
                                attack_artifact()
                            if phase == 'initial' and args.history_tool_output:
                                tool = {'name': 'run_shell_command', 'args': {'command': 'cat bounded-output.txt', 'description': 'Read the finite synthetic artifact fixture.'}}
                            else:
                                tool = {'name': 'read_file', 'args': {'file_path': 'bounded.png' if phase == 'initial' else str(artifact_file)}}
                            self.send(200, {'response': {'candidates': [{'index': 0, 'content': {'role': 'model', 'parts': [{'functionCall': {'id': 'synthetic-artifact-' + phase, **tool}}]}, 'finishReason': 'STOP'}], 'modelVersion': 'gemini-2.5-flash'}, 'traceId': 'synthetic-tool-response'}, stream=True)
                            return
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
        if tool_mode:
            flags = ['--approval-mode', 'yolo', *flags]
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
        previous = len(models)
        code, output = invoke(diagnostic, peer_env, ['--resume', session, '--prompt', 'SYNTHETIC-CONCURRENT-ARCHIVE-PEER'])
        evidence = {'peer_refused': code != 0 and 'Gemini canonical conversation history is unavailable or unsafe.' in output,
                    'no_peer_inference': len(models) == previous,
                    'source_present': record.exists(),
                    'prior_bytes_preserved': record.exists() and record.read_bytes().startswith(before),
                    'same_inode': record.exists() and (record.stat().st_dev, record.stat().st_ino) == identity}
        diagnostic.with_suffix('.control.json').write_text(json.dumps(evidence))
        return all(evidence.values())

    if args.shell_history:
        witness = workspace / 'native-shell-witness.txt'
        shell_command = "printf 'SYNTHETIC-SHELL-OUTPUT\\n'; printf 'SYNTHETIC-SHELL-WITNESS' > native-shell-witness.txt"

        def interactive(child_env, prompt, diagnostic, recalled=False, refused=False):
            master, slave = pty.openpty()
            fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
            deadline = time.monotonic() + 45
            output = bytearray()
            try:
                with diagnostic.open('wb') as diagnostics:
                    diagnostic.chmod(0o600)
                    requests_before = len(models)
                    child = subprocess.Popen(['prlimit', '--data=2147483648', '--stack=16777216', '--core=0', '--',
                                              shutil.which('node'), '--max-old-space-size=256', str(native / 'bundle/gemini.js'),
                                              '--model', 'gemini-2.5-flash', '--skip-trust', '--approval-mode', 'yolo',
                                              '--prompt-interactive', prompt],
                                             env={**child_env, 'TERM': 'xterm-256color', 'COLUMNS': '120', 'LINES': '40'},
                                             cwd=workspace, stdin=slave, stdout=slave, stderr=slave, start_new_session=True)
                    children.append(child)
                    os.close(slave)
                    slave = None

                    def pump(seconds=0.1, allow_exit=False):
                        assert time.monotonic() < deadline, 'Finite native Gemini TUI deadline exceeded.'
                        if select.select([master], [], [], seconds)[0]:
                            try:
                                data = os.read(master, 65536)
                            except OSError:
                                data = b''
                            diagnostics.write(data)
                            diagnostics.flush()
                            output.extend(data)
                            assert len(output) <= 1024 * 1024, 'Native TUI diagnostics exceeded their bound.'
                            if b'\x1b[6n' in data:
                                os.write(master, b'\x1b[1;1R')
                        assert allow_exit or child.poll() is None, 'Native TUI exited before its finite command control; inspect diagnostics.'

                    def settle(seconds=0.4, allow_exit=False):
                        until = time.monotonic() + seconds
                        while time.monotonic() < until:
                            pump(max(0, min(0.1, until - time.monotonic())), allow_exit=allow_exit)

                    try:
                        before = len(completions())
                        if refused:
                            refusal = b'Gemini canonical conversation history is unavailable or unsafe.'
                            while refusal not in output and child.poll() is None:
                                pump(allow_exit=True)
                            assert refusal in output, 'Native TUI must report its canonical shell audit refusal.'
                            settle(allow_exit=True)
                            assert len(models) == requests_before, 'Native TUI must refuse unsafe shell history before another inference.'
                            assert not witness.exists(), 'Native TUI must refuse unsafe shell history before shell execution.'
                            return
                        while len(completions()) == before or b'SYNTHETIC-GEMINI-COMPLETE' not in output:
                            pump()
                        settle()
                        os.write(master, b'!')
                        settle()
                        os.write(master, b'\x1b[A' if recalled else shell_command.encode())
                        settle()
                        os.write(master, b'\r')
                        command_deadline = time.monotonic() + 8
                        while (not witness.exists() or witness.read_text() != 'SYNTHETIC-SHELL-WITNESS') and time.monotonic() < command_deadline:
                            pump()
                        assert witness.exists(), ('Fresh native TUI shell navigation must recover the prior command after private-home disposal.' if recalled else 'Healthy native TUI must execute its entered shell command before disposal.')
                        assert witness.read_text() == 'SYNTHETIC-SHELL-WITNESS'
                        settle()
                    finally:
                        stop_process_group(child)
            finally:
                os.close(master)
                if slave is not None:
                    os.close(slave)

        interactive(env, first_prompt, args.diagnostics)
        assert len(completions()) == 1 and completions()[0]['first_prompt']
        protected = None
        if args.shell_history_attack:
            audits = list(history.rglob('prompt-history.json'))
            assert len(audits) == 1
            audit = audits[0]
            protected = audit
            if args.shell_history_attack in ('symlink', 'hardlink'):
                protected = root / 'protected-shell-audit'
                audit.rename(protected)
                if args.shell_history_attack == 'symlink':
                    audit.symlink_to(protected)
                else:
                    os.link(protected, audit)
            elif args.shell_history_attack == 'unsafe-mode':
                audit.chmod(0o644)
            elif args.shell_history_attack == 'malformed':
                audit.write_bytes(b'{')
            elif args.shell_history_attack == 'invalid-utf8':
                audit.write_bytes(b'\xff')
            elif args.shell_history_attack == 'command-schema':
                records = json.loads(audit.read_text())
                next(entry for entry in records if entry['type'] == 'shell-command')['message'] = 'SYNTHETIC\0INVALID'
                audit.write_text(json.dumps(records))
            else:
                with audit.open('r+b') as output:
                    output.truncate(32 * 1024 * 1024 + 1)

            def fingerprint(file):
                info = file.stat()
                digest = hashlib.sha256()
                with file.open('rb') as data:
                    while chunk := data.read(65536):
                        digest.update(chunk)
                return (info.st_dev, info.st_ino, info.st_mode, info.st_nlink, info.st_size, digest.hexdigest())

            original = fingerprint(protected)
        shutil.rmtree(home)
        witness.unlink()
        peer = root / 'shell-peer'
        private_peer = peer / '.gemini'
        private_peer.mkdir(mode=0o700, parents=True)
        (private_peer / 'settings.json').write_text(json.dumps(settings))
        (private_peer / 'settings.json').chmod(0o600)
        peer_env = {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                    'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                    'XDG_CACHE_HOME': str(peer / '.cache')}
        interactive(peer_env, second_prompt, args.diagnostics.with_name(args.diagnostics.stem + '-shell-peer.log'), recalled=True, refused=bool(args.shell_history_attack))
        if args.shell_history_attack:
            assert fingerprint(protected) == original
            assert len(completions()) == 1 and not errors, errors
            print('PASS: actual native TUI refuses unsafe shell history before inference or command execution without changing protected audit data: ' + args.shell_history_attack)
            safe_cleanup = True
            raise SystemExit(0)
        assert len(completions()) == 2 and completions()[1]['second_prompt']
        assert not list(private_peer.rglob('shell_history'))
        assert json.loads(auth.read_text()) == credentials
        assert (auth.stat().st_dev, auth.stat().st_ino) == auth_identity
        assert not errors, errors
        print('PASS: actual native TUI executes a shell command, disposes its private home, recalls and executes the same command in a fresh native TUI.')
        safe_cleanup = True
        raise SystemExit(0)

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
        if args.history_tool_output:
            assert len(models) == 2 and completions()[0]['artifact_reference']
            artifacts = [p for base in (private, history) for p in base.rglob('*.txt') if 'tool-outputs' in p.parts and tool_middle in p.read_text()]
            assert len(artifacts) == 1, 'The actual native tool must first offload its full output.'
            artifact_file = artifacts[0]
            artifact_bytes = artifact_file.read_bytes()
            artifact_identity = (artifact_file.stat().st_dev, artifact_file.stat().st_ino)
            assert tool_content in artifact_bytes.decode()
        if args.history_blob:
            assert len(models) == 2 and completions()[0]['blob_reference'], 'The actual native context pipeline must first degrade the PNG.'
            artifacts = [p for base in (private, history) for p in base.rglob('*') if p.is_file() and 'degraded-blobs' in p.parts and p.read_bytes() == base64.b64decode(blob_data)]
            assert len(artifacts) == 1
            artifact_file = artifacts[0]
            artifact_bytes = artifact_file.read_bytes()
            artifact_identity = (artifact_file.stat().st_dev, artifact_file.stat().st_ino)
            (workspace / 'bounded.png').unlink()
        # The whole native process group has exited before private state disposal.
        shutil.rmtree(home)
        if args.history_tool_output:
            assert artifact_file.exists(), 'Native tool-output history must survive private-home disposal.'
            assert history in artifact_file.parents
            assert artifact_file.read_bytes() == artifact_bytes
            assert (artifact_file.stat().st_dev, artifact_file.stat().st_ino) == artifact_identity
        if args.history_blob:
            assert artifact_file.exists(), 'Native degraded blob history must survive private-home disposal.'
            assert history in artifact_file.parents
            assert artifact_file.read_bytes() == artifact_bytes
            assert (artifact_file.stat().st_dev, artifact_file.stat().st_ino) == artifact_identity
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
        if args.history_blob:
            # Keep the fresh read in the provider request instead of degrading it again.
            settings['experimental'] = {'generalistProfile': False}
        (private / 'settings.json').write_text(json.dumps(settings))
        (private / 'settings.json').chmod(0o600)
        peer_env = {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                    'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                    'XDG_CACHE_HOME': str(peer / '.cache')}
        if args.history_import:
            source = transcripts[0]
            if args.history_import != 'canonical':
                exports = root / 'exports'
                exports.mkdir(mode=0o700)
                source = exports / 'native-export.jsonl'
                shutil.copyfile(transcripts[0], source)
                source.chmod(0o600)
                lines = source.read_text().splitlines()
                metadata = json.loads(lines[0])
                metadata['projectHash'] = '0' * 64
                lines[0] = json.dumps(metadata)
                source.write_text('\n'.join(lines) + '\n')
                if args.history_import == 'legacy-export':
                    messages = {}
                    for record in map(json.loads, lines[1:]):
                        if '$set' in record:
                            assert set(record['$set']) == {'lastUpdated'}
                            metadata.update(record['$set'])
                        else:
                            messages[record['id']] = record
                    source.unlink()
                    source = exports / 'native-export.json'
                    source.write_text(json.dumps({**metadata, 'messages': list(messages.values())}, indent=2))
                    source.chmod(0o600)
            original = source.read_bytes()
            original_identity = (source.stat().st_dev, source.stat().st_ino)
            if args.history_import_attack:
                protected_import = root / 'protected-import'
                source.rename(protected_import)
                attack = args.history_import_attack
                if attack == 'symlink':
                    source.symlink_to(protected_import)
                elif attack == 'hardlink':
                    os.link(protected_import, source)
                else:
                    content = original.decode()
                    if attack == 'malformed':
                        content = '{malformed-native-import\n'
                    elif attack == 'truncated':
                        content += '{"$set":'
                    elif attack in ('schema', 'invalid-session', 'invalid-project'):
                        lines = content.splitlines()
                        metadata = json.loads(lines[0])
                        metadata['sessionId' if attack == 'invalid-session' else 'projectHash'] = 37 if attack == 'invalid-session' else 'invalid' if attack == 'invalid-project' else None
                        lines[0] = json.dumps(metadata)
                        content = '\n'.join(lines) + '\n'
                    source.write_text(content)
                    source.chmod(0o644 if attack == 'unsafe-mode' else 0o600)
                    if attack == 'unsafe-parent':
                        exports.chmod(0o755)
                attacked = source.read_bytes()
                attacked_identity = (source.lstat().st_dev, source.lstat().st_ino)
                existing_records = {p: p.read_bytes() for p in history.rglob('*.jsonl')}
            diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-import.log')
            code, output = invoke(diagnostic, peer_env, ['--session-file', str(source), '--prompt', second_prompt])
            if args.history_import_attack:
                assert code != 0 and len(models) == 1
                assert 'Gemini canonical conversation history is unavailable or unsafe.' in output
                assert protected_import.read_bytes() == original
                assert (protected_import.stat().st_dev, protected_import.stat().st_ino) == original_identity
                assert source.read_bytes() == attacked
                assert (source.lstat().st_dev, source.lstat().st_ino) == attacked_identity
                assert {p: p.read_bytes() for p in history.rglob('*.jsonl')} == existing_records
                assert not list(private.rglob('*.jsonl'))
                assert json.loads(auth.read_text()) == credentials
                assert not errors, errors
                print('PASS: actual native import refuses unsafe input before publication/inference and preserves canonical/protected bytes: ' + args.history_import_attack)
                safe_cleanup = True
                raise SystemExit(0)
            assert code == 0 and len(completions()) == 2, 'An explicit native import must complete against canonical history.'
            assert all(completions()[1][key] for key in ('first_prompt', 'second_prompt', 'prior_response'))
            assert source.read_bytes() == original
            assert (source.stat().st_dev, source.stat().st_ino) == original_identity
            imported = [p for p in history.rglob('*.jsonl') if second_prompt in p.read_text() and '.archive' not in p.parts]
            assert len(imported) == 1
            imported_metadata = json.loads(imported[0].read_text().splitlines()[0])
            imported_session = imported_metadata['sessionId']
            assert imported_session != session
            assert imported_metadata['projectHash'] == hashlib.sha256(str(workspace).encode()).hexdigest()
            assert imported[0].stat().st_mode & 0o777 == 0o600
            assert imported[0].stat().st_nlink == 1
            assert not list(private.rglob('*.jsonl'))
            assert not (private / 'oauth_creds.json').exists()
            assert not (private / 'google_accounts.json').exists()
            shutil.rmtree(peer)
            restored = root / 'import-reader'
            restored.mkdir(mode=0o700)
            restored_private = restored / '.gemini'
            restored_private.mkdir(mode=0o700)
            (restored_private / 'settings.json').write_text(json.dumps(settings))
            (restored_private / 'settings.json').chmod(0o600)
            restored_env = {**env, 'HOME': str(restored), 'GEMINI_CLI_HOME': str(restored),
                            'XDG_CONFIG_HOME': str(restored / '.config'), 'XDG_DATA_HOME': str(restored / '.local/share'),
                            'XDG_CACHE_HOME': str(restored / '.cache')}
            diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-import-list.log')
            code, output = invoke(diagnostic, restored_env, ['--list-sessions'])
            assert code == 0 and imported_session in output
            diagnostic = args.diagnostics.with_name(args.diagnostics.stem + '-import-resume.log')
            code, output = invoke(diagnostic, restored_env, ['--resume', imported_session, '--prompt', third_prompt])
            assert code == 0 and len(completions()) == 3
            assert all(completions()[2][key] for key in ('first_prompt', 'second_prompt', 'third_prompt', 'prior_response'))
            assert source.read_bytes() == original
            assert (source.stat().st_dev, source.stat().st_ino) == original_identity
            assert not list(restored_private.rglob('*.jsonl'))
            assert not errors, errors
            print('PASS: actual native import preserves its source, publishes private canonical history, and resumes all prior content after configuration disposal: ' + args.history_import)
            safe_cleanup = True
            raise SystemExit(0)
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
                requests_before_resume = len(models)
                code, output = invoke(diagnostic, third_env, ['--resume', session, '--prompt', second_prompt])
                if args.history_archive_attack:
                    assert code != 0 and len(models) == requests_before_resume
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
        if artifact_attack:
            assert code != 0 and 'Gemini canonical conversation history is unavailable or unsafe.' in output
            assert len(completions()) == 1 and sum(record['operation'] == 'streamGenerateContent' for record in models) == 3
            assert len(artifact_attack_evidence) == 1 and not errors
            protected, content, identity = artifact_attack_evidence[0]
            current = protected.stat()
            assert (current.st_dev, current.st_ino, current.st_size) == identity
            if content is not None:
                assert protected.read_bytes() == content
            assert not list(private.rglob('degraded-blobs' if args.history_blob else 'tool-outputs'))
            print('PASS: actual native read_file refuses ' + artifact_attack + ' without another model request or artifact mutation.')
            safe_cleanup = True
            raise SystemExit(0)
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
            if args.history_tool_output:
                assert sum(record['operation'] == 'streamGenerateContent' for record in models) == 4 and completions()[1]['artifact_reference'] and completions()[1]['full_artifact'], 'A fresh native peer must read the complete prior tool artifact during resume.'
                assert artifact_file.read_bytes() == artifact_bytes
                assert (artifact_file.stat().st_dev, artifact_file.stat().st_ino) == artifact_identity
                assert not list(private.rglob('tool-outputs'))
                print('PASS: actual native shell offload survives private-home disposal and a fresh native read_file restores its complete content during resume.')
            if args.history_blob:
                assert sum(record['operation'] == 'streamGenerateContent' for record in models) == 4 and completions()[1]['native_blob_response'], 'A fresh native CLI must send the retained PNG in its new read_file response.'
                assert artifact_file.read_bytes() == artifact_bytes
                assert (artifact_file.stat().st_dev, artifact_file.stat().st_ino) == artifact_identity
                assert not list(private.rglob('degraded-blobs'))
                print('PASS: actual native context degradation survives private-home disposal and fresh CLI read_file sends the original PNG to the provider during resume.')
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
