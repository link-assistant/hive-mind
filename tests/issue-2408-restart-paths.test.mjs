/**
 * @hive-mind-test-suite default
 * Issue #2408, PR #2409 review (2026-10-03): "Auto-restart limit should have stopped the task, yet
 * it was restarted in the background and continued to work… carefully double check all the paths."
 *
 * The audit of every restart path found these gaps, each covered here:
 *   B1. a session SIGKILLed after solve had already stopped deliberately was still recovered;
 *   B2. an exit 0 with Docker's sticky OOMKilled flag and no footer yet was reported as an OOM kill;
 *   B3. "No progress between sessions" and "SUBSCRIPTION/ACCESS UNAVAILABLE" stops were not
 *       recognised as deliberate;
 *   B4. `/stop <root session>` did not reach the kill-recovery session it was replaced by, so the
 *       operator's stop was followed by another automatic recovery;
 *   B5. a resumed solve child killed by a signal made the auto-continue parent exit 0 (success);
 *   B7. the stop markers matched anywhere in a line, e.g. inside quoted tool output.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession, markSessionStopRequested, getTrackedSessionInfo, STALE_EXECUTING_MIN_AGE_MS } from '../src/session-monitor.lib.mjs';
import { resolveOomKilledState } from '../src/session-monitor.oom.lib.mjs';
import { findDeliberateSolveStop } from '../src/session-kill-attribution.lib.mjs';
import { recoverKilledSession } from '../src/session-kill-resume.lib.mjs';
import { exitCodeFromChildClose } from '../src/session-status.lib.mjs';

const PR_URL = 'https://github.com/link-foundation/meta-language/pull/196';
const TOOL_SESSION = '85671f31-4459-422e-8fef-04ee03fd3aa0';

async function writeLog(name, text) {
  const logPath = path.join(os.tmpdir(), `hive-mind-issue-2408-paths-${name}-${process.pid}.log`);
  await fs.writeFile(logPath, text);
  return logPath;
}

function makeHarness(statusProvider) {
  const edits = [];
  const comments = [];
  const launches = [];
  const bot = { telegram: { editMessageText: async (_chatId, messageId, _inline, message) => edits.push({ messageId, message }), sendMessage: async () => ({ chat: { id: 4242 }, message_id: 1 }) } };
  const options = {
    statusProvider,
    exitFromLog: () => null,
    backendAlive: async () => false,
    dockerContainerSizeProvider: async () => null,
    readFile: async file => await fs.readFile(file, 'utf8'),
    lookupLinkedPullRequest: async () => null,
    lookupPullRequestState: async () => null, // #2498: offline — the real pull request may have merged since
    env: {},
    isolationRunner: { generateSessionId: () => 'recovery-1', executeWithIsolation: async (...args) => (launches.push(args), { success: true }) },
    runCommand: async (_command, args) => {
      comments.push(await fs.readFile(args[args.indexOf('--body-file') + 1], 'utf8'));
      return { code: 0, stdout: `${PR_URL}#issuecomment-1`, stderr: '' };
    },
  };
  return { bot, edits, comments, launches, options };
}

const sessionInfo = (sessionName, logPath) => ({
  chatId: 4242,
  messageId: 77,
  startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000),
  command: 'solve',
  tool: 'claude',
  isolationBackend: 'docker',
  sessionId: sessionName,
  logPath,
  locale: 'en',
  url: PR_URL,
  args: [PR_URL, '--on-session-kill', 'resume'],
});

test('B1: a SIGKILL after solve already stopped deliberately is reported, not recovered', async () => {
  await initI18n('en');
  await preloadAllLocales();
  const sessionName = '7edfe0cf-0000-4000-8000-0000000000b1';
  // e.g. `docker stop` timed out on the post-mortem upload after the limit line.
  const logPath = await writeLog('b1', `📌 Session ID: ${TOOL_SESSION}\n[2026-10-03T03:27:40.000Z] [ERROR] ❌ Auto-restart limit reached\n`);
  const { bot, edits, comments, launches, options } = makeHarness(async () => ({ exists: true, status: 'executed', exitCode: 137, oomKilled: true, isolation: 'docker', logPath }));
  resetSessionMonitorForTests();
  try {
    trackSession(sessionName, sessionInfo(sessionName, logPath), false);
    await monitorSessions(bot, false, options);
    assert.equal(launches.length, 0, 'no recovery session is started');
    const reports = [...edits.map(edit => edit.message), ...comments].join('\n');
    assert.match(reports, /had already stopped on its own/);
  } finally {
    resetSessionMonitorForTests();
    await fs.rm(logPath, { force: true });
  }
});

test('B2: an exit 0 with the sticky OOM flag and no footer yet is a success with an OOM event', async () => {
  const info = { isolationBackend: 'docker', sessionId: 's' };
  const state = await resolveOomKilledState('s', info, { exists: true, status: 'executed', exitCode: 0, oomKilled: true, logPath: '/nonexistent' }, { exitFromLog: () => null, backendAlive: async () => false });
  assert.equal(state.exitCode, 0);
  assert.equal(state.status, 'executed');
  assert.ok(info.oomEventObservedAt, 'the OOM event is still remembered for the report');

  // While start-command still says "executing", exit 0 is only a placeholder.
  const running = await resolveOomKilledState('s', { isolationBackend: 'docker' }, { exists: true, status: 'executing', exitCode: 0, oomKilled: true }, { exitFromLog: () => null, backendAlive: async () => false });
  assert.notEqual(running.status, 'executed');
});

test('B3/B7: deliberate stops are recognised only on their own ❌ line', () => {
  const reason = text => findDeliberateSolveStop(text)?.reason || null;
  assert.equal(reason('❌ Auto-restart limit reached\n'), 'auto-restart-limit');
  assert.equal(reason('[2026-10-03T03:27:40.000Z] [ERROR] ❌ Auto-restart limit reached\r\n'), 'auto-restart-limit', 'log-prefixed and CRLF lines count');
  assert.equal(reason('[2026-09-27T15:06:31.624Z] [ERROR] ❌ No progress between sessions\n'), 'no-progress');
  assert.equal(reason('❌ Stopped after two consecutive AI sessions produced identical results\n'), 'no-progress');
  assert.equal(reason('❌ ⚠️ SUBSCRIPTION/ACCESS UNAVAILABLE\n'), 'subscription-blocked');
  assert.equal(reason('{"type":"text","text":"❌ Auto-restart limit reached"}\n'), null, 'quoted tool output is not a stop');
  assert.equal(reason('   ❌ Auto-restart limit reached\n'), null, 'an indented excerpt is not a stop');
  assert.equal(reason('❌ AI session failed\n'), null, 'a failed AI session stays recoverable (#2301)');
});

test('B4: /stop with the root session name reaches the recovery session that replaced it', async () => {
  resetSessionMonitorForTests();
  try {
    trackSession('recovery-1', { sessionId: 'recovery-1', executionUuid: 'exec-uuid-2', rootSessionName: 'root-session', killRecoveryOfSession: 'root-session', killRecoveryResumed: true, args: [PR_URL] }, false);
    assert.equal(markSessionStopRequested('root-session', { requestedBy: '@op' }), true);
    const info = getTrackedSessionInfo('recovery-1');
    assert.equal(info.stopRequestedByUser, true);
    assert.equal(info.stopRequestedBy, '@op');
    let launched = 0;
    const result = await recoverKilledSession({ sessionName: 'recovery-1', sessionInfo: info, killed: true, env: {}, readLastSessionId: () => TOOL_SESSION, runner: { generateSessionId: () => 'x', executeWithIsolation: async () => (launched++, { success: true }) }, trackSession: () => {} });
    assert.equal(result.resumed, false, 'the operator stop is not fought by another recovery');
    assert.equal(launched, 0);
    assert.equal(markSessionStopRequested('exec-uuid-2'), true, 'the execution UUID also matches');
    assert.equal(markSessionStopRequested('unrelated'), false);
  } finally {
    resetSessionMonitorForTests();
  }
});

test('B5: a resumed solve child killed by a signal is not reported as success', () => {
  assert.equal(exitCodeFromChildClose(0, null), 0);
  assert.equal(exitCodeFromChildClose(1, null), 1);
  assert.equal(exitCodeFromChildClose(null, 'SIGKILL'), 137);
  assert.equal(exitCodeFromChildClose(null, 'SIGTERM'), 143);
  assert.equal(exitCodeFromChildClose(null, 'SIGSOMETHING'), 137);
  assert.equal(exitCodeFromChildClose(null, null), 137);
});
