/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { applyLegacyProxyCleanup, inventoryLegacyProxy, planLegacyProxyCleanup } from '../src/hive-manager/proxy/legacy.mjs';
import { compareProxyReports, summarize } from '../src/hive-manager/proxy/pcap.mjs';
import { createProbePhoto } from '../src/hive-manager/proxy/photo.mjs';
import { readProxyMatrix, runProxyProbe } from '../src/hive-manager/proxy/test.mjs';

const cli = fileURLToPath(new URL('../src/hive-manager/cli.sh', import.meta.url));
const id = createHash('sha256').update('proxy migration fixture').digest('hex');

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'hive-proxy-4111-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const file = name => join(cwd, name);
  const executable = (name, body) => writeFileSync(file(name), `#!/usr/bin/env bash\nset -eu\n${body}\n`, { mode: 0o700 });
  const run = (args, input, options) =>
    spawnSync('bash', [cli, ...args], {
      cwd,
      input,
      encoding: 'utf8',
      timeout: 10000,
      env: { ...process.env, DOCKER_HOST: '', DOCKER_CONTEXT: '', PATH: `${cwd}:${process.env.PATH}`, XDG_RUNTIME_DIR: cwd, ...options },
    });
  return { file, executable, run };
}

function mediaClient(download) {
  let current;
  let nextId = 0;
  const deleted = [];
  return {
    deleted,
    connect() {},
    checkAuthorization: () => true,
    sendMessage: (_, { message }) => (current = { id: ++nextId, message }),
    sendFile: (_, { file, forceDocument }) => (current = { id: ++nextId, media: { file, forceDocument } }),
    getMessages: () => [current],
    downloadMedia: ({ media }) => (media.forceDocument ? media.file : download),
    deleteMessages: (_, ids) => deleted.push(...ids),
    destroy() {},
  };
}

test('photo verification rejects the reported signature-only PNG and mismatched valid images', async () => {
  const sent = createProbePhoto();
  const fake = Buffer.alloc(24);
  fake.write('89504e470d0a1a0a', 'hex');
  const broken = mediaClient(fake);
  await assert.rejects(runProxyProbe(broken, { photo: sent }), /Could not decode/);
  assert.deepEqual(broken.deleted, [1, 2]);
  const wrongSize = mediaClient(PNG.sync.write(new PNG({ width: 96, height: 96 })));
  await assert.rejects(runProxyProbe(wrongSize, { photo: sent }), /dimensions differ/);
  const image = PNG.sync.read(sent);
  image.data.fill(255, 0, image.data.length / 4);
  const wrongPixels = mediaClient(PNG.sync.write(image));
  await assert.rejects(runProxyProbe(wrongPixels, { photo: sent }), /pixels differ/);
  const truncated = mediaClient(sent.subarray(0, sent.length - 12));
  await assert.rejects(runProxyProbe(truncated, { photo: sent }), /Could not decode/);
  await assert.rejects(runProxyProbe(mediaClient(sent), { photo: fake }), /Could not decode/);
});

test('the deterministic photo survives JPEG recompression and the document stays byte-exact', async () => {
  const photo = createProbePhoto();
  assert.deepEqual(photo, createProbePhoto());
  const recompressed = jpeg.encode(PNG.sync.read(photo), 65).data;
  const client = mediaClient(recompressed);
  assert.deepEqual(await runProxyProbe(client, { photo, media: true }), { text: true, document: 32768, photo: recompressed.length, cleaned: true });
  assert.deepEqual(client.deleted, [1, 2, 3]);
});

