/**
 * @hive-mind-test-suite default
 * A container killed by a Docker daemon restart is not reported as OOM-killed (#2892).
 *
 * On 2026-10-09 the kernel OOM-killed the host dockerd at 12:11:39Z. systemd
 * restarted it, and at 12:11:55Z it force-killed every running container (exit
 * 137). Task containers that had survived earlier child OOM kills (rustc,
 * clippy-driver) kept Docker's sticky `State.OOMKilled = true`, so the bot
 * logged `status includes oomKilled=true … treating it as terminal oom-killed`
 * and the reports said the task ran out of memory.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { BOT_CONTAINER_RESTART_WINDOW_MS, DAEMON_RESTART_EXIT_REASON, correlateWithBotContainerRestart, detectDockerDaemonRestart, findDaemonRestartInJournal, isAttributedNonMemoryExitReason, isDaemonRestartExitReason, readBotContainerLifetime, readDockerDaemonStartedAt, readExitEvidenceFromLog } from '../src/docker-daemon-restart.lib.mjs';
import { resolveOomKilledState } from '../src/session-monitor.oom.lib.mjs';
import { KILL_CAUSE_DAEMON_RESTART, KILL_CAUSE_FORCED_KILL, KILL_CAUSE_HOST_REBOOT, KILL_CAUSE_OUT_OF_MEMORY, describeKillCause } from '../src/session-kill-diagnostics.lib.mjs';
import { buildKillRecoveryNotice } from '../src/session-kill-recovery.lib.mjs';
import { buildKillCompletionSections } from '../src/session-monitor.kill-sections.lib.mjs';
import { formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { serializeSessionInfo, deserializeSessionInfo } from '../src/session-store.lib.mjs';

const CONTAINER = '175ff931-26d8-4f47-b8f5-a84e6c6eceeb';
const CONTAINER_ID = '8bde925ce60038a2a057fd16985ec7e792f8110f3a70b776a6b32657f2e54dde';
const STARTED_AT = '2026-10-09T03:17:35.509Z';
const FINISHED_AT = '2026-10-09T12:11:56.236Z';
// The incident journal (CEST in the issue, UTC here).
const JOURNAL = ['2026-10-09T12:11:39+0000 host systemd[1]: docker.service: A process of this unit has been killed by the OOM killer.', '2026-10-09T12:11:41+0000 host systemd[1]: docker.service: Main process exited, code=killed, status=9/KILL', '2026-10-09T12:11:44+0000 host systemd[1]: docker.service: Scheduled restart job, restart counter is at 1.', '2026-10-09T12:11:45+0000 host dockerd[517913]: time="2026-10-09T14:11:45.479997354+02:00" level=info msg="Loading containers: start."', `2026-10-09T12:11:55+0000 host dockerd[517913]: time="2026-10-09T14:11:55.864559930+02:00" level=info msg="Container failed to exit within 10s of signal 15 - using the force" container=${CONTAINER_ID}`].join('\n');
const INCIDENT_STATUS = {
  exists: true,
  status: 'executed',
  exitCode: 137,
  oomKilled: true,
  exitReason: 'memory-exhaustion (cgroup-oom-killer)',
  memoryExhausted: true,
  memoryExhaustedReason: 'Docker reported State.OOMKilled=true',
  isolation: 'docker',
  endTime: FINISHED_AT,
};
const quiet = { log: () => {} };
// Every probe set stubs the bot-container anchor too, so no test touches a real docker.
const noBot = { readBotContainer: async () => null };
const noProbes = { ...noBot, inspect: async () => null, readJournal: async () => null, readDaemonStartedAt: async () => null };
const inspected = { ...noBot, inspect: async () => ({ id: CONTAINER_ID, startedAt: STARTED_AT, finishedAt: FINISHED_AT }) };

test('exit reasons: the daemon restart and any non-memory attribution are recognised', () => {
  assert.equal(isDaemonRestartExitReason(DAEMON_RESTART_EXIT_REASON), true);
  assert.equal(isDaemonRestartExitReason('memory-exhaustion (cgroup-oom-killer)'), false);
  assert.equal(isAttributedNonMemoryExitReason('signal (SIGKILL; cause unknown)'), true);
  assert.equal(isAttributedNonMemoryExitReason(DAEMON_RESTART_EXIT_REASON), true);
  assert.equal(isAttributedNonMemoryExitReason('memory-exhaustion (v8-heap-limit)'), false);
  assert.equal(isAttributedNonMemoryExitReason(''), false);
  assert.equal(isAttributedNonMemoryExitReason(null), false);
  assert.deepEqual(readExitEvidenceFromLog('x\nExit evidence: main-oom (recent cgroup oom_kill delta)\nExit evidence: docker-daemon-restart (Docker service journal)\n'), { daemonRestart: true, mainOom: false, line: 'Exit evidence: docker-daemon-restart (Docker service journal)' });
  assert.equal(readExitEvidenceFromLog('Exit evidence: main-oom (recent Docker oom event)').mainOom, true);
});

test('the journal needs a daemon line AND the force-kill line for this exact container', () => {
  const hit = findDaemonRestartInJournal(JOURNAL, CONTAINER_ID);
  assert.match(hit.daemonLine, /Main process exited/);
  assert.match(hit.forceLine, /using the force/);
  assert.equal(findDaemonRestartInJournal(JOURNAL, 'f'.repeat(64)), null, 'another container');
  // `docker stop` writes the force line too, without any daemon restart.
  const stopOnly = JOURNAL.split('\n').at(-1);
  assert.equal(findDaemonRestartInJournal(stopOnly, CONTAINER_ID), null);
});

test('detection: exit reason, log evidence, journal, then the daemon start time', async () => {
  const fromReason = await detectDockerDaemonRestart({ exitCode: 137, exitReason: DAEMON_RESTART_EXIT_REASON, containerName: CONTAINER, probes: { inspect: async () => assert.fail('no probe is needed') } });
  assert.equal(fromReason.detectedBy, 'exit-reason');
  const fromLog = await detectDockerDaemonRestart({ exitCode: 137, logText: 'Exit evidence: docker-daemon-restart (Docker service journal)', containerName: CONTAINER, probes: noProbes });
  assert.equal(fromLog.detectedBy, 'log-evidence');
  const fromJournal = await detectDockerDaemonRestart({ exitCode: 137, exitReason: 'memory-exhaustion (cgroup-oom-killer)', containerName: CONTAINER, probes: { ...inspected, readJournal: async () => JOURNAL } });
  assert.equal(fromJournal.detectedBy, 'journal');
  assert.equal(fromJournal.containerId, CONTAINER_ID);
  assert.equal(fromJournal.finishedAt, FINISHED_AT);
  // In a container there is no host journal: the restarted dockerd's start time decides.
  const fromStart = await detectDockerDaemonRestart({ exitCode: 137, containerName: CONTAINER, probes: { ...inspected, readJournal: async () => null, readDaemonStartedAt: async () => ({ startedAt: '2026-10-09T12:11:45.000Z', source: 'test' }) } });
  assert.equal(fromStart.detectedBy, 'daemon-start-time');
  assert.equal(fromStart.daemonStartedAt, '2026-10-09T12:11:45.000Z');
});

test('detection does not fire without a restart, for other exits, or against fresh OOM evidence', async () => {
  const longRunningDaemon = { ...inspected, readJournal: async () => null, readDaemonStartedAt: async () => ({ startedAt: '2026-10-01T00:00:00.000Z', source: 'test' }) };
  assert.equal(await detectDockerDaemonRestart({ exitCode: 137, containerName: CONTAINER, probes: longRunningDaemon }), null);
  const restartedDaemon = { ...inspected, readJournal: async () => null, readDaemonStartedAt: async () => ({ startedAt: '2026-10-09T12:11:45.000Z', source: 'test' }) };
  assert.equal(await detectDockerDaemonRestart({ exitCode: 1, containerName: CONTAINER, probes: restartedDaemon }), null);
  assert.equal(await detectDockerDaemonRestart({ exitCode: 143, containerName: CONTAINER, probes: restartedDaemon }), null);
  assert.equal(await detectDockerDaemonRestart({ exitCode: 137, logText: 'Exit evidence: main-oom (recent cgroup oom_kill delta)', containerName: CONTAINER, probes: restartedDaemon }), null);
  // A container started after the daemon was not running when it restarted.
  const lateContainer = { ...restartedDaemon, inspect: async () => ({ id: CONTAINER_ID, startedAt: '2026-10-09T12:11:50.000Z', finishedAt: FINISHED_AT }) };
  assert.equal(await detectDockerDaemonRestart({ exitCode: 137, containerName: CONTAINER, probes: lateContainer }), null);
  // Probes that throw never escape.
  const broken = { ...noBot, inspect: async () => Promise.reject(new Error('EACCES')) };
  assert.equal(await detectDockerDaemonRestart({ exitCode: 137, containerName: CONTAINER, probes: broken }), null);
  assert.equal(await detectDockerDaemonRestart({ exitCode: 137, containerName: CONTAINER, probes: { run: async () => Promise.reject(new Error('ENOENT')), ...noBot } }), null);
});

test('the dockerd start time comes from systemd, then from the dockerd process', async () => {
  const calls = [];
  const systemd = await readDockerDaemonStartedAt({ run: async (cmd, args) => (calls.push(cmd), cmd === 'systemctl' ? { code: 0, stdout: '@1791548799\n' } : assert.fail(`unexpected ${cmd} ${args}`)) });
  assert.deepEqual(systemd, { startedAt: '2026-10-09T12:26:39.000Z', source: 'systemd ActiveEnterTimestamp' });
  const now = () => Date.parse('2026-10-09T12:21:45.000Z');
  const proc = await readDockerDaemonStartedAt({ now, run: async cmd => (cmd === 'systemctl' ? { code: 1, stdout: '' } : cmd === 'pgrep' ? { code: 0, stdout: '517913\n' } : { code: 0, stdout: '   600\n' }) });
  assert.deepEqual(proc, { startedAt: '2026-10-09T12:11:45.000Z', source: 'dockerd process 517913 start time' });
  assert.equal(await readDockerDaemonStartedAt({ run: async () => ({ code: 1, stdout: '' }) }), null);
  assert.equal(await readDockerDaemonStartedAt({ run: async () => Promise.reject(new Error('ENOENT')) }), null);
});

test('resolveOomKilledState: a daemon restart is a kill, not oom-killed, and is remembered', async () => {
  const sessionInfo = { isolationBackend: 'docker', containerName: CONTAINER };
  let persisted = 0;
  const lines = [];
  const original = console.log;
  console.log = line => lines.push(line);
  let state;
  try {
    state = await resolveOomKilledState(CONTAINER, sessionInfo, INCIDENT_STATUS, {
      verbose: true,
      exitFromLog: () => null,
      backendAlive: async () => false,
      persistSnapshot: () => persisted++,
      detectDaemonRestart: async options => {
        assert.equal(options.exitCode, 137);
        assert.equal(options.containerName, CONTAINER);
        return { detectedBy: 'journal', containerId: CONTAINER_ID, finishedAt: FINISHED_AT };
      },
    });
  } finally {
    console.log = original;
  }
  assert.equal(state.status, 'killed');
  assert.equal(state.exitCode, 137);
  assert.equal(state.statusResult.status, 'killed');
  assert.equal(state.running, false);
  assert.equal(sessionInfo.dockerDaemonRestart.detectedBy, 'journal');
  assert.ok(persisted > 0);
  assert.ok(lines.some(line => /Docker daemon restart/.test(line) && /issue #2892/.test(line)));
  assert.ok(!lines.some(line => /treating it as terminal oom-killed/.test(line)));
});

test("resolveOomKilledState: start-command's attribution is consumed before oom-killed", async () => {
  const deps = { exitFromLog: () => null, backendAlive: async () => false, detectDaemonRestart: async ({ exitReason }) => (exitReason === DAEMON_RESTART_EXIT_REASON ? { detectedBy: 'exit-reason' } : null) };
  const restart = { isolationBackend: 'docker' };
  const fromReason = await resolveOomKilledState(CONTAINER, restart, { ...INCIDENT_STATUS, exitReason: DAEMON_RESTART_EXIT_REASON }, deps);
  assert.equal(fromReason.status, 'killed');
  assert.equal(restart.dockerDaemonRestart.detectedBy, 'exit-reason');
  // start-command >= 0.37: the sticky flag and old counters do not explain the SIGKILL.
  const unknown = { isolationBackend: 'docker' };
  const unknownState = await resolveOomKilledState(CONTAINER, unknown, { ...INCIDENT_STATUS, exitReason: 'signal (SIGKILL; cause unknown)', memoryExhausted: false }, deps);
  assert.equal(unknownState.status, 'killed');
  assert.equal(unknown.dockerDaemonRestart, undefined);
  // Issue #2015 still holds: without contrary evidence the kill is an OOM kill.
  const oom = await resolveOomKilledState(CONTAINER, { isolationBackend: 'docker' }, INCIDENT_STATUS, deps);
  assert.equal(oom.status, 'oom-killed');
  // A failing detector falls back to the same verdict.
  const failing = await resolveOomKilledState(CONTAINER, { isolationBackend: 'docker' }, INCIDENT_STATUS, { ...deps, detectDaemonRestart: async () => Promise.reject(new Error('boom')) });
  assert.equal(failing.status, 'oom-killed');
});

test('describeKillCause names the daemon restart and demotes the sticky OOMKilled flag', () => {
  const daemonRestart = { detectedBy: 'journal', containerId: CONTAINER_ID, finishedAt: FINISHED_AT, daemonLine: 'docker.service: Main process exited, code=killed, status=9/KILL', forceLine: `Container failed to exit within 10s of signal 15 - using the force container=${CONTAINER_ID}` };
  const diagnosis = describeKillCause({ oomKilled: true, exitCode: 137, reportedExitReason: 'memory-exhaustion (cgroup-oom-killer)', reportedMemoryExhausted: true, reportedMemoryExhaustedReason: 'Docker reported State.OOMKilled=true', reportedCgroupMemory: { oomKills: 5 }, daemonRestart });
  assert.equal(diagnosis.cause, KILL_CAUSE_DAEMON_RESTART);
  assert.match(diagnosis.summary, /^killed by Docker daemon restart/);
  assert.match(diagnosis.summary, /live-restore/);
  assert.doesNotMatch(diagnosis.summary, /out of memory/);
  const evidence = diagnosis.evidence.join('\n');
  assert.match(evidence, /`State\.OOMKilled = true` — left by an earlier OOM event in the container that the session survived; it is not what ended the session/);
  assert.match(evidence, /Main process exited/);
  assert.match(evidence, /using the force/);
  // start-command's attribution alone is enough.
  assert.equal(describeKillCause({ oomKilled: true, exitCode: 137, reportedExitReason: DAEMON_RESTART_EXIT_REASON }).cause, KILL_CAUSE_DAEMON_RESTART);
  assert.equal(describeKillCause({ oomKilled: true, exitCode: 137, logText: 'Exit evidence: docker-daemon-restart (Docker service journal)\n' }).cause, KILL_CAUSE_DAEMON_RESTART);
  // A host reboot outranks it, and an operator stop is never attributed to it.
  assert.equal(describeKillCause({ oomKilled: true, exitCode: 137, daemonRestart, hostReboot: { detectedBy: 'boot-id', previousBootId: 'a', currentBootId: 'b' } }).cause, KILL_CAUSE_HOST_REBOOT);
  assert.equal(describeKillCause({ oomKilled: true, exitCode: 137, daemonRestart, stopRequestedByUser: true }).cause, KILL_CAUSE_FORCED_KILL);
  assert.equal(describeKillCause({ exitCode: 0, daemonRestart }).cause === KILL_CAUSE_DAEMON_RESTART, false);
});

test('"cause unknown" is not downgraded to a forced kill; fresh OOM evidence still decides', () => {
  // The triage of #2892 keeps describeKillCause's verdict for start-command's
  // "cause unknown": only a positive daemon-restart attribution changes it
  // (changing it would regress #3125's OOM reporting).
  const diagnosis = describeKillCause({ oomKilled: true, exitCode: 137, reportedExitReason: 'signal (SIGKILL; cause unknown)', reportedCgroupMemory: { oomKills: 3 } });
  assert.notEqual(diagnosis.cause, KILL_CAUSE_DAEMON_RESTART);
  // Fresh main-process OOM evidence written by start-command still decides.
  assert.equal(describeKillCause({ oomKilled: true, exitCode: 137, logText: 'Exit evidence: main-oom (recent cgroup oom_kill delta)\n' }).cause, KILL_CAUSE_OUT_OF_MEMORY);
  // Without any attribution the flag keeps meaning OOM (#2015, #2134).
  assert.equal(describeKillCause({ oomKilled: true, exitCode: 137 }).cause, KILL_CAUSE_OUT_OF_MEMORY);
});

test('the pull-request notice and the Telegram status say "killed by Docker daemon restart"', () => {
  const diagnosis = describeKillCause({ oomKilled: true, exitCode: 137, reportedExitReason: DAEMON_RESTART_EXIT_REASON });
  const body = buildKillRecoveryNotice({ diagnosis, exitCode: 137, sessionName: CONTAINER, observedAt: '2026-10-09T08:00:00.000Z', endedAt: FINISHED_AT, recoveryPending: true });
  assert.match(body, /## ❌ Working session was killed by Docker daemon restart/);
  assert.match(body, /\*\*Earlier OOM event:\*\* at 2026-10-09T08:00:00\.000Z, survived/);
  assert.match(body, /Auto recovery/);
  assert.doesNotMatch(body, /out of memory/);
  const message = formatSessionCompletionMessage({ sessionName: CONTAINER, sessionInfo: { command: 'solve' }, statusResult: { status: 'killed', exitCode: 137 }, exitCode: 137, killCause: KILL_CAUSE_DAEMON_RESTART });
  assert.match(message, /Work session killed by Docker daemon restart \(SIGKILL\) \(exit code: 137\)/);
  assert.doesNotMatch(message, /out of memory/);
  const recovering = formatSessionCompletionMessage({ sessionName: CONTAINER, sessionInfo: { command: 'solve' }, statusResult: { status: 'killed', exitCode: 137 }, exitCode: 137, killCause: KILL_CAUSE_DAEMON_RESTART, resumedAs: 'next' });
  assert.match(recovering, /recovering from a kill \(Docker daemon restart\)/);
});

test('the completion report reads the remembered restart and detects one on the non-OOM path', async () => {
  const remembered = await buildKillCompletionSections({
    sessionName: CONTAINER,
    sessionInfo: { isolationBackend: 'docker', containerName: CONTAINER, dockerDaemonRestart: { detectedBy: 'journal', finishedAt: FINISHED_AT } },
    statusResult: { ...INCIDENT_STATUS, status: 'killed' },
    exitCode: 137,
    status: 'killed',
    readFile: async () => '',
    detectDaemonRestart: async () => assert.fail('already known'),
  });
  assert.equal(remembered.diagnosis.cause, KILL_CAUSE_DAEMON_RESTART);
  // The root container had OOMKilled=false and was killed by the same restart.
  const sessionInfo = { isolationBackend: 'docker', containerName: CONTAINER };
  const detected = await buildKillCompletionSections({
    sessionName: CONTAINER,
    sessionInfo,
    statusResult: { exists: true, status: 'killed', exitCode: 137, oomKilled: false, isolation: 'docker', endTime: FINISHED_AT },
    exitCode: 137,
    status: 'killed',
    readFile: async () => '',
    detectDaemonRestart: async () => ({ detectedBy: 'daemon-start-time', finishedAt: FINISHED_AT, startedAt: STARTED_AT, daemonStartedAt: '2026-10-09T12:11:45.000Z', daemonStartSource: 'test' }),
  });
  assert.equal(detected.diagnosis.cause, KILL_CAUSE_DAEMON_RESTART);
  assert.equal(sessionInfo.dockerDaemonRestart.detectedBy, 'daemon-start-time');
  assert.match(detected.diagnosis.evidence.join('\n'), /dockerd started at 2026-10-09T12:11:45\.000Z \(test\), 11 s from the container's exit/);
});

test('the restart survives a bot restart with the session snapshot', () => {
  const dockerDaemonRestart = { detectedBy: 'journal', finishedAt: FINISHED_AT };
  assert.deepEqual(deserializeSessionInfo(serializeSessionInfo({ startTime: new Date(0), dockerDaemonRestart })).dockerDaemonRestart, dockerDaemonRestart);
  assert.ok(quiet);
});

test('triage (a)-(c): attribution beats the sticky flag, and #2015 still holds without it', async () => {
  const diagnosis = describeKillCause({ exitCode: 137, oomKilled: true, reportedExitReason: DAEMON_RESTART_EXIT_REASON, reportedCgroupMemory: { oomKills: 3 } });
  assert.equal(diagnosis.cause, KILL_CAUSE_DAEMON_RESTART);
  for (const line of diagnosis.evidence) assert.doesNotMatch(line, /an OOM event hit the container cgroup\)$/, line);
  // No runner, no detector: only the reported exit reason is used (hermetic).
  const deps = { exitFromLog: async () => null, backendAlive: async () => false };
  const restart = await resolveOomKilledState('s', { isolationBackend: 'docker' }, { status: 'executed', exitCode: 137, oomKilled: true, exitReason: DAEMON_RESTART_EXIT_REASON }, deps);
  assert.equal(restart.status, 'killed');
  assert.equal(restart.dockerDaemonRestart, true);
  const oom = await resolveOomKilledState('s', { isolationBackend: 'docker' }, { status: 'executed', exitCode: 137, oomKilled: true, exitReason: 'memory-exhaustion (cgroup-oom-killer)' }, deps);
  assert.equal(oom.status, 'oom-killed');
});

test('triage (d): tasks killed with the bot container are attributed to the daemon restart', async () => {
  const anchor = { name: 'hive-bot', finishedAt: '2026-10-09T12:11:56.000Z', startedAt: '2026-10-09T12:12:30.000Z' };
  const sessions = [
    { sessionName: 'a', exitCode: 137, startedAt: STARTED_AT, finishedAt: '2026-10-09T12:11:55.100Z' },
    { sessionName: 'b', exitCode: null, startedAt: STARTED_AT, finishedAt: '2026-10-09T12:11:56.236Z' },
    { sessionName: 'early', exitCode: 137, startedAt: STARTED_AT, finishedAt: '2026-10-09T11:00:00.000Z' },
    { sessionName: 'exit-1', exitCode: 1, startedAt: STARTED_AT, finishedAt: '2026-10-09T12:11:55.500Z' },
    { sessionName: 'started-after', exitCode: 137, startedAt: '2026-10-09T12:11:58.000Z', finishedAt: '2026-10-09T12:11:59.000Z' },
  ];
  assert.deepEqual(correlateWithBotContainerRestart({ anchor, sessions }), ['a', 'b']);
  assert.deepEqual(correlateWithBotContainerRestart({ anchor: null, sessions }), []);
  assert.equal(BOT_CONTAINER_RESTART_WINDOW_MS, 15_000);

  // The anchor is read with `docker inspect $HOSTNAME`, only inside a container.
  const run = async (cmd, args) => (assert.equal(cmd, 'docker'), assert.equal(args.at(-1), 'hive-bot'), { code: 0, stdout: `${anchor.startedAt}|${anchor.finishedAt}\n` });
  assert.deepEqual(await readBotContainerLifetime({ hostname: 'hive-bot', run, inContainer: () => true }), anchor);
  assert.equal(await readBotContainerLifetime({ hostname: 'hive-bot', run, inContainer: () => false }), null);
  assert.equal(await readBotContainerLifetime({ hostname: '', run, inContainer: () => true }), null);
  // A bot container that never exited (FinishedAt zero time) is no anchor.
  const neverExited = async () => ({ code: 0, stdout: `${anchor.startedAt}|0001-01-01T00:00:00Z\n` });
  assert.equal(await readBotContainerLifetime({ hostname: 'hive-bot', run: neverExited, inContainer: () => true }), null);

  // A removed task container (inspect fails) with no host journal or dockerd access.
  const removed = await detectDockerDaemonRestart({ exitCode: 137, containerName: CONTAINER, startedAt: STARTED_AT, finishedAt: '2026-10-09T12:11:55.900Z', probes: { inspect: async () => null, readBotContainer: async () => anchor } });
  assert.equal(removed.detectedBy, 'bot-container-restart');
  assert.equal(removed.botContainer, 'hive-bot');
  // An inspected container whose daemon start time is unknown falls back to the anchor too.
  const inspectedOnly = await detectDockerDaemonRestart({ exitCode: 137, containerName: CONTAINER, probes: { ...inspected, readJournal: async () => null, readDaemonStartedAt: async () => null, readBotContainer: async () => anchor } });
  assert.equal(inspectedOnly.detectedBy, 'bot-container-restart');
  assert.match(describeKillCause({ oomKilled: true, exitCode: 137, daemonRestart: inspectedOnly }).evidence.join('\n'), /the bot's own container `hive-bot` was killed at 2026-10-09T12:11:56\.000Z/);
  // A bot container that died an hour later says nothing about this task.
  const late = { ...anchor, finishedAt: '2026-10-09T13:11:56.000Z', startedAt: '2026-10-09T13:12:30.000Z' };
  assert.equal(await detectDockerDaemonRestart({ exitCode: 137, containerName: CONTAINER, probes: { ...inspected, readJournal: async () => null, readDaemonStartedAt: async () => null, readBotContainer: async () => late } }), null);
});

test('the killed headline without an OOM flag is not annotated "cgroup OOM"', async () => {
  const { describeSessionExitCodes } = await import('../src/session-tool-exit.lib.mjs');
  assert.doesNotMatch(describeSessionExitCodes({ exitCode: 137, oomEvidence: true, cause: KILL_CAUSE_DAEMON_RESTART }), /cgroup OOM/);
  assert.match(describeSessionExitCodes({ exitCode: 137, oomEvidence: true, cause: KILL_CAUSE_OUT_OF_MEMORY }), /cgroup OOM/);
});
