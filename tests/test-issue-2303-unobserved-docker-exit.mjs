#!/usr/bin/env node
/**
 * Regression test for issue #2303 — "✅ Work session finished successfully" for
 * a docker `/solve` session that was actually killed when the host disk filled.
 *
 * Root cause (upstream, start-command 0.34.0 detached docker watcher):
 *
 *   docker logs -f C >> LOG; state=$(docker inspect C); if exit==0 → docker rm -f C
 *
 * When the disk fills, `docker logs -f >> LOG` fails with ENOSPC and returns
 * while the container is STILL RUNNING. `docker inspect` of a running container
 * reports `ExitCode 0`, `OOMKilled false` and the zero `FinishedAt`
 * (`0001-01-01T00:00:00Z`), so the watcher treats the live session as a clean
 * exit: it removes the container (killing the work), writes an `Exit Code: 0`
 * footer and finalizes the record as `executed` / `0`. Because docker never
 * reported a finish time, the record carries `endTimeSource: 'observed-at'` —
 * a container that really exited always has `docker-finished-at`.
 *
 * Reproduced against the real start-command code in
 * experiments/issue-2303-watcher-enospc.mjs.
 *
 * Hive Mind must not trust that exit 0:
 *   1. A docker exit 0 docker never observed (`observed-at`) is reported as a
 *      kill, not a success — whether or not the watcher's footer is present.
 *   2. The kill is diagnosed as "disk full" from the host disk observations the
 *      monitor records while the session runs, or from an ENOSPC line in the log.
 *   3. The default `--on-session-kill=resume` policy then restarts the work, and
 *      the completion message says so.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2303
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession, getActiveSessionCount, getIsolationSessionStateForTests, __setIsolationRunnerForTests } from '../src/session-monitor.lib.mjs';
import { isUnknownDockerExitCode, isExecutingSessionStatus, isTerminalSessionStatus } from '../src/isolation-runner.lib.mjs';
import { detectUnobservedDockerExit, reclassifyUnobservedDockerExit } from '../src/session-monitor.unobserved-exit.lib.mjs';
import { observeHostDiskForSession, describeObservedHostDisk } from '../src/session-monitor.host-disk.lib.mjs';
import { describeKillCause, findDiskFullMarker, KILL_CAUSE_DISK_FULL, KILL_CAUSE_UNKNOWN } from '../src/session-kill-diagnostics.lib.mjs';
import { formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { serializeSessionInfo } from '../src/session-store.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #2303: a docker exit nobody observed must not be reported as success');
console.log('='.repeat(78));

await initI18n('en');
await preloadAllLocales();

const SESSION = '56291848-d17d-4326-8b41-3ac995221efc';
const TOOL_SESSION = 'a1b2c3d4-0000-4000-8000-000000002303';
const GIB = 1024 ** 3;

// What `$ --status --output-format json` returned for the incident (see the
// reproduction): executed / 0, but no docker finish time.
const incidentStatus = {
  exists: true,
  uuid: 'b105ce98-52a1-4c2d-949a-bfa872c4f784',
  status: 'executed',
  exitCode: 0,
  isolation: 'docker',
  logPath: '/tmp/session-2303.log',
  endTime: '2026-09-26T07:26:04.000Z',
  endTimeSource: 'observed-at',
  observedAt: '2026-09-26T07:26:04.000Z',
  containerStartedAt: '2026-09-25T17:47:05.000Z',
  oomKilled: false,
};

// ---------------------------------------------------------------------------
// 1. Detection is narrow: docker + exit 0 + no docker finish time.
// ---------------------------------------------------------------------------

const dockerInfo = { isolationBackend: 'docker', sessionId: SESSION };
assert(Boolean(detectUnobservedDockerExit({ sessionInfo: dockerInfo, statusResult: incidentStatus, exitCode: 0, status: 'executed' })), 'executed/0 with endTimeSource=observed-at is an unobserved docker exit');
assert(Boolean(detectUnobservedDockerExit({ sessionInfo: dockerInfo, statusResult: incidentStatus, exitCode: null, status: 'executed' })), 'a null exit code with an executed status is the same unobserved success');
assert(detectUnobservedDockerExit({ sessionInfo: dockerInfo, statusResult: { ...incidentStatus, endTimeSource: 'docker-finished-at' }, exitCode: 0, status: 'executed' }) === null, 'a container docker saw finish (docker-finished-at) is a real success');
assert(detectUnobservedDockerExit({ sessionInfo: dockerInfo, statusResult: { ...incidentStatus, endTimeSource: 'log-footer' }, exitCode: 0, status: 'executed' }) === null, 'a footer-timed exit is not reclassified');
assert(detectUnobservedDockerExit({ sessionInfo: dockerInfo, statusResult: { ...incidentStatus, endTimeSource: undefined }, exitCode: 0, status: 'executed' }) === null, 'an older start-command that reports no endTimeSource is left alone');
assert(detectUnobservedDockerExit({ sessionInfo: { isolationBackend: 'screen', sessionId: SESSION }, statusResult: { ...incidentStatus, isolation: 'screen' }, exitCode: 0, status: 'executed' }) === null, 'non-docker isolation is never reclassified');
assert(detectUnobservedDockerExit({ sessionInfo: dockerInfo, statusResult: { ...incidentStatus, exitCode: 1 }, exitCode: 1, status: 'failed' }) === null, 'a failure is already reported as a failure');
assert(detectUnobservedDockerExit({ sessionInfo: dockerInfo, statusResult: incidentStatus, exitCode: 0, status: 'executed', running: true }) === null, 'a session still running is not touched');

const untouched = { running: false, exitCode: 0, status: 'executed', statusResult: { ...incidentStatus, endTimeSource: 'docker-finished-at' } };
assert(reclassifyUnobservedDockerExit(SESSION, dockerInfo, untouched) === untouched, 'reclassification returns the very same state when nothing is wrong');

// ---------------------------------------------------------------------------
// 2. getIsolationSessionState: the incident is reported as killed.
// ---------------------------------------------------------------------------

function stubRunner({ status = incidentStatus, footer = { finished: false, exitCode: null, endTime: null }, isSessionRunning = false } = {}) {
  return {
    isExecutingSessionStatus,
    isTerminalSessionStatus,
    isUnknownDockerExitCode,
    readSessionExitFromLog: () => footer,
    querySessionStatus: async () => status,
    isSessionRunning: async () => isSessionRunning,
  };
}

// The watcher wrote `Exit Code: 0` from the same bogus inspect result, so the
// footer is not independent evidence and must not rescue the success.
__setIsolationRunnerForTests(stubRunner({ footer: { finished: true, exitCode: 0, endTime: '2026-09-26 07:26:04.000' } }));
const withFooter = await getIsolationSessionStateForTests(SESSION, { ...dockerInfo });
assert(withFooter.running === false, 'the session is terminal');
assert(withFooter.status === 'killed', `the footer-backed exit 0 is reclassified as killed (got ${withFooter.status})`);
assert(withFooter.exitCode === null, 'the fabricated exit 0 is dropped');
assert(withFooter.statusResult?.status === 'killed' && withFooter.statusResult?.exitCode === null, 'the status payload used by the formatter is corrected too');
assert(withFooter.statusResult?.reportedExitCode === 0, 'the exit code start-command reported is preserved for diagnostics');
assert(typeof withFooter.statusResult?.unobservedExit === 'string' && withFooter.statusResult.unobservedExit.length > 0, 'the reason is recorded on the status payload');

__setIsolationRunnerForTests(stubRunner());
const withoutFooter = await getIsolationSessionStateForTests(SESSION, { ...dockerInfo });
assert(withoutFooter.running === false && withoutFooter.status === 'killed', 'without a footer the unobserved exit is still reported as killed');

__setIsolationRunnerForTests(stubRunner({ status: { ...incidentStatus, endTimeSource: 'docker-finished-at' }, footer: { finished: true, exitCode: 0, endTime: '2026-09-26 07:26:04.000' } }));
const realSuccess = await getIsolationSessionStateForTests(SESSION, { ...dockerInfo });
assert(realSuccess.running === false && realSuccess.exitCode === 0 && realSuccess.status === 'executed', 'a real docker success is still a success');

// Issue #2303 also audited the other "null exit, null status" exits: a status
// query that throws must not be read as a finished, successful session.
__setIsolationRunnerForTests({
  ...stubRunner(),
  querySessionStatus: async () => {
    throw new Error('spawn $ ENOSPC');
  },
});
const errorInfo = { ...dockerInfo };
const errored = await getIsolationSessionStateForTests(SESSION, errorInfo);
assert(errored.running === true, 'a status query error keeps the session tracked instead of reporting success');
__setIsolationRunnerForTests(null);

// ---------------------------------------------------------------------------
// 3. Disk-full evidence.
// ---------------------------------------------------------------------------

// 3a. Host disk observations recorded while the session runs.
const diskInfo = { isolationBackend: 'docker', sessionId: SESSION, logPath: '/var/log/start/session.log' };
const statfsReadings = [
  { bavail: 30 * GIB, blocks: 192 * GIB, bsize: 1 },
  { bavail: 0.2 * GIB, blocks: 192 * GIB, bsize: 1 },
  { bavail: 120 * GIB, blocks: 192 * GIB, bsize: 1 }, // after `docker rm -f` freed the layer
];
const statfsPaths = [];
for (const reading of statfsReadings) {
  await observeHostDiskForSession(diskInfo, {
    statfs: async target => {
      statfsPaths.push(target);
      return reading;
    },
  });
}
assert(
  statfsPaths.every(target => target === '/var/log/start'),
  'the host disk is sampled on the filesystem that holds the session log'
);
assert(diskInfo.hostDiskMinAvailableBytes === Math.round(0.2 * GIB), 'the minimum available space seen during the session is kept');
assert(diskInfo.hostDiskTotalBytes === 192 * GIB, 'the filesystem size is recorded');
assert(Boolean(diskInfo.hostDiskMinAvailableAt), 'the time of the lowest reading is recorded');
const persisted = serializeSessionInfo(diskInfo);
assert(persisted.hostDiskMinAvailableBytes === diskInfo.hostDiskMinAvailableBytes && persisted.hostDiskTotalBytes === diskInfo.hostDiskTotalBytes, 'host disk observations survive a bot restart');

const failingStatfs = { isolationBackend: 'docker' };
const failedObservation = await observeHostDiskForSession(failingStatfs, {
  statfs: async () => {
    throw new Error('EACCES');
  },
});
assert(failedObservation === null && failingStatfs.hostDiskMinAvailableBytes === undefined, 'a failed statfs never throws and records nothing');

const observedDisk = describeObservedHostDisk(diskInfo);
assert(observedDisk && observedDisk.availableBytes === diskInfo.hostDiskMinAvailableBytes, 'the observation is exposed to the kill diagnosis');

// A killed session whose resource markers looked healthy (the last one in the
// incident said 78.9% used) is diagnosed as disk full from the host samples.
const healthyMarker = '[2026-09-26T06:34:23.901Z] [INFO] 📈 [RESOURCES] phase=log_upload_start diskPath=%2F diskTotalBytes=206900281344 diskAvailableBytes=43535716352 diskUsedBytes=163347787776 diskUsedPercent=78.9500075664044\n';
const hostDiagnosis = describeKillCause({ logText: healthyMarker, exitCode: null, observedDisk });
assert(hostDiagnosis.cause === KILL_CAUSE_DISK_FULL, `host disk observations diagnose a disk-full kill (got ${hostDiagnosis.cause})`);
assert(/disk full/.test(hostDiagnosis.summary), 'the summary names the disk');
assert(
  hostDiagnosis.evidence.some(line => /host disk/i.test(line)),
  'the host disk reading is listed as evidence'
);

const healthyHost = describeKillCause({ logText: healthyMarker, exitCode: null, observedDisk: { availableBytes: 40 * GIB, totalBytes: 192 * GIB, observedAt: '2026-09-26T06:00:00.000Z', path: '/' } });
assert(healthyHost.cause === KILL_CAUSE_UNKNOWN, 'a healthy host disk does not invent a disk-full verdict');

// 3b. ENOSPC in the log tail of an abnormal exit.
const enospcLog = `${healthyMarker}[2026-09-26T07:25:59.000Z] [ERROR] Error: ENOSPC: no space left on device, write\n`;
assert(Boolean(findDiskFullMarker(enospcLog)), 'an ENOSPC line is recognised');
assert(Boolean(findDiskFullMarker("cp: error writing 'x': No space left on device")), 'the libc wording is recognised');
assert(findDiskFullMarker(healthyMarker) === null, 'resource markers alone are not an ENOSPC line');
const enospcDiagnosis = describeKillCause({ logText: enospcLog, exitCode: null });
assert(enospcDiagnosis.cause === KILL_CAUSE_DISK_FULL, `an ENOSPC line diagnoses a disk-full kill (got ${enospcDiagnosis.cause})`);
const enospcSuccess = describeKillCause({ logText: enospcLog, exitCode: 0 });
assert(enospcSuccess.cause !== KILL_CAUSE_DISK_FULL, 'an ENOSPC line in a clean exit does not manufacture a diagnosis');

// 3c. The unobserved exit itself is explained.
const unobservedDiagnosis = describeKillCause({ logText: healthyMarker, exitCode: null, observedDisk, unobservedExit: 'docker never reported a finish time' });
assert(
  unobservedDiagnosis.evidence.some(line => /never reported a finish time/.test(line)),
  'the evidence explains why the reported exit 0 was not trusted'
);

// ---------------------------------------------------------------------------
// 4. Headline.
// ---------------------------------------------------------------------------

const headline = formatSessionCompletionMessage({
  sessionName: SESSION,
  sessionInfo: { isolationBackend: 'docker', locale: 'en' },
  statusResult: { ...incidentStatus, status: 'killed', exitCode: null },
  exitCode: null,
  killCause: KILL_CAUSE_DISK_FULL,
}).split('\n')[0];
assert(/killed/i.test(headline) && /disk full/i.test(headline), `the headline says killed (disk full) (got ${headline})`);
assert(!/successfully/i.test(headline), 'the headline no longer says finished successfully');

// ---------------------------------------------------------------------------
// 5. End to end: killed, diagnosed, auto-resumed.
// ---------------------------------------------------------------------------

function makeBot() {
  const edits = [];
  return {
    edits,
    telegram: {
      editMessageText: async (chatId, messageId, _inline, text, options) => {
        edits.push({ chatId, messageId, text, options });
      },
      sendMessage: async () => {
        throw new Error('sendMessage should not be used when messageId is present');
      },
    },
  };
}

const e2eLogPath = path.join(os.tmpdir(), `hive-mind-test-2303-${process.pid}.log`);
const e2eLog = `📌 Session ID: ${TOOL_SESSION}\n${healthyMarker}\n${'='.repeat(50)}\nFinished: 2026-09-26 07:26:04.000\nExit Code: 0\n`;
fs.writeFileSync(e2eLogPath, e2eLog, 'utf8');

resetSessionMonitorForTests();
const sessionInfo = {
  chatId: 1001,
  messageId: 2002,
  startTime: new Date(Date.now() - 13 * 60 * 60 * 1000),
  command: 'solve',
  tool: 'claude',
  url: 'https://github.com/link-foundation/meta-language/pull/196',
  args: ['https://github.com/link-foundation/meta-language/pull/196', '--think', 'high', '--attach-logs', '--verbose'],
  isolationBackend: 'docker',
  sessionId: SESSION,
  logPath: e2eLogPath,
  locale: 'en',
};
trackSession(SESSION, sessionInfo, false);

const bot = makeBot();
const recoveryLaunches = [];
const removedContainers = [];
const statusResult = { ...incidentStatus, logPath: e2eLogPath };
const commonOptions = {
  exitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
  dockerContainerSizeProvider: async () => 122.7 * 1e9,
  lookupLinkedPullRequest: async () => 'https://github.com/link-foundation/meta-language/pull/196',
  env: {},
  runCommand: async () => ({ code: 0, stdout: 'https://github.com/link-foundation/meta-language/pull/196#issuecomment-1\n', stderr: '' }),
  removeDockerContainer: async name => {
    removedContainers.push(name);
    return { success: true };
  },
  isolationRunner: {
    generateSessionId: () => 'recovery-2303-0000-0000-000000000000',
    executeWithIsolation: async (command, args, opts) => {
      recoveryLaunches.push({ command, args, opts });
      return { success: true };
    },
  },
};

// Poll #1 — still running while the disk fills up.
await monitorSessions(bot, false, {
  ...commonOptions,
  statusProvider: async () => ({ ...statusResult, status: 'executing', exitCode: null, endTime: null, endTimeSource: undefined, observedAt: undefined }),
  backendAlive: async () => true,
  hostDiskProvider: async () => ({ bavail: 0.1 * GIB, blocks: 192 * GIB, bsize: 1 }),
});
assert(bot.edits.length === 0, 'nothing is reported while the session is running');
assert(sessionInfo.hostDiskMinAvailableBytes === Math.round(0.1 * GIB), 'the monitor records the host disk while the session runs');

// Poll #2 — start-command's watcher removed the container and finalized exit 0.
await monitorSessions(bot, false, {
  ...commonOptions,
  statusProvider: async () => statusResult,
  exitFromLog: () => ({ finished: true, exitCode: 0, endTime: '2026-09-26 07:26:04.000' }),
  backendAlive: async () => false,
  hostDiskProvider: async () => ({ bavail: 120 * GIB, blocks: 192 * GIB, bsize: 1 }),
});

const completion = bot.edits[0]?.text || '';
if (process.env.SHOW_MESSAGE) console.log(completion);
const firstLine = completion.split('\n')[0];
assert(bot.edits.length === 1, 'the session is reported once');
assert(!/successfully/i.test(firstLine), `the completion is not reported as success (got: ${firstLine})`);
assert(/killed/i.test(firstLine) && /disk full/i.test(firstLine), `the completion headline says the session was killed by a full disk (got: ${firstLine})`);
assert(/Kill diagnostics/.test(completion) && /Cause: disk full/.test(completion), 'the kill diagnostics name the full disk');
assert(recoveryLaunches.length === 1, 'the default --on-session-kill=resume policy restarts the work');
assert(recoveryLaunches[0]?.args.includes('--resume') && recoveryLaunches[0]?.args.includes(TOOL_SESSION), 'the restart resumes the last tool session');
assert(/recovery-2303-0000-0000-000000000000/.test(completion), 'the completion message names the recovery session');
assert(!/Docker container kept/.test(completion), 'a container start-command already removed is not advertised as kept');
assert(removedContainers.length === 0, 'Hive Mind does not try to remove a container that is already gone');
assert(getActiveSessionCount(false) === 1, 'only the recovery session remains tracked');

fs.rmSync(e2eLogPath, { force: true });
resetSessionMonitorForTests();
printSummary(78);

if (getFailCount() > 0) {
  process.exit(1);
}
