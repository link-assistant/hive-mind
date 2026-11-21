/**
 * In-place kill recoveries snapshot one container at a time, and only with
 * enough free disk (#2889).
 * @hive-mind-test-suite default
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resumeKilledSessionInPlace, IN_PLACE_SKIP_REASONS } from '../src/session-kill-resume.in-place.lib.mjs';
import { recoverKilledSession } from '../src/session-kill-resume.lib.mjs';
import { RESUME_MODES } from '../src/isolation-runner.resume.lib.mjs';
import { createSnapshotQueue, evaluateSnapshotDiskHeadroom, formatSnapshotDiskWait, SNAPSHOT_DISK_RESERVE_BYTES } from '../src/kill-recovery-snapshot-guard.lib.mjs';

const GIB = 1024 ** 3;
const URL = 'https://github.com/link-assistant/router/issues/724';
const info = (name, layerGiB) => ({ command: 'solve', commandAlias: 'codex', args: [URL, '--tool', 'codex'], tool: 'codex', isolationBackend: 'docker', sessionId: name, executionUuid: `${name}-uuid`, containerFilesystemLastBytes: Number.isFinite(layerGiB) ? layerGiB * GIB : undefined });
const plan = { attempt: 1, command: { binary: 'solve', args: [URL, '--tool', 'codex', '--resume', 'thread'] } };

function fakeRunner({ freeGiB = null } = {}) {
  const state = { active: 0, maxActive: 0, resumed: [] };
  let free = freeGiB;
  const runner = {
    state,
    setFree: value => {
      free = value;
    },
    checkDockerContainerExists: async () => true,
    checkDockerDiskSpace: async () => (Number.isFinite(free) ? { availableGiB: free, dataRoot: '/var/lib/docker' } : null),
    resumeIsolatedSession: async identifier => {
      state.active++;
      state.maxActive = Math.max(state.maxActive, state.active);
      await new Promise(resolve => setTimeout(resolve, 20));
      state.active--;
      state.resumed.push(identifier);
      const name = identifier.replace(/-uuid$/, '');
      return { success: true, uuid: identifier, mode: RESUME_MODES.DOCKER_SNAPSHOT, sessionName: `${name}-resume-1`, previousSessionName: name, snapshotImage: `start-command-resume/${name}:1` };
    },
    checkResumedDockerStartup: async () => ({ failed: false }),
  };
  return runner;
}

test('router incident: four concurrent recoveries commit one snapshot at a time', async () => {
  const runner = fakeRunner({ freeGiB: 500 });
  const queue = createSnapshotQueue();
  const notices = [];
  const names = ['router-724', 'router-725', 'router-727', 'router-728'];
  const results = await Promise.all(names.map((name, i) => resumeKilledSessionInPlace({ sessionName: name, sessionInfo: info(name, [11, 21.2, 23.5, 36.8][i]), plan, runner, notify: async event => notices.push(event), snapshotGuard: { queue } })));
  assert.equal(runner.state.maxActive, 1);
  assert.deepEqual(
    results.map(r => r.resumed),
    [true, true, true, true]
  );
  assert.ok(notices.some(event => /Waiting for \d+ other container snapshot/.test(event.reason || '')));
});

test('a snapshot that does not fit the free disk is not started; recovery falls back', async () => {
  const runner = fakeRunner({ freeGiB: 52 });
  const notices = [];
  let clock = 0;
  const result = await resumeKilledSessionInPlace({ sessionName: 'router-728', sessionInfo: info('router-728', 36.8), plan, runner, notify: async event => notices.push(event), snapshotGuard: { queue: createSnapshotQueue(), sleep: async ms => (clock += ms), now: () => clock } });
  assert.equal(result.resumed, false);
  assert.equal(result.reason, IN_PLACE_SKIP_REASONS.INSUFFICIENT_DISK);
  assert.match(result.error, /Waiting for disk: 52\.0 GiB free.*83\.6 GiB needed.*36\.8 GiB container/);
  assert.equal(runner.state.resumed.length, 0);
  assert.equal(notices.filter(event => /^Waiting for disk/.test(event.reason || '')).length, 1);
});

test('a snapshot waits for disk and proceeds once space appears', async () => {
  const runner = fakeRunner({ freeGiB: 20 });
  let clock = 0;
  const result = await resumeKilledSessionInPlace({
    sessionName: 'router-724',
    sessionInfo: info('router-724', 11),
    plan,
    runner,
    snapshotGuard: {
      queue: createSnapshotQueue(),
      now: () => clock,
      sleep: async ms => {
        clock += ms;
        runner.setFree(40);
      },
    },
  });
  assert.equal(result.resumed, true);
  assert.equal(runner.state.resumed.length, 1);
});

test('unmeasured free space keeps the previous behaviour; an unmeasured layer must still leave the reserve', async () => {
  const runner = fakeRunner();
  const result = await resumeKilledSessionInPlace({ sessionName: 'x', sessionInfo: info('x'), plan, runner, snapshotGuard: { queue: createSnapshotQueue() } });
  assert.equal(result.resumed, true);
  assert.equal(evaluateSnapshotDiskHeadroom({ writableBytes: 5 * GIB, availableBytes: null }).ok, true);
  // Issue #2889: 1 byte free used to pass because the layer size was unknown.
  const nearlyFull = evaluateSnapshotDiskHeadroom({ writableBytes: null, availableBytes: 1 });
  assert.deepEqual([nearlyFull.ok, nearlyFull.requiredBytes], [false, SNAPSHOT_DISK_RESERVE_BYTES]);
  assert.match(formatSnapshotDiskWait(nearlyFull), /10\.0 GiB needed to snapshot this unmeasured container safely/);
  assert.equal(evaluateSnapshotDiskHeadroom({ writableBytes: null, availableBytes: 20 * GIB }).ok, true);
});

test('through recoverKilledSession, a disk refusal reports why and starts fresh', async () => {
  const runner = { ...fakeRunner({ freeGiB: 12 }), generateSessionId: () => 'fresh', executeWithIsolation: async () => ({ success: true, executionUuid: 'fresh-uuid' }) };
  const events = [];
  const tracked = [];
  const recovered = await recoverKilledSession({
    sessionName: 'router-725',
    sessionInfo: info('router-725', 21.2),
    runner,
    killed: true,
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    snapshotGuard: { queue: createSnapshotQueue(), waitMs: 0 },
    readLastSessionId: () => 'thread',
    trackSession: (name, data) => tracked.push({ name, data }),
    onLifecycle: async event => events.push(event),
  });
  assert.equal(recovered.resumed, true);
  assert.equal(recovered.inPlace, false);
  assert.equal(tracked[0].name, 'fresh');
  assert.ok(events.some(event => /Not snapshotting router-725: Waiting for disk/.test(event.reason || '')));
});
