/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { classifyUpload } from '../src/hive-manager-task-check-uploads.mjs';
import { readProxyMatrix, runProxyMatrix, runProxyProbe } from '../src/hive-manager-proxy-test.mjs';

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
  const run = (args, { stdin, entry = script, environment = {} } = {}) => spawnSync('bash', [entry, ...args], { cwd, input: stdin, env: { ...env, ...environment }, encoding: 'utf8', timeout: 10000 });
  const standalone = (args, input = source) => spawnSync('bash', ['-s', '--', ...args], { cwd, input, env, encoding: 'utf8', timeout: 10000 });
  return { cwd, executable, run, standalone };
}

test('deploy diagnose reads bounded service and memory journal evidence for a missing container', t => {
  const { executable, run } = fixture(t);
  executable('docker', 'if [[ "$1" == info ]]; then printf "Docker fixture\\n"; else exit 1; fi');
  executable('journalctl', 'printf "<%s>\\n" "$@"; if [[ "$1" == _TRANSPORT=kernel ]]; then exit 1; fi');
  const result = run(['deploy', '--name', 'missing', 'diagnose', '--since', '1 hour ago']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Docker fixture\nContainer unavailable: missing/);
  assert.match(result.stdout, /<--unit=docker\.service>\n<--since=1 hour ago>\n<--lines=80>/);
  assert.match(result.stdout, /<_TRANSPORT=kernel>\n<--since=1 hour ago>\n<--lines=80>/);
});

test('deploy diagnose uses the selected task attempt window and shows browser resource evidence', t => {
  const { executable, run } = fixture(t);
  const id = '40950000-0000-4000-a000-000000000001';
  executable('$', `printf '%s\\n' '{"executions":[{"uuid":"${id}","status":"executing","attempt":{"number":2},"attemptHistory":[{"number":1,"status":"executed","startedAt":"2026-11-20T08:00:00Z","endTime":"2026-11-20T08:15:00Z"}]}]}'`);
  executable(
    'docker',
    `case "$1 $2" in
  'exec --user')
    [[ "$3 $4 $5" == 'box hive-mind hive-manager' ]]
    shift 5
    [[ "$*" == 'tasks report --window ${id} --attempt 1' ]]
    "$MANAGER_TEST" "$@" ;;
  'container inspect') printf 'true\\n' ;;
  'top hive-mind') printf 'PID PPID STAT CPU WCHAN COMMAND\\n101 1 S 1.0 futex_wait chromium\\n102 1 R 0.5 - unrelated\\n' ;;
  'exec hive-mind')
    if [[ "$3" == df ]]; then printf 'shm 64M /dev/shm\\n'; else printf 'cpu.stat\\n'; fi ;;
  *) printf 'Docker fixture\\n' ;;
esac`
  );
  executable('journalctl', 'printf "<%s>\\n" "$@"');
  const window = ['--since=2026-11-20T08:00:00.000Z', '--until=2026-11-20T08:15:00.000Z'];
  const result = run(['deploy', 'diagnose', '--task', id, '--attempt', '1', '--resources'], { environment: { MANAGER_TEST: script } });
  assert.equal(result.status, 0, result.stderr);
  for (const argument of window) assert.equal(result.stdout.split(argument).length - 1, 2);
  assert.match(result.stdout, /Browser processes[^]*chromium\nMatching browser processes: 1\nshm 64M \/dev\/shm/);
  assert.match(run(['deploy', 'diagnose', '--task', id, '--since', 'now']).stderr, /Usage: deploy diagnose/);
});

test('deployment releases the fallback lock when flock is unavailable', t => {
  const { cwd, executable, run } = fixture(t);
  for (const command of ['bash', 'cat', 'id', 'mkdir', 'rmdir']) {
    const lookup = spawnSync('bash', ['-c', 'command -v "$1"', 'command-path', command], { encoding: 'utf8' });
    assert.equal(lookup.status, 0, lookup.stderr);
    symlinkSync(lookup.stdout.trim(), join(cwd, command));
  }
  executable('docker', '[[ "$*" == "stop hive-mind" ]]');
  const runtime = join(cwd, 'runtime folder');
  const lock = join(runtime, `hive-manager-${process.getuid()}`, 'hive-mind.lock');
  const environment = { PATH: cwd, XDG_RUNTIME_DIR: runtime };
  for (let attempt = 0; attempt < 2; attempt++) {
    const stopped = run(['deploy', 'stop'], { environment });
    assert.equal(stopped.status, 0, stopped.stderr);
    assert.throws(() => statSync(lock), { code: 'ENOENT' });
  }
  mkdirSync(lock);
  const locked = run(['deploy', 'stop'], { environment });
  assert.equal(locked.status, 1);
  assert.match(locked.stderr, /is locked at/);
  assert.ok(statSync(lock).isDirectory());
});

