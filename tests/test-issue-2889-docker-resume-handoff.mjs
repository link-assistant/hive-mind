#!/usr/bin/env node

/**
 * Issue #2889: kill recoveries must not commit whole task writable layers.
 *
 * Every in-place resume used to pass a command to `$ --resume`, which makes
 * start-command `docker commit` the stopped container (tens of GB for a Rust or
 * Node build), with no free-space check and several at once after one OOM
 * event — the disk filled. Now:
 *
 *   1. Task containers are created with a command-handoff prefix; a recovery
 *      writes its command into the stopped container (`docker cp`) and runs
 *      `$ --resume <uuid>` without a command, i.e. `docker start` — no copy.
 *   2. Containers created without the prefix still need a snapshot; those run
 *      one at a time, only with free-disk headroom, and the stopped original is
 *      removed afterwards. Snapshot images go when the work finishes.
 *   3. The recovery status says "waiting for disk" / "snapshotting N GiB".
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2889
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildDockerResumeHandoffPath, buildDockerResumeHandoffScript, buildShellCommandLine, getDockerTaskContainerName, parseDockerResumeHandoffPath, removeDockerSnapshotImages, removeStoppedDockerContainer, settleDockerTaskContainerActionAfterRecovery, withDockerResumeHandoff, writeDockerResumeHandoff } from '../src/docker-resume-handoff.lib.mjs';
import { createDockerSnapshotQueue, evaluateSnapshotDiskHeadroom, formatSnapshotDiskWait, waitForSnapshotDiskHeadroom } from '../src/docker-resume-snapshot-guard.lib.mjs';
import { buildRecoveryShellCommand, IN_PLACE_SKIP_REASONS, resumeKilledSessionInPlace } from '../src/session-kill-resume.in-place.lib.mjs';
import { collectSnapshotImages, recoverKilledSession } from '../src/session-kill-resume.lib.mjs';
import { enforceContainerDiskLimitForSession } from '../src/container-resource-monitor.lib.mjs';
import { buildDockerTaskContainerCompletionAction, monitorSessions, resetSessionMonitorForTests, STALE_EXECUTING_MIN_AGE_MS, trackSession } from '../src/session-monitor.lib.mjs';
import { formatRecoveryLifecycle, reportRecoveryLifecycle } from '../src/session-recovery-lifecycle.lib.mjs';
import { RESUME_MODES } from '../src/isolation-runner.resume.lib.mjs';
import { initI18n } from '../src/i18n.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #2889: kill recovery without whole-container snapshots');
console.log('='.repeat(78));

await initI18n('en');

const GIB = 1024 ** 3;
const MIB = 1024 ** 2;
const SESSION = '2889aaaa-0000-4000-8000-000000000001';
const UUID = '2889bbbb-0000-4000-8000-000000000002';
const TOOL_SESSION = '2889cccc-0000-4000-8000-000000000003';
const HANDOFF = buildDockerResumeHandoffPath(SESSION);
const plan = { command: { args: ['https://github.com/link-assistant/hive-mind/pull/2894', '--resume', TOOL_SESSION], display: `/solve https://github.com/link-assistant/hive-mind/pull/2894 --resume ${TOOL_SESSION}` }, shouldResume: true, attempt: 1, maxAttempts: 2 };
const killedSession = (overrides = {}) => ({ isolationBackend: 'docker', sessionId: SESSION, executionUuid: UUID, command: 'solve', tool: 'claude', args: ['https://github.com/link-assistant/hive-mind/pull/2894', '--on-session-kill', 'resume'], ...overrides });

const quiet = async fn => {
  const original = console.warn;
  const warnings = [];
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    return { value: await fn(), warnings };
  } finally {
    console.warn = original;
  }
};

const makeRunner = ({ handoff = HANDOFF, write = { success: true, error: null }, resume = null, writableBytes = 20 * GIB, availableGiB = 200, gate = null, ...extra } = {}) => {
  const calls = { exists: [], handoffReads: [], writes: [], resume: [], removed: [], gates: [], reapply: [] };
  return {
    calls,
    getStartCommandVersion: async () => '0.35.4',
    generateSessionId: () => 'fresh-2889-0000-0000-000000000000',
    executeWithIsolation: async () => ({ success: true, executionUuid: 'fresh-uuid' }),
    checkDockerContainerExists: async name => (calls.exists.push(name), true),
    ...(handoff === undefined ? {} : { readDockerResumeHandoffPath: async name => (calls.handoffReads.push(name), handoff) }),
    writeDockerResumeHandoff: async (name, handoffPath, command) => (calls.writes.push({ name, handoffPath, command }), write),
    resumeIsolatedSession: async (identifier, options) => {
      calls.resume.push({ identifier, options });
      if (gate) await gate;
      return resume || { success: true, uuid: UUID, mode: RESUME_MODES.DOCKER_START, sessionName: SESSION };
    },
    getDockerContainerWritableLayerSize: async () => writableBytes,
    checkDockerDiskSpace: async () => ({ availableGiB, dataRoot: '/var/lib/docker' }),
    removeStoppedDockerContainer: async name => (calls.removed.push(name), { success: true, error: null }),
    releaseDockerContainerStartGate: async name => (calls.gates.push(name), { success: true }),
    applyDockerContainerResourceLimits: async (name, requested) => (calls.reapply.push({ name, requested }), { success: true, error: null }),
    ...extra,
  };
};

console.log('\n1. The command handoff prefix');
assert(HANDOFF === `/tmp/hive-mind-resume-command-${SESSION}`, 'the handoff file is named after the session id');
assert(buildDockerResumeHandoffPath("x'; rm -rf /") === null && buildDockerResumeHandoffPath('') === null, 'a token that is not path-safe gets no handoff');
const wrapped = withDockerResumeHandoff('echo original', SESSION);
assert(wrapped.endsWith('; echo original') && wrapped.startsWith(`h='${HANDOFF}'`), 'the original command runs unchanged after the handoff check');
assert(withDockerResumeHandoff('echo original', null) === 'echo original', 'without a token the command is not wrapped');
assert(parseDockerResumeHandoffPath(JSON.stringify(['/bin/sh', '-c', wrapped])) === HANDOFF, 'the handoff path is read back from `docker inspect` Config.Cmd JSON');
assert(parseDockerResumeHandoffPath(JSON.stringify(['/bin/sh', '-c', 'solve https://x'])) === null, 'a container created before the prefix has no handoff');
assert(buildShellCommandLine('solve', ['a b', "it's"]) === `'solve' 'a b' 'it'\\''s'`, 'recovery arguments are shell-quoted');
assert(buildRecoveryShellCommand(killedSession(), plan) === `'solve' 'https://github.com/link-assistant/hive-mind/pull/2894' '--resume' '${TOOL_SESSION}'`, 'the container runs `solve`, never the chat display form `/solve ...`');
assert(buildDockerResumeHandoffScript("'solve' '--resume' 'x'").includes("\nexec 'solve' '--resume' 'x'\n"), 'the handoff file execs the recovery command');

// Real shell semantics: first start runs the task, a restart runs the handoff.
const token = `test-2889-${process.pid}`;
const tokenPath = buildDockerResumeHandoffPath(token);
const run = () => spawnSync('sh', ['-c', withDockerResumeHandoff('echo original-task', token)], { encoding: 'utf8' }).stdout.trim();
try {
  fs.rmSync(tokenPath, { force: true });
  assert(run() === 'original-task', 'sh: with no handoff file the original command runs');
  fs.writeFileSync(tokenPath, buildDockerResumeHandoffScript(buildShellCommandLine('echo', ['recovery', 'it\'s "quoted"'])));
  assert(run() === 'recovery it\'s "quoted"', 'sh: once the handoff file exists the recovery command runs instead');
} finally {
  fs.rmSync(tokenPath, { force: true });
}

assert(getDockerTaskContainerName({ sessionId: UUID, containerName: SESSION }, UUID) === SESSION, 'Docker probes use the recorded container name over the tracking key');
assert(getDockerTaskContainerName({ sessionId: SESSION }, 'x') === SESSION && getDockerTaskContainerName(null, 'x') === 'x', 'without one they use the session id, then the key');

console.log('\n2. Docker command helpers report failures (command-stream does not throw)');
const fakeDollar = (code, stderr = '') => {
  const seen = [];
  const $ =
    () =>
    (strings, ...values) => (seen.push(strings.reduce((text, part, i) => text + part + (i < values.length ? values[i] : ''), '')), Promise.resolve({ code, stdout: '', stderr }));
  return { seen, getDollar: async () => $ };
};
const okDollar = fakeDollar(0);
assert((await writeDockerResumeHandoff(SESSION, HANDOFF, "'solve'", { getDollar: okDollar.getDollar })).success === true && okDollar.seen[0].startsWith('docker cp ') && okDollar.seen[0].endsWith(`${SESSION}:${HANDOFF}`), 'the handoff is copied into the container with `docker cp`');
const badCp = await writeDockerResumeHandoff(SESSION, HANDOFF, "'solve'", { getDollar: fakeDollar(1, 'Error: No such container').getDollar });
assert(badCp.success === false && badCp.error.includes('No such container'), 'a failed `docker cp` is a failure, not a silent success');
const rmDollar = fakeDollar(0);
await removeStoppedDockerContainer(SESSION, { getDollar: rmDollar.getDollar });
assert(rmDollar.seen[0] === `docker rm ${SESSION}`, 'the snapshotted original is removed without -f, so a running container is never killed');
const rmiDollar = fakeDollar(0);
const rmi = await removeDockerSnapshotImages(['img:1', 'img:2', 'img:1'], { getDollar: rmiDollar.getDollar });
assert(rmi.removed.join() === 'img:2,img:1' && rmiDollar.seen.join('|') === 'docker rmi img:2|docker rmi img:1', 'snapshot images are removed newest first, once each');
const rmiFail = await removeDockerSnapshotImages(['img:1'], { getDollar: fakeDollar(1, 'image is being used by stopped container').getDollar });
assert(rmiFail.failed[0]?.error.includes('being used'), 'an image still in use is reported, not forced');

console.log('\n3. The snapshot disk guard');
assert(evaluateSnapshotDiskHeadroom({ writableBytes: null, availableBytes: 5 * GIB }).ok === true, 'an unmeasured layer does not block (previous behaviour)');
const tight = evaluateSnapshotDiskHeadroom({ writableBytes: 20 * GIB, availableBytes: 45 * GIB });
assert(tight.ok === false && tight.requiredBytes === 50 * GIB, 'a 20 GiB layer needs 2 × 20 + 10 GiB free');
assert(evaluateSnapshotDiskHeadroom({ writableBytes: 20 * GIB, availableBytes: 50 * GIB }).ok === true, 'exactly enough is enough');
assert(formatSnapshotDiskWait(tight) === 'Waiting for disk: 45.0 GiB free on the Docker data root, 50.0 GiB needed to snapshot this 20.0 GiB container safely.', 'the waiting status names free, needed and layer sizes');
{
  let clock = 0;
  const free = [10, 10, 60];
  const waits = [];
  const result = await waitForSnapshotDiskHeadroom({ measure: async () => ({ writableBytes: 20 * GIB, availableBytes: free.shift() * GIB }), onWaiting: async e => waits.push(e), sleep: async ms => (clock += ms), now: () => clock, waitMs: 120_000, pollMs: 30_000 });
  assert(result.ok === true && waits.length === 2 && result.waitedMs === 60_000, 'the guard re-checks until space appears');
  clock = 0;
  const never = await waitForSnapshotDiskHeadroom({ measure: async () => ({ writableBytes: 20 * GIB, availableBytes: 10 * GIB }), sleep: async ms => (clock += ms), now: () => clock, waitMs: 90_000, pollMs: 30_000 });
  assert(never.ok === false && never.waitedMs === 90_000, 'and gives up after the wait budget');
}
{
  const queue = createDockerSnapshotQueue();
  const order = [];
  const queued = [];
  let releaseFirst;
  const first = queue.run(async () => {
    order.push('first:start');
    await new Promise(resolve => (releaseFirst = resolve));
    order.push('first:end');
  });
  const second = queue.run(async () => order.push('second:start'), { onQueued: ahead => queued.push(ahead) });
  await new Promise(resolve => setImmediate(resolve));
  assert(queue.pending() === 2 && order.join() === 'first:start' && queued[0] === 1, 'a second snapshot waits, and is told how many are ahead');
  releaseFirst();
  await Promise.all([first, second]);
  assert(order.join() === 'first:start,first:end,second:start' && queue.pending() === 0, 'snapshots run strictly one at a time');
  const failing = queue.run(async () => {
    throw new Error('boom');
  });
  assert(await failing.then(() => false).catch(() => true), 'a failing snapshot rejects its own caller');
  assert((await queue.run(async () => 'next')) === 'next', 'and does not block the queue');
}

console.log('\n4. Handoff-capable containers resume with docker start (no copy)');
{
  const runner = makeRunner();
  const events = [];
  const result = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: killedSession({ containerFilesystemInheritedBytes: 5 * MIB }), plan, runner, notify: async e => events.push(e) });
  assert(result.resumed === true && result.reason === 'resumed-docker-start' && result.mode === RESUME_MODES.DOCKER_START, 'the container is restarted with docker start');
  assert(runner.calls.resume[0].identifier === UUID && runner.calls.resume[0].options.command === null, '`$ --resume <uuid>` is called WITHOUT a command, so nothing is committed');
  assert(runner.calls.writes[0]?.name === SESSION && runner.calls.writes[0].handoffPath === HANDOFF && runner.calls.writes[0].command === buildRecoveryShellCommand(killedSession(), plan), 'the recovery command is handed to the stopped container first');
  assert(result.sessionId === UUID && result.containerName === SESSION && result.containerReused === true, 'tracked under the UUID (the killed key is deleted on completion), probing the same container');
  assert(result.containerFilesystemInheritedBytes === 5 * MIB, 'earlier carried usage stays; the writable layer is the same one');
  assert(
    events.some(e => /docker start \(no filesystem copy\)/.test(e.detail || '')),
    'the recovery status says no copy is made'
  );
  assert(runner.calls.removed.length === 0 && runner.calls.gates.length === 0, 'nothing is removed and no start gate is involved');

  const uuidKeyed = makeRunner();
  const uuidResult = await resumeKilledSessionInPlace({ sessionName: UUID, sessionInfo: killedSession({ containerName: SESSION, sessionId: UUID }), plan, runner: uuidKeyed });
  assert(uuidResult.sessionId === SESSION && uuidResult.containerName === SESSION, 'a killed recovery tracked under the UUID is followed by one tracked under the container name');

  const limited = makeRunner({ getStartCommandVersion: async () => '0.34.1' });
  const limitedResult = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: killedSession({ containerResourceLimits: { cpuCores: 2, requested: { cpu: '2' } } }), plan, runner: limited });
  assert(limitedResult.resumed === true && limited.calls.reapply.length === 0, 'docker start keeps the HostConfig limits on any `$` version; nothing to re-assert');

  const failedWrite = makeRunner({ write: { success: false, error: 'Error: No such container' } });
  const { value: failedResult, warnings } = await quiet(() => resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: killedSession(), plan, runner: failedWrite }));
  assert(failedResult.resumed === false && failedResult.reason === IN_PLACE_SKIP_REASONS.HANDOFF_FAILED && failedWrite.calls.resume.length === 0, 'without a handoff the container is not started (it would re-run the gated task)');
  assert(
    warnings.some(line => line.includes('Could not hand the recovery command')),
    'the failed handoff is logged'
  );

  const raced = makeRunner({ resume: { success: true, uuid: UUID, mode: RESUME_MODES.RELAUNCH, sessionName: SESSION } });
  const racedResult = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: killedSession({ containerResourceLimits: { cpuCores: 2, requested: { cpu: '2' } } }), plan, runner: raced });
  assert(racedResult.resumed === true && raced.calls.gates[0] === SESSION, 'a relaunch (container vanished meanwhile) has its start gate released');
  assert(raced.calls.reapply[0]?.name === SESSION, 'and its CPU/RAM limits re-asserted');
}

console.log('\n5. Containers without the handoff: guarded snapshots');
{
  const snapshot = { success: true, uuid: UUID, mode: RESUME_MODES.DOCKER_SNAPSHOT, sessionName: `${SESSION}-resume-1`, snapshotImage: `start-command-resume/${SESSION}:1` };
  const runner = makeRunner({ handoff: null, resume: snapshot });
  const events = [];
  const result = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: killedSession(), plan, runner, notify: async e => events.push(e), snapshotQueue: createDockerSnapshotQueue(), env: {} });
  assert(result.resumed === true && result.reason === 'resumed-in-place' && result.snapshotImage === snapshot.snapshotImage, 'an old container still resumes by snapshot');
  assert(runner.calls.writes.length === 0, 'no handoff is written to a container that cannot read it');
  assert(parseDockerResumeHandoffPath(runner.calls.resume[0].options.command) !== null, 'the snapshot-derived container gets a handoff, so its next recovery is a docker start');
  assert(runner.calls.removed[0] === SESSION && result.originalContainerRemoved === true, 'the stopped original is removed once the snapshot container runs');
  assert(
    events.some(e => e.detail === 'Snapshotting the 20.0 GiB container filesystem (the container predates the docker start handoff).'),
    'the recovery status says how much is being snapshotted'
  );

  const kept = makeRunner({ handoff: undefined, resume: snapshot });
  const keptResult = await resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: killedSession(), plan, runner: kept, snapshotQueue: createDockerSnapshotQueue(), env: { HIVE_MIND_KEEP_TASK_CONTAINER: 'always' } });
  assert(keptResult.resumed === true && kept.calls.removed.length === 0 && keptResult.originalContainerRemoved === false, 'HIVE_MIND_KEEP_TASK_CONTAINER=always keeps the original');

  let clock = 0;
  const full = makeRunner({ handoff: null, resume: snapshot, availableGiB: 30 });
  const fullEvents = [];
  const { value: fullResult, warnings } = await quiet(() => resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: killedSession(), plan, runner: full, notify: async e => fullEvents.push(e), snapshotQueue: createDockerSnapshotQueue(), sleep: async ms => (clock += ms), now: () => clock }));
  assert(fullResult.resumed === false && fullResult.reason === IN_PLACE_SKIP_REASONS.INSUFFICIENT_DISK && full.calls.resume.length === 0, 'without headroom no snapshot is taken; the fresh path is used');
  assert(fullEvents.filter(e => /^Waiting for disk: 30\.0 GiB free/.test(e.detail || '')).length === 1, 'the recovery status reports "waiting for disk" once, not every poll');
  assert(
    warnings.some(line => line.includes('Not snapshotting')),
    'the fallback is logged'
  );

  const queue = createDockerSnapshotQueue();
  let releaseFirst;
  const gate = new Promise(resolve => (releaseFirst = resolve));
  const first = makeRunner({ handoff: null, resume: snapshot, gate });
  const second = makeRunner({ handoff: null, resume: snapshot });
  const secondEvents = [];
  const firstRun = resumeKilledSessionInPlace({ sessionName: SESSION, sessionInfo: killedSession(), plan, runner: first, snapshotQueue: queue });
  const secondRun = resumeKilledSessionInPlace({ sessionName: 'other', sessionInfo: killedSession({ sessionId: 'other', executionUuid: 'other-uuid' }), plan, runner: second, snapshotQueue: queue, notify: async e => secondEvents.push(e) });
  await new Promise(resolve => setTimeout(resolve, 20));
  assert(first.calls.resume.length === 1 && second.calls.resume.length === 0, 'a second snapshot does not start while the first runs');
  assert(
    secondEvents.some(e => e.detail === 'Waiting for 1 other container snapshot to finish first.'),
    'and its recovery status says why it waits'
  );
  releaseFirst();
  await Promise.all([firstRun, secondRun]);
  assert(second.calls.resume.length === 1, 'it runs once the first is done');
}

console.log('\n6. The tracked recovery session');
{
  const tracked = [];
  const recovered = await recoverKilledSession({
    sessionName: SESSION,
    sessionInfo: killedSession({ containerFilesystemStartBytes: 3 * MIB, containerSnapshotImages: ['start-command-resume/old:1'] }),
    killed: true,
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    readLastSessionId: () => TOOL_SESSION,
    runner: makeRunner(),
    trackSession: (name, info) => tracked.push({ name, info }),
  });
  assert(recovered.resumed === true && recovered.containerReused === true && recovered.inPlace === true, 'recoverKilledSession() reports a reused container');
  assert(tracked[0]?.name === UUID && tracked[0].info.containerName === SESSION && tracked[0].info.executionUuid === UUID, 'the recovery is tracked under the UUID, with the container name for probes');
  assert(tracked[0].info.containerFilesystemStartBytes === 3 * MIB, 'the disk baseline of the same writable layer is kept');
  assert(tracked[0].info.containerSnapshotImages?.join() === 'start-command-resume/old:1', 'images of earlier snapshots stay with the execution until it finishes');
  assert(collectSnapshotImages({ containerSnapshotImages: ['a'] }, 'b').join() === 'a,b' && collectSnapshotImages({}, null) === undefined, 'a new snapshot image is appended to the chain');

  const killed = [];
  await enforceContainerDiskLimitForSession(UUID, { ...tracked[0].info, containerResourceLimits: { diskBytes: 10 * MIB } }, 20 * MIB, { killContainer: async name => (killed.push(name), { success: true }) });
  assert(killed[0] === SESSION, 'the disk limit stops the container, not a container named after the UUID');
}

console.log('\n7. Completion of the killed session and of the recovery');
{
  const action = buildDockerTaskContainerCompletionAction({ sessionName: UUID, sessionInfo: { isolationBackend: 'docker', sessionId: UUID, containerName: SESSION, containerSnapshotImages: ['img:1'] }, exitCode: 1, status: 'executed', env: {} });
  assert(action.containerName === SESSION && action.snapshotImages.join() === 'img:1', 'the completion action targets the recorded container and its images');
  assert(action.extraSection.includes('Snapshot images: `img:1`') && action.extraSection.includes('docker rmi img:1'), 'a kept container names its snapshot images and how to remove them');

  const killedAction = buildDockerTaskContainerCompletionAction({ sessionName: SESSION, sessionInfo: { isolationBackend: 'docker', sessionId: SESSION, containerSnapshotImages: ['img:1'] }, exitCode: 137, status: 'executed', env: { HIVE_MIND_KEEP_TASK_CONTAINER: 'never' } });
  settleDockerTaskContainerActionAfterRecovery(killedAction, { resumed: true, containerReused: true });
  assert(killedAction.shouldRemove === false && killedAction.extraSection === '' && killedAction.snapshotImages.length === 0, 'a container restarted by the recovery is neither removed nor reported as kept');
  const freshAction = buildDockerTaskContainerCompletionAction({ sessionName: SESSION, sessionInfo: { isolationBackend: 'docker', sessionId: SESSION }, exitCode: 137, status: 'executed', env: { HIVE_MIND_KEEP_TASK_CONTAINER: 'never' } });
  settleDockerTaskContainerActionAfterRecovery(freshAction, { resumed: true, containerReused: false });
  assert(freshAction.shouldRemove === true, 'after a fresh-launch recovery the killed container follows the keep policy as before');
}

const LOG = path.join(os.tmpdir(), `hive-mind-test-2889-${process.pid}.log`);
const makeBot = () => {
  const edits = [];
  return { edits, telegram: { editMessageText: async (_c, _m, _i, text) => edits.push(text), sendMessage: async (_c, text) => (edits.push(text), { message_id: 1 }) } };
};
const baseInfo = () => ({ chatId: 1, messageId: 2, command: 'solve', tool: 'claude', url: 'https://github.com/link-assistant/hive-mind/issues/2889', urlContext: { type: 'issue', owner: 'link-assistant', repo: 'hive-mind', number: 2889 }, isolationBackend: 'docker', locale: 'en', logPath: LOG, startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000) });
fs.writeFileSync(LOG, `📌 Session ID: ${TOOL_SESSION}\nKilled\n`);
try {
  resetSessionMonitorForTests();
  trackSession(SESSION, { ...baseInfo(), sessionId: SESSION, executionUuid: UUID, args: ['https://github.com/link-assistant/hive-mind/issues/2889', '--on-session-kill', 'resume'] }, false);
  const removals = [];
  const runner = makeRunner();
  const tracked = [];
  await monitorSessions(makeBot(), false, {
    statusProvider: async () => ({ exists: true, status: 'executed', exitCode: 137, oomKilled: true, isolation: 'docker', logPath: LOG }),
    exitFromLog: () => ({ finished: true, exitCode: 137, endTime: new Date().toISOString() }),
    backendAlive: async () => false,
    dockerContainerSizeProvider: async () => null,
    readFile: async () => `📌 Session ID: ${TOOL_SESSION}\n`,
    lookupLinkedPullRequest: async () => null,
    lookupPullRequestState: async () => null,
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0', HIVE_MIND_KEEP_TASK_CONTAINER: 'never' },
    isolationRunner: runner,
    trackSession: (name, info) => tracked.push({ name, info }),
    removeDockerContainer: async name => (removals.push(name), { success: true }),
    runCommand: async () => ({ code: 0, stdout: '', stderr: '' }),
  });
  assert(runner.calls.resume.length === 1 && runner.calls.resume[0].options.command === null, 'monitor: a killed session is resumed with docker start');
  assert(tracked[0]?.name === UUID, 'monitor: the recovery is tracked under the UUID');
  assert(removals.length === 0, 'monitor: HIVE_MIND_KEEP_TASK_CONTAINER=never does not remove the container the recovery just restarted');

  resetSessionMonitorForTests();
  trackSession(UUID, { ...baseInfo(), sessionId: UUID, containerName: `${SESSION}-resume-1`, containerSnapshotImages: [`start-command-resume/${SESSION}:1`], executionUuid: UUID, args: ['https://github.com/link-assistant/hive-mind/issues/2889'] }, false);
  const finalRemovals = [];
  const imageRemovals = [];
  await monitorSessions(makeBot(), false, {
    statusProvider: async () => ({ exists: true, status: 'executed', exitCode: 0, isolation: 'docker', logPath: LOG }),
    exitFromLog: () => ({ finished: true, exitCode: 0, endTime: new Date().toISOString() }),
    backendAlive: async () => false,
    dockerContainerSizeProvider: async () => null,
    lookupLinkedPullRequest: async () => null,
    lookupPullRequestState: async () => null,
    env: {},
    removeDockerContainer: async name => (finalRemovals.push(name), { success: true }),
    removeDockerSnapshotImages: async images => (imageRemovals.push(...images), { removed: images, failed: [] }),
    runCommand: async () => ({ code: 0, stdout: '', stderr: '' }),
  });
  assert(finalRemovals[0] === `${SESSION}-resume-1`, 'monitor: the finished recovery removes the container it ran in');
  assert(imageRemovals.join() === `start-command-resume/${SESSION}:1`, 'monitor: and then the snapshot images it came from');
} finally {
  resetSessionMonitorForTests();
  fs.rmSync(LOG, { force: true });
}

console.log('\n8. Recovery status detail');
assert(formatRecoveryLifecycle({ phase: 'launching', attempt: 1, at: 'now', detail: 'Waiting for disk: x' }).split('\n').includes('Waiting for disk: x'), 'the detail is a line of the recovery status');
{
  const edits = [];
  const bot = { telegram: { editMessageText: async (_c, _m, _i, text) => edits.push(text) } };
  let now = 1_000_000;
  const sessionInfo = { chatId: 1, messageId: 2, recoveryLifecycle: { kind: 'container', attempt: 1, phase: 'launching', outerTerminal: false, lastReportedMs: now, detail: null } };
  const report = detail => reportRecoveryLifecycle({ bot, sessionName: SESSION, sessionInfo, phase: 'launching', attempt: 1, detail, options: { recoveryNow: () => now } });
  assert((await report('Waiting for disk: 1')) !== null && edits.at(-1).includes('Waiting for disk: 1'), 'a new detail is published although the phase is unchanged');
  now += 1000;
  assert((await report('Waiting for disk: 1')) === null, 'the same detail is not re-published before the heartbeat');
  assert((await report('Snapshotting the 20.0 GiB container filesystem')) !== null && edits.at(-1).includes('Snapshotting the 20.0 GiB'), 'the next stage replaces it');
}

printSummary(78);
process.exit(getFailCount() > 0 ? 1 : 0);
