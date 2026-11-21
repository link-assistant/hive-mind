#!/usr/bin/env node
/**
 * Regression coverage for issue #3209: a Docker session was reported
 * "✅ Work session finished successfully" 11 s after it was tracked — before its
 * container existed — and its real failure 26 minutes later was never reported.
 *
 * Captured timeline (Hive Mind 2.35.8, `/codex … --model formal-ai`):
 *   21:52:05  session tracked; the Formal AI image pull starts (the container is
 *             created only after the sidecar is ready)
 *   21:52:15  `$ --status` has no record, `docker inspect` says not running →
 *             "Session … has finished"
 *   21:52:16  "✅ Work session finished successfully" (exitCode null → audit 0)
 *   22:02:12  the container actually starts (the launch call returns and the
 *             same session record is tracked again)
 *   22:02:44  "already reported … (issue #2189)" — dropped by the latch
 *   22:18:13  the run fails with exit 1 — never reported
 *
 * Asserted here:
 *   1. a launch that takes longer than a poll interval is reported only when
 *      the container exits, with its real exit code;
 *   2. a session whose execution is never observed is reported as
 *      "status unknown" once its launch grace expires — never as success;
 *   3. `exitCode: null` never yields the success message, and the audit never
 *      records exit 0 for it;
 *   4. a completion latched with an unknown exit code is un-latched when the
 *      session is later found running, so its real end is reported.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3209
 */

import { initI18n } from '../src/i18n.lib.mjs';
import { isExecutingSessionStatus, isTerminalSessionStatus } from '../src/session-status.lib.mjs';
import { formatStartingWorkSessionMessage, formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { buildExecuteAndUpdateMessage } from '../src/telegram-command-execution.lib.mjs';
import { serializeSessionInfo, deserializeSessionInfo } from '../src/session-store.lib.mjs';
import { __setIsolationRunnerForTests, getActiveSessionCount, getTrackedSessionInfo, hasActiveSessionForUrlAsync, monitorSessions, resetSessionMonitorForTests, setSessionLogger, setSessionStore, trackSession, untrackSession } from '../src/session-monitor.lib.mjs';
import { LAUNCH_APPEAR_GRACE_MS, LAUNCH_PENDING_GRACE_MS } from '../src/session-monitor.launch-state.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #3209: an isolated session is not finished before its execution was observed');
console.log('='.repeat(78));

await initI18n('en');

const SESSION = '67c6a8b5-28ce-48f7-ba89-8e33278f2749';
const URL = 'https://github.com/konard/test-hello-world-019fb331-c107-78c7-8ff6-9f127a3c593c/issues/1';
const LOG_PATH = `/tmp/hive-mind-test-3209-${process.pid}.log`;

// What `$ --status`, `docker inspect` and the log footer currently say.
const world = { status: { exists: false, status: null, exitCode: null }, running: false, footer: null };
function setWorld(next) {
  Object.assign(world, { status: { exists: false, status: null, exitCode: null }, running: false, footer: null }, next);
}
__setIsolationRunnerForTests({
  querySessionStatus: async () => world.status,
  isSessionRunning: async () => world.running,
  checkBackendSessionAlive: async () => world.running,
  readSessionExitFromLog: () => world.footer,
  isExecutingSessionStatus,
  isTerminalSessionStatus,
  isUnknownDockerExitCode: code => code === -1 || code === null || code === undefined,
  getDockerContainerWritableLayerSize: async () => null,
  removeDockerContainer: async () => ({ success: true }),
});

const events = [];
const removed = [];
function resetMonitor() {
  resetSessionMonitorForTests();
  events.length = 0;
  removed.length = 0;
  setSessionLogger({ event: (type, data) => events.push({ type, data }) });
  setSessionStore({ snapshotPath: '/tmp/test-3209/sessions.json', persist: () => {}, remove: (sessionName, meta) => removed.push({ sessionName, meta }), load: () => [] });
}

const edits = [];
const telegram = {
  editMessageText: async (_chatId, _messageId, _inline, text) => {
    edits.push(text);
    return true;
  },
  sendMessage: async (chatId, text) => {
    edits.push(text);
    return { message_id: 1, chat: { id: chatId } };
  },
};
const bot = { telegram };
const monitorOptions = {
  lookupLinkedPullRequest: async () => null,
  lookupPullRequestState: async () => null,
  readFile: async () => '',
  dockerContainerSizeProvider: async () => null,
  removeDockerContainer: async () => ({ success: true }),
  env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
  runCommand: async () => ({ code: 0, stdout: '', stderr: '' }),
  attachLog: async () => true,
};
const tick = () => monitorSessions(bot, false, monitorOptions);
const completionEdits = () => edits.filter(text => /Work session|status unknown/i.test(text) && !/Starting|EXECUTING/.test(text));
const completedEvents = () => events.filter(event => event.type === 'session_completed');