test('Docker live restore validates, reloads and restores the previous configuration on failure', { timeout: 10000 }, t => {
  const { cwd, executable, run } = fixture(t);
  const config = join(cwd, 'daemon.json');
  const entry = join(cwd, 'manager');
  writeFileSync(entry, source.replace('/etc/docker/daemon.json', config).replace('(( EUID == 0 )) || fail "Run with root privileges', '(( EUID == UID )) || fail "Run with root privileges'));
  const oldConfig = '{"debug":true,"live-restore":false}\n';
  writeFileSync(config, oldConfig, { mode: 0o640 });
  executable('docker', 'printf "%s\\n" "$(cat "${FIXTURE}/daemon-status")"');
  executable('jq', 'node -e \'const fs = require("node:fs"); const data = JSON.parse(fs.readFileSync(process.argv[1])); data["live-restore"] = true; console.log(JSON.stringify(data));\' "$3"');
  executable('dockerd', '[[ "$1" == --config-file && "$3" == --validate ]]; grep -q \'"live-restore":true\' "$2"');
  executable(
    'systemctl',
    `case "$1" in
    is-active) exit 0 ;;
    show) printf '%s\\n' '/usr/bin/dockerd -H fd://' ;;
    reload)
      if [[ \${FAIL_RELOAD:-0} == 1 ]] && grep -q '"live-restore":true' "$FIXTURE/daemon.json"; then exit 1; fi
      if grep -q '"live-restore":true' "$FIXTURE/daemon.json"; then printf 'true\\n'; else printf 'false\\n'; fi > "$FIXTURE/daemon-status" ;;
    *) exit 99 ;;
  esac`
  );
  writeFileSync(join(cwd, 'daemon-status'), 'false\n');
  const options = { entry, environment: { FIXTURE: cwd, XDG_RUNTIME_DIR: cwd } };
  const args = ['deploy', 'docker-service', 'live-restore'];
  assert.match(run(args, options).stdout, /live restore is disabled/);
  assert.equal(readFileSync(config, 'utf8'), oldConfig);
  const failed = run([...args, '--apply'], { ...options, environment: { ...options.environment, FAIL_RELOAD: '1' } });
  assert.notEqual(failed.status, 0);
  assert.match(failed.stderr, /Restored the previous configuration/);
  assert.equal(readFileSync(config, 'utf8'), oldConfig);
  const applied = run([...args, '--apply'], options);
  assert.equal(applied.status, 0, applied.stderr);
  assert.match(applied.stdout, /Enabled Docker live restore by reloading/);
  assert.deepEqual(JSON.parse(readFileSync(config)), { debug: true, 'live-restore': true });
  assert.equal(statSync(config).mode & 0o777, 0o640);
  assert.match(run([...args, '--apply'], options).stdout, /live restore is enabled/);
});

test('proxy matrices continue after a failing route and omit secrets from results', async t => {
  const { cwd } = fixture(t);
  const file = join(cwd, 'routes.json');
  const secret = '12'.repeat(16);
  writeFileSync(join(cwd, 'proxy.secret'), `${secret}\n`, { mode: 0o600 });
  writeFileSync(
    file,
    JSON.stringify([
      { name: 'direct', direct: true },
      { name: 'failing', host: 'test.example', port: 9443, secretFile: 'proxy.secret' },
      { name: 'alternate', host: '2001:db8::1', secretFile: 'proxy.secret' },
    ])
  );
  const routes = await readProxyMatrix(file);
  assert.deepEqual(routes.get('alternate'), { host: '2001:db8::1', port: 443, secret: `dd${secret}` });
  const attempts = [];
  const results = await runProxyMatrix(
    routes,
    route => {
      let message;
      return {
        async connect() {
          attempts.push(route?.host ?? 'direct');
          if (route?.port === 9443) throw new Error(secret);
        },
        async checkAuthorization() {
          return true;
        },
        async sendMessage(_entity, options) {
          message = options.message;
          return { id: 1 };
        },
        async getMessages() {
          return [{ id: 1, message }];
        },
        async deleteMessages() {},
        async destroy() {},
      };
    },
    { timeout: 1 }
  );
  assert.deepEqual(attempts, ['direct', 'test.example', '2001:db8::1']);
  assert.deepEqual(
    results.map(({ name, ok }) => [name, ok]),
    [
      ['direct', true],
      ['failing', false],
      ['alternate', true],
    ]
  );
  assert.match(results[1].error, /connection failed/);
  assert.ok(!JSON.stringify(results).includes(secret));
  writeFileSync(file, JSON.stringify([{ name: 'direct', direct: true, port: 443 }]));
  await assert.rejects(readProxyMatrix(file), /cannot specify proxy options/);
});

test('recovers pending queue requests using the previous and current verbose logs', { timeout: 10000 }, t => {
  const { cwd, run } = fixture(t);
  const previous = join(cwd, 'previous.log');
  const current = join(cwd, 'current.log');
  const startup = '/queue: SolveQueue initialized with separate tool queues';
  const enqueue = (id, number) => `/queue: Enqueued: [solve-${id}] https://github.com/acme/thing/issues/${number} (queued) to codex queue, queue length: 1`;
  const event = (action, id, number) => `/queue: ${action}: [solve-${id}] https://github.com/acme/thing/issues/${number} (waiting)`;
  const log = (path, lines) => writeFileSync(path, lines.map(line => `2026-11-20T10:05:00.000000000Z [VERBOSE] ${line}\n`).join(''));
  log(previous, [startup, enqueue('old', 1), startup, '/codex raw text: /codex https://github.com/acme/thing/issues/2 --model small', enqueue('pending', 2), enqueue('started', 3), event('Starting', 'started', 3), enqueue('cancelled', 4), event('Cancelled queued item', 'cancelled', 4), enqueue('rejected', 5), event('Rejected queued item', 'rejected', 5), enqueue('requeued', 6), enqueue('direct', 7), `${event('Waiting for dependencies', 'waiting', 8)} to codex queue`, `${event('Waiting for dependencies', 'failed', 9)} to codex queue`, event('Failed waiting item', 'failed', 9), `${event('Waiting for dependencies', 'released', 10)} to codex queue`, enqueue('released', 10), enqueue('older-current', 11)]);
  log(current, [startup, enqueue('old', 11), startup, enqueue('new', 6), '/queue: Starting directly: https://github.com/ACME/thing/issues/7']);
  const args = ['tasks', 'recover-queue', '--previous', previous, '--current', current];
  const result = run(args);
  assert.equal(result.status, 0, result.stderr);
  const { pending, comparedCurrentRun } = JSON.parse(result.stdout);
  assert.equal(comparedCurrentRun, true);
  assert.deepEqual(
    pending.map(entry => [entry.id, entry.waitingForDependencies]),
    [
      ['solve-pending', false],
      ['solve-waiting', true],
      ['solve-released', false],
      ['solve-older-current', false],
    ]
  );
  assert.ok(pending.every(entry => !('command' in entry)));
  assert.equal(JSON.parse(run([...args, '--include-commands']).stdout).pending[0].command, '/codex https://github.com/acme/thing/issues/2 --model small');
  log(current, [enqueue('partial', 2)]);
  assert.match(run(args).stderr, /needs the verbose queue startup line/);
});

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

  // The image provides a standalone copy on PATH alongside the package's hive link.
  const copied = join(cwd, 'image-manager');
  writeFileSync(copied, source, { mode: 0o700 });
  symlinkSync(fileURLToPath(new URL('../src/hive.mjs', import.meta.url)), join(cwd, 'hive'));
  assert.equal(run(['--version'], { entry: copied }).stdout.trim(), pkg.version);
  assert.match(run(['audit-config', '--help'], { entry: copied }).stdout, /Audit global agent settings/);

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

