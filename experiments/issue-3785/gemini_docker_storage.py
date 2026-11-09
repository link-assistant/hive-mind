"""Reuse the complete TLS fixture for actual production-builder Docker peers."""
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time

from native_process_group import stop_process_group


def verify_docker_storage(*, args, package, home, canonical, history, workspace,
                          certificate, managed, settings, env, first_prompt,
                          second_prompt, children, completions, errors):
    launcher = (args.docker_launcher or Path(__file__).resolve().parents[2] / 'src/hive.mjs').resolve(strict=True)
    script = Path(__file__).with_name('verify-gemini-docker-storage.mjs')
    # The ordinary fixture selects a nonexistent managed-settings path. Docker
    # requires an existing file to bind, so preserve the same empty settings.
    managed.write_text('{}')
    managed.chmod(0o600)
    payload = {'launcher': str(launcher), 'nativePackage': str(package),
               'homeDir': str(home), 'canonical': str(canonical),
               'history': str(history), 'workspace': str(workspace),
               'certificate': str(certificate), 'managed': str(managed),
               'settings': settings, 'env': env, 'firstPrompt': first_prompt,
               'secondPrompt': second_prompt,
               'image': os.environ.get('HIVE_MOUNT_TEST_GEMINI_IMAGE', 'node:24-bookworm-slim'),
               'network': args.docker_network or os.environ.get('HIVE_MOUNT_TEST_NETWORK', 'host'),
               'experimental': args.docker_experimental}
    with args.diagnostics.open('wb') as diagnostic:
        args.diagnostics.chmod(0o600)
        child = subprocess.Popen(['prlimit', '--data=2147483648', '--stack=16777216', '--core=0', '--',
                                  shutil.which('node'), '--max-old-space-size=128', str(script)],
                                 env={'PATH': os.environ['PATH'], 'HIVE_MOUNT_TEST_DIAGNOSTICS': os.environ.get('HIVE_MOUNT_TEST_DIAGNOSTICS', '0')},
                                 stdin=subprocess.PIPE, stdout=diagnostic,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        children.append(child)
        child.stdin.write(json.dumps(payload).encode())
        child.stdin.close()
        deadline = time.monotonic() + 240
        try:
            while child.poll() is None:
                assert time.monotonic() < deadline, 'Finite Gemini Docker fixture deadline exceeded.'
                assert os.fstat(diagnostic.fileno()).st_size <= 1024 * 1024, 'Gemini Docker diagnostics exceeded their bound.'
                time.sleep(0.05)
            assert child.returncode == 0, 'Actual native Gemini Docker fixture failed; inspect bounded diagnostics.'
        finally:
            stop_process_group(child)
            # Also reap daemon-owned peers if the finite supervisor killed Node
            # before its own finally block could run. Never delete other tasks.
            record = home.parent / 'docker-peers.json'
            if record.exists():
                peers = json.loads(record.read_text())
                assert isinstance(peers, list) and len(peers) == len(set(peers)) == 3
                assert all(isinstance(name, str) and re.fullmatch(r'hive-gemini-storage-[a-f0-9-]{36}', name) for name in peers)
                docker_env = {'PATH': os.environ['PATH'], 'DOCKER_HOST': 'unix:///var/run/docker.sock'}
                cleanup = subprocess.Popen(['docker', 'rm', '--force', *peers], env=docker_env,
                                           stdout=diagnostic, stderr=subprocess.STDOUT, start_new_session=True)
                children.append(cleanup)
                try:
                    cleanup.wait(timeout=30)
                finally:
                    stop_process_group(cleanup)
                query = ['docker', 'ps', '--all']
                for name in peers:
                    query += ['--filter', f'name=^/{name}$']
                inspection = subprocess.Popen([*query, '--format', '{{.Names}}'], env=docker_env,
                                              stdout=subprocess.PIPE, stderr=diagnostic, start_new_session=True)
                children.append(inspection)
                try:
                    remaining, _ = inspection.communicate(timeout=30)
                    assert inspection.returncode == 0 and not remaining.strip(), 'Gemini Docker peers remain; retain the synthetic fixture.'
                finally:
                    stop_process_group(inspection)
    conversations = completions()
    assert len(conversations) == 4, 'Require root, two Docker peers and a fresh root conversation.'
    assert [record['credential_generation'] for record in conversations] == ['G0', 'G1', 'G2', 'G2']
    assert conversations[0]['first_prompt']
    assert all(record['first_prompt'] and record['second_prompt'] and record['prior_response'] for record in conversations[1:])
    assert not errors, errors
    print('PASS: complete native Gemini root/two-Docker-peer/fresh-root TLS conversations preserve prior user/model content across private-home disposal and G0/G1/G2 parent-backed credential publication; no inference after canonical removal or legacy file retirement.')
