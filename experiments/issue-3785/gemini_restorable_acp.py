"""Bounded actual ACP edit/checkpoint/restore across private-home disposal."""
import json
import os
from pathlib import Path
import select
import shutil
import subprocess
import time

from native_process_group import stop_process_group


class NativeAcp:
    """Use the actual CLI's newline-delimited JSON-RPC transport."""

    def __init__(self, native, workspace, env, diagnostic, permission):
        self.child = None
        self.deadline = time.monotonic() + 45
        self.buffer = bytearray()
        self.total = 0
        self.serial = 0
        self.responses = {}
        self.messages = []
        self.permission = permission
        self.log = diagnostic.open('wb')
        diagnostic.chmod(0o600)
        self.protocol = diagnostic.with_suffix('.protocol.log').open('wb')
        os.chmod(self.protocol.name, 0o600)
        try:
            self.child = subprocess.Popen(
                ['prlimit', '--data=2147483648', '--stack=16777216', '--core=0', '--',
                 shutil.which('node'), '--max-old-space-size=256', str(native / 'bundle/gemini.js'),
                 '--model', 'gemini-2.5-flash', '--skip-trust', '--experimental-acp'],
                env=env, cwd=workspace, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                stderr=self.log, start_new_session=True)
            os.set_blocking(self.child.stdout.fileno(), False)
        except BaseException:
            self.close()
            raise

    def send(self, value):
        data = (json.dumps(value) + '\n').encode()
        assert len(data) <= 65536, 'Finite native ACP request bound exceeded.'
        self.child.stdin.write(data)
        self.child.stdin.flush()

    def pump(self):
        assert time.monotonic() < self.deadline, 'Finite native ACP phase deadline exceeded.'
        assert os.fstat(self.log.fileno()).st_size <= 256 * 1024, 'Native ACP diagnostics exceeded their bound.'
        if select.select([self.child.stdout], [], [], 0.1)[0]:
            data = os.read(self.child.stdout.fileno(), 65536)
            self.total += len(data)
            assert self.total <= 1024 * 1024, 'Native ACP protocol exceeded its bound.'
            self.protocol.write(data)
            self.protocol.flush()
            self.buffer.extend(data)
            while b'\n' in self.buffer:
                line, _, remaining = self.buffer.partition(b'\n')
                self.buffer = bytearray(remaining)
                value = json.loads(line)
                assert value.get('jsonrpc') == '2.0'
                self.messages.append(value)
                if 'method' not in value:
                    assert value['id'] not in self.responses
                    self.responses[value['id']] = value
                elif 'id' in value:
                    assert value['method'] == 'session/request_permission', 'Unexpected native ACP client request.'
                    kind = self.permission(value['params']) or 'allow_once'
                    option = next(option for option in value['params']['options'] if option['kind'] == kind)
                    self.send({'jsonrpc': '2.0', 'id': value['id'], 'result':
                               {'outcome': {'outcome': 'selected', 'optionId': option['optionId']}}})
        assert self.child.poll() is None or self.responses, 'Native ACP exited early; inspect bounded diagnostics.'

    def call(self, method, params, *, allow_error=False):
        self.serial += 1
        request_id = self.serial
        self.deadline = time.monotonic() + 45
        self.send({'jsonrpc': '2.0', 'id': request_id, 'method': method, 'params': params})
        while request_id not in self.responses:
            self.pump()
        response = self.responses.pop(request_id)
        if allow_error and 'error' in response:
            return response
        assert 'error' not in response, 'Native ACP request failed; inspect bounded protocol diagnostics.'
        return response['result']

    def close(self):
        try:
            if self.child is not None:
                stop_process_group(self.child)
                self.child.stdin.close()
                self.child.stdout.close()
        finally:
            self.log.close()
            self.protocol.close()