test('task inspection and recovery preserve start-command arguments locally and in the instance', { timeout: 10000 }, t => {
  const { run, executable } = fixture(t);
  executable('$', 'printf "<%s>\\n" "$@"');
  executable('docker', 'printf "<%s>\\n" "$@"');
  const list = run(['tasks', 'list', '--running']);
  assert.equal(list.status, 0, list.stderr);
  assert.equal(list.stdout, '<--list>\n<--running>\n');
  const resume = run(['deploy', 'tasks', 'resume', 'task-id', '--', 'echo', 'two words']);
  assert.equal(resume.status, 0, resume.stderr);
  assert.equal(resume.stdout, '<exec>\n<--user>\n<box>\n<-i>\n<hive-mind>\n<$>\n<--resume>\n<task-id>\n<-->\n<echo>\n<two words>\n');
  const cleanup = run(['tasks', 'cleanup-dry-run', 'task-id']);
  assert.equal(cleanup.stdout, '<--cleanup-dry-run>\n<task-id>\n');
  const report = run(['deploy', 'tasks', 'report']);
  assert.equal(report.stdout, '<exec>\n<--user>\n<box>\n<-i>\n<hive-mind>\n<hive-manager>\n<tasks>\n<report>\n');
  const uploads = run(['deploy', 'tasks', 'check-uploads', '--minutes', '45']);
  assert.equal(uploads.stdout, '<exec>\n<--user>\n<box>\n<-i>\n<hive-mind>\n<hive-manager>\n<tasks>\n<check-uploads>\n<--minutes>\n<45>\n');
});

test('task report counts states and keeps command lines and paths out of its output', { timeout: 10000 }, t => {
  const { run, executable } = fixture(t);
  executable(
    '$',
    `[[ "$*" == '--list --output-format json' ]]
cat <<'RECORDS'
{"executions":[
  {"status":"executing"},
  {"status":"executing","paused":true},
  {"status":"executed","exitCode":0,"uuid":"recovered","attempt":{"number":2},"attemptHistory":[{"number":1,"status":"executed","exitCode":137,"oomKilled":true,"finishedAt":"2026-11-20T10:00:00Z"},{"number":2,"status":"executed","exitCode":1}]},
  {"status":"executed","exitCode":137,"uuid":"first","oomKilled":true,"exitReason":"out-of-memory","command":"secret argument","logPath":"/private/log"},
  {"status":"executed","exitCode":1,"uuid":"second","exitReason":"API_TOKEN=SYNTHETIC_TEST_TOKEN_123456"},
  {"status":"executed","exitCode":null}
]}
RECORDS`
  );
  const result = run(['tasks', 'report', '--limit', '1']);
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(result.stdout, /secret argument|private\/log/);
  assert.deepEqual(JSON.parse(result.stdout), {
    counts: { running: 1, paused: 1, succeeded: 1, failed: 2, unknown: 1 },
    failures: [{ id: 'first', exitCode: 137, finishedAt: null, memoryExhausted: true, reason: 'out-of-memory' }],
  });
  const details = run(['tasks', 'report']);
  assert.equal(details.status, 0, details.stderr);
  assert.doesNotMatch(details.stdout, /SYNTHETIC_TEST_TOKEN_123456/);
  assert.equal(JSON.parse(details.stdout).failures[1].reason, 'API_TOKEN=SYN…456');
  const grouped = run(['tasks', 'report', '--group', '--limit', '1']);
  assert.equal(grouped.status, 0, grouped.stderr);
  assert.doesNotMatch(grouped.stdout, /secret argument|private\/log/);
  assert.deepEqual(JSON.parse(grouped.stdout), {
    groups: [{ backend: 'local', kind: 'Memory exhaustion', exitCode: 137, count: 2, latest: { id: 'recovered', attempt: 1, finishedAt: '2026-11-20T10:00:00.000Z' } }],
  });
});

