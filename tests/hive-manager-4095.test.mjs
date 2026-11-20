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
import { runProxyProbe } from '../src/hive-manager-proxy-test.mjs';

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
  {"status":"executed","exitCode":0},
  {"status":"executed","exitCode":137,"uuid":"first","oomKilled":true,"exitReason":"out-of-memory","command":"secret argument","logPath":"/private/log"},
  {"status":"executed","exitCode":1,"uuid":"second"},
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
  writeSession(join(resultsDir, 'result.jsonl'), { cwd: checkout, message: 'attached tool result', token });
  writeSession(join(resultsDir, 'active.json'), { token }, false);
  writeSession(join(resultsDir, 'ignored.bin'), { token });
  symlinkSync('result.jsonl', join(resultsDir, 'ignored.jsonl'));
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
    ['claude', 'codex']
  );
  for (const { archive, linksNotation } of manifest.sessions) {
    assert.notEqual(JSON.parse(readFileSync(join(cwd, 'staged', archive), 'utf8')).token, token);
    assert.notEqual(JSON.parse(readFileSync(join(cwd, 'staged', linksNotation), 'utf8')).token, token);
  }
  assert.equal(manifest.sessions[0].toolResults.length, 1);
  const toolResult = JSON.parse(readFileSync(join(cwd, 'staged', manifest.sessions[0].toolResults[0].archive), 'utf8'));
  assert.equal(toolResult.message, 'attached tool result');
  assert.notEqual(toolResult.token, token);
  assert.equal(statSync(join(cwd, 'staged')).mode & 0o777, 0o700);
  assert.notEqual(run(args).status, 0);
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