// ---------------------------------------------------------------------------
// 1. The captured timeline: a slow launch is reported only when it really ends
// ---------------------------------------------------------------------------
{
  resetMonitor();
  edits.length = 0;
  setWorld({});
  let resolveLaunch;
  const launch = new Promise(resolve => {
    resolveLaunch = resolve;
  });
  const run = buildExecuteAndUpdateMessage({
    resolveIsolation: async () => ({ backend: 'docker', runner: { generateSessionId: () => SESSION, executeWithIsolation: () => launch } }),
    ISOLATION_BACKEND: 'docker',
    isolationRunner: {},
    VERBOSE: false,
    executeStartScreen: async () => ({ success: false }),
    trackSession,
    untrackSession,
    AUTO_WATCH_MESSAGE: false,
    startAutoTerminalWatchForSession: async () => {},
    bot,
    formatExecutingWorkSessionMessage: ({ sessionName }) => `EXECUTING ${sessionName}`,
    formatStartingWorkSessionMessage,
  });
  const ctx = { from: { id: 7 }, chat: { id: 42 }, message: {}, telegram };
  const launched = run(ctx, { chat: { id: 42 }, message_id: 100 }, 'solve', [URL], `Issue: ${URL}`, 'docker', 'codex');
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline && getActiveSessionCount() === 0) await new Promise(resolve => setTimeout(resolve, 10));
  assert(getActiveSessionCount() === 1, 'the session is tracked while its launch is still pulling the image');

  // 21:52:15 — no `$` record yet, `docker inspect` finds no running container.
  await tick();
  assert(completionEdits().length === 0, 'no completion is reported while the launch is still preparing the container');
  assert(completedEvents().length === 0, 'no session_completed audit event is written during the launch');
  assert(getActiveSessionCount() === 1, 'the session stays tracked during the launch');
  const duplicate = await hasActiveSessionForUrlAsync(URL, false);
  assert(duplicate.isActive === true, 'a session that is still launching blocks a duplicate run for the same URL');

  // 22:02:12 — the container starts and the launch call returns.
  setWorld({ status: { exists: true, status: 'executing', exitCode: null, isolation: 'docker', logPath: LOG_PATH }, running: true });
  resolveLaunch({ success: true, sessionId: SESSION, output: 'ok', executionUuid: '4d45ad2c-90e8-45b7-92eb-1c63aa270972' });
  await launched;
  const info = getTrackedSessionInfo(SESSION);
  assert(info && !info.launchPending && typeof info.launchedAt === 'string', 'a returned launch is recorded on the tracked session');
  await tick();
  assert(completionEdits().length === 0, 'a running container is not reported as finished');
  assert(typeof getTrackedSessionInfo(SESSION)?.containerSeenAt === 'string', 'the first sighting of the execution is recorded');

  // 22:18:13 — the run fails with exit 1.
  setWorld({ status: { exists: true, status: 'executed', exitCode: 1, isolation: 'docker', logPath: LOG_PATH, endTime: new Date().toISOString() }, running: false, footer: { finished: true, exitCode: 1 } });
  await tick();
  const reports = completionEdits();
  assert(reports.length === 1, 'the real end of the session is reported exactly once');
  assert(/failed \(exit code: 1\)/.test(reports[0] || ''), 'the report carries the real exit code 1');
  assert(!/finished successfully/.test(reports.join('\n')), 'no success message was ever sent for the failed run');
  assert(completedEvents().length === 1 && completedEvents()[0].data.exitCode === 1, 'the audit records the real exit code');
  assert(getActiveSessionCount() === 0, 'the session is untracked after its real end');
}

// ---------------------------------------------------------------------------
// 2. An execution that never appears is "status unknown", never success
// ---------------------------------------------------------------------------
function dockerSession(extra = {}) {
  return { chatId: 42, messageId: 100, startTime: new Date(), url: URL, command: 'solve', tool: 'codex', isolationBackend: 'docker', sessionId: SESSION, ...extra };
}

{
  resetMonitor();
  edits.length = 0;
  setWorld({});
  trackSession(SESSION, dockerSession({ launchPending: true, startTime: new Date(Date.now() - 10 * 60 * 1000) }));
  await tick();
  assert(getActiveSessionCount() === 1 && completionEdits().length === 0, 'a launch ten minutes into an image pull is still awaited');

  resetMonitor();
  edits.length = 0;
  trackSession(SESSION, dockerSession({ launchPending: true, startTime: new Date(Date.now() - LAUNCH_PENDING_GRACE_MS - 1000) }));
  await tick();
  const reports = completionEdits();
  assert(reports.length === 1, 'a launch that never produced an execution is reported once its grace expires');
  assert(/^⚠️/.test(reports[0] || '') && /status unknown/i.test(reports[0] || ''), 'it is reported as "status unknown" with a warning');
  assert(!/finished successfully|^✅/.test(reports[0] || ''), 'it is never reported as a success');
  assert(completedEvents()[0]?.data.exitCode === null && removed[0]?.meta.exitCode === null, 'the audit and the session store record an unknown exit code, not 0');

  resetMonitor();
  edits.length = 0;
  trackSession(SESSION, dockerSession({ launchedAt: new Date(Date.now() - 30 * 1000).toISOString() }));
  await tick();
  assert(getActiveSessionCount() === 1 && completionEdits().length === 0, 'a launch that returned 30 s ago gets time for its execution to appear');

  resetMonitor();
  edits.length = 0;
  trackSession(SESSION, dockerSession({ launchedAt: new Date(Date.now() - LAUNCH_APPEAR_GRACE_MS - 1000).toISOString() }));
  await tick();
  assert(completionEdits().length === 1 && /status unknown/i.test(completionEdits()[0]), 'a returned launch whose execution never appeared is reported as status unknown');
}