test('failed-task recovery previews only confirmed memory failures with an idle task family', { timeout: 10000 }, t => {
  const { cwd, run, executable } = fixture(t);
  const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const task = (n, issue = n, patch = {}) => ({
    uuid: id(n),
    command: `cd /fixture; exec 'solve' 'https://github.com/test/repo/issues/${issue}' --token fixture-secret`,
    status: 'executed',
    exitCode: 137,
    oomKilled: true,
    startTime: `2026-11-${String(n).padStart(2, '0')}T01:00:00Z`,
    options: { rootSession: `task-${n}`, isolated: 'docker', isolationMode: 'detached' },
    ...patch,
  });
  const records = [task(1), task(2), task(3, 2, { exitCode: 0, oomKilled: false }), task(4), task(5, 5, { oomKilled: false }), task(6, 6, { options: { ...task(6).options, resumeCount: 1 } }), task(7), task(8, 7, { status: 'executing', command: 'solve https://github.com/Test/Repo/issues/7' })];
  executable(
    '$',
    `if [[ $1 == --resume ]]; then printf '%s\n' "$2" >> invoked; exit; fi
[[ "$*" == '--list --output-format json' ]]
if [[ \${COMPLETE_RETRY:-false} == true && -f invoked ]]; then
  printf '%s\\n' '${JSON.stringify({ executions: [{ ...records[0], attempt: { number: 3 }, attemptHistory: [{ number: 2, status: 'executed', exitCode: 0 }] }] })}'
  exit
fi
cat <<'RECORDS'
${JSON.stringify({ executions: records })}
RECORDS`
  );
  executable('docker', '[[ $1 == ps ]]; printf "task-4-resume-1\\ttask-4\\t%s\\n" ' + id(4));
  const environment = { HIVE_MIND_STATE_DIR: join(cwd, 'state') };
  const preview = run(['tasks', 'recover-failed'], { environment });
  assert.equal(preview.status, 0, preview.stderr);
  assert.doesNotMatch(preview.stdout, /fixture-secret|test\/repo/);
  assert.deepEqual(JSON.parse(preview.stdout), { mode: 'preview', candidates: [{ id: id(1), exitCode: 137, finishedAt: null }], outcomes: [] });
  assert.throws(() => readFileSync(join(cwd, 'invoked')), { code: 'ENOENT' });

  const applied = run(['tasks', 'recover-failed', '--apply'], { environment });
  assert.equal(applied.status, 0, applied.stderr);
  assert.deepEqual(JSON.parse(applied.stdout).outcomes, [{ id: id(1), state: 'resumed' }]);
  assert.equal(readFileSync(join(cwd, 'invoked'), 'utf8').trim(), id(1));
  writeFileSync(join(cwd, 'invoked'), '');
  const pending = run(['tasks', 'recover-failed', '--apply', '--wait', '1'], { environment });
  assert.equal(pending.status, 1, pending.stderr);
  assert.deepEqual(JSON.parse(pending.stdout).outcomes, [{ id: id(1), state: 'resumed', completion: null }]);
  rmSync(join(cwd, 'invoked'));
  const monitored = run(['tasks', 'recover-failed', '--apply', '--wait', '1'], { environment: { ...environment, COMPLETE_RETRY: 'true' } });
  assert.equal(monitored.status, 0, monitored.stderr);
  assert.deepEqual(JSON.parse(monitored.stdout).outcomes, [{ id: id(1), state: 'resumed', completion: { attempt: 2, exitCode: 0, finishedAt: null } }]);
});

test('upload diagnostics distinguish CPU stalls from progress and guard termination', { timeout: 10000 }, t => {
  const { run } = fixture(t);
  const baseline = { pid: 100, command: 'gh-upload-log', started: 10000, ticks: 200, io: { read: 20n, written: 30n } };
  const observation = { ...baseline, ticks: 390 };
  const thresholds = { ticksPerSecond: 100, seconds: 2, uptime: 1900, minutes: 30, percent: 80 };
  assert.deepEqual(classifyUpload(baseline, observation, thresholds), { pid: 100, command: 'gh-upload-log', ageSeconds: 1800, cpuPercent: 95, ioProgress: false, stalled: true });
  for (const ongoing of [
    { ...observation, io: { read: 21n, written: 30n } },
    { ...observation, io: null },
    { ...observation, ticks: 250 },
  ]) {
    assert.equal(classifyUpload(baseline, ongoing, thresholds).stalled, false);
  }
  assert.equal(classifyUpload(baseline, observation, { ...thresholds, uptime: 1000 }).stalled, false);
  assert.equal(classifyUpload(baseline, { ...observation, started: 10001 }, thresholds), null);
  assert.match(run(['tasks', 'check-uploads', '--help']).stdout, /Inspect same-user Linux log upload processes/);
  if (process.platform === 'linux') {
    const unrelated = run(['tasks', 'check-uploads', '--terminate', String(process.pid)]);
    assert.equal(unrelated.status, 1);
    assert.match(unrelated.stderr, /was not confirmed stalled/);
    assert.deepEqual(JSON.parse(unrelated.stdout), { uploads: [], terminated: null });
  }
});