test('same-port matrix runs can select one named route with only its own key available', async t => {
  const { file } = fixture(t);
  const config = file('matrix.json');
  const key = 'a'.repeat(32);
  writeFileSync(file('baseline'), key);
  writeFileSync(
    config,
    JSON.stringify([
      { name: 'baseline', host: 'proxy.example', port: 8443, secretFile: 'baseline' },
      { name: 'alternate', host: 'proxy.example', port: 8443, secretFile: 'alternate' },
    ])
  );
  assert.deepEqual(await readProxyMatrix(config, 'baseline'), new Map([['baseline', { host: 'proxy.example', port: 8443, secret: `dd${key}` }]]));
  await assert.rejects(readProxyMatrix(config, 'alternate'), /proxy secret/);
  await assert.rejects(readProxyMatrix(config, 'unknown'), /absent from the matrix/);
});

test('snapshot hashes a read-only legacy input and observes actual namespace and MSS state', t => {
  const { file, executable, run } = fixture(t);
  const key = 'b'.repeat(32);
  writeFileSync(file('legacy.secret'), `${key}\n`);
  executable(
    'docker',
    `
case "$1 $2" in
  'context inspect') echo unix:///var/run/docker.sock ;;
  'container inspect')
    case "$4" in
      '{{.Id}}') echo ${id} ;;
      *State.Pid*) echo "${process.pid} ${'/proc/' + process.pid + '/ns/net'}" ;;
      *RestartPolicy.Name*WORKERS*) exit 94 ;;
      *printf*image*) echo image=fixture ;;
      *Config.Env*) echo WORKERS=4 ;;
      *PortBindings*) echo '443/tcp 8443' ;;
      *RestartPolicy.Name*) echo unless-stopped ;;
      '{{.State.Running}}') echo true ;;
      *) exit 93 ;;
    esac ;;
  'port '${id}) echo '0.0.0.0:8443' ;;
  *) exit 92 ;;
esac
`
  );
  executable(
    'timeout',
    `
[[ "$4" == nsenter && "$5" == --net=/proc/self/fd/8 ]]
[[ /proc/self/fd/8 -ef /proc/${process.pid}/ns/net ]]
printf '%s:%s\n' "\${@: -2:1}" "\${@: -1}" >> probes
case "\${@: -2:1}" in
  149.154.161.144) printf reachable ;;
  149.154.161.184) printf unreachable ;;
  *) exit 125 ;;
esac
`
  );
  executable('nsenter', 'exit 89');
  executable(
    'iptables',
    `
printf '%s\n' '-P FORWARD ACCEPT' \
  '-A FORWARD -p tcp -m tcp --sport 8443 --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1120' \
  '-A FORWARD -p tcp -m tcp --sport 8888 --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200'
`
  );
  const args = ['deploy', '--state-dir', file('manager'), 'proxy', '--port', '8443', '--proxy-name', 'mtproxy-classic-8443'];
  const checks = ['--secret-file', file('legacy.secret'), '--check-mss', '--check-egress'];
  const result = run([...args, ...checks, 'snapshot']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /secret-sha256=[a-f0-9]{64}/);
  assert.ok(!result.stdout.includes(key));
  assert.match(result.stdout, /egress 149\.154\.161\.144:8888=reachable\negress 149\.154\.161\.184:8888=unreachable\negress 91\.105\.192\.110:443=unavailable/);
  assert.match(result.stdout, /mss-rule=.*8443 .*1120/);
  assert.ok(!result.stdout.includes('sport 8888'));
  assert.equal(readFileSync(file('legacy.secret'), 'utf8'), `${key}\n`);
  assert.ok(!existsSync(file('manager')));
  assert.match(run([...args, 'verify']).stderr, /observations are unavailable/);
  assert.match(run([...args, ...checks, 'compare', '-'], result.stdout).stderr, /observations are unavailable/);
  rmSync(file('probes'));
  const remote = run([...args, 'verify'], undefined, { DOCKER_HOST: 'tcp://remote.example:2376' });
  assert.match(remote.stderr, /observations are unavailable/);
  assert.match(remote.stdout, /egress 149\.154\.161\.144:8888=unavailable/);
  assert.ok(!existsSync(file('probes')));
  const remoteSnapshot = run([...args, ...checks, 'snapshot'], undefined, { DOCKER_HOST: 'tcp://remote.example:2376' });
  assert.equal(remoteSnapshot.status, 0, remoteSnapshot.stderr);
  assert.match(remoteSnapshot.stdout, /^mss=unavailable$/m);
  assert.doesNotMatch(remoteSnapshot.stdout, /^mss-rule=/m);
});