// ---------------------------------------------------------------------------
// 3. `exitCode: null` never yields the success message
// ---------------------------------------------------------------------------
{
  const plain = formatSessionCompletionMessage({ sessionName: SESSION, sessionInfo: dockerSession(), exitCode: null, statusResult: null });
  assert(!/finished successfully/.test(plain) && /^⚠️/.test(plain) && /unknown/i.test(plain), 'a null exit code without a status record is reported as unknown');
  const executed = formatSessionCompletionMessage({ sessionName: SESSION, sessionInfo: dockerSession(), exitCode: null, statusResult: { status: 'executed', exitCode: null } });
  assert(!/finished successfully/.test(executed) && /unknown/i.test(executed), 'a terminal status without an exit code is reported as unknown');
  const zero = formatSessionCompletionMessage({ sessionName: SESSION, sessionInfo: dockerSession(), exitCode: 0, statusResult: { status: 'executed', exitCode: 0 } });
  assert(/^✅/.test(zero) && /finished successfully/.test(zero), 'a real exit code 0 is still a success');
  await initI18n('ru');
  const russian = formatSessionCompletionMessage({ sessionName: SESSION, sessionInfo: dockerSession({ locale: 'ru' }), exitCode: null });
  await initI18n('en');
  assert(/^⚠️/.test(russian) && !/unknown|finished successfully|Work session/i.test(russian.split('\n')[0]), 'the unknown-status text is localized');

  // Seen running, then gone with no status record and no log footer.
  resetMonitor();
  edits.length = 0;
  setWorld({ running: true });
  trackSession(SESSION, dockerSession({ launchedAt: new Date().toISOString() }));
  await tick();
  assert(getActiveSessionCount() === 1, 'a running session is kept tracked');
  setWorld({});
  await tick();
  const reports = completionEdits();
  assert(reports.length === 1 && !/finished successfully/.test(reports[0]) && /unknown/i.test(reports[0]), 'a session that vanished without an exit code is reported as unknown, not success');
  assert(completedEvents()[0]?.data.exitCode === null, 'the audit does not turn the unknown exit code into 0');
}

// ---------------------------------------------------------------------------
// 4. An unknown-exit completion is un-latched when the session is found running
// ---------------------------------------------------------------------------
{
  resetMonitor();
  edits.length = 0;
  setWorld({ status: { exists: true, status: 'executing', exitCode: null, isolation: 'docker', logPath: LOG_PATH }, running: true });
  trackSession(SESSION, dockerSession({ completionNotifiedAt: '2026-10-13T21:52:16.000Z', completionExitCode: null, completionStatus: null }));
  await tick();
  const info = getTrackedSessionInfo(SESSION);
  assert(getActiveSessionCount() === 1, 'a latched completion with an unknown exit code is not finalized while the session runs');
  assert(info && !info.completionNotifiedAt, 'the latch is cleared');
  assert(
    events.some(event => event.type === 'session_completion_unlatched'),
    'the un-latch is recorded in the structured log'
  );

  setWorld({ status: { exists: true, status: 'executed', exitCode: 1, isolation: 'docker', logPath: LOG_PATH, endTime: new Date().toISOString() }, running: false, footer: { finished: true, exitCode: 1 } });
  await tick();
  assert(completionEdits().length === 1 && /failed \(exit code: 1\)/.test(completionEdits()[0]), 'the real end is reported with its real exit code');

  // A latch with a known exit code still finalizes silently (issue #2189).
  resetMonitor();
  edits.length = 0;
  setWorld({ status: { exists: true, status: 'executing', exitCode: null }, running: true });
  trackSession(SESSION, dockerSession({ completionNotifiedAt: '2026-10-13T21:52:16.000Z', completionExitCode: 1, completionStatus: 'failed' }));
  await tick();
  assert(getActiveSessionCount() === 0 && completionEdits().length === 0, 'a latch with a known exit code is finalized without a second report');
  assert(completedEvents()[0]?.data.exitCode === 1, 'the finalized audit keeps the reported exit code');
}

// ---------------------------------------------------------------------------
// 5. The launch bookkeeping survives a bot restart
// ---------------------------------------------------------------------------
{
  const restored = deserializeSessionInfo(serializeSessionInfo(dockerSession({ launchPending: true, launchedAt: '2026-10-13T22:02:12.000Z', containerSeenAt: '2026-10-13T22:02:44.000Z' })));
  assert(restored.launchPending === true && restored.launchedAt === '2026-10-13T22:02:12.000Z' && restored.containerSeenAt === '2026-10-13T22:02:44.000Z', 'launch state is persisted in the session snapshot');
}

__setIsolationRunnerForTests(null);
resetSessionMonitorForTests();
printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