test('task incidents publish reviewed historical evidence and keep retries idempotent', { timeout: 30000 }, t => {
  const { cwd, run, executable } = fixture(t);
  const id = '40950000-0000-4000-a000-000000000001';
  executable('$', `printf '%s\\n' '${JSON.stringify({ executions: [{ uuid: id, status: 'executing', attempt: { number: 2 }, options: { isolated: 'docker' }, attemptHistory: [{ number: 1, status: 'executed', exitCode: 137, oomKilled: true, logPath: '/private/log', command: 'secret command' }] }] })}'`);
  // github-retry-ok: the test writes a fake gh executable and touches only fixture files.
  executable(
    'gh',
    `
case "$1 $2" in
  'api --hostname')
    case "$6" in
      search/issues) printf '[{"incomplete_results":false,"items":[]}]\\n' ;;
      repos/example/project/issues/18) printf '{"number":18,"state":"%s"}\\n' "\${ISSUE_STATE:-open}" ;;
      repos/example/project/issues/18/comments*) printf '[[]]\\n' ;;
      *) exit 1 ;;
    esac ;;
  'issue create') printf 'created\\n' >> called; printf 'https://github.com/example/project/issues/17\\n' ;;
  'issue comment') [[ $3 == 18 ]]; printf 'commented\\n' >> called; printf 'https://github.com/example/project/issues/18#issuecomment-19\\n' ;;
  *) exit 1 ;;
esac`
  );
  const environment = { HIVE_MIND_STATE_DIR: join(cwd, 'state') };
  const args = ['tasks', 'report', '--incident', id, '--destination', 'example/project'];
  assert.match(run(args, { environment }).stderr, /no confirmed failed exit/);
  const past = [...args, '--attempt', '1'];
  const preview = run(past, { environment });
  assert.equal(preview.status, 0, preview.stderr);
  const { digest, title, body } = JSON.parse(preview.stdout);
  assert.match(title, /attempt 1/);
  assert.match(body, /Memory exhaustion/);
  assert.doesNotMatch(body, /private\/log|secret command/);
  assert.throws(() => statSync(join(cwd, 'called')), { code: 'ENOENT' });
  assert.match(run([...past, '--publish', 'a'.repeat(64)], { environment }).stderr, /changed since review/);
  const applied = [...past, '--publish', digest];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = run(applied, { environment });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout.trim(), 'https://github.com/example/project/issues/17');
  }
  assert.equal(readFileSync(join(cwd, 'called'), 'utf8'), 'created\n');
  const followUp = [...past, '--follow-up', '18'];
  const followUpPreview = run(followUp, { environment });
  assert.equal(followUpPreview.status, 0, followUpPreview.stderr);
  const reviewed = JSON.parse(followUpPreview.stdout);
  assert.equal(reviewed.followUp, 18);
  assert.notEqual(reviewed.digest, digest);
  assert.match(run([...followUp, '--publish', reviewed.digest], { environment: { ...environment, ISSUE_STATE: 'closed' } }).stderr, /requires an open GitHub issue/);
  for (let attempt = 0; attempt < 2; attempt++) {
    const comment = run([...followUp, '--publish', reviewed.digest], { environment });
    assert.equal(comment.status, 0, comment.stderr);
    assert.equal(comment.stdout.trim(), 'https://github.com/example/project/issues/18#issuecomment-19');
  }
  assert.equal(readFileSync(join(cwd, 'called'), 'utf8'), 'created\ncommented\n');
});

test('archive-session writes redacted output only after sanitization and rejects non-files', { timeout: 30000 }, t => {
  const { cwd, run } = fixture(t);
  const token = `ghp_${'abcdefghij'.repeat(4)}`;
  writeFileSync(join(cwd, 'session.jsonl'), `${JSON.stringify({ message: 'test session', token })}\n`);
  const archived = run(['archive-session', 'session.jsonl']);
  assert.equal(archived.status, 0, archived.stderr);
  assert.notEqual(JSON.parse(archived.stdout).token, token);
  assert.equal(JSON.parse(archived.stdout).message, 'test session');
  const invalid = run(['archive-session', '.']);
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout, '');
});

test('archive-sessions stages only public, attributable, inactive sessions with sanitized contents', { timeout: 30000 }, t => {
  const { cwd, executable, run } = fixture(t);
  // github-retry-ok: This creates the fake GitHub CLI for the fixture.
  executable(
    'gh',
    `[[ "$*" == 'api --hostname github.com repos/example/project --jq .visibility' ]]
if [[ \${FAIL_DURING_ARCHIVE:-} && -d staged ]]; then exit 1; fi
printf '%s\\n' "\${REPO_VISIBILITY:-public}"`
  );
  const checkout = join(cwd, 'checkout');
  executable(
    'git',
    `[[ "$1" == -C && "$2" == ${JSON.stringify(checkout)} ]]
printf '%s\\n' 'git@github.com:example/project.git'`
  );
  executable('conversation', '[[ "$1" == import && ( "$2" == claude || "$2" == codex ) ]]; cp -- "$3" "$4"');
  mkdirSync(join(cwd, 'claude', 'project'), { recursive: true });
  mkdirSync(join(cwd, 'codex'));
  const old = new Date(Date.now() - 60 * 60 * 1000);
  const token = `ghp_${'abcdefghij'.repeat(4)}`;
  const writeSession = (file, fields, inactive = true) => {
    writeFileSync(file, `${JSON.stringify(fields)}\n`);
    if (inactive) utimesSync(file, old, old);
  };
  const codex = url => ({ type: 'session_meta', payload: { git: { repository_url: url } }, token });
  writeSession(join(cwd, 'claude', 'project', 'closed.jsonl'), { cwd: checkout, message: 'Claude', token });
  const resultsDir = join(cwd, 'claude', 'project', 'closed', 'tool-results');
  mkdirSync(resultsDir, { recursive: true });
  writeSession(join(resultsDir, 'result.jsonl'), { cwd: checkout, message: 'attached tool result', token, details: 'Booking reference: ZQ7RF9' });
  writeSession(join(resultsDir, 'active.json'), { token }, false);
  writeSession(join(resultsDir, 'ignored.bin'), { token });
  symlinkSync('result.jsonl', join(resultsDir, 'ignored.jsonl'));
  const subagents = join(cwd, 'claude', 'project', 'closed', 'subagents');
  mkdirSync(subagents);
  writeSession(join(subagents, 'agent-inherited.jsonl'), { message: 'subagent', token });
  writeSession(join(subagents, 'agent-unattributed.jsonl'), { cwd: '/other/checkout', message: 'unattributed', token });
  writeSession(join(cwd, 'codex', 'public.jsonl'), codex('https://github.com/example/project.git'));
  writeSession(join(cwd, 'codex', 'private.jsonl'), codex('https://github.com/example/private'));
  writeSession(join(cwd, 'codex', 'active.jsonl'), codex('https://github.com/example/project'), false);
  symlinkSync('public.jsonl', join(cwd, 'codex', 'symlink.jsonl'));

  const args = ['archive-sessions', '--repo', 'example/project', '--output', 'staged', '--claude-dir', 'claude', '--codex-dir', 'codex'];
  assert.notEqual(run(args, { environment: { REPO_VISIBILITY: 'private' } }).status, 0);
  assert.throws(() => statSync(join(cwd, 'staged')), { code: 'ENOENT' });
  assert.notEqual(run(args, { environment: { FAIL_DURING_ARCHIVE: '1' } }).status, 0);
  assert.throws(() => statSync(join(cwd, 'staged')), { code: 'ENOENT' });

  const result = run([...args, '--lino', '--tool-results']);
  assert.equal(result.status, 0, result.stderr);
  const manifest = JSON.parse(readFileSync(join(cwd, 'staged', 'manifest.json'), 'utf8'));
  assert.deepEqual(
    manifest.sessions.map(session => session.tool),
    ['claude', 'claude', 'codex']
  );
  for (const { archive, linksNotation } of manifest.sessions) {
    assert.notEqual(JSON.parse(readFileSync(join(cwd, 'staged', archive), 'utf8')).token, token);
    assert.notEqual(JSON.parse(readFileSync(join(cwd, 'staged', linksNotation), 'utf8')).token, token);
  }
  const parent = manifest.sessions.find(session => session.toolResults?.length === 1);
  const subagent = manifest.sessions.find(session => session.tool === 'claude' && !session.toolResults?.length);
  assert.equal(JSON.parse(readFileSync(join(cwd, 'staged', subagent.archive), 'utf8')).message, 'subagent');
  const toolResult = JSON.parse(readFileSync(join(cwd, 'staged', parent.toolResults[0].archive), 'utf8'));
  assert.equal(toolResult.message, 'attached tool result');
  assert.equal(toolResult.details, 'Booking reference: [REDACTED]');
  assert.notEqual(toolResult.token, token);
  assert.equal(statSync(join(cwd, 'staged')).mode & 0o777, 0o700);
  assert.notEqual(run(args).status, 0);
  const codexOnly = run([...args.slice(0, 4), 'codex-only', ...args.slice(5), '--only', 'codex']);
  assert.equal(codexOnly.status, 0, codexOnly.stderr);
  assert.deepEqual(
    JSON.parse(readFileSync(join(cwd, 'codex-only', 'manifest.json'), 'utf8')).sessions.map(session => session.tool),
    ['codex']
  );
});

