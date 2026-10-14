/**
 * @hive-mind-test-suite default
 * Issue #3210: a task container that already exited kept its Formal AI lease
 * for the whole one-hour launch grace, because `containerSeen` was only set
 * when the container was observed *running*. A task that finished between two
 * maintenance ticks therefore pinned the sidecar, and the verbose log claimed
 * the container "has not appeared yet" although Docker reported it.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3210
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { LEASE_START_GRACE_MS, describeLeaseLauncher, inspectDockerContainer, isLeaseLaunchAbandoned, reconcileSidecarLeases } from '../src/docker-sidecar.lib.mjs';

const NOW = Date.parse('2026-10-14T12:00:00Z');
const lease = (sessionId, ageMs, extra = {}) => ({ sessionId, acquiredAt: new Date(NOW - ageMs).toISOString(), containerSeen: false, ...extra });

/** A `docker inspect` stub; `containers` maps a name to its reported state. */
const stubDocker = containers => {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    assert.equal(command, 'docker');
    assert.equal(args[0], 'inspect');
    const container = containers[args[1]];
    if (!container) {
      const error = new Error(`Command failed: docker inspect ${args[1]}`);
      error.stderr = `Error: No such object: ${args[1]}`;
      throw error;
    }
    const format = args[3];
    // Answer only the fields asked for, so the stub works with any format.
    const fields = { '{{.State.Running}}': String(container.status === 'running'), '{{.Config.Image}}': 'img', '{{.Image}}': 'sha256:abc', '{{.State.Status}}': container.status };
    return { stdout: `${format.replace(/\{\{[^}]+\}\}/g, field => fields[field] ?? '')}\n` };
  };
  return { run, calls };
};

const reconcile = async (leases, containers) => {
  const lines = [];
  const dropped = [];
  const { run } = stubDocker(containers);
  const live = await reconcileSidecarLeases(leases, { run, now: () => NOW, verbose: true, log: async line => lines.push(line), onDropped: dropped.push.bind(dropped) });
  return { live, lines, dropped };
};

test('an exited task container ends its lease at once, even inside the launch grace', async () => {
  const { live, dropped, lines } = await reconcile([lease('task-exited', 30_000)], { 'task-exited': { status: 'exited' } });
  assert.deepEqual(live, []);
  assert.deepEqual(
    dropped.map(entry => entry.sessionId),
    ['task-exited']
  );
  assert.ok(!lines.some(line => /has not appeared yet/.test(line)), lines.join('\n'));
});

test('a dead task container ends its lease at once', async () => {
  const { live } = await reconcile([lease('task-dead', 5_000)], { 'task-dead': { status: 'dead' } });
  assert.deepEqual(live, []);
});

test('a running task container marks the lease as seen and keeps it', async () => {
  const { live } = await reconcile([lease('task-running', 5_000)], { 'task-running': { status: 'running' } });
  assert.equal(live.length, 1);
  assert.equal(live[0].containerSeen, true);
});

test('a container that exists but has not started yet is seen and kept', async () => {
  const { live } = await reconcile([lease('task-created', 5_000)], { 'task-created': { status: 'created' } });
  assert.equal(live.length, 1);
  assert.equal(live[0].containerSeen, true);
});

test('the launch grace applies only while the task container does not exist', async () => {
  const { live, lines } = await reconcile([lease('task-launching', 60_000)], {});
  assert.equal(live.length, 1);
  assert.equal(live[0].containerSeen, false);
  const keep = lines.find(line => line.includes("'task-launching'"));
  assert.match(keep, /does not exist yet/);
  assert.doesNotMatch(keep, /has not appeared yet/);

  const expired = await reconcile([lease('task-never-launched', LEASE_START_GRACE_MS + 1_000)], {});
  assert.deepEqual(expired.live, []);
});

test('a lease whose container was seen and is now gone is dropped', async () => {
  const { live } = await reconcile([lease('task-gone', 5_000, { containerSeen: true })], {});
  assert.deepEqual(live, []);
});

test('a container that was seen once keeps its lease while Docker restarts it', async () => {
  const { live } = await reconcile([lease('task-restart', LEASE_START_GRACE_MS * 3, { containerSeen: true })], { 'task-restart': { status: 'restarting' } });
  assert.equal(live.length, 1);
});

test('inspectDockerContainer reports the container status', async () => {
  const { run } = stubDocker({ 'task-exited': { status: 'exited' } });
  const container = await inspectDockerContainer('task-exited', { run });
  assert.equal(container.exists, true);
  assert.equal(container.running, false);
  assert.equal(container.status, 'exited');
});

test('an older inspect answer without a status still counts an existing, stopped container as stopped', async () => {
  const run = async () => ({ stdout: 'false|img|sha256:abc\n' });
  const live = await reconcileSidecarLeases([lease('task-legacy', 5_000)], { run, now: () => NOW });
  assert.deepEqual(live, []);
});

test('a lease whose launcher exited before creating the container ends at once, inside the launch grace', async () => {
  const host = 'hive-host';
  const leases = [lease('task-launcher-gone', 30_000, { launcher: { pid: 4242, host } }), lease('task-launcher-alive', 30_000, { launcher: { pid: 4343, host } }), lease('task-other-host', 30_000, { launcher: { pid: 4242, host: 'elsewhere' } }), lease('task-old-lease', 30_000)];
  const lines = [];
  const dropped = [];
  const { run } = stubDocker({});
  const live = await reconcileSidecarLeases(leases, { run, now: () => NOW, verbose: true, log: async line => lines.push(line), onDropped: dropped.push.bind(dropped), host, processAlive: pid => pid === 4343 });
  assert.deepEqual(
    dropped.map(entry => entry.sessionId),
    ['task-launcher-gone']
  );
  assert.deepEqual(
    live.map(entry => entry.sessionId),
    ['task-launcher-alive', 'task-other-host', 'task-old-lease']
  );
  assert.match(
    lines.find(line => line.includes("dropping lease 'task-launcher-gone'")),
    /the process launching it \(pid 4242\) exited before creating the task container/
  );
});

test('a lease records the process launching its task, and a live launcher is recognised', () => {
  const launcher = describeLeaseLauncher();
  assert.equal(launcher.pid, process.pid);
  assert.equal(typeof launcher.host, 'string');
  assert.equal(isLeaseLaunchAbandoned({ launcher }), false, 'this very process is alive');
  assert.equal(isLeaseLaunchAbandoned({ launcher: { pid: 1, host: launcher.host } }, { processAlive: () => false }), true);
  assert.equal(isLeaseLaunchAbandoned({}), false, 'an older lease without a launcher keeps the plain grace');
});
