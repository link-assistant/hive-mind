#!/usr/bin/env node
/**
 * Regression coverage for issue #2189, defect 1 and the follow-up comment:
 * "a killed session is only *offered* for resume, never resumed" and
 * "the killed session is re-detected every poll and never marked handled".
 *
 * The captured incident: a `/solve` working session died at 14:07:49Z of a V8
 * heap OOM. The monitor reported `recovered=false policy=report` — the automatic
 * recovery built for issue #2134 existed but was opt-in, so nothing restarted
 * the work. Then, because a late step of the completion pipeline kept failing,
 * the very same completion was re-run on every poll: four "has finished. Sending
 * notification" lines, three "was killed; offering resume from last session"
 * lines, each one re-resolving the linked pull request, re-scanning a 134 MB log
 * and re-walking a 27 GB docker writable layer, with the bot's RSS climbing to
 * 1.84 GB against a ~2 GB cap.
 *
 * What is asserted here:
 *   1. `resume` is the default on-kill policy, so the bot initiates the resume
 *      itself; `--on-session-kill=report` still turns that off;
 *   2. a delivered completion notification latches a terminal, persisted
 *      `completionNotifiedAt` state, and a session reloaded in that state (the
 *      bot restart case) is finalized silently instead of notified again;
 *   3. per-poll work is not O(log size): the last tool session id is scanned
 *      once and cached in the session record, the linked pull request is
 *      resolved once, and the docker writable-layer walk is throttled;
 *   4. all of that survives the durable session snapshot round trip — including
 *      `stopRequestedByUser`, which must never be forgotten now that a killed
 *      session is resumed by default.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initI18n } from '../src/i18n.lib.mjs';
import { isCompletionHandled, markCompletionHandled, resolveCachedLastToolSessionId, COMPLETION_STATE_FIELDS } from '../src/session-completion-state.lib.mjs';
import { serializeSessionInfo, deserializeSessionInfo } from '../src/session-store.lib.mjs';
import { resolveOnSessionKillPolicy, ON_SESSION_KILL_RESUME, ON_SESSION_KILL_REPORT } from '../src/session-kill-policy.lib.mjs';
import { planKillRecovery } from '../src/session-kill-resume.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, setSessionStore, trackSession, getActiveSessionCount, shouldRefreshDockerFilesystemSize, DOCKER_FILESYSTEM_REFRESH_INTERVAL_MS, STALE_EXECUTING_MIN_AGE_MS } from '../src/session-monitor.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #2189: a killed session is resumed by default and reported exactly once');
console.log('='.repeat(78));

await initI18n('en');

const SESSION = '0ea1c630-cfdf-477e-8528-29d175a7fe64';
const TOOL_SESSION = '01a05c1c-0c3d-7472-a431-11d9c948e162';

// ---------------------------------------------------------------------------
// 1. The bot initiates the resume itself (defect 1)
// ---------------------------------------------------------------------------

assert(resolveOnSessionKillPolicy({ argv: {}, env: {} }) === ON_SESSION_KILL_RESUME, 'a killed session is resumed by default, not merely offered');
assert(resolveOnSessionKillPolicy({ argv: { 'on-session-kill': 'report' }, env: {} }) === ON_SESSION_KILL_REPORT, '--on-session-kill=report still opts out of automatic recovery');
assert(resolveOnSessionKillPolicy({ argv: {}, env: { HIVE_MIND_ON_SESSION_KILL: 'report' } }) === ON_SESSION_KILL_REPORT, 'the environment variable can opt out too');

const defaultPlan = planKillRecovery({ sessionInfo: { command: 'solve', url: 'https://github.com/link-assistant/formal-ai/issues/1069', isolationBackend: 'docker' }, killed: true, env: {}, readLastSessionId: () => TOOL_SESSION });
assert(defaultPlan.shouldResume === true && defaultPlan.policy === ON_SESSION_KILL_RESUME, 'the default plan for a killed /solve is to start a recovery session');
const stoppedPlan = planKillRecovery({ sessionInfo: { command: 'solve', url: 'https://github.com/x/y/issues/1', isolationBackend: 'docker', stopRequestedByUser: true }, killed: true, env: {}, readLastSessionId: () => TOOL_SESSION });
assert(stoppedPlan.shouldResume === false && stoppedPlan.reason === 'stopped-by-user', 'a session stopped by a user is never auto-resumed, even under the new default');

// ---------------------------------------------------------------------------
// 2. The handled latch (issue comment: "terminal, persisted, handled")
// ---------------------------------------------------------------------------

const latched = { chatId: 1 };
assert(isCompletionHandled(latched) === false, 'a fresh session is not yet handled');
assert(isCompletionHandled(null) === false, 'a missing session is not handled');
assert(markCompletionHandled(latched, { exitCode: 139, status: 'executed', now: () => new Date('2026-08-30T14:07:49.000Z') }) === true, 'the first delivered notification latches the session');
assert(latched.completionNotifiedAt === '2026-08-30T14:07:49.000Z' && latched.completionExitCode === 139 && latched.completionStatus === 'executed', 'the latch records when, with what exit code and status');
assert(isCompletionHandled(latched) === true, 'the latched session reports as handled');
assert(markCompletionHandled(latched, { exitCode: 0, status: 'other', now: () => new Date('2026-08-30T20:14:00.000Z') }) === false, 'a second notification attempt is refused');
assert(latched.completionNotifiedAt === '2026-08-30T14:07:49.000Z' && latched.completionExitCode === 139, 'the refused attempt does not rewrite the latch');
assert(markCompletionHandled(null) === false, 'latching a missing session is a no-op, not a throw');

// ---------------------------------------------------------------------------
// 3. The last tool session id is scanned once, not once per poll per consumer
// ---------------------------------------------------------------------------

const cacheInfo = {};
let scans = 0;
const scanner = () => {
  scans += 1;
  return TOOL_SESSION;
};
const firstScan = resolveCachedLastToolSessionId({ sessionInfo: cacheInfo, logPath: '/tmp/huge.log', readLastSessionId: scanner });
assert(firstScan.id === TOOL_SESSION && firstScan.scanned === true && firstScan.cached === false, 'the first resolution scans the log');
assert(cacheInfo.lastToolSessionId === TOOL_SESSION, 'the id is cached in the session record');
const secondScan = resolveCachedLastToolSessionId({ sessionInfo: cacheInfo, logPath: '/tmp/huge.log', readLastSessionId: scanner });
assert(secondScan.id === TOOL_SESSION && secondScan.cached === true && scans === 1, 'a second consumer reuses the cache instead of re-scanning the log');

const emptyInfo = {};
let emptyScans = 0;
const emptyScanner = () => {
  emptyScans += 1;
  return null;
};
assert(resolveCachedLastToolSessionId({ sessionInfo: emptyInfo, logPath: '/tmp/huge.log', readLastSessionId: emptyScanner }).id === null, 'a log without a marker resolves to no id');
assert(emptyInfo.lastToolSessionId === '', 'a fruitless scan is remembered as such');
const repeatEmpty = resolveCachedLastToolSessionId({ sessionInfo: emptyInfo, logPath: '/tmp/huge.log', readLastSessionId: emptyScanner });
assert(repeatEmpty.id === null && repeatEmpty.cached === true && emptyScans === 1, 'a fruitless multi-gigabyte scan is never repeated');

const unreadable = {};
const throwing = () => {
  throw new Error('EACCES');
};
const errored = resolveCachedLastToolSessionId({ sessionInfo: unreadable, logPath: '/tmp/gone.log', readLastSessionId: throwing });
assert(errored.id === null && errored.scanned === false, 'a read error is reported, not thrown');
assert(unreadable.lastToolSessionId === undefined, 'a read error is not cached, so a later poll can still find the id');

// ---------------------------------------------------------------------------
// 4. The docker writable-layer walk is throttled while the session runs
// ---------------------------------------------------------------------------

const now = Date.now();
assert(shouldRefreshDockerFilesystemSize({ isolationBackend: 'screen' }, { stillRunning: true, now }) === false, 'only docker sessions have a writable layer to measure');
assert(shouldRefreshDockerFilesystemSize({ isolationBackend: 'docker' }, { stillRunning: false, now }) === true, 'a finished docker session is always measured once more');
assert(shouldRefreshDockerFilesystemSize({ isolationBackend: 'docker' }, { stillRunning: true, now }) === true, 'a running docker session never measured before is measured now');
const justMeasured = { isolationBackend: 'docker', containerFilesystemLastObservedAt: new Date(now - 1000).toISOString() };
assert(shouldRefreshDockerFilesystemSize(justMeasured, { stillRunning: true, now }) === false, 'a 27 GB writable layer is not re-walked on every 30 s poll');
const staleMeasurement = { isolationBackend: 'docker', containerFilesystemLastObservedAt: new Date(now - DOCKER_FILESYSTEM_REFRESH_INTERVAL_MS - 1000).toISOString() };
assert(shouldRefreshDockerFilesystemSize(staleMeasurement, { stillRunning: true, now }) === true, 'the measurement is refreshed once the throttle window elapses');

// ---------------------------------------------------------------------------
// 5. Everything above survives the durable snapshot round trip
// ---------------------------------------------------------------------------

const persisted = deserializeSessionInfo(
  serializeSessionInfo({
    chatId: 42,
    startTime: new Date('2026-08-30T13:00:00.000Z'),
    completionNotifiedAt: '2026-08-30T14:07:49.000Z',
    completionExitCode: 139,
    completionStatus: 'executed',
    lastToolSessionId: TOOL_SESSION,
    killRecoveryAttempts: 1,
    killRecoverySessionId: 'recovery-1111',
    killRecoveryOfSession: SESSION,
    stopRequestedByUser: true,
    stopRequestedBy: 'konard',
    resolvedPullRequestUrl: 'https://github.com/link-assistant/formal-ai/pull/1070',
  })
);
for (const field of COMPLETION_STATE_FIELDS) {
  assert(persisted[field] !== undefined, `${field} survives the session snapshot`);
}
assert(isCompletionHandled(persisted) === true, 'a reloaded session is still handled after a restart');
assert(persisted.killRecoveryAttempts === 1 && persisted.killRecoverySessionId === 'recovery-1111', 'the recovery bookkeeping is persisted, so recovery cannot restart once per bot launch forever');
assert(persisted.stopRequestedByUser === true && persisted.stopRequestedBy === 'konard', 'a user stop survives a restart, so resume-by-default never relaunches cancelled work');
assert(persisted.resolvedPullRequestUrl === 'https://github.com/link-assistant/formal-ai/pull/1070', 'the resolved pull request is persisted, so it is not looked up again');

// ---------------------------------------------------------------------------
// 6. End to end: one notification, one recovery, and no repeat work afterwards
// ---------------------------------------------------------------------------

function makeBot() {
  const edits = [];
  const sends = [];
  return {
    edits,
    sends,
    telegram: {
      editMessageText: async (chatId, messageId, _inline, text, options) => {
        edits.push({ chatId, messageId, text, options });
        return { message_id: messageId, chat: { id: chatId } };
      },
      sendMessage: async (chatId, text, options) => {
        sends.push({ chatId, text, options });
        return { message_id: 999, chat: { id: chatId } };
      },
    },
  };
}

const logPath = path.join(os.tmpdir(), `hive-mind-test-2189-${process.pid}.log`);
fs.writeFileSync(logPath, ['solve v2.15.1 starting', `📌 Session ID: ${TOOL_SESSION}`, '<--- Last few GCs --->', 'FATAL ERROR: Reached heap limit Allocation failed - JavaScript heap out of memory', ''].join('\n'), 'utf8');

// A store that records every snapshot, so the "bot died right after notifying"
// case can be replayed from exactly what was on disk at that moment.
const snapshots = [];
const removed = [];
const recordingStore = {
  snapshotPath: '/tmp/test-2189/sessions.json',
  persist: (sessionName, sessionInfo) => snapshots.push({ sessionName, record: serializeSessionInfo(sessionInfo) }),
  remove: (sessionName, meta) => removed.push({ sessionName, meta }),
  load: () => [],
};

function killedSessionInfo() {
  return {
    chatId: 100,
    messageId: 200,
    startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000),
    url: 'https://github.com/link-assistant/formal-ai/issues/1069',
    command: 'solve',
    isolationBackend: 'docker',
    sessionId: SESSION,
    tool: 'codex',
    logPath,
    args: ['--verbose'],
    urlContext: { type: 'issue', owner: 'link-assistant', repo: 'formal-ai', number: 1069 },
  };
}

const probes = { status: 0, readFile: 0, linkedPr: 0, dockerSize: 0, uploads: 0, ghCalls: [] };
function monitorOptions(extra = {}) {
  return {
    statusProvider: async () => {
      probes.status += 1;
      return { exists: true, status: 'executed', exitCode: 139, oomKilled: false, isolation: 'docker', logPath };
    },
    exitFromLog: () => ({ finished: true, exitCode: 139, endTime: '2026-08-30T14:07:49.000Z' }),
    backendAlive: async () => false,
    dockerContainerSizeProvider: async () => {
      probes.dockerSize += 1;
      return null;
    },
    readFile: async () => {
      probes.readFile += 1;
      return fs.readFileSync(logPath, 'utf8');
    },
    lookupLinkedPullRequest: async () => {
      probes.linkedPr += 1;
      return 'https://github.com/link-assistant/formal-ai/pull/1070';
    },
    env: {},
    // Every outward-facing call is injected: this test must never talk to
    // GitHub or Telegram for real.
    runCommand: async (command, args) => {
      probes.ghCalls.push({ command, args });
      return { code: 0, stdout: 'https://github.com/link-assistant/formal-ai/pull/1070#issuecomment-1\n', stderr: '' };
    },
    attachLog: async () => {
      probes.uploads += 1;
      return true;
    },
    ...extra,
  };
}

resetSessionMonitorForTests();
setSessionStore(recordingStore);
trackSession(SESSION, killedSessionInfo(), false);

const bot = makeBot();
const recoveryLaunches = [];
await monitorSessions(
  bot,
  false,
  monitorOptions({
    isolationRunner: {
      generateSessionId: () => 'recovery-2189-0000-1111-222233334444',
      executeWithIsolation: async (command, args, opts) => {
        recoveryLaunches.push({ command, args, opts });
        return { success: true };
      },
    },
  })
);

assert(recoveryLaunches.length === 1, 'the killed session is resumed by the bot itself, with no flag set (defect 1)');
assert(bot.edits.length === 1, 'the user is notified exactly once');
assert(/recovery-2189-0000-1111-222233334444/.test(bot.edits[0].text), 'the notification names the working session that took over');
const latchedSnapshot = snapshots.filter(entry => entry.record.completionNotifiedAt).pop();
assert(latchedSnapshot !== undefined, 'the delivered notification is latched into the durable snapshot');
assert(latchedSnapshot.record.completionExitCode === 139, 'the latched snapshot carries the exit code the user was told about');
assert(latchedSnapshot.record.lastToolSessionId === TOOL_SESSION, 'the last tool session id is cached in the same snapshot, so no later poll re-scans the log');
assert(latchedSnapshot.record.resolvedPullRequestUrl === 'https://github.com/link-assistant/formal-ai/pull/1070', 'the resolved pull request is cached too');
assert(probes.linkedPr === 1, 'the linked pull request is resolved once for the completion');

// The incident: the bot restarts (or the completion is retried) with the session
// still tracked. Replay exactly the record that was on disk when it died.
const afterCrash = { ...probes, ghCalls: probes.ghCalls.length };
const restartedBot = makeBot();
resetSessionMonitorForTests();
setSessionStore(recordingStore);
trackSession(SESSION, deserializeSessionInfo(latchedSnapshot.record), false);
await monitorSessions(restartedBot, false, monitorOptions());

assert(restartedBot.edits.length === 0 && restartedBot.sends.length === 0, 'a session that was already reported is never reported again (issue #2189 comment)');
assert(probes.status === afterCrash.status, 'no status probe is issued for an already-reported session');
assert(probes.readFile === afterCrash.readFile && probes.linkedPr === afterCrash.linkedPr, 'no log read and no pull request lookup happen again');
assert(probes.dockerSize === afterCrash.dockerSize, 'the 27 GB writable layer is not walked again');
assert(probes.ghCalls.length === afterCrash.ghCalls && probes.uploads === afterCrash.uploads, 'no pull request comment and no log upload are repeated');
assert(getActiveSessionCount(false) === 0, 'the already-reported session reaches its terminal state instead of being re-detected every poll');
assert(
  removed.some(entry => entry.sessionName === SESSION),
  'the terminal session is removed from the durable store'
);

// Same replay without the latch — this is the loop the incident was stuck in.
const unlatchedBot = makeBot();
const unlatchedRecord = { ...latchedSnapshot.record };
for (const field of COMPLETION_STATE_FIELDS) delete unlatchedRecord[field];
delete unlatchedRecord.resolvedPullRequestUrl;
resetSessionMonitorForTests();
setSessionStore(recordingStore);
trackSession(SESSION, deserializeSessionInfo(unlatchedRecord), false);
await monitorSessions(unlatchedBot, false, monitorOptions());
assert(unlatchedBot.edits.length === 1 && probes.linkedPr === afterCrash.linkedPr + 1, 'without the latch the very same completion runs again — the loop this fix removes');

resetSessionMonitorForTests();
setSessionStore(null);
fs.rmSync(logPath, { force: true });

printSummary(78);

if (getFailCount() > 0) {
  process.exit(1);
}