test('archive publication checks approval, visibility, and commits only the reviewed files', { timeout: 30000 }, t => {
  const { cwd, run, executable } = fixture(t);
  const repository = join(cwd, 'destination.git');
  const configuration = join(cwd, 'gitconfig');
  const environment = { GIT_CONFIG_GLOBAL: configuration, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, env: { ...process.env, ...environment }, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('config', '--global', 'user.name', 'Archive Test');
  git('config', '--global', 'user.email', 'archive-test@example.invalid');
  git('config', '--global', `url.file://${repository}.insteadOf`, 'https://github.com/example/destination.git');
  git('init', '--bare', '--initial-branch=main', repository);
  git('-C', repository, 'config', 'uploadpack.allowFilter', 'true');
  git('init', '--initial-branch=main', 'seed');
  writeFileSync(join(cwd, 'seed', 'README.md'), 'Existing destination files are preserved.\n');
  const legacy = 'example/project/claude/legacy.meta.json';
  mkdirSync(join(cwd, 'seed', 'example', 'project', 'claude'), { recursive: true });
  writeFileSync(join(cwd, 'seed', legacy), '{"source":{"sha256":"legacy"}}\n');
  git('-C', 'seed', 'add', 'README.md', legacy);
  git('-C', 'seed', 'commit', '-qm', 'Initial archive');
  git('-C', 'seed', 'push', repository, 'main');
  const base = git('-C', repository, 'rev-parse', 'main');

  // github-retry-ok: fixture writes a fake gh executable and sends no requests.
  executable(
    'gh',
    `
if [[ "$1" == repo ]]; then
  [[ "$GH_HOST" == github.com && "$*" == 'repo create example/new-destination --private --add-readme --description Reviewed Hive Mind session archives' ]]
  touch initialized
  exit
fi
case "$4" in
  repos/example/project)
    if [[ "$6" == .visibility ]]; then printf '%s\\n' "\${SOURCE_VISIBILITY:-public}";
    else printf '{"full_name":"example/project","visibility":"%s","default_branch":"main"}\\n' "\${SOURCE_VISIBILITY:-public}"; fi ;;
  repos/example/destination) printf '{"full_name":"example/destination","visibility":"%s","default_branch":"main"}\\n' "\${DESTINATION_VISIBILITY:-private}" ;;
  repos/example/new-destination) [[ -f initialized ]] && printf '%s\\n' '{"full_name":"example/new-destination","visibility":"private","default_branch":"main"}' ;;
  *) exit 1 ;;
esac`
  );
  const initialize = ['archive-publish', '--initialize', '--destination', 'example/new-destination'];
  assert.notEqual(run(initialize, { environment }).status, 0);
  assert.throws(() => statSync(join(cwd, 'initialized')), { code: 'ENOENT' });
  const initialized = run([...initialize, '--visibility', 'private'], { environment });
  assert.equal(initialized.status, 0, initialized.stderr);
  assert.match(initialized.stdout, /Initialized private archive/);
  const directory = join(cwd, 'review');
  mkdirSync(join(cwd, 'codex'));
  const sourceFile = join(cwd, 'codex', 'session.jsonl');
  const old = new Date(Date.now() - 60 * 60 * 1000);
  const sessionText = message => `${JSON.stringify({ type: 'session_meta', payload: { git: { repository_url: 'https://github.com/example/project.git' } }, message })}\n`;
  writeFileSync(sourceFile, sessionText('abc'));
  utimesSync(sourceFile, old, old);
  const stage = ['archive-sessions', '--repo', 'example/project', '--claude-dir', 'empty', '--codex-dir', 'codex', '--published-in', 'example/destination', '--limit', '1', '--output'];
  const staged = run([...stage, directory], { environment });
  assert.equal(staged.status, 0, staged.stderr);
  const [{ archive, revision }] = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8')).sessions;
  const file = join(directory, archive);
  writeFileSync(join(directory, 'ignored.txt'), 'never published');
  const fixtureText = readFileSync(file, 'utf8');
  const args = ['archive-publish', directory, '--destination', 'example/destination'];
  const plan = run(args, { environment });
  assert.equal(plan.status, 0, plan.stderr);
  const { digest, files, visibility } = JSON.parse(plan.stdout);
  assert.match(digest, /^sha256:[a-f\d]{64}$/);
  assert.equal(visibility, 'private');
  assert.deepEqual(files, [archive, 'manifest.json']);
  const apply = [...args, '--apply', digest];
  assert.notEqual(run(apply, { environment: { ...environment, DESTINATION_VISIBILITY: 'public' } }).status, 0);
  assert.notEqual(run(apply, { environment: { ...environment, SOURCE_VISIBILITY: 'private' } }).status, 0);
  writeFileSync(file, '{"message":"changed fixture"}\n');
  assert.match(run(apply, { environment }).stderr, /changed since review/);
  writeFileSync(file, '{"message":"Booking reference: ZQ7RF9"}\n');
  assert.match(run(args, { environment }).stderr, /identity-document, booking, or contact details/);
  assert.equal(git('-C', repository, 'rev-parse', 'main'), base);
  writeFileSync(file, fixtureText);
  const published = run(apply, { environment });
  assert.equal(published.status, 0, published.stderr);
  const head = git('-C', repository, 'rev-parse', 'main');
  assert.equal(git('-C', repository, 'rev-parse', `${head}^`), base);
  const prefix = `example/project/${digest.slice('sha256:'.length)}`;
  assert.equal(git('-C', repository, 'show', `main:${prefix}/${archive}`), fixtureText.trim());
  assert.deepEqual(git('-C', repository, 'ls-tree', '-r', '--name-only', 'main').split('\n'), ['README.md', `example/project/.published/${archive}.${revision.slice('sha256:'.length)}`, `${prefix}/${archive}`, `${prefix}/manifest.json`, legacy].sort());
  assert.equal(git('-C', repository, 'show', `main:${legacy}`), '{"source":{"sha256":"legacy"}}');
  const retried = run(apply, { environment });
  assert.equal(retried.status, 0, retried.stderr);
  assert.match(retried.stdout, /already published/);
  assert.equal(git('-C', repository, 'rev-parse', 'main'), head);
  const skipped = run([...stage, 'repeat'], { environment });
  assert.equal(skipped.status, 0, skipped.stderr);
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'repeat', 'manifest.json'), 'utf8')).sessions, []);
  writeFileSync(sourceFile, sessionText('def'));
  utimesSync(sourceFile, old, old);
  const changed = run([...stage, 'changed'], { environment });
  assert.equal(changed.status, 0, changed.stderr);
  const [newRevision] = JSON.parse(readFileSync(join(cwd, 'changed', 'manifest.json'), 'utf8')).sessions;
  assert.equal(newRevision.archive, archive);
  assert.notEqual(newRevision.revision, revision);
  const scheduled = [...stage.slice(0, -5), '--publish-private', 'example/destination'];
  assert.match(run(scheduled, { environment: { ...environment, DESTINATION_VISIBILITY: 'public' } }).stderr, /requires a private destination/);
  assert.equal(git('-C', repository, 'rev-parse', 'main'), head);
  const automatic = run(scheduled, { environment });
  assert.equal(automatic.status, 0, automatic.stderr);
  const automaticHead = git('-C', repository, 'rev-parse', 'main');
  assert.equal(git('-C', repository, 'rev-parse', `${automaticHead}^`), head);
  assert.match(run(scheduled, { environment }).stdout, /Staged 0 session/);
  assert.equal(git('-C', repository, 'rev-parse', 'main'), automaticHead);
});