function cleanupHost() {
  const names = ['mtproxy', 'mtproxy-classic', 'mtproxy-classic-8443', 'mtproxy-classic-8443-old', 'hive-mind', 'mtproxy-classic-65536'];
  const containers = names.map((name, index) => ({
    name,
    id: String(index + 1).repeat(64),
    state: name.endsWith('old') ? 'exited' : 'running',
    image: 'fixture',
    owner: '',
  }));
  const rules = ['-A FORWARD -p tcp -m tcp --sport 8443 --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1120', '-A FORWARD -p tcp -m tcp --dport 8443 --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1120'];
  const unrelated = '-A FORWARD -p tcp -m tcp --sport 8443 --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1200';
  const unit = '/etc/systemd/system/mtproxy-mss.service';
  const script = '/usr/local/sbin/mtproxy-mss.sh';
  const files = new Map([
    [
      unit,
      `[Unit]
Description=Clamp TCP MSS for MTProto proxy traffic (Docker bridge PMTU)
After=network-online.target docker.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=${script}
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
`,
    ],
    [
      script,
      `#!/bin/sh
set -eu

add_rule() {
  iptables -t mangle -C "$@" 2>/dev/null || iptables -t mangle -A "$@"
}

for port in 8443; do
  add_rule FORWARD -p tcp --sport "$port" --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1120
  add_rule FORWARD -p tcp --dport "$port" --tcp-flags SYN,RST SYN -j TCPMSS --set-mss 1120
done
`,
    ],
  ]);
  const state = { containers, rules: ['-P FORWARD ACCEPT', ...rules, ...rules, unrelated], files, active: true, enabled: true, mutations: [] };
  const host = {
    read: async path => files.get(path) ?? null,
    remove: async path => files.delete(path),
    locked: async callback => callback(),
    async run(program, args) {
      const [first, second] = args;
      if (program === 'docker' && first === 'container' && second === 'ls') {
        if (state.listFailure) throw new Error('Docker listing failed');
        return state.containers.map(c => [c.id, c.name, c.state, c.image, c.owner].map(value => JSON.stringify(value)).join('\t')).join('\n');
      }
      if (program === 'docker' && first === 'context') return 'unix:///var/run/docker.sock';
      if (program === 'docker' && first === 'image') return 'sha256:fixture';
      if (program === 'systemctl' && first === 'show') {
        const loaded = files.has(unit);
        return `LoadState=${loaded ? 'loaded' : 'not-found'}\nActiveState=${state.active ? 'active' : 'inactive'}\nUnitFileState=${loaded ? (state.enabled ? 'enabled' : 'disabled') : ''}\nFragmentPath=${loaded ? unit : ''}\nDropInPaths=\nNeedDaemonReload=no`;
      }
      if (program === 'iptables' && args.includes('-S')) return state.rules.join('\n');
      state.mutations.push([program, ...args]);
      if (program === 'systemctl' && first === 'stop') state.active = false;
      else if (program === 'systemctl' && first === 'disable') state.enabled = false;
      else if (program === 'iptables' && args.includes('-D')) {
        const rule = `-A ${args.slice(5).join(' ')}`;
        const index = state.rules.indexOf(rule);
        assert.notEqual(index, -1);
        state.rules.splice(index, 1);
      } else if (program === 'docker' && second === 'stop') {
        if (state.failAfterStop) state.listFailure = true;
        state.containers.find(c => c.id === args.at(-1)).state = 'exited';
      } else if (program === 'docker' && second === 'rm') {
        state.containers = state.containers.filter(c => c.id !== args.at(-1));
      } else assert.deepEqual([program, first], ['systemctl', 'daemon-reload']);
      return '';
    },
  };
  return { host, state, unrelated };
}

