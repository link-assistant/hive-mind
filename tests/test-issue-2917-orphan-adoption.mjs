#!/usr/bin/env node
/**
 * Regression coverage for issue #2917 — the monitor side.
 *
 * After the 2026-10-09 dockerd OOM the bot reported four `/codex` tasks as
 * finished (`executed 137`) and dropped them; an operator resumed each with
 * `$ --resume`, so `<uuid>-resume-<n>` containers did the work while nothing
 * watched them. Asserted here:
 *   1. a tracked session whose container died but whose `-resume-<n>`
 *      descendant runs is followed into it, not reported finished;
 *   2. the dead container's footer in a shared log does not end the followed
 *      session, a footer written after the resume does;
 *   3. a docker `executed 0` with no log footer and a live container stays
 *      running (stale `$ --status`, link-foundation/start#193);
 *   4. an untracked running container is adopted from the durable event log
 *      with its chat, message and URL, and its real end is reported there;
 *   5. a container with no record, or one that only just started, is not
 *      adopted (it is still counted by the queue as `untracked`).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2917
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { __setIsolationRunnerForTests, getIsolationSessionStateForTests, adoptOrphanTaskContainers, monitorSessions, resetSessionMonitorForTests, setSessionStore, trackSession, getTrackedSessionInfo, getActiveSessionCount } from '../src/session-monitor.lib.mjs';
import { createSessionStore } from '../src/session-store.lib.mjs';
import { buildAdoptedSessionInfo, ORPHAN_ADOPTION_MIN_AGE_MS } from '../src/session-monitor.adopt.lib.mjs';
import { scopeRecoveryFooter } from '../src/session-recovery-footer.lib.mjs';
import { isUnknownDockerExitCode } from '../src/isolation-runner.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #2917: resumed task containers are followed and adopted');
console.log('='.repeat(78));

await initI18n('en');
await preloadAllLocales();

const SESSION = 'a1b2c3d4-0000-4000-8000-000000000724';
const RESUMED = `${SESSION}-resume-1`;
const URL = 'https://github.com/link-assistant/router/issues/724';
const LOG = `/tmp/start-command/logs/isolation/docker/${SESSION}.log`;
const DEAD_AT = '2026-10-09T10:00:00.000Z';
const RESUMED_AT = '2026-10-09T11:00:00.000Z';

function stubRunner(statuses, { alive = {} } = {}) {
  return {
    isExecutingSessionStatus: s => s === 'executing' || s === 'running',
    isTerminalSessionStatus: s => ['executed', 'completed', 'failed', 'cancelled', 'canceled', 'error', 'killed'].includes(s),
    isUnknownDockerExitCode,
    querySessionStatus: async id => statuses[id] || { exists: false },
    isSessionRunning: async id => Boolean(alive[id]),
    checkBackendSessionAlive: async id => (id in alive ? alive[id] : null),
    readSessionExitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
  };
}

const container = (name, extra = {}) => ({ id: `id-${name}`, name, rootSessionName: SESSION, parentSessionId: null, tool: 'codex', toolSource: 'command', url: URL, startedAt: RESUMED_AT, image: 'konard/hive-mind:latest', ...extra });
const containersOf =
  (...list) =>
  async () => ({ available: true, containers: list });

function makeBot() {
  const edits = [];
  const sends = [];
  return {
    edits,
    sends,
    telegram: {
      editMessageText: async (chatId, messageId, _inline, text, options) => edits.push({ chatId, messageId, text, options }),
      sendMessage: async (chatId, text, options) => {
        sends.push({ chatId, text, options });
        return { chat: { id: chatId }, message_id: 1 };
      },
    },
  };
}

// ---------------------------------------------------------------------------
console.log('\n-- 1. a dead container with a running resume is followed --');
{
  const deadFooter = () => ({ finished: true, exitCode: 137, endTime: DEAD_AT });
  __setIsolationRunnerForTests(
    stubRunner({
      [SESSION]: { exists: true, status: 'executed', exitCode: 137, logPath: LOG },
      [RESUMED]: { exists: true, status: 'executing', logPath: LOG, uuid: 'exec-uuid-resume-1' },
    })
  );
  const info = { isolationBackend: 'docker', sessionId: SESSION, url: URL, tool: 'codex', chatId: 1, logPath: LOG };
  const state = await getIsolationSessionStateForTests(SESSION, info, { taskContainers: containersOf(container(RESUMED)), exitFromLog: deadFooter });
  assert(state.running === true, 'the session is still running: its work continues in the resumed container');
  assert(state.followedResume?.to === RESUMED, 'the state reports the switch to the resumed container');
  assert(info.sessionId === RESUMED, 'the tracked session now points at the resumed container');
  assert(info.followedResumeOf === SESSION && info.rootSessionName === SESSION, 'the original session is kept as the chain root');
  assert(info.attemptStartedAt === RESUMED_AT, 'the attempt is scoped to the resumed container start');
  assert(info.executionUuid === 'exec-uuid-resume-1', 'the resumed execution UUID is recorded (what `$ --list` shows)');

  const owned = { isolationBackend: 'docker', sessionId: SESSION, killRecoverySessionId: 'recovery-uuid', logPath: LOG };
  const ownedState = await getIsolationSessionStateForTests(SESSION, owned, { taskContainers: containersOf(container(RESUMED)), exitFromLog: deadFooter });
  assert(ownedState.running === false && owned.sessionId === SESSION, "a session the bot's own kill recovery took over is not followed");

  const noDescendant = { isolationBackend: 'docker', sessionId: SESSION, logPath: LOG };
  const goneState = await getIsolationSessionStateForTests(SESSION, noDescendant, { taskContainers: containersOf(), exitFromLog: deadFooter });
  assert(goneState.running === false && goneState.exitCode === 137, 'without a running resume the kill is still reported');
}

// ---------------------------------------------------------------------------
console.log('\n-- 2. the footer is scoped to the resumed attempt --');
{
  const info = { attemptStartedAt: RESUMED_AT };
  const old = scopeRecoveryFooter(() => ({ finished: true, exitCode: 137, endTime: DEAD_AT }), info)(LOG);
  assert(old.finished === false, "the dead container's footer is ignored for the resumed attempt");
  const fresh = scopeRecoveryFooter(() => ({ finished: true, exitCode: 0, endTime: '2026-10-09T12:00:00.000Z' }), info)(LOG);
  assert(fresh.finished === true && fresh.exitCode === 0, 'a footer written after the resume ends the session');
  const inPlace = { attemptStartedAt: RESUMED_AT, killRecoveryInPlace: true, killRecoveryLogStartBytes: 10, killRecoveryResumed: true, killRecoveryStartedAt: '2026-10-09T09:00:00.000Z' };
  const stale = scopeRecoveryFooter(() => ({ finished: true, exitCode: 137, endTime: DEAD_AT }), inPlace)(LOG);
  assert(stale.finished === false, "an earlier recovery's byte boundary does not let the dead container's footer through");
  const unscoped = scopeRecoveryFooter(() => ({ finished: true, exitCode: 0, endTime: DEAD_AT }), {})(LOG);
  assert(unscoped.finished === true, 'sessions without a resumed attempt are unaffected');
}

// ---------------------------------------------------------------------------
console.log('\n-- 3. a stale footer-less `executed 0` with a live container stays running --');
{
  __setIsolationRunnerForTests(stubRunner({ [SESSION]: { exists: true, status: 'executed', exitCode: 0, logPath: LOG } }, { alive: { [SESSION]: true } }));
  const info = { isolationBackend: 'docker', sessionId: SESSION, logPath: LOG };
  const state = await getIsolationSessionStateForTests(SESSION, info, { taskContainers: containersOf() });
  assert(state.running === true, 'a running container outranks a footer-less `executed 0`');

  __setIsolationRunnerForTests(stubRunner({ [SESSION]: { exists: true, status: 'executed', exitCode: 0, logPath: LOG } }, { alive: { [SESSION]: false } }));
  const done = await getIsolationSessionStateForTests(SESSION, { isolationBackend: 'docker', sessionId: SESSION, logPath: LOG }, { taskContainers: containersOf() });
  assert(done.running === false && done.exitCode === 0, 'a stopped container with `executed 0` completes as before');
}
__setIsolationRunnerForTests(null);

// ---------------------------------------------------------------------------
console.log('\n-- 4. an untracked running container is adopted from the event log --');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-2917-'));
try {
  resetSessionMonitorForTests();
  const store = createSessionStore({ dir: stateDir });
  setSessionStore(store);
  // The original launch, then the (wrong) completion the bot reported after the dockerd OOM.
  trackSession(SESSION, { chatId: 42, messageId: 7, startTime: new Date(DEAD_AT), url: URL, command: 'solve', isolationBackend: 'docker', sessionId: SESSION, tool: 'codex', args: [URL, '--tool', 'codex'], logPath: LOG });
  const tracked = getTrackedSessionInfo(SESSION);
  tracked.completionNotifiedAt = DEAD_AT;
  tracked.completionExitCode = 137;
  store.persist(SESSION, tracked);
  resetSessionMonitorForTests();
  setSessionStore(store);
  store.remove(SESSION, { status: 'killed', exitCode: 137 });
  assert(getActiveSessionCount(false) === 0, 'precondition: the bot no longer tracks the task (sessions.json is empty)');

  const now = () => new Date('2026-10-09T11:30:00.000Z');
  const young = await adoptOrphanTaskContainers({ taskContainers: containersOf(container(RESUMED, { startedAt: '2026-10-09T11:29:30.000Z' })), now });
  assert(young.adopted.length === 0, `a container younger than ${ORPHAN_ADOPTION_MIN_AGE_MS / 1000}s is not adopted (it may be launching)`);

  const stranger = container('ffffffff-0000-4000-8000-000000000999', { rootSessionName: 'ffffffff-0000-4000-8000-000000000999', url: 'https://github.com/x/y/issues/1' });
  const result = await adoptOrphanTaskContainers({ taskContainers: containersOf(container(RESUMED), stranger), now });
  assert(result.adopted.length === 1 && result.adopted[0].container === RESUMED, 'the resumed container is adopted');
  assert(result.unmatched.includes(stranger.name), 'a container with no session record is not adopted');
  const adopted = getTrackedSessionInfo(SESSION);
  assert(adopted?.chatId === 42 && adopted.messageId === 7, 'the adopted session reports to the original chat and message');
  assert(adopted.sessionId === RESUMED && adopted.tool === 'codex' && adopted.url === URL, 'it tracks the resumed container with tool and url');
  assert(adopted.adopted === true && adopted.attemptStartedAt === RESUMED_AT, 'it is marked adopted and scoped to the resumed attempt');
  assert(adopted.completionNotifiedAt === undefined && adopted.completionExitCode === undefined, 'the latch of the wrongly reported completion is cleared');
  assert(
    store.load().some(r => r.sessionName === SESSION && r.sessionInfo.adopted === true),
    'the adoption is persisted, so a restart keeps watching it'
  );

  let lookups = 0;
  const originalFind = store.findLatestTrackEvent;
  store.findLatestTrackEvent = (...args) => {
    lookups++;
    return originalFind.apply(store, args);
  };
  const again = await adoptOrphanTaskContainers({ taskContainers: containersOf(container(RESUMED), stranger), now });
  assert(again.adopted.length === 0 && lookups === 0, 'later ticks neither re-adopt nor rescan the event log for known strangers');
  store.findLatestTrackEvent = originalFind;

  // The adopted session's real end is reported where the task was started.
  const bot = makeBot();
  await monitorSessions(bot, false, {
    taskContainers: containersOf(),
    statusProvider: async id => (id === RESUMED ? { exists: true, status: 'executed', exitCode: 0, isolation: 'docker', logPath: LOG } : { exists: false }),
    exitFromLog: () => ({ finished: true, exitCode: 0, endTime: '2026-10-09T12:00:00.000Z' }),
    backendAlive: async () => false,
    dockerContainerSizeProvider: async () => null,
    readFile: async () => '',
    lookupLinkedPullRequest: async () => null,
    lookupPullRequestState: async () => null,
  });
  const delivered = [...bot.edits, ...bot.sends];
  assert(delivered.length > 0 && delivered.every(m => m.chatId === 42), 'the completion is delivered to the original chat');
  assert(
    bot.edits.some(m => m.messageId === 7),
    'the original status message is edited with the real result'
  );
  assert(getActiveSessionCount(false) === 0, 'the adopted session is untracked once reported');
} finally {
  resetSessionMonitorForTests();
  fs.rmSync(stateDir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
console.log('\n-- 5. buildAdoptedSessionInfo --');
{
  const record = { sessionName: SESSION, ts: DEAD_AT, sessionInfo: { chatId: 1, sessionId: SESSION, killRecoverySessionId: 'old', completionStatus: 'killed', executionUuid: 'dead', tool: null } };
  const info = buildAdoptedSessionInfo(container(RESUMED, { tool: 'codex' }), record, new Date(RESUMED_AT));
  assert(info.killRecoverySessionId === undefined && info.completionStatus === undefined && info.executionUuid === undefined, 'stale attempt fields are dropped');
  assert(info.tool === 'codex' && info.followedResumeOf === SESSION && info.adoptedFrom === DEAD_AT, 'missing fields come from the container; provenance is recorded');
}

printSummary();
if (getFailCount() > 0) process.exit(1);
