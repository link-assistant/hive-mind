/**
 * @hive-mind-test-suite default
 * Issue #2408 (link-foundation/meta-language#196): an OOM recovery that was actually running was
 * reported as "❌ Work session failed (exit code: 1)" while `/queue` still listed the task, the
 * pull request received six duplicate notice pairs, one of them with "[object Object]" as the
 * resume command, and the queue counted only the recovery session's time.
 *
 * Root causes covered here:
 *   1. overlapping 30 s monitor ticks ran the same completion several times; the later ones found
 *      the recovery budget spent and overwrote "recovering" with "failed";
 *   2. the first poll after an ordinary exit 1 (no footer yet) was classified "killed: OOM";
 *   3. a deliberate solve stop ("Auto-restart limit reached") spent the OOM recovery budget;
 *   4. the default budget (1) could not recover a second OOM in a long run;
 *   5. a tool process SIGKILLed inside the container (exit 137) stopped the solve loop;
 *   6. the queue and the headline did not show the total time or the recovery count.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initI18n, preloadAllLocales, t } from '../src/i18n.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession, STALE_EXECUTING_MIN_AGE_MS } from '../src/session-monitor.lib.mjs';
import { resolveOomKilledState } from '../src/session-monitor.oom.lib.mjs';
import { buildKillRecoveryNotice } from '../src/session-kill-recovery.lib.mjs';
import { recoverKilledSession } from '../src/session-kill-resume.lib.mjs';
import { resolveSessionKillResumeAttempts, DEFAULT_SESSION_KILL_RESUME_ATTEMPTS } from '../src/session-kill-policy.lib.mjs';
import { formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { collectExecutingItems, formatQueueExecutingItems } from '../src/telegram-solve-queue.helpers.lib.mjs';
import { findDeliberateSolveStop, detectDeliberateSolveStop } from '../src/session-kill-attribution.lib.mjs';
import { isToolProcessKilled, resumeAfterToolKill, buildToolKillWarningComment, TOOL_KILL_RESUME_FEEDBACK } from '../src/solve.tool-kill-resume.lib.mjs';

const PR_URL = 'https://github.com/link-foundation/meta-language/pull/196';
const pullContext = { type: 'pull', owner: 'link-foundation', repo: 'meta-language', number: 196, normalized: PR_URL };
const TOOL_SESSION = '85671f31-4459-422e-8fef-04ee03fd3aa0';

async function writeLog(name, text) {
  const logPath = path.join(os.tmpdir(), `hive-mind-issue-2408-${name}-${process.pid}.log`);
  await fs.writeFile(logPath, text);
  return logPath;
}

function makeSessionInfo(sessionName, logPath) {
  return {
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
    urlContext: pullContext,
    args: [PR_URL, '--on-session-kill', 'resume'],
    oomEventObservedAt: '2026-10-02T10:02:24.000Z',
  };
}

function makeHarness(statusProvider) {
  const edits = [];
  const comments = [];
  const launches = [];
  const bot = {
    telegram: {
      editMessageText: async (_chatId, messageId, _inline, message) => edits.push({ messageId, message }),
      sendMessage: async () => ({ chat: { id: 4242 }, message_id: 1 }),
    },
  };
  let counter = 0;
  const options = {
    statusProvider,
    exitFromLog: () => null,
    backendAlive: async () => false,
    dockerContainerSizeProvider: async () => null,
    readFile: async file => await fs.readFile(file, 'utf8'),
    lookupLinkedPullRequest: async () => null,
    env: {},
    isolationRunner: {
      generateSessionId: () => `recovery-${++counter}`,
      executeWithIsolation: async (...args) => {
        launches.push(args);
        // Hold the launch long enough for the next tick to overlap with it.
        await new Promise(resolve => setTimeout(resolve, 50));
        return { success: true };
      },
    },
    runCommand: async (_command, args) => {
      comments.push(await fs.readFile(args[args.indexOf('--body-file') + 1], 'utf8'));
      return { code: 0, stdout: `${PR_URL}#issuecomment-1`, stderr: '' };
    },
  };
  return { bot, edits, comments, launches, options };
}

test('overlapping monitor ticks recover a killed session once and report it once', async () => {
  await initI18n('en');
  await preloadAllLocales();
  const sessionName = '2b185a46-0000-4000-8000-000000002408';
  const logPath = await writeLog('overlap', `📌 Session ID: ${TOOL_SESSION}\n`);
  const { bot, edits, comments, launches, options } = makeHarness(async id => (id === sessionName ? { exists: true, status: 'executed', exitCode: 137, oomKilled: true, isolation: 'docker', logPath } : { exists: true, status: 'executing', isolation: 'docker' }));
  resetSessionMonitorForTests();
  try {
    trackSession(sessionName, makeSessionInfo(sessionName, logPath), false);
    // setInterval fires every 30 s whether or not the previous tick finished.
    await Promise.all([monitorSessions(bot, false, options), monitorSessions(bot, false, options), monitorSessions(bot, false, options)]);

    assert.equal(launches.length, 1, 'exactly one recovery session is started');
    assert.equal(comments.length, 1, 'exactly one pull-request notice is posted');
    assert.doesNotMatch(comments[0], /\[object Object\]/);
    const completions = edits.filter(edit => edit.messageId === 77);
    assert.equal(completions.length, 1, 'the Telegram message is completed once');
    assert.doesNotMatch(completions[0].message, /Work session failed/);
    assert.match(completions[0].message, /^⚠️ /, 'a running recovery is a warning, not a failure');
    assert.match(completions[0].message, /automatic recoveries: 1/);
  } finally {
    resetSessionMonitorForTests();
    await fs.rm(logPath, { force: true });
  }
});

test('an exit 1 with the OOM flag and no footer yet is a survived OOM event, not a kill', async () => {
  const info = { isolationBackend: 'docker', sessionId: 's' };
  const state = await resolveOomKilledState('s', info, { status: 'executed', exitCode: 1, oomKilled: true, logPath: '/nonexistent' }, { exitFromLog: () => null, backendAlive: async () => false });
  assert.equal(state.status, 'failed');
  assert.equal(state.exitCode, 1);
  assert.equal(state.running, false);
  assert.ok(info.oomEventObservedAt, 'the OOM event is remembered for the completion report');

  const killed = await resolveOomKilledState('s', { isolationBackend: 'docker' }, { status: 'executed', exitCode: 137, oomKilled: true }, { exitFromLog: () => null, backendAlive: async () => false });
  assert.equal(killed.status, 'oom-killed', 'a real SIGKILL is still reported as an OOM kill (#2015)');
});

test('the still-alive OOM verbose line is printed once, not on every poll', async () => {
  const info = { isolationBackend: 'docker', sessionId: 's' };
  const lines = [];
  const original = console.log;
  console.log = line => lines.push(String(line));
  try {
    for (let i = 0; i < 3; i++) {
      await resolveOomKilledState('s', info, { status: 'executing', oomKilled: true }, { verbose: true, exitFromLog: () => null, backendAlive: async () => true });
    }
  } finally {
    console.log = original;
  }
  assert.equal(lines.filter(line => line.includes('backend is still alive')).length, 1);
});

test('the pull-request notice renders a resume command object, never "[object Object]"', () => {
  const notice = buildKillRecoveryNotice({ exitCode: 1, sessionName: 's', oomEventOnly: true, resumeCommand: { binary: 'solve', args: [PR_URL, '--resume', TOOL_SESSION], display: `solve ${PR_URL} --resume ${TOOL_SESSION}` } });
  assert.doesNotMatch(notice, /\[object Object\]/);
  assert.match(notice, new RegExp(`--resume ${TOOL_SESSION}`));
});

test('a repeated completion for an already-recovered session does not start another one', async () => {
  let launches = 0;
  const runner = { generateSessionId: () => 'new', executeWithIsolation: async () => (launches++, { success: true }) };
  const sessionInfo = { killRecoverySessionId: 'recovery-1', killRecoveryAttempts: 1, args: [PR_URL] };
  const result = await recoverKilledSession({ sessionName: 's', sessionInfo, killed: true, env: {}, runner, trackSession: () => {} });
  assert.equal(result.resumed, true);
  assert.equal(result.reason, 'already-recovered');
  assert.equal(result.sessionId, 'recovery-1');
  assert.equal(launches, 0);
});

test('a second OOM in a long run can still be recovered by default', () => {
  assert.equal(DEFAULT_SESSION_KILL_RESUME_ATTEMPTS, 3);
  assert.equal(resolveSessionKillResumeAttempts({ argv: {}, env: {} }), 3);
  assert.equal(resolveSessionKillResumeAttempts({ argv: {}, env: { HIVE_MIND_SESSION_KILL_RESUME_ATTEMPTS: '1' } }), 1, 'the old behaviour stays one setting away');
});

test('a deliberate solve stop after an OOM event is reported, not recovered', async () => {
  assert.deepEqual(findDeliberateSolveStop('…\n❌ Auto-restart limit reached after 5 iterations - the blocker was never resolved.\n=== Container post-mortem ===\nExit Code: 1\n')?.reason, 'auto-restart-limit');
  assert.equal(findDeliberateSolveStop('error: could not compile\nExit Code: 1\n'), null);

  await initI18n('en');
  const sessionName = '6bf35d99-0000-4000-8000-000000002408';
  const logPath = await writeLog('deliberate', `📌 Session ID: ${TOOL_SESSION}\n❌ Auto-restart limit reached after 5 iterations - the blocker was never resolved.\n❌ Auto-restart limit reached\nExit Code: 1\n`);
  assert.equal((await detectDeliberateSolveStop(logPath))?.reason, 'auto-restart-limit', 'the real log tail reader finds the marker');
  const { bot, edits, comments, launches, options } = makeHarness(async () => ({ exists: true, status: 'executed', exitCode: 1, oomKilled: true, isolation: 'docker', logPath }));
  resetSessionMonitorForTests();
  try {
    trackSession(sessionName, makeSessionInfo(sessionName, logPath), false);
    await monitorSessions(bot, false, options);
    assert.equal(launches.length, 0, 'the OOM recovery budget is not spent on a deliberate stop');
    assert.equal(edits.length, 1);
    assert.match(edits[0].message, /^❌ \*Work session failed/);
    assert.match(edits[0].message, /container OOM event/, 'the OOM event is still reported as a warning');
    assert.match(edits[0].message, /solve stopped on its own/);
    assert.equal(comments.length, 1);
  } finally {
    resetSessionMonitorForTests();
    await fs.rm(logPath, { force: true });
  }
});

test('the headline says how many automatic recoveries the work needed', async () => {
  await initI18n('en');
  const base = { sessionName: 'root', observedEndTime: new Date(15 * 3600_000) };
  const recovered = formatSessionCompletionMessage({ ...base, sessionInfo: { startTime: new Date(10 * 3600_000), rootStartTime: new Date(0), rootSessionName: 'root', killRecoveryResumed: true, killRecoveryAttempts: 2 }, exitCode: 0 });
  assert.match(recovered, /^⚠️ \*Work session finished successfully after automatic recovery \(automatic recoveries: 2\)\*/);
  assert.match(recovered, /⏱️ Duration: 15h/, 'the duration covers the whole work (10h + 5h)');

  const failedAfter = formatSessionCompletionMessage({ ...base, sessionInfo: { startTime: new Date(0), killRecoveryResumed: true, killRecoveryAttempts: 3 }, exitCode: 1 });
  assert.match(failedAfter, /^❌ \*Work session failed.*\(automatic recoveries: 3\)\*/);

  const plain = formatSessionCompletionMessage({ ...base, sessionInfo: { startTime: new Date(0) }, exitCode: 0 });
  assert.match(plain, /^✅ \*Work session finished successfully\*/);
  assert.doesNotMatch(plain, /automatic recoveries/);

  await preloadAllLocales();
  for (const locale of ['en', 'ru', 'hi', 'zh']) {
    for (const key of ['telegram.work_session_recovered', 'telegram.work_session_recoveries']) {
      const value = t(key, { count: 2 }, { locale });
      assert.ok(value && !value.includes('telegram.'), `${locale} ${key}: ${value}`);
    }
  }
});