def verify_acp_lifetime(*, native, root, home, workspace, history, env, settings,
                        diagnostics, models, first_prompt, second_prompt, attack=None, tool='write_file', mode=None):
    witness = workspace / 'native-restorable-witness.txt'
    companion = workspace / 'native-restorable-companion.txt'
    before = 'SYNTHETIC BEFORE NATIVE EDIT 東京\n'
    after = 'SYNTHETIC AFTER NATIVE EDIT café\n'
    witness.write_text(before)
    companion.write_text(before)
    permissions = []
    damaged = None
    refusal = 'Gemini canonical conversation history is unavailable or unsafe.'

    def damage_metadata():
        journals = list(history.rglob('prompt-history.json'))
        assert len(journals) == 1
        journal = journals[0]
        rows = json.loads(journal.read_text())
        row = next(row for row in rows if row['type'] == 'restorable-tool')
        saved = json.loads(row['message'])
        data = json.loads(saved['content'])
        data['history'] = [{'type': 'user', 'id': 'SYNTHETIC INVALID NATIVE HISTORY ID'}]
        saved['content'] = json.dumps(data)
        row['message'] = json.dumps(saved)
        journal.write_text(json.dumps(rows))
        return journal, journal.read_bytes()

    def checkpoints():
        journals = list(history.rglob('prompt-history.json'))
        assert len(journals) <= 1
        rows = json.loads(journals[0].read_text()) if journals else []
        return [json.loads(row['message']) for row in rows if row['type'] == 'restorable-tool']

    def approve(params):
        nonlocal damaged
        assert witness.read_text() == before, 'Native ACP must request approval before editing.'
        permissions.append({'checkpoint_count': len(checkpoints())})
        if attack == 'live-metadata-schema':
            assert permissions[-1]['checkpoint_count'] == 1, 'Require a healthy ACP checkpoint before live damage.'
            damaged = damage_metadata()
        return 'reject_once' if mode == 'cancel' else 'allow_once'

    def initialize(client, *, allow_error=False):
        response = client.call('initialize', {'protocolVersion': 1, 'clientCapabilities': {}}, allow_error=allow_error)
        if allow_error and 'error' in response:
            return False
        assert response['protocolVersion'] == 1 and response['agentCapabilities']['loadSession']
        return True

    def prompt(client, session_id, text, *, allow_error=False):
        return client.call('session/prompt', {'sessionId': session_id, 'prompt': [{'type': 'text', 'text': text}]},
                           allow_error=allow_error)

    client = NativeAcp(native, workspace, env, diagnostics, approve)
    try:
        initialize(client)
        created = client.call('session/new', {'cwd': str(workspace), 'mcpServers': []})
        session_id = created['sessionId']
        if mode == 'autoEdit':
            client.call('session/set_mode', {'sessionId': session_id, 'modeId': 'autoEdit'})
        response = prompt(client, session_id, first_prompt, allow_error=attack == 'live-metadata-schema')
        if attack == 'live-metadata-schema':
            assert witness.read_text() == before, 'Unsafe native ACP metadata must prevent the approved edit.'
            assert len(models) == 1, 'Unsafe native ACP metadata must prevent another inference.'
            assert damaged and damaged[0].read_bytes() == damaged[1]
            assert refusal in json.dumps(client.messages) + diagnostics.read_text()
            print('PASS: actual native ACP refuses the approved edit and further inference after live restore-metadata damage.', flush=True)
            return
        assert response['stopReason'] == 'end_turn'
        if mode == 'cancel':
            assert witness.read_text() == before and companion.read_text() == before
            assert len(permissions) == 1 and permissions[0]['checkpoint_count'] == 1
            assert len(checkpoints()) == 1 and len(models) == 2
            assert any(message.get('params', {}).get('update', {}).get('status') == 'failed' for message in client.messages)
            print('PASS: actual native ACP cancellation preserves the pre-edit checkpoint and leaves both project files unchanged.', flush=True)
            return
        assert witness.read_text() == after and len(permissions) == (0 if mode == 'autoEdit' else 1)
        assert len([row for row in models if row['operation'] == 'streamGenerateContent']) == 2
        print('PASS: actual native ACP approves and completes its real ' + tool + ' edit and inference.', flush=True)
        if 'GEMINI_HISTORY_HOME' not in env:
            assert not list(history.rglob('*')), 'Unselected native ACP must leave canonical history untouched.'
            assert not checkpoints() and permissions[0]['checkpoint_count'] == 0
            assert any(first_prompt in path.read_text() for path in home.rglob('session-*.jsonl'))
            print('PASS: unselected actual native ACP preserves private recording and its original approval/edit behavior.', flush=True)
            return
        saved = checkpoints()
        assert len(saved) == 1 and (mode == 'autoEdit' or permissions[0]['checkpoint_count'] == 1), 'Actual native ACP edits must acknowledge their restorable checkpoint before approval.'
        name = saved[0]['name']
        native_data = json.loads(saved[0]['content'])
        assert native_data['toolCall']['name'] == tool
        assert first_prompt in json.dumps(native_data['clientHistory'])
        if mode == 'list':
            count = len(models)
            for command in ('/restore list', '/restore'):
                offset = len(client.messages)
                assert prompt(client, session_id, command)['stopReason'] == 'end_turn'
                text = '\n'.join(message.get('params', {}).get('update', {}).get('content', {}).get('text', '')
                                 for message in client.messages[offset:])
                assert name.removesuffix('.json') in text and tool in text, 'Actual native ACP checkpoint listings must identify their restorable native filename and tool.'
                assert 'Unknown' not in text
            assert len(models) == count and witness.read_text() == after and companion.read_text() == before
            print('PASS: both actual native ACP restore listings identify the saved native checkpoint and tool without inference or project changes.', flush=True)
            return
    finally:
        client.close()

    companion.write_text(after)
    shutil.rmtree(home)
    peer = root / 'acp-peer-home'
    peer.mkdir(mode=0o700)
    private = peer / '.gemini'
    private.mkdir(mode=0o700)
    (private / 'settings.json').write_text(json.dumps(settings))
    (private / 'settings.json').chmod(0o600)
    peer_env = {**env, 'HOME': str(peer), 'GEMINI_CLI_HOME': str(peer),
                'XDG_CONFIG_HOME': str(peer / '.config'), 'XDG_DATA_HOME': str(peer / '.local/share'),
                'XDG_CACHE_HOME': str(peer / '.cache')}
    if attack == 'startup-metadata-schema':
        damaged = damage_metadata()
    client = NativeAcp(native, workspace, peer_env,
                       diagnostics.with_name(diagnostics.stem + '-peer.log'), approve)
    try:
        if attack == 'startup-metadata-schema':
            journal, corrupt = damaged
            count = len(models)
            try:
                if initialize(client, allow_error=True):
                    client.call('session/load', {'sessionId': session_id, 'cwd': str(workspace), 'mcpServers': []},
                                allow_error=True)
            except AssertionError:
                # A native refusal may exit before returning a JSON-RPC result.
                assert client.child.poll() is not None
            assert refusal in json.dumps(client.messages) + Path(client.log.name).read_text()
            assert len(models) == count and witness.read_text() == after and companion.read_text() == after
            assert journal.read_bytes() == corrupt
            print('PASS: fresh actual native ACP refuses unsafe restore metadata before inference or project changes.', flush=True)
            return
        initialize(client)
        client.call('session/load', {'sessionId': session_id, 'cwd': str(workspace), 'mcpServers': []})
        assert prompt(client, session_id, second_prompt)['stopReason'] == 'end_turn'
        assert models[-1]['first_prompt'] and models[-1]['second_prompt']
        count = len(models)
        audit = {path: path.read_bytes() for path in history.rglob('*.jsonl')
                 if '.archive' not in path.parts and second_prompt in path.read_text()}
        assert len(audit) == 1, 'Identify the actual ACP conversation audit before restore.'
        assert prompt(client, session_id, '/restore ' + name.removesuffix('.json'))['stopReason'] == 'end_turn'
        assert witness.read_text() == before and companion.read_text() == before, 'Fresh native ACP must restore its acknowledged pre-edit checkpoint after private-home disposal.'
        assert len(models) == count, 'Native ACP restore must not make another model request.'
        assert prompt(client, session_id, 'SYNTHETIC-GEMINI-ACP-AFTER-RESTORE')['stopReason'] == 'end_turn'
        assert models[-1]['first_prompt'] and not models[-1]['second_prompt'], 'Native ACP restore must update the actual subsequent model history.'
        assert len(checkpoints()) == 1, 'Native ACP restore must preserve acknowledged checkpoint generations.'
        assert all(path.read_bytes().startswith(content) for path, content in audit.items()), 'Native ACP restore must retain the prior conversation audit.'
        print('PASS: actual fresh native ACP restores its Git snapshot and model history after complete private-home disposal.', flush=True)
    finally:
        client.close()

    shutil.rmtree(peer)
    final_home = root / 'acp-after-restore-home'
    final_private = final_home / '.gemini'
    final_private.mkdir(parents=True, mode=0o700)
    (final_private / 'settings.json').write_text(json.dumps(settings))
    (final_private / 'settings.json').chmod(0o600)
    final_env = {**peer_env, 'HOME': str(final_home), 'GEMINI_CLI_HOME': str(final_home),
                 'XDG_CONFIG_HOME': str(final_home / '.config'), 'XDG_DATA_HOME': str(final_home / '.local/share'),
                 'XDG_CACHE_HOME': str(final_home / '.cache')}
    client = NativeAcp(native, workspace, final_env,
                       diagnostics.with_name(diagnostics.stem + '-reopen.log'), approve)
    try:
        initialize(client)
        client.call('session/load', {'sessionId': session_id, 'cwd': str(workspace), 'mcpServers': []})
        assert prompt(client, session_id, 'SYNTHETIC-GEMINI-ACP-REOPEN-RESTORE')['stopReason'] == 'end_turn'
        assert models[-1]['first_prompt'] and not models[-1]['second_prompt'], 'A fresh native ACP must resume the restored model history.'
        assert len(checkpoints()) == 1
        assert all(path.read_bytes().startswith(content) for path, content in audit.items())
        print('PASS: a third actual native ACP resumes the restored model history while retaining the complete prior audit.', flush=True)
        if mode == 'autoEdit':
            print('PASS: actual native ACP automatic edit mode uses the same acknowledged pre-edit snapshot without an approval request.', flush=True)
    finally:
        client.close()
