/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../src/hive-manager/cli.sh', import.meta.url));

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'hive-manager-auth-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = { ...process.env, PATH: cwd + ':' + process.env.PATH };
  const executable = (name, body) => writeFileSync(join(cwd, name), '#!/usr/bin/env bash\nset -eu\n' + body + '\n', { mode: 0o700 });
  const run = (args, { input, streamed = false } = {}) => spawnSync('bash', [...(streamed ? ['-s', '--'] : [script]), ...args], { cwd, env, input: streamed ? readFileSync(script) : input, encoding: 'utf8', timeout: 5000 });
  return { executable, run };
}

test('forwards a Claude authorization prompt and stdin through SSH and Docker without a TTY', t => {
  const { executable, run } = fixture(t);
  executable('ssh', ['[[ "$1 $2 $3" == "-T -- hive.example" ]]', 'exec sh -c "$4"'].join('\n'));
  executable('docker', ['[[ "$1 $2 $3 $4 $5" == "exec --user box -i production" ]]', 'shift 5', 'exec "$@"'].join('\n'));
  executable('claude', ['[[ "$# $*" == "2 auth login" && ! -t 0 && ! -t 1 ]]', 'printf "Open https://example.test/authorize\\nPaste authorization code: "', 'IFS= read -r code', '[[ $code == fixture#state ]]', 'printf "Signed in\\n"'].join('\n'));
  const result = run(['--host', 'hive.example', 'deploy', '--name', 'production', 'auth', 'claude'], { input: 'fixture#state\n' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'Open https://example.test/authorize\nPaste authorization code: Signed in\n');
  assert.doesNotMatch(result.stdout + result.stderr, /fixture#state/);
});

test('uses the providers’ login and status commands and propagates native errors', t => {
  const { executable, run } = fixture(t);
  executable('codex', 'printf "%s\\n" "$*"; if [[ "$*" == "login status" ]]; then exit 17; fi');
  executable('gh-setup-git-identity', '[[ $GH_BROWSER == true ]]; printf "%s\\n" "$*"');
  // github-retry-ok: fixture executable only returns its argument list.
  executable('gh', 'printf "%s\\n" "$*"');
  executable('claude', 'printf "%s\\n" "$*"');
  assert.equal(run(['auth', 'codex', 'login'], { streamed: true }).stdout.trim(), 'login --device-auth');
  assert.equal(run(['auth', 'codex', 'status']).status, 17);
  assert.equal(run(['auth', 'claude', 'status']).stdout.trim(), 'auth status');
  assert.equal(run(['auth', 'github']).stdout.trim(), '--web --skip-ssh-key');
  assert.equal(run(['auth', 'github', 'status']).stdout.trim(), 'auth status --hostname github.com');
});

test('handles help and rejects invalid auth arguments before invoking a provider or Docker', t => {
  const { executable, run } = fixture(t);
  executable('claude', 'exit 99');
  executable('docker', 'exit 99');
  const local = run(['auth', '--help']);
  const managed = run(['deploy', 'auth', '--help']);
  assert.equal(local.status, 0, local.stderr);
  assert.equal(managed.status, 0, managed.stderr);
  assert.match(local.stdout, /claude.*codex.*github/);
  assert.equal(managed.stdout, local.stdout);
  assert.match(run(['deploy', 'auth', 'unknown']).stderr, /Unknown auth provider or action/);
  assert.match(run(['auth', 'claude', 'login', '--code', 'fixture']).stderr, /Unexpected auth arguments/);
});