test('MTProxy MSS unit uses the original published port after destination NAT', { timeout: 10000 }, t => {
  const { run } = fixture(t);
  const result = run(['deploy', 'proxy', '--port', '8443', '--mss', '1200', 'mss-unit']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /^After=docker.service$/m);
  for (const direction of ['ORIGINAL', 'REPLY']) {
    const options = `--ctstate DNAT --ctorigdstport 8443 --ctdir ${direction} -m comment --comment hive-manager-mtproxy-8443 -j TCPMSS --set-mss 1200`;
    for (const operation of ['-C', '-I', '-D']) {
      assert.ok(result.stdout.includes(`iptables -w -t mangle ${operation} FORWARD -p tcp --tcp-flags SYN,RST SYN -m conntrack ${options}`));
    }
  }
  const invalid = run(['deploy', 'proxy', '--mss', '1; echo unwanted', 'mss-unit']);
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout, '');
});

test('agent config audit requires explicit repair before modifying the fixture home', { timeout: 10000 }, t => {
  const { cwd, run } = fixture(t);
  const options = { environment: { HOME: cwd, CODEX_HOME: join(cwd, '.codex'), CLAUDE_CONFIG_DIR: join(cwd, '.claude') } };
  assert.notEqual(run(['audit-config'], options).status, 0);
  assert.throws(() => statSync(join(cwd, '.codex/config.toml')), { code: 'ENOENT' });
  const repaired = run(['audit-config', '--repair'], options);
  assert.equal(repaired.status, 0, repaired.stderr);
  assert.match(readFileSync(join(cwd, '.codex/config.toml'), 'utf8'), /remote_plugin = false/);
  assert.equal(run(['audit-config'], options).status, 0);
});

