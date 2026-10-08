/**
 * @hive-mind-test-suite default
 * Issue #2809 (koz-3 PR #15): a child process was OOM-killed at 11:13 and the session kept working.
 * The bot observed the sticky Docker `State.OOMKilled` flag right then, but said nothing on the pull
 * request until the session exited 0 at 15:10:59 — one second after solve posted "✅ Ready to merge" —
 * and then posted "ℹ️ Work session completed — an earlier container OOM event did not stop it".
 *
 * Required behaviour:
 *   - the pull request hears about an OOM event only at the moment it happens (with the log when
 *     `--attach-logs` is on), plus a separate comment if it stops the session and it is restarted;
 *   - nothing is posted on the pull request after a session completed;
 *   - Telegram still reports the event after the fact, with the number of OOM kills when > 1.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession, STALE_EXECUTING_MIN_AGE_MS } from '../src/session-monitor.lib.mjs';
import { announceOomEventWhileRunning, buildOomEventNotice, OOM_NOTICE_UPDATE_INTERVAL_MS } from '../src/session-monitor.oom-notice.lib.mjs';
import { formatOomKillCount } from '../src/session-kill-diagnostics.lib.mjs';
import { isToolGeneratedComment, OOM_EVENT_NOTICE_MARKER } from '../src/tool-comments.lib.mjs';

const PR_URL = 'https://github.com/konard/koz-3/pull/15';
const ISSUE_URL = 'https://github.com/konard/koz-3/issues/14';
const SESSION = '0b6f0b1c-2809-4c7e-9a7e-5f0e2a1d2809';
const OOM_OBSERVED_AT = '2026-10-08T11:13:13.140Z';
const COMPLETED_LOG = ['📌 Session ID: 2809-claude-session', '✅ Ready to merge', '==========', 'Finished: 2026-10-08 15:10:59.712', 'Exit Code: 0', ''].join('\n');

function sessionInfoFor(logPath, { attachLogs = true, issue = false, oomEventObservedAt = undefined, onSessionKill = 'resume' } = {}) {
  const urlContext = issue ? { type: 'issue', owner: 'konard', repo: 'koz-3', number: 14, normalized: ISSUE_URL } : { type: 'pull', owner: 'konard', repo: 'koz-3', number: 15, normalized: PR_URL };
  return {
    chatId: 4242,
    messageId: 77,
    startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000),
    command: 'solve',
    tool: 'claude',
    isolationBackend: 'docker',
    sessionId: SESSION,
    logPath,
    locale: 'en',
    url: issue ? ISSUE_URL : PR_URL,
    urlContext,
    args: [issue ? ISSUE_URL : PR_URL, '--auto-merge', ...(attachLogs ? ['--attach-logs'] : []), '--on-session-kill', onSessionKill],
    oomEventObservedAt,
  };
}

/**
 * Drive the real monitor through a sequence of `$ --status` snapshots.
 * Each step: `{ running, oomKills, exitCode, advanceMs }`.
 */
async function runMonitor(steps, { attachLogs = true, issue = false, oomEventObservedAt = undefined, linkedPullRequest = PR_URL, onSessionKill = 'resume' } = {}) {
  await initI18n('en');
  await preloadAllLocales();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-2809-'));
  const logPath = path.join(dir, 'session.log');
  await fs.writeFile(logPath, 'solve is working\n');
  const telegram = [];
  const comments = [];
  const uploads = [];
  const launches = [];
  const prLookups = [];
  let now = Date.parse('2026-10-08T11:13:13.140Z');
  let step = steps[0];
  const bot = {
    telegram: {
      editMessageText: async (_chatId, messageId, _inline, message) => telegram.push({ messageId, message }),
      sendMessage: async (_chatId, message) => (telegram.push({ messageId: null, message }), { chat: { id: 4242 }, message_id: 1 }),
    },
  };
  const options = {
    statusProvider: async () => ({ exists: true, status: step.running ? 'executing' : 'executed', exitCode: step.running ? null : step.exitCode, oomKilled: true, cgroupMemory: { oomKills: step.oomKills, oomEvents: step.oomKills * 2 }, isolation: 'docker', logPath }),
    exitFromLog: () => (step.running ? { finished: false } : { finished: true, exitCode: step.exitCode, endTime: '2026-10-08T15:10:59.712Z' }),
    backendAlive: async () => step.running,
    dockerContainerSizeProvider: async () => null,
    removeDockerContainer: async () => ({ success: true }),
    readFile: async file => await fs.readFile(file, 'utf8'),
    lookupLinkedPullRequest: async () => (prLookups.push(now), linkedPullRequest),
    lookupPullRequestState: async () => ({ merged: false, mergedAt: null, state: 'open' }),
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    sleepBeforeRecovery: async () => {},
    oomNoticeNow: () => now,
    isolationRunner: {
      generateSessionId: () => 'recovery-1',
      executeWithIsolation: async (...args) => (launches.push(args), { success: true }),
    },
    attachLog: async options => (uploads.push(options), true),
    runCommand: async (_command, args) => {
      const editing = args.includes('--input');
      const payload = await fs.readFile(args[args.indexOf(editing ? '--input' : '--body-file') + 1], 'utf8');
      comments.push({ editing, body: editing ? JSON.parse(payload).body : payload });
      return { code: 0, stdout: `${PR_URL}#issuecomment-${comments.length}`, stderr: '' };
    },
  };
  resetSessionMonitorForTests();
  try {
    trackSession(SESSION, sessionInfoFor(logPath, { attachLogs, issue, oomEventObservedAt, onSessionKill }), false);
    for (step of steps) {
      now += step.advanceMs || 0;
      if (!step.running) await fs.writeFile(logPath, COMPLETED_LOG.replace('Exit Code: 0', `Exit Code: ${step.exitCode}`));
      await monitorSessions(bot, Boolean(process.env.TEST_VERBOSE), options);
    }
  } finally {
    resetSessionMonitorForTests();
    await fs.rm(dir, { recursive: true, force: true });
  }
  const completion = [...telegram].reverse().find(edit => edit.messageId === 77)?.message || '';
  return { telegram, completion, comments, uploads, launches, prLookups };
}

