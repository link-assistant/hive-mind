"""Restore caches removed by an inherited tool-home test, without starting a model turn.
This calls the pinned native plugin reconciliation API on the existing installed
plugin set. It never installs a new plugin or prints backend/config/auth data.
"""
import json
import os
import pathlib
import resource
import selectors
import subprocess
import time

binary = pathlib.Path('/home/box/.bun/install/global/node_modules/@openai/codex-linux-x64/vendor/x86_64-unknown-linux-musl/bin/codex')
root = pathlib.Path(os.environ['CODEX_HOME'])
assert root.is_absolute() and (root / 'auth.json').is_file()

def bound():
    resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
    resource.setrlimit(resource.RLIMIT_DATA, (1024 ** 3, 1024 ** 3))

child = subprocess.Popen([str(binary), '-c', 'features.remote_plugin=true', 'app-server'], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, env={**os.environ, 'TOKIO_WORKER_THREADS': '2', 'RUST_LOG': 'off'}, preexec_fn=bound)
watcher = selectors.DefaultSelector()
watcher.register(child.stdout, selectors.EVENT_READ)
remaining = b''
bytes_read = 0
deadline = time.monotonic() + 90

def request(seq, method, params):
    global remaining, bytes_read
    child.stdin.write((json.dumps({'id': seq, 'method': method, 'params': params}) + '\n').encode())
    child.stdin.flush()
    while time.monotonic() < deadline:
        while b'\n' in remaining:
            line, remaining = remaining.split(b'\n', 1)
            message = json.loads(line)
            if message.get('id') == seq:
                if 'error' in message:
                    raise RuntimeError('Native cache recovery request failed; response omitted.')
                return message.get('result')
        if not watcher.select(1):
            continue
        block = os.read(child.stdout.fileno(), 65536)
        if not block:
            raise RuntimeError('Native cache recovery process exited.')
        bytes_read += len(block)
        if bytes_read > 2 * 1024 ** 2:
            raise RuntimeError('Native cache recovery response exceeded fixed bound.')
        remaining += block
    raise RuntimeError('Native cache recovery exceeded its finite deadline.')

try:
    request(1, 'initialize', {'clientInfo': {'name': 'hive_cache_recovery', 'version': '0.0.0'}, 'capabilities': {'experimentalApi': True}})
    child.stdin.write(b'{"method":"initialized","params":{}}\n')
    child.stdin.flush()
    result = request(2, 'plugin/reconcile', {'reason': 'Restore existing cache after isolated-test failure'})
    for key in ['failedRemotePluginIds', 'failedMaterializationRemotePluginIds']:
        if result.get(key):
            raise RuntimeError('Some installed plugin caches could not be restored; identities omitted.')
    print('Native installed-plugin reconciliation completed; changed caches:', len(result.get('changedPlugins', [])))
finally:
    child.kill()
    child.wait()
    watcher.close()

expected = {'pages': '0.1.25', 'plugin-management': '0.1.0', 'sites': '1.1.2', 'work-pets': '0.1.6'}
for name, version in expected.items():
    assert (root / 'plugins/cache/openai-curated-remote' / name / version).is_dir(), 'An original plugin cache is still missing.'
print('Original skill-package versions are present again.')