test('proxy packet captures compare external directions without assuming full payloads were saved', { timeout: 10000 }, t => {
  const { cwd, run } = fixture(t);
  const port = 8443;
  const header = Buffer.alloc(24);
  header.writeUInt32LE(0xa1b2c3d4);
  header.writeUInt32LE(101, 20);
  const packet = ({ outgoing, seq = 1, ack = 0, flags = 16, bytes = 0 }) => {
    const raw = Buffer.alloc(16 + 40);
    raw.writeUInt32LE(40, 8);
    raw.writeUInt32LE(40 + bytes, 12);
    raw[16] = 0x45;
    raw.writeUInt16BE(40 + bytes, 18);
    raw[25] = 6;
    raw[31] = outgoing ? 1 : 2;
    raw[35] = outgoing ? 2 : 1;
    raw.writeUInt16BE(outgoing ? 47901 : port, 36);
    raw.writeUInt16BE(outgoing ? port : 47901, 38);
    raw.writeUInt32BE(seq, 40);
    raw.writeUInt32BE(ack, 44);
    raw[48] = 0x50;
    raw[49] = flags;
    return raw;
  };
  const syn = packet({ outgoing: true, flags: 2 });
  const synAck = packet({ outgoing: false, flags: 18 });
  const request = packet({ outgoing: true, seq: 2, bytes: 12 });
  const response = packet({ outgoing: false, seq: 2, bytes: 100 });
  const duplicateAck = packet({ outgoing: true, ack: 2 });
  writeFileSync(join(cwd, 'client.pcap'), Buffer.concat([header, syn, synAck, request, duplicateAck, duplicateAck]));
  writeFileSync(join(cwd, 'server.pcap'), Buffer.concat([header, syn, synAck, request, response, response]));
  const parsed = run(['proxy-pcap', '--port', String(port), 'client.pcap', 'server.pcap']);
  assert.equal(parsed.status, 0, parsed.stderr);
  const summary = JSON.parse(parsed.stdout);
  assert.equal(summary.client.flows, 1);
  assert.equal(summary.client.clientToProxy.syns, 1);
  assert.equal(summary.client.clientToProxy.repeatedAcks, 1);
  assert.equal(summary.server.proxyToClient.wirePayloadBytes, 200);
  assert.equal(summary.server.proxyToClient.repeatedSegments, 1);
  assert.deepEqual(summary.observedPayloadDifference, { clientToProxy: 0, proxyToClient: 100 });
  writeFileSync(join(cwd, 'truncated.pcap'), Buffer.concat([header, response.subarray(0, -1)]));
  assert.match(run(['proxy-pcap', 'truncated.pcap']).stderr, /capture ends inside a packet/);
});

test('Telegram probe verifies only its own Saved Messages and cleans up on failure', { timeout: 10000 }, async t => {
  const { run } = fixture(t);
  const messages = new Map();
  const deleted = [];
  let id = 0;
  let destroyed = 0;
  const send = data => {
    const message = { id: ++id, ...data };
    messages.set(id, message);
    return message;
  };
  const client = {
    connect() {},
    checkAuthorization: () => true,
    sendMessage(peer, { message }) {
      assert.equal(peer, 'me');
      return send({ message });
    },
    sendFile(peer, { file, forceDocument }) {
      assert.equal(peer, 'me');
      assert.equal(file.name, forceDocument ? 'hive-manager-probe.bin' : 'hive-manager-probe.png');
      return send({ media: file });
    },
    getMessages(peer, { ids }) {
      assert.equal(peer, 'me');
      return ids.map(id => messages.get(id));
    },
    downloadMedia: ({ media }) => media,
    deleteMessages(peer, ids) {
      assert.equal(peer, 'me');
      deleted.push([...ids]);
      for (const id of ids) messages.delete(id);
    },
    destroy() {
      destroyed++;
    },
  };
  const photo = Buffer.alloc(32);
  Buffer.from('89504e470d0a1a0a', 'hex').copy(photo);
  assert.deepEqual(await runProxyProbe(client, { media: true, photo }), { text: true, document: 32768, photo: 32, cleaned: true });
  assert.deepEqual(deleted, [[1, 2, 3]]);
  assert.equal(messages.size, 0);
  await assert.rejects(runProxyProbe({ ...client, downloadMedia: () => Buffer.from('wrong') }, { media: true }), /differs from the probe document/);
  assert.deepEqual(deleted, [
    [1, 2, 3],
    [4, 5],
  ]);
  assert.equal(destroyed, 2);
  assert.match(run(['proxy-test', '--help']).stdout, /Saved Messages/);
  const invalid = run(['proxy-test', '--api-hash', 'private-value']);
  assert.equal(invalid.status, 1);
  assert.doesNotMatch(invalid.stderr, /private-value/);
});

test('MTProxy capture is scoped by port, client and time and refuses out-of-range durations', { timeout: 10000 }, t => {
  const { run, executable } = fixture(t);
  executable('timeout', 'printf "<%s>\\n" "$@"');
  executable('tcpdump', 'exit 19');
  const args = ['deploy', 'proxy', '--port', '8443', '--seconds', '5', '--client-ip', '2001:db8::1', 'capture'];
  const result = run(args);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, '<--preserve-status>\n<--signal=INT>\n<--kill-after=5>\n<5>\n<tcpdump>\n<-p>\n<-n>\n<-i>\n<any>\n<-s>\n<96>\n<-c>\n<10000>\n<-w>\n<->\n<tcp>\n<port>\n<8443>\n<and>\n<host>\n<2001:db8::1>\n');
  const invalid = run(['deploy', 'proxy', '--seconds', '600', 'capture']);
  assert.notEqual(invalid.status, 0);
  assert.equal(invalid.stdout, '');
});