test('legacy cleanup reviews exact identities, disables MSS, preserves files and removes duplicates only within scope', async () => {
  const { host, state, unrelated } = cleanupHost();
  const { containers, mss } = await inventoryLegacyProxy({ legacyMss: true }, host);
  assert.deepEqual(
    containers.map(c => c.name),
    ['mtproxy', 'mtproxy-classic', 'mtproxy-classic-8443', 'mtproxy-classic-8443-old']
  );
  assert.equal(mss.rules.length, 4);
  const names = ['mtproxy', 'mtproxy-classic-8443-old'];
  const options = { action: 'stop', names, legacyMss: true };
  const plan = await planLegacyProxyCleanup(options, host);
  state.containers[0].id = id;
  await assert.rejects(applyLegacyProxyCleanup(plan, host), /observations changed/);
  assert.equal(state.mutations.length, 0);
  state.containers[0].id = plan.containers[0].id.slice('sha256:'.length);
  assert.equal((await applyLegacyProxyCleanup(plan, host)).verified, true);
  assert.deepEqual(state.rules, ['-P FORWARD ACCEPT', unrelated]);
  assert.equal(state.files.size, 2);
  assert.equal(state.enabled, false);
  assert.equal(state.containers.find(c => c.name === 'hive-mind').state, 'running');
  const permanent = await planLegacyProxyCleanup({ ...options, action: 'remove' }, host);
  assert.equal((await applyLegacyProxyCleanup(permanent, host)).verified, true);
  assert.equal(state.files.size, 0);
  assert.deepEqual(
    state.containers.map(c => c.name),
    ['mtproxy-classic', 'mtproxy-classic-8443', 'hive-mind', 'mtproxy-classic-65536']
  );
  assert.deepEqual(state.rules, ['-P FORWARD ACCEPT', unrelated]);
});

test('legacy cleanup propagates listing and post-operation verification errors', async () => {
  const { host, state } = cleanupHost();
  state.listFailure = true;
  await assert.rejects(inventoryLegacyProxy({}, host), /Docker listing failed/);
  state.listFailure = false;
  const plan = await planLegacyProxyCleanup({ action: 'stop', names: ['mtproxy'] }, host);
  state.failAfterStop = true;
  await assert.rejects(applyLegacyProxyCleanup(plan, host), /Docker listing failed/);
  assert.equal(state.mutations.length, 1);
});

test('the CLI uses the same legacy inventory and enforces cleanup review and adoption', async t => {
  const { executable, file, run } = fixture(t);
  writeFileSync(file('phase'), 'running');
  executable(
    'docker',
    `
case "$1 $2" in
  'container ls') printf '"%s"\t"mtproxy"\t"%s"\t"fixture"\t""\n' ${id} "$(cat phase)" ;;
  'image ls') echo sha256:fixture ;;
  'container stop') [[ "$3" == ${id} ]]; echo exited > phase ;;
  *) exit 90 ;;
esac
`
  );
  const inventory = run(['deploy', 'proxy', 'inventory']);
  assert.equal(inventory.status, 0, inventory.stderr);
  assert.equal(JSON.parse(inventory.stdout).containers[0].id, `sha256:${id}`);
  const plan = run(['deploy', 'proxy', '--select', 'mtproxy', 'cleanup-plan', 'stop']);
  assert.equal(plan.status, 0, plan.stderr);
  assert.match(run(['deploy', 'proxy', 'cleanup', '-'], plan.stdout).stderr, /Use --adopt/);
  const noChange = run(['deploy', '--adopt', 'proxy', 'cleanup', '-'], plan.stdout.replace(id, 'b'.repeat(64)));
  assert.match(noChange.stderr, /observations changed/);
  assert.equal(readFileSync(file('phase'), 'utf8'), 'running');
  const applied = run(['deploy', '--adopt', 'proxy', 'cleanup', '-'], plan.stdout);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(applied.stdout).verified, true);
  assert.equal(readFileSync(file('phase'), 'utf8').trim(), 'exited');
});

