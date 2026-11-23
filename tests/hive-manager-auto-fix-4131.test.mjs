/**
 * @hive-mind-test-suite default,pr-essential
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statfsSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { previewAutoFix } from '../src/hive-manager/index.mjs';
import { launchAutoFix } from '../src/hive-manager/auto-fix/index.mjs';
import { autoFixPolicy } from '../src/hive-manager/auto-fix/lib/policy.mjs';
import { receiptStatus } from '../src/hive-manager/auto-fix/lib/receipts.mjs';
import { test } from 'node:test';

const manager = fileURLToPath(new URL('../src/hive-manager/cli.sh', import.meta.url));
const ids = [1, 2, 3, 4, 5].map(n => `0000000${n}-0000-4000-8000-00000000000${n}`);
const layers = ['a', 'b', 'c', 'd', 'e'].map(letter => letter.repeat(64));

const dockerFixture = String.raw`
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
const args = process.argv.slice(2);
const host = args[0] === '--host';
if (host) args.splice(0, 2);
const [action, resource] = args;
const dir = process.env.AUTO_FIX_FIXTURE;
const data = JSON.parse(readFileSync(join(dir, 'controls.json'), 'utf8'));
const records = JSON.parse(readFileSync(join(dir, 'executions.lino'), 'utf8'));
const print = data => console.log(JSON.stringify(data));
if (host && !data.daemon) process.exit(1);
if (action === 'info') {
  print(host ? { id: 'fixture-daemon', version: '28.0.0', root: dir, liveRestore: true } : { DockerRootDir: dir });
} else if (action === 'context') {
  console.log('unix:///var/run/docker.sock');
} else if (action === 'container' && resource === 'inspect' && host) {
  const status = data.instanceStatus ?? 'running';
  print({ id: 'f'.repeat(64), name: '/fixture-hive', status, pid: status === 'running' ? 42 : 0, startedAt: '2026-01-01T00:00:00Z', health: status === 'running' ? 'healthy' : null });
} else if (action === 'container' && resource === 'inspect') {
  const row = records.find(task => task.options.sessionName === args.at(-1));
  if (!row) process.exit(1);
  print({ id: row.options.containerId, name: '/' + row.options.sessionName, state: 'exited', exitCode: row.exitCode, size: 1048576, labels: { 'start-command.uuid': row.uuid } });
} else if (action === 'start' && host && args.at(-1) === 'f'.repeat(64) && data.instanceStatus === 'exited') {
  writeFileSync(join(dir, 'controls.json'), JSON.stringify({ ...data, instanceStatus: 'running' }));
  appendFileSync(join(dir, 'started'), 'deployment\n');
} else if (action === 'exec' && host) {
  const taskAction = args.at(-2);
  const request = JSON.parse(args.at(-1));
  if (taskAction === 'recover' && data.interrupt === request.candidate.id) {
    writeFileSync(join(dir, 'interruption'), JSON.stringify({ worker: process.ppid, child: process.pid }));
    setInterval(() => {}, 1000);
  } else {
    const result = spawnSync(process.env.AUTO_FIX_MANAGER, ['tasks', 'lifecycle', taskAction, args.at(-1)], { encoding: 'utf8', timeout: 10000 });
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    process.exitCode = result.status ?? 1;
  }
} else if (action === 'ps') {
  const full = args.includes('-a');
  for (const record of records) {
    if (!full && record.status !== 'executing' && !record.paused) continue;
    const { sessionName, containerId } = record.options;
    const state = record.paused ? 'paused' : record.status === 'executing' ? 'running' : 'exited';
    console.log((full ? [containerId, sessionName, state, record.uuid] : [sessionName, sessionName, record.uuid]).join('\t'));
  }
  if (full) console.log(['9'.repeat(64), 'unrecorded-task', 'paused', '90000000-0000-4000-8000-000000000009'].join('\t'));
} else {
  appendFileSync(join(dir, 'unexpected'), args.join(' ') + '\n');
  process.exitCode = 1;
}
`;

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'hive-auto-fix-'));
  const bin = join(directory, 'bin');
  mkdirSync(bin);
  const file = (name, content) => writeFileSync(join(bin, name), content, { mode: 0o700 });
  file('docker', '#!/usr/bin/env node\n' + dockerFixture);
  file('df', '#!/bin/sh\nprintf "Filesystem 1024-blocks Used Available Capacity Mounted on\\n/dev/mock 99999999 9 %s 1%% /\\n" "$(cat "$AUTO_FIX_FIXTURE/free")"\n');
  file('ps', '#!/bin/sh\nprintf "%s\\n" "docker wait active-task"\n');
  file('journalctl', '#!/bin/sh\nexit 0\n');
  file(
    'systemctl',
    `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const dir = process.env.AUTO_FIX_FIXTURE;
const path = dir + '/controls.json';
const data = JSON.parse(readFileSync(path, 'utf8'));
if (!data.systemd || process.argv.at(-1) !== 'docker.service') process.exit(1);
if (process.argv[2] === 'show') console.log('LoadState=loaded\\nActiveState=' + (data.daemon ? 'active' : 'inactive'));
else if (process.argv[2] === 'start' && !data.daemon) {
  writeFileSync(path, JSON.stringify({ ...data, daemon: true }));
  appendFileSync(dir + '/started', 'docker\\n');
} else process.exit(1);
`
  );
  file(
    '$',
    `#!/usr/bin/env node
const { appendFileSync, readFileSync, writeFileSync } = require('node:fs');
const dir = process.env.AUTO_FIX_FIXTURE;
if (process.argv[2] !== '--resume') process.exit(77);
const id = process.argv[3];
const path = dir + '/executions.lino';
const records = JSON.parse(readFileSync(path, 'utf8'));
const record = records.find(record => record.uuid === id);
record.status = 'executing';
record.options.resumeCount = 1;
writeFileSync(path, JSON.stringify(records));
appendFileSync(dir + '/resumed', id + '\\n');
`
  );
  const update = data => writeFileSync(join(directory, 'controls.json'), JSON.stringify(data));
  update({ daemon: true });
  const setFree = kbytes => writeFileSync(join(directory, 'free'), String(kbytes));
  setFree(30 * 1024 ** 2);
  const records = [0, 1, 2, 3, 4].map(index => ({
    uuid: ids[index],
    status: index < 2 ? 'executing' : 'executed',
    paused: index === 1,
    exitCode: index < 2 ? null : 137,
    oomKilled: index >= 2,
    startTime: `2026-01-01T00:0${5 - index}:00Z`,
    endTime: '2026-01-01T01:00:00Z',
    command: `solve https://github.com/example/tasks/issues/${index + 1}`,
    options: {
      isolated: 'docker',
      isolationMode: 'detached',
      sessionName: ['active-task', 'paused-task', 'first-failure', 'second-failure', 'paused-task-resume-1'][index],
      rootSession: index === 4 ? 'paused-task' : undefined,
      containerId: layers[index],
    },
  }));
  writeFileSync(join(directory, 'executions.lino'), JSON.stringify(records));
  const options = { name: 'fixture-hive', stateDir: directory, minMemoryMiB: 128, recovery: { limit: 3 } };
  const profile = join(directory, 'deploy.profile');
  writeFileSync(profile, 'name=fixture-hive\nstate-dir=.\n');
  const changes = {
    PATH: `${bin}:${process.env.PATH}`,
    AUTO_FIX_FIXTURE: directory,
    AUTO_FIX_MANAGER: manager,
    START_APP_FOLDER: directory,
    HIVE_MIND_STATE_DIR: directory,
  };
  for (const key of ['DOCKER_HOST', 'DOCKER_CONTEXT', 'START_DOCKER_BIN']) changes[key] = undefined;
  const old = Object.fromEntries(Object.keys(changes).map(key => [key, process.env[key]]));
  const setEnv = values => {
    for (const [key, value] of Object.entries(values)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  setEnv(changes);
  t.after(() => {
    setEnv(old);
    rmSync(directory, { recursive: true, force: true });
  });
  const root = join(directory, 'receipts');
  const receipts = join(root, options.name);
  return { directory, options, root, receipts, profile, update, setFree };
}

async function until(get, ready) {
  for (let attempt = 0; attempt < 150; attempt++) {
    const value = await get();
    if (ready(value)) return value;
    await delay(50);
  }
  assert.fail('The auto-fix fixture did not reach the expected state.');
}

test('CLI previews the selected profile and protects running and paused families with a live watcher', { timeout: 15000 }, async t => {
  const { directory, profile } = fixture(t);
  const result = spawnSync(manager, ['deploy', '--profile', profile, 'auto-fix', '--recover-limit', '3', '--min-memory-mib', '128'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.target.name, 'fixture-hive');
  assert.deepEqual(
    plan.phases.map(phase => phase.name),
    ['host-diagnostics', 'docker', 'preflight', 'instance', 'task-inventory', 'scoped-cleanup', 'record-repair', 'recovery']
  );
  const { tasks } = plan.phases.find(phase => phase.name === 'task-inventory').details;
  assert.equal(tasks.unrecordedCount, 1);
  assert.equal(tasks.unrecordedContainers[0].state, 'paused');
  assert.deepEqual(
    tasks.protectedTasks.map(({ id, state, watcher }) => ({ id, state, watcher })),
    [
      { id: ids[0], state: 'running', watcher: 'observed' },
      { id: ids[1], state: 'paused', watcher: 'unobserved' },
    ]
  );
  assert.deepEqual(
    plan.actions.map(action => action.candidate.id),
    [ids[2], ids[3]]
  );
  assert.match(plan.approval, /^sha256:[a-f0-9]{64}$/);
  assert.equal(existsSync(join(directory, 'resumed')), false);
  assert.equal(existsSync(join(directory, 'executions.decoded.js.json')), false);
  assert.equal(existsSync(join(directory, 'unexpected')), false);
});

test('an unavailable daemon and low snapshot space are reported before any mutation', { timeout: 15000 }, async t => {
  const { options, update, setFree } = fixture(t);
  update({ daemon: false });
  const unavailable = await previewAutoFix(options);
  assert.equal(unavailable.approval, null);
  assert.equal(unavailable.blockers[0].phase, 'docker');
  assert.equal(unavailable.phases.find(phase => phase.name === 'task-inventory').state, 'deferred');
  update({ daemon: true });
  setFree(1024);
  const low = await previewAutoFix(options);
  assert.equal(low.approval, null);
  assert.deepEqual(
    low.blockers.map(({ id, reason }) => ({ id, reason })),
    [
      { id: ids[2], reason: 'insufficient-space' },
      { id: ids[3], reason: 'insufficient-space' },
    ]
  );
});

test('changed headroom invalidates approval before any recovery starts', { timeout: 15000 }, async t => {
  const { directory, options, root, receipts, setFree } = fixture(t);
  const plan = await previewAutoFix(options);
  setFree(1024);
  const run = await launchAutoFix(autoFixPolicy(options), plan.approval, undefined, root);
  const blocked = await until(
    () => receiptStatus(receipts, run.id),
    receipt => receipt.status !== 'running'
  );
  assert.equal(blocked.status, 'blocked');
  assert.deepEqual(blocked.actions, []);
  assert.equal(existsSync(join(directory, 'resumed')), false);
});

test('startup requires separate approvals and never starts a paused deployment', { timeout: 20000 }, async t => {
  const { directory, options, root, receipts, update } = fixture(t);
  const startup = { ...options, startDocker: true, startInstance: true };
  const policy = autoFixPolicy(startup);
  update({ systemd: true, daemon: false, instanceStatus: 'exited' });
  const daemon = await previewAutoFix(startup);
  assert.deepEqual(
    daemon.actions.map(action => action.type),
    ['start-docker']
  );
  const daemonRun = await launchAutoFix(policy, daemon.approval, undefined, root);
  assert.equal(
    (
      await until(
        () => receiptStatus(receipts, daemonRun.id),
        result => result.status !== 'running'
      )
    ).status,
    'completed'
  );

  const deployment = await previewAutoFix(startup);
  assert.deepEqual(
    deployment.actions.map(action => action.type),
    ['start-instance']
  );
  const deploymentRun = await launchAutoFix(policy, deployment.approval, undefined, root);
  assert.equal(
    (
      await until(
        () => receiptStatus(receipts, deploymentRun.id),
        result => result.status !== 'running'
      )
    ).status,
    'completed'
  );
  assert.equal(readFileSync(join(directory, 'started'), 'utf8'), 'docker\ndeployment\n');
  assert.equal(existsSync(join(directory, 'resumed')), false);

  update({ systemd: true, daemon: true, instanceStatus: 'paused' });
  const paused = await previewAutoFix(startup);
  assert.equal(paused.approval, null);
  assert.match(paused.blockers[0].reason, /is paused/);
});

test('host preflight blocks mutations and defers recovery review while preserving task inventory', { timeout: 15000 }, async t => {
  const { directory, options } = fixture(t);
  const { bavail, bsize } = statfsSync(directory);
  const minFreeGiB = Math.floor((bavail * bsize) / 1024 ** 3) + 1;
  if (minFreeGiB > 1024) return t.skip('Host filesystem headroom exceeds the supported test threshold.');
  const plan = await previewAutoFix({ ...options, minFreeGiB });
  assert.equal(plan.approval, null);
  assert.ok(plan.blockers.some(item => item.phase === 'preflight'));
  assert.equal(plan.phases.find(phase => phase.name === 'task-inventory').state, 'completed');
  assert.equal(plan.phases.find(phase => phase.name === 'recovery').state, 'deferred');
});

test('one apply holds the profile lock, preserves completed steps after interruption, and safely accepts a fresh plan', { timeout: 25000 }, async t => {
  const { directory, options, root, receipts, update } = fixture(t);
  update({ daemon: true, interrupt: ids[3] });
  const plan = await previewAutoFix(options);
  const policy = autoFixPolicy(options);
  const first = await launchAutoFix(policy, plan.approval, undefined, root);
  const marker = join(directory, 'interruption');
  const pids = await until(async () => {
    if (existsSync(marker)) return JSON.parse(readFileSync(marker, 'utf8'));
    const status = await receiptStatus(receipts, first.id);
    assert.equal(status.status, 'running', JSON.stringify(status));
    return null;
  }, Boolean);
  try {
    await assert.rejects(launchAutoFix(autoFixPolicy({ ...options, stateDir: join(directory, 'another-state-path') }), plan.approval, undefined, root), /already running/);
  } finally {
    process.kill(pids.worker, 'SIGKILL');
    process.kill(pids.child, 'SIGKILL');
  }
  const interrupted = await until(
    () => receiptStatus(receipts, first.id),
    receipt => receipt.status === 'interrupted'
  );
  assert.deepEqual(
    interrupted.actions.map(action => action.state),
    ['completed', 'running']
  );
  assert.equal(interrupted.actions[0].result.id, ids[2]);
  await assert.rejects(launchAutoFix(policy, plan.approval, undefined, root), /before another apply/);

  update({ daemon: true });
  const fresh = await previewAutoFix(options);
  assert.deepEqual(
    fresh.actions.map(action => action.candidate.id),
    [ids[3]]
  );
  const next = await launchAutoFix(policy, fresh.approval, first.id, root);
  const complete = await until(
    () => receiptStatus(receipts, next.id),
    receipt => receipt.status !== 'running'
  );
  assert.equal(complete.status, 'completed');
  assert.equal((await launchAutoFix(policy, fresh.approval, undefined, root)).id, next.id);
  assert.equal((await receiptStatus(receipts, first.id)).status, 'interrupted');
  assert.deepEqual(readFileSync(join(directory, 'resumed'), 'utf8').trim().split('\n'), [ids[2], ids[3]]);
});