test('the queue shows the total active time of recovered work and its recovery count', () => {
  const now = Date.parse('2026-10-02T13:00:00Z');
  const items = collectExecutingItems({
    tool: 'claude',
    now,
    sessionItems: [{ sessionName: 'recovery-1', url: PR_URL, tool: 'claude', startTime: new Date(now - 5 * 3600_000), rootStartTime: new Date(now - 15 * 3600_000), recoveries: 1 }],
  });
  assert.equal(items[0].waitMs, 15 * 3600_000);
  const text = formatQueueExecutingItems({ items, locale: 'en' });
  assert.match(text, /15h/);
  assert.match(text, /🔁 1/);
});

test('a tool process killed by SIGKILL resumes its own session in-process, with a warning', async () => {
  const killed = { success: false, sessionId: TOOL_SESSION, errorInfo: { exitCode: 137, message: 'Claude command failed with exit code 137' } };
  assert.equal(isToolProcessKilled(killed), true);
  assert.equal(isToolProcessKilled({ success: false, errorInfo: { exitCode: 1 } }), false);
  assert.equal(isToolProcessKilled({ success: false, limitReached: true, errorInfo: { exitCode: 137 } }), false);

  const runs = [];
  const posted = [];
  const result = await resumeAfterToolKill({
    toolResult: killed,
    argv: { tool: 'claude' },
    env: {},
    runIteration: async params => (runs.push(params), { success: true, sessionId: TOOL_SESSION }),
    $: () => {},
    owner: 'link-foundation',
    repo: 'meta-language',
    prNumber: 196,
    postComment: async params => posted.push(params.body),
  });
  assert.equal(result.toolResult.success, true);
  assert.equal(result.attemptsUsed, 1);
  assert.equal(runs[0].argv.resume, TOOL_SESSION, 'the same AI session is resumed');
  assert.deepEqual(runs[0].feedbackLines, [TOOL_KILL_RESUME_FEEDBACK]);
  assert.match(posted[0], /^## ⚠️ /);
  assert.match(posted[0], /automatically resuming/);

  // A process that keeps getting killed stops at the budget, and says so.
  let calls = 0;
  const exhausted = await resumeAfterToolKill({ toolResult: killed, argv: { tool: 'claude' }, env: { HIVE_MIND_SESSION_KILL_RESUME_ATTEMPTS: '2' }, runIteration: async () => (calls++, killed), postComment: async () => {} });
  assert.equal(calls, 2);
  assert.equal(exhausted.toolResult.success, false);
  assert.match(buildToolKillWarningComment({ resuming: false, maxAttempts: 2 }), /budget \(2\) is spent/);
});