function capture(segments) {
  const global = Buffer.alloc(24);
  global.writeUInt32LE(0xa1b2c3d4);
  global.writeUInt32LE(101, 20);
  return Buffer.concat([
    global,
    ...segments.map(({ fromProxy, seq = 20, ack = 10, payload = 0 }) => {
      const packet = Buffer.alloc(56);
      packet.writeUInt32LE(40, 8);
      packet.writeUInt32LE(40 + payload, 12);
      packet[16] = 0x45;
      packet.writeUInt16BE(40 + payload, 18);
      packet[25] = 6;
      packet[31] = fromProxy ? 2 : 1;
      packet[35] = fromProxy ? 1 : 2;
      packet.writeUInt16BE(fromProxy ? 8443 : 39000, 36);
      packet.writeUInt16BE(fromProxy ? 39000 : 8443, 38);
      packet.writeUInt32BE(seq, 40);
      packet.writeUInt32BE(ack, 44);
      packet[48] = 0x50;
      packet[49] = 0x10;
      return packet;
    }),
  ]);
}

test('two-sided reports compare overlapping retransmit bytes, ACK gaps across wrap, and application outcomes', t => {
  const { file, run } = fixture(t);
  const server = capture([{ fromProxy: true, seq: 0xfffffff0, payload: 32 }, { fromProxy: true, seq: 0, payload: 32 }, { ack: 24 }, { ack: 24 }]);
  const client = capture([{ fromProxy: true, seq: 0xfffffff0, payload: 32 }, { ack: 16 }]);
  const packetStats = summarize(server, 8443);
  assert.equal(packetStats.proxyToClient.firstSeenPayloadBytes, 48);
  assert.equal(packetStats.proxyToClient.repeatedPayloadBytes, 16);
  assert.equal(packetStats.proxyToClient.ackGapMax, 8);
  assert.equal(packetStats.proxyToClient.ackGapSum, 8);
  assert.equal(packetStats.proxyToClient.ackGapFlows, 1);
  assert.equal(packetStats.clientToProxy.repeatedAcks, 1);
  assert.equal(packetStats.clientToProxy.ackGapComparableFlows, 0);
  writeFileSync(file('client.pcap'), client);
  writeFileSync(file('server.pcap'), server);
  const probe = { route: 'proxy', text: true, document: 32768, photo: 243, cleaned: true };
  writeFileSync(file('probe.json'), JSON.stringify(probe));
  const result = run(['proxy-pcap', '--port', '8443', '--probe', 'probe.json', 'client.pcap', 'server.pcap']);
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.observedPayloadDifference.proxyToClient, 16);
  assert.equal(report.probe.probe.photo, 243);
  writeFileSync(file('baseline.json'), result.stdout);
  writeFileSync(file('candidate.json'), JSON.stringify({ ...report, probe: { probe: { route: 'proxy', ok: false } } }));
  const compared = run(['proxy-pcap', '--compare', 'baseline.json', 'candidate.json']);
  assert.equal(compared.status, 0, compared.stderr);
  assert.deepEqual(
    JSON.parse(compared.stdout).metrics.find(row => row.metric === 'probe.probe.photo'),
    {
      metric: 'probe.probe.photo',
      before: 243,
      after: null,
      observedBefore: true,
      observedAfter: false,
      delta: null,
    }
  );
  assert.equal(compareProxyReports(probe, { ...probe, photo: 250 }).find(row => row.metric === 'probe.probe.photo').delta, 7);
});
