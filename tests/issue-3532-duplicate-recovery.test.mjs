/**
 * @hive-mind-test-suite default
 * A healthy recovery must never be declared dead and launched a second time (#3532).
 *
 * In #3532 a `docker-start` in-place resume was tracked as `sessionId = <execution
 * UUID>`. `docker inspect <execution UUID>` found no container, so two minutes
 * later the monitor declared the running session dead and launched duplicate
 * solves for the same pull request.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSessionContainerName, resolveSessionContainerRoot, isContainerFamilyMember, parseRunningContainerFamily, probeSessionBackendAlive, findRunningSessionContainers, collectSessionContainerRoots, nextContainerNameHistory } from '../src/session-container-identity.lib.mjs';
import { findRunningDuplicate, startKillRecoverySession } from '../src/session-kill-resume.lib.mjs';
import { findOtherActiveSessionForUrl, resetSessionMonitorForTests, trackSession } from '../src/session-monitor.lib.mjs';
import { createIsolationAwareQueueCallback } from '../src/telegram-isolation.lib.mjs';
import { findLaunchingQueueItem } from '../src/session-kill-resume.resource-gate.lib.mjs';

// The identifiers of the voice-simulator session from #3532.
const CONTAINER = 'a84a2357-55f6-4a7e-9d1b-7c3c9a2c1f10';
const EXECUTION_UUID = '16c0000f-1b0e-4b8e-9c55-2f1d0f2c7a11';
const PR = 'https://github.com/link-foundation/voice-simulator/pull/7';

test('the container name wins over the execution UUID reported as sessionId', () => {
  const info = { sessionId: EXECUTION_UUID, containerName: CONTAINER, isolationBackend: 'docker' };
  assert.equal(resolveSessionContainerName('recovery', info), CONTAINER);
  // Sessions tracked before #3532 fall back to sessionId, then the tracking key.
  assert.equal(resolveSessionContainerName('key', { sessionId: CONTAINER }), CONTAINER);
  assert.equal(resolveSessionContainerName('key', {}), 'key');
  assert.equal(resolveSessionContainerRoot('key', { containerName: `${CONTAINER}-resume-2` }), CONTAINER);
  assert.equal(resolveSessionContainerRoot('key', { containerName: `${CONTAINER}-resume-2`, rootContainerName: 'explicit' }), 'explicit');
});

test('the container family is matched exactly, not as Docker substring filter does', () => {
  assert.ok(isContainerFamilyMember(CONTAINER, CONTAINER));
  assert.ok(isContainerFamilyMember(`/${CONTAINER}-resume-1`, CONTAINER));
  assert.ok(!isContainerFamilyMember(`${CONTAINER}-resume-x`, CONTAINER));
  assert.ok(!isContainerFamilyMember(`x${CONTAINER}`, CONTAINER));
  assert.ok(!isContainerFamilyMember('a84a2357', CONTAINER));
  const output = [`${CONTAINER}-resume-1`, `other-${CONTAINER}`, `${CONTAINER}-backup`, CONTAINER, ''].join('\n');
  assert.deepEqual(parseRunningContainerFamily(output, CONTAINER), [`${CONTAINER}-resume-1`, CONTAINER]);
});

test('the liveness probe asks for the container, and a running sibling outvotes a missing container', async () => {
  const probed = [];
  const probe = async name => (probed.push(name), false);
  const runner = { findRunningDockerContainerFamily: async root => (root === CONTAINER ? [`${CONTAINER}-resume-1`] : []) };
  const info = { sessionId: EXECUTION_UUID, containerName: CONTAINER, isolationBackend: 'docker' };
  assert.equal(await probeSessionBackendAlive('recovery', info, { probe, runner }), true);
  assert.deepEqual(probed, [CONTAINER], 'docker inspect is never asked about the execution UUID');
  assert.equal(await probeSessionBackendAlive('recovery', info, { probe, runner: { findRunningDockerContainerFamily: async () => [] } }), false);
  // Unknown stays unknown; screen sessions have no container family.
  assert.equal(await probeSessionBackendAlive('recovery', info, { probe: async () => null, runner }), null);
  assert.equal(await probeSessionBackendAlive('recovery', { ...info, isolationBackend: 'screen' }, { probe, runner }), false);
});

test('earlier attempts are part of the family a recovery checks before launching', async () => {
  const info = { containerName: 'fresh-2', containerNameHistory: [CONTAINER, `${CONTAINER}-resume-1`, 'fresh-1'] };
  assert.deepEqual(collectSessionContainerRoots('fresh-2', info), ['fresh-2', CONTAINER, 'fresh-1']);
  assert.deepEqual(nextContainerNameHistory('fresh-2', info), [CONTAINER, `${CONTAINER}-resume-1`, 'fresh-1', 'fresh-2']);
  const asked = [];
  const runner = { findRunningDockerContainerFamily: async root => (asked.push(root), root === CONTAINER ? [`${CONTAINER}-resume-1`] : []) };
  assert.deepEqual(await findRunningSessionContainers('fresh-2', info, { runner, includeHistory: true }), [`${CONTAINER}-resume-1`]);
  assert.deepEqual(asked, ['fresh-2', CONTAINER, 'fresh-1']);
  assert.deepEqual(await findRunningSessionContainers('fresh-2', info, { runner: { findRunningDockerContainerFamily: async () => Promise.reject(new Error('daemon down')) } }), []);
});

test('findRunningDuplicate names the running container or the sibling session', async () => {
  const info = { isolationBackend: 'docker', containerName: CONTAINER, url: PR };
  const running = { findRunningDockerContainerFamily: async () => [`${CONTAINER}-resume-1`] };
  const idle = { findRunningDockerContainerFamily: async () => [] };
  assert.match(await findRunningDuplicate({ sessionName: CONTAINER, sessionInfo: info, runner: running }), /container .*-resume-1 of the same task is still running/);
  assert.match(await findRunningDuplicate({ sessionName: CONTAINER, sessionInfo: info, runner: idle, findActiveSibling: async () => 'other-session' }), /session other-session is already working on .*pull\/7/);
  assert.equal(await findRunningDuplicate({ sessionName: CONTAINER, sessionInfo: info, runner: idle, findActiveSibling: async () => null }), null);
  assert.equal(await findRunningDuplicate({ sessionName: CONTAINER, sessionInfo: info, runner: idle, findActiveSibling: async () => Promise.reject(new Error('boom')) }), null, 'a failing check never blocks a recovery');
});

function recoveryRun({ running = [], sibling = null } = {}) {
  const launches = [];
  const phases = [];
  const tracked = [];
  const sessionInfo = { startTime: new Date(0), isolationBackend: 'docker', sessionId: EXECUTION_UUID, containerName: CONTAINER, url: PR, args: [PR], tool: 'claude' };
  const promise = startKillRecoverySession({
    sessionName: CONTAINER,
    sessionInfo,
    plan: { shouldResume: true, attempt: 2, maxAttempts: 3, command: { args: [PR, '--resume', 'tool-session'], display: 'solve' } },
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    onLifecycle: async event => phases.push(event),
    skipInPlace: 'container is gone',
    resolveFreshCommand: async ({ command }) => ({ command }),
    findActiveSibling: async () => sibling,
    runner: {
      generateSessionId: () => 'fresh-1',
      findRunningDockerContainerFamily: async () => running,
      executeWithIsolation: async (...args) => (launches.push(args), { success: true, executionUuid: 'exec-fresh' }),
    },
    trackSession: (name, info) => tracked.push({ name, info }),
  });
  return { promise, launches, phases, tracked, sessionInfo };
}

test('no recovery attempt launches while a container of the task still runs', async () => {
  const run = recoveryRun({ running: [`${CONTAINER}-resume-1`] });
  const result = await run.promise;
  assert.equal(result.resumed, false);
  assert.equal(result.reason, 'already-running');
  assert.match(result.detail, /-resume-1 of the same task is still running/);
  assert.equal(run.launches.length, 0, 'no second solve for the same pull request');
  assert.ok(run.phases.some(event => event.phase === 'failed' && /Recovery not started/.test(event.reason)));
  assert.ok(
    run.phases.every(event => event.maxAttempts === 3),
    'every lifecycle event carries attempt n/m'
  );
  assert.equal(run.sessionInfo.killRecoveryPendingSince, undefined, 'the pending marker is cleared after the decision');
});

test('no recovery attempt launches while another tracked session works on the same URL', async () => {
  const run = recoveryRun({ sibling: 'b405f409' });
  const result = await run.promise;
  assert.equal(result.reason, 'already-running');
  assert.equal(run.launches.length, 0);
});

test('a launched recovery records the container it runs in and every earlier one', async () => {
  const run = recoveryRun();
  const result = await run.promise;
  assert.equal(result.resumed, true);
  assert.equal(run.launches.length, 1);
  const [{ name, info }] = run.tracked;
  assert.equal(name, 'fresh-1');
  assert.equal(info.containerName, 'fresh-1');
  assert.equal(info.rootContainerName, CONTAINER);
  assert.deepEqual(info.containerNameHistory, [CONTAINER]);
});

test('a session waiting for its own recovery is not a live sibling, but its replacement is', () => {
  resetSessionMonitorForTests();
  try {
    trackSession('killed', { url: PR, isolationBackend: 'docker', startTime: new Date(), killRecoveryPendingSince: new Date().toISOString() });
    assert.equal(findOtherActiveSessionForUrl(PR, 'recovery'), null);
    trackSession('replacement', { url: PR, isolationBackend: 'docker', startTime: new Date() });
    assert.equal(findOtherActiveSessionForUrl(PR, 'killed'), 'replacement');
    assert.equal(findOtherActiveSessionForUrl(PR, 'replacement'), null, 'a session never blocks itself');
    trackSession('finished', { url: 'https://github.com/o/r/pull/1', isolationBackend: 'docker', startTime: new Date(), completionNotifiedAt: new Date().toISOString() });
    assert.equal(findOtherActiveSessionForUrl('https://github.com/o/r/pull/1', 'x'), null, 'a completed session does not block');
  } finally {
    resetSessionMonitorForTests();
  }
});

test('a queued solve is checked again right before it launches', async () => {
  const launched = [];
  const fallback = async item => (launched.push(item.url), { success: true, output: 'session: s1' });
  const busy = createIsolationAwareQueueCallback(
    null,
    null,
    () => {},
    fallback,
    false,
    null,
    async () => ({ isActive: true, sessionName: 'recovery-1' })
  );
  const refused = await busy({ url: PR, args: [PR] });
  assert.equal(refused.success, false);
  assert.match(refused.error, /session recovery-1 is already working on .*pull\/7; a second solve for the same task was not started/);
  assert.equal(launched.length, 0);
  const idle = createIsolationAwareQueueCallback(
    null,
    null,
    () => {},
    fallback,
    false,
    null,
    async () => ({ isActive: false })
  );
  assert.equal((await idle({ url: PR, args: [PR] })).success, true);
  // A failing check never blocks the queue; without a checker nothing changes.
  assert.equal(
    (
      await createIsolationAwareQueueCallback(
        null,
        null,
        () => {},
        fallback,
        false,
        null,
        async () => Promise.reject(new Error('boom'))
      )({ url: PR })
    ).success,
    true
  );
  assert.equal((await createIsolationAwareQueueCallback(null, null, () => {}, fallback, false)({ url: PR })).success, true);
});

test('a recovery sees a queue item for the same task that is being launched', () => {
  const item = { id: 'q-7', url: PR };
  const queue = { findByUrl: url => (url === PR ? item : null), processing: new Map([['q-7', item]]) };
  assert.equal(findLaunchingQueueItem(queue, PR), 'queue item q-7');
  assert.equal(findLaunchingQueueItem({ ...queue, processing: new Map() }, PR), null, 'a waiting item is refused at its own launch instead');
  assert.equal(findLaunchingQueueItem(null, PR), null);
  assert.equal(
    findLaunchingQueueItem(
      {
        findByUrl: () => {
          throw new Error('x');
        },
      },
      PR
    ),
    null
  );
});
