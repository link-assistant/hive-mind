/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../src/hive-manager.sh', import.meta.url));
const source = readFileSync(script, 'utf8');

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'hive-manager-test-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = { ...process.env, PATH: `${cwd}:${process.env.PATH}` };
  const executable = (name, body) => {
    const file = join(cwd, name);
    writeFileSync(file, `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o700 });
    return file;
  };
  const run = (args, { stdin, entry = script } = {}) => spawnSync('bash', [entry, ...args], { cwd, input: stdin, env, encoding: 'utf8', timeout: 10000 });
  const standalone = (args, input = source) => spawnSync('bash', ['-s', '--', ...args], { cwd, input, env, encoding: 'utf8', timeout: 10000 });
  return { cwd, executable, run, standalone };
}

test('package and complete streamed script expose the same deployment interface', { timeout: 10000 }, t => {
  const { cwd, run, standalone } = fixture(t);
  const installed = join(cwd, 'hive-manager');
  symlinkSync(script, installed);

  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(pkg.bin['hive-manager'], './src/hive-manager.sh');
  assert.notEqual(statSync(script).mode & 0o111, 0);
  assert.equal(run(['--version'], { entry: installed }).stdout.trim(), pkg.version);

  const downloaded = standalone(['deploy', '--help']);
  assert.equal(downloaded.status, 0, downloaded.stderr);
  assert.match(downloaded.stdout, /prepare[ \t]+Pull/);
  assert.equal(downloaded.stdout, run(['deploy', '--help']).stdout);

  const truncated = standalone(['deploy', '--setup', 'apply'], source.slice(0, -100));
  assert.notEqual(truncated.status, 0);
  assert.doesNotMatch(truncated.stdout, /Deployed/);
});

test('standalone deploy routes exact arguments, stdin and failure through the login shell and OpenSSH options', { timeout: 10000 }, t => {
  const { run, standalone, executable } = fixture(t);
  executable(
    'ssh',
    `printf '%s\\n' "$1" "$2" "$3" "$4" "$5" "$6" "$7" >&2
shift 7
exec /bin/sh -c "$1"`
  );
  executable('docker', `printf '<%s>\\n' "$@"; cat; exit 19`);
  const args = ['--host', 'admin@hive.example', '--jump', 'one,two', '--ssh-option', 'ConnectTimeout=5', 'deploy', 'exec', '--', 'printf', "a 'quote' $(exit 70)", '', 'first\nsecond'];
  const remote = run(args, { stdin: 'forwarded stdin\n' });
  assert.equal(remote.status, 19, remote.stderr);
  assert.equal(remote.stderr, '-J\none,two\n-o\nConnectTimeout=5\n-T\n--\nadmin@hive.example\n');
  assert.equal(remote.stdout, "<exec>\n<--user>\n<box>\n<-i>\n<hive-mind>\n<printf>\n<a 'quote' $(exit 70)>\n<>\n<first\nsecond>\nforwarded stdin\n");
  const piped = standalone(args);
  assert.equal(piped.status, 19, piped.stderr);
  assert.equal(piped.stdout, remote.stdout.replace('forwarded stdin\n', ''));
});

test('deployment profiles resolve target-relative paths, allow CLI overrides and keep secret values out of preview', { timeout: 10000 }, t => {
  const { cwd, run } = fixture(t);
  mkdirSync(join(cwd, 'profile files'));
  writeFileSync(join(cwd, 'profile files', 'instance'), 'name=demo\r\nstate-dir=state folder\nenv-file=bot.env\nvariant=dind');
  const envFile = join(cwd, 'profile files', 'bot.env');
  writeFileSync(envFile, 'TELEGRAM_BOT_TOKEN=example-secret\n', { mode: 0o600 });
  const preview = run(['deploy', '--profile', 'profile files/instance', '--variant', 'plain', '--dry-run', 'apply']);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /^Instance demo\nImage konard\/hive-mind:latest\nState .*profile files\/state folder/m);
  assert.match(preview.stdout, /hive-telegram-bot/);
  assert.doesNotMatch(preview.stdout, /example-secret|--privileged/);

  writeFileSync(join(cwd, 'bad-profile'), 'name=$(touch unexpected)\n');
  const invalid = run(['deploy', '--profile', 'bad-profile', '--setup', '--dry-run', 'apply']);
  assert.notEqual(invalid.status, 0);
  assert.match(invalid.stderr, /Invalid container name/);
  assert.throws(() => statSync(join(cwd, 'unexpected')), { code: 'ENOENT' });
});

test('packaged maintenance commands keep their implementation and backup restores a private copy', { timeout: 30000 }, t => {
  const { cwd, run } = fixture(t);
  const state = join(cwd, 'state');
  const settings = join(state, 'settings file.json');
  mkdirSync(state);
  const configured = run(['configure-claude', '--settings-path', settings]);
  assert.equal(configured.status, 0, configured.stderr);
  assert.equal(run(['configure-claude', '--settings-path', settings, '--verify']).status, 0);

  const archive = join(cwd, 'private backup.tar.gz');
  const backup = run(['deploy', '--state-dir', state, 'backup', '--output', archive]);
  assert.equal(backup.status, 0, backup.stderr);
  chmodSync(settings, 0o600);
  assert.equal(statSync(archive).mode & 0o777, 0o600);
  assert.notEqual(run(['deploy', '--state-dir', state, 'backup', '--output', archive]).status, 0);

  const restore = run(['deploy', '--state-dir', 'restored state', 'restore', '--input', archive]);
  assert.equal(restore.status, 0, restore.stderr);
  assert.deepEqual(readFileSync(join(cwd, 'restored state', 'settings file.json')), readFileSync(settings));
  assert.notEqual(run(['deploy', '--state-dir', 'restored state', 'restore', '--input', archive]).status, 0);
});

test('standalone dispatches maintenance through an available bin and preserves exit status', { timeout: 10000 }, t => {
  const { standalone, executable } = fixture(t);
  executable('hive-models', 'printf "<%s>\\n" "$@"; exit 13');
  const result = standalone(['models', '--tool', 'formal-ai', '--json']);
  assert.equal(result.status, 13, result.stderr);
  assert.equal(result.stdout, '<--tool>\n<formal-ai>\n<--json>\n');
});