const ooms = comments => comments.filter(comment => comment.body.includes(OOM_EVENT_NOTICE_MARKER));
const killNotices = comments => comments.filter(comment => comment.body.includes('hive-mind:session-kill-notice'));

test('koz-3 PR #15: a session that completed after an OOM event gets no post-factum pull request comment', { timeout: 15000 }, async () => {
  // The bot only sees the event at the final poll — exactly the comment the issue complains about.
  const run = await runMonitor([{ running: false, exitCode: 0, oomKills: 9 }], { oomEventObservedAt: OOM_OBSERVED_AT });
  assert.equal(run.comments.length, 0, `nothing is posted after "Ready to merge":\n${run.comments.map(c => c.body).join('\n---\n')}`);
  assert.equal(run.uploads.length, 0);
  assert.equal(run.launches.length, 0);
  assert.match(run.completion, /finished successfully/);
  assert.match(run.completion, /recovered from out of memory\* \(OOM kills: 9\)/, 'Telegram still reports it, with the count');
  assert.match(run.completion, /2026-10-08T11:13:13\.140Z/);
});

test('the OOM event is reported on the pull request when it happens, once, with the log under --attach-logs', { timeout: 15000 }, async () => {
  const run = await runMonitor([
    { running: true, oomKills: 1 },
    { running: true, oomKills: 1, advanceMs: 30_000 },
    { running: true, oomKills: 1, advanceMs: OOM_NOTICE_UPDATE_INTERVAL_MS },
    { running: false, exitCode: 0, oomKills: 1, advanceMs: 30_000 },
  ]);
  assert.equal(run.comments.length, 1, `one live notice, nothing at completion:\n${run.comments.map(c => c.body).join('\n---\n')}`);
  const [notice] = ooms(run.comments);
  assert.equal(notice.editing, false);
  assert.match(notice.body, /Container OOM event — the work session is still running/);
  assert.match(notice.body, /OOM event observed at:\*\* \d{4}-\d\d-\d\dT/);
  assert.match(notice.body, new RegExp(`Working session:\\*\\* \`${SESSION}\``));
  assert.match(notice.body, /log at the time of the event was uploaded/);
  assert.match(notice.body, /a separate comment will report it together with any restart/);
  assert.doesNotMatch(notice.body, /Processes killed by the OOM killer/, 'a single OOM kill is not counted');
  assert.equal(run.uploads.length, 1, 'the intermediate log is uploaded once, at the event');
  assert.match(run.uploads[0].customTitle, /container OOM event/);
  assert.equal(run.uploads[0].targetNumber, 15);
  assert.match(run.completion, /recovered from out of memory\*\n/, 'Telegram reports the single OOM without a count');
});

test('more OOM kills edit the same comment (throttled) instead of posting new ones', { timeout: 15000 }, async () => {
  const run = await runMonitor([
    { running: true, oomKills: 1 },
    { running: true, oomKills: 3, advanceMs: 30_000 },
    { running: true, oomKills: 9, advanceMs: OOM_NOTICE_UPDATE_INTERVAL_MS },
    { running: true, oomKills: 9, advanceMs: OOM_NOTICE_UPDATE_INTERVAL_MS },
    { running: false, exitCode: 0, oomKills: 9, advanceMs: 30_000 },
  ]);
  assert.deepEqual(
    run.comments.map(c => c.editing),
    [false, true],
    'posted once, then edited once when the count grew and the interval elapsed'
  );
  assert.match(run.comments[1].body, /Processes killed by the OOM killer so far:\*\* 9/);
  assert.match(run.comments[1].body, /Updated:\*\* /);
  assert.equal(run.uploads.length, 1);
  assert.match(run.completion, /recovered from out of memory\* \(OOM kills: 9\)/);
});

test('without --attach-logs no log is uploaded and the notice says why', { timeout: 15000 }, async () => {
  const run = await runMonitor([{ running: true, oomKills: 2 }], { attachLogs: false });
  assert.equal(run.uploads.length, 0);
  const [notice] = ooms(run.comments);
  assert.match(notice.body, /not uploaded because `--attach-logs` is disabled/);
  assert.match(notice.body, /Processes killed by the OOM killer so far:\*\* 2/);
});

test('an issue session without a pull request yet retries the lookup at most once per interval', { timeout: 15000 }, async () => {
  const run = await runMonitor(
    [
      { running: true, oomKills: 1 },
      { running: true, oomKills: 1, advanceMs: 30_000 },
      { running: true, oomKills: 1, advanceMs: OOM_NOTICE_UPDATE_INTERVAL_MS },
    ],
    { issue: true, linkedPullRequest: null }
  );
  assert.equal(run.comments.length, 0);
  assert.equal(run.prLookups.length, 2, `the lookup is throttled (${run.prLookups.length} lookups)`);
});

test('an OOM event that later kills the session gets a separate restart comment (behaviour preserved)', { timeout: 15000 }, async () => {
  const run = await runMonitor([
    { running: true, oomKills: 1 },
    { running: false, exitCode: 137, oomKills: 2, advanceMs: 30_000 },
  ]);
  assert.equal(ooms(run.comments).length, 1, 'the moment of the event');
  assert.equal(run.launches.length, 1, 'the killed work is resumed');
  const restart = killNotices(run.comments);
  assert.equal(restart.length, 1, `then the restart:\n${run.comments.map(c => c.body).join('\n---\n')}`);
  assert.match(restart[0].body, /restarted after a kill — outcome pending/);
});

test('a failed run after a live-reported OOM event gets a separate comment when it is restarted', { timeout: 15000 }, async () => {
  const run = await runMonitor([
    { running: true, oomKills: 1 },
    { running: false, exitCode: 1, oomKills: 1, advanceMs: 30_000 },
  ]);
  assert.equal(ooms(run.comments).length, 1);
  assert.equal(run.launches.length, 1, 'the failed work is resumed');
  assert.equal(killNotices(run.comments).length, 1, 'the restart gets its own comment');
});

test('a failed run after a live-reported OOM event that is not restarted posts nothing more', { timeout: 15000 }, async () => {
  const run = await runMonitor(
    [
      { running: true, oomKills: 1 },
      { running: false, exitCode: 1, oomKills: 1, advanceMs: 30_000 },
    ],
    { onSessionKill: 'report' }
  );
  assert.equal(run.launches.length, 0);
  assert.equal(ooms(run.comments).length, 1, 'the moment of the event');
  assert.equal(killNotices(run.comments).length, 0, `no post-factum OOM notice:\n${run.comments.map(c => c.body).join('\n---\n')}`);
  assert.match(run.completion, /A container OOM event affected a child process/, 'Telegram still reports it');
});

test('the notice never posts once the session is known to have finished, nor without an OOM event', async () => {
  const runCommand = async () => assert.fail('nothing must be posted');
  const sessionInfo = { args: [], urlContext: { type: 'pull', owner: 'konard', repo: 'koz-3', number: 15 } };
  const result = await announceOomEventWhileRunning({ sessionName: SESSION, sessionInfo, statusResult: { cgroupMemory: { oomKills: 0 } }, options: { runCommand } });
  assert.equal(result.action, 'skipped');
  assert.equal(result.reason, 'no-oom-event');
});

test('the OOM notice is recognised as tool-generated, so solve never treats it as feedback', () => {
  const body = buildOomEventNotice({ observedAt: OOM_OBSERVED_AT, sessionName: SESSION, count: 9 });
  assert.ok(body.startsWith(OOM_EVENT_NOTICE_MARKER));
  assert.equal(isToolGeneratedComment(body), true);
});

test('the Telegram OOM kill count appears only when there was more than one', () => {
  assert.equal(formatOomKillCount(0), '');
  assert.equal(formatOomKillCount(1), '');
  assert.equal(formatOomKillCount(2), ' (OOM kills: 2)');
  assert.equal(formatOomKillCount(9, 'en'), ' (OOM kills: 9)');
});
