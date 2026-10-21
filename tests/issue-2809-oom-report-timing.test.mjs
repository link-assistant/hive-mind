/**
 * @hive-mind-test-suite default
 * Issue #2809: an OOM event is reported when it happens, not after the work is done.
 *
 *   1. A session that survived an OOM event and then completed gets no GitHub
 *      comment (Telegram only) — see also issue-2498-merged-pr-recovery.
 *   2. A pull request whose newest "## ✅ Ready to merge" comment is newer than
 *      the newest session start gets no kill or OOM comment.
 *   3. A survived OOM event is reported while the session runs: one GitHub
 *      comment (with the log so far under --attach-logs) and one Telegram
 *      message, once per session; never on a merged / ready pull request.
 *   4. The number of OOM kills is counted and shown when it is above one.
 *   5. The survived-OOM report waits about one poll, and posts nothing on GitHub
 *      when solve already commented on the kill of its AI tool (issue #3435 side risk).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { isReadyToMergeCommentLatest, resolvePullRequestState, resolveReadyToMerge } from '../src/github-pr-state.lib.mjs';
import { buildKillCompletionSections, pullRequestReportSkipReason } from '../src/session-monitor.kill-sections.lib.mjs';
import { announcePendingKillNotice, finishKillNotice } from '../src/session-monitor.kill-notice.lib.mjs';
import { markOomEventObserved } from '../src/session-monitor.oom.lib.mjs';
import { formatKillRecoverySection } from '../src/session-kill-diagnostics.lib.mjs';
import { buildOomEventNotice, OOM_EVENT_NOTICE_MARKER, OOM_EVENT_REPORT_GRACE_MS, OOM_EVENT_REPORT_MAX_AGE_MS, reportSurvivedOomEvent } from '../src/session-oom-event-report.lib.mjs';
import { recoveryLogLine } from '../src/session-recovery-lifecycle.lib.mjs';
import { RECOVERY_LIFECYCLE_MARKER } from '../src/tool-comments.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession, STALE_EXECUTING_MIN_AGE_MS } from '../src/session-monitor.lib.mjs';
import { createGhCommentRecorder } from './helpers/gh-comment-recorder.mjs';

const PR = 'https://github.com/link-assistant/hive-mind/pull/2809';
const OPEN = { merged: false, mergedAt: null, state: 'open', readyToMerge: false };
const READY = { merged: false, mergedAt: null, state: 'open', readyToMerge: true };
const MERGED = { merged: true, mergedAt: '2026-10-19T10:00:00Z', state: 'closed' };
const READY_COMMENT = '## ✅ Ready to merge\n\nThis pull request is ready to be merged.';
const STARTED_COMMENT = '## 🤖 AI Work Session Started\n\nStarting automated work session at 2026-10-19T09:00:00Z';
const URL_CONTEXT = { type: 'pull', owner: 'link-assistant', repo: 'hive-mind', number: 2809, normalized: PR };

function fakeBot() {
  const sent = [];
  const edits = [];
  const bot = {
    telegram: {
      sendMessage: async (chatId, message, options) => (sent.push({ chatId, message, options }), { chat: { id: chatId }, message_id: 100 + sent.length }),
      editMessageText: async (_chatId, messageId, _inline, message) => (edits.push({ messageId, message }), true),
    },
  };
  return { bot, sent, edits };
}

// ---------------------------------------------------------------------------
// 2. Ready to merge.
// ---------------------------------------------------------------------------

test('a pull request is ready to merge when its newest "Ready to merge" comment is newer than the newest session start', () => {
  assert.equal(isReadyToMergeCommentLatest([STARTED_COMMENT, 'progress', READY_COMMENT]), true);
  assert.equal(isReadyToMergeCommentLatest([STARTED_COMMENT, READY_COMMENT, '## 🔄 AI Work Session Resumed']), false, 'a later session start reopens the work');
  assert.equal(isReadyToMergeCommentLatest([READY_COMMENT, 'a human comment']), true, 'other comments do not matter');
  assert.equal(isReadyToMergeCommentLatest([STARTED_COMMENT]), false);
  assert.equal(isReadyToMergeCommentLatest([]), false);
  assert.equal(isReadyToMergeCommentLatest(null), false);
});

test('the ready-to-merge lookup is injectable, never throws, and only reads pull requests', async () => {
  const calls = [];
  const lookupCommentBodies = async url => (calls.push(url), [STARTED_COMMENT, READY_COMMENT]);
  assert.equal(await resolveReadyToMerge(PR, { lookupCommentBodies }), true);
  assert.deepEqual(calls, [PR]);
  assert.equal(await resolveReadyToMerge('https://github.com/link-assistant/hive-mind/issues/2809', { lookupCommentBodies }), false, 'an issue is never ready to merge');
  assert.equal(calls.length, 1);
  const failing = async () => {
    throw new Error('gh unavailable');
  };
  assert.equal(await resolveReadyToMerge(PR, { lookupCommentBodies: failing }), null, 'unknown, so the notice is still posted');
  assert.equal(pullRequestReportSkipReason({ merged: false, readyToMerge: null }), null);
  // With both lookups injected, an open pull request carries readyToMerge.
  assert.equal((await resolvePullRequestState(PR, { lookupPullRequestState: async () => ({ merged: false, mergedAt: null, state: 'open' }), lookupCommentBodies })).readyToMerge, true);
  assert.equal((await resolvePullRequestState(PR, { lookupPullRequestState: async () => MERGED, lookupCommentBodies })).readyToMerge, undefined, 'a merged pull request needs no comment lookup');
  // An injected state lookup is returned as is (it carries readyToMerge itself).
  assert.deepEqual(await resolvePullRequestState(PR, { lookupPullRequestState: async () => READY }), READY);
});

test('a merged, closed or ready pull request is the reason no GitHub notice is posted', () => {
  assert.equal(pullRequestReportSkipReason(MERGED), 'pull-request-merged');
  assert.equal(pullRequestReportSkipReason({ merged: false, mergedAt: '2026-10-19T10:00:00Z' }), 'pull-request-merged');
  assert.equal(pullRequestReportSkipReason(READY), 'pull-request-ready-to-merge');
  assert.equal(pullRequestReportSkipReason({ merged: false, mergedAt: null, state: 'closed' }), 'pull-request-closed');
  assert.equal(pullRequestReportSkipReason({ merged: false, mergedAt: null, state: 'CLOSED', readyToMerge: true }), 'pull-request-closed');
  assert.equal(pullRequestReportSkipReason(OPEN), null);
  assert.equal(pullRequestReportSkipReason(null), null);
});

test('a kill on a closed pull request is not reported on GitHub and not recovered', async () => {
  await initI18n('en');
  const sessionInfo = { args: [PR], urlContext: URL_CONTEXT, logPath: null };
  const report = await buildKillCompletionSections({ sessionName: 's1', sessionInfo, exitCode: 137, status: 'killed', pullRequestState: { merged: false, mergedAt: null, state: 'closed' }, readFile: async () => '' });
  assert.equal(report.skippedReason, 'pull-request-closed');
  assert.ok(report.sections.some(line => /The pull request is closed/.test(line)));
  const gh = createGhCommentRecorder();
  const context = { sessionName: 's1', sessionInfo, killReport: report, exitCode: 137, options: { runCommand: gh.runCommand, attachLog: async () => assert.fail('no log upload') }, persist: () => {} };
  assert.equal((await announcePendingKillNotice({ ...context, planRecovery: async () => true })).skipped, 'pull-request-closed');
  assert.equal(gh.posts.length, 0);
});

test('a kill on a ready pull request keeps the Telegram report and posts no GitHub notice', async () => {
  await initI18n('en');
  const sessionInfo = { args: [PR], urlContext: URL_CONTEXT, logPath: null };
  const report = await buildKillCompletionSections({ sessionName: 's1', sessionInfo, exitCode: 137, status: 'killed', pullRequestState: READY, readFile: async () => '' });
  assert.equal(report.killed, true);
  assert.equal(report.skippedReason, 'pull-request-ready-to-merge');
  assert.ok(report.sections.length > 0, 'Telegram still gets the kill report');

  const gh = createGhCommentRecorder();
  const context = { sessionName: 's1', sessionInfo, killReport: report, exitCode: 137, options: { runCommand: gh.runCommand, attachLog: async () => assert.fail('no log upload') }, persist: () => {} };
  assert.equal((await announcePendingKillNotice({ ...context, planRecovery: async () => true })).skipped, 'pull-request-ready-to-merge');
  assert.equal((await finishKillNotice({ ...context, killRecovery: { resumed: false, reason: 'policy' } })).skipped, 'pull-request-ready-to-merge');
  assert.equal(gh.posts.length, 0);
});

test('end to end: a session killed (exit 137) on a ready-to-merge pull request posts no comment', { timeout: 15000 }, async () => {
  await initI18n('en');
  await preloadAllLocales();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-2809-ready-'));
  const logPath = path.join(dir, 'session.log');
  await fs.writeFile(logPath, '==========\nFinished: 2026-10-19 10:00:00.000\nExit Code: 137\n');
  const gh = createGhCommentRecorder();
  const uploads = [];
  const { bot, sent, edits } = fakeBot();
  resetSessionMonitorForTests();
  try {
    trackSession('ready-1', { chatId: 1, messageId: 7, startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000), command: 'solve', tool: 'claude', isolationBackend: 'docker', sessionId: 'ready-1', logPath, locale: 'en', url: PR, urlContext: URL_CONTEXT, args: [PR, '--attach-logs', '--on-session-kill', 'resume'], oomEventObservedAt: new Date().toISOString() }, false);
    await monitorSessions(bot, Boolean(process.env.TEST_VERBOSE), {
      statusProvider: async () => ({ exists: true, status: 'oom-killed', exitCode: 137, oomKilled: true, isolation: 'docker', logPath }),
      exitFromLog: () => ({ finished: true, exitCode: 137, endTime: new Date().toISOString() }),
      backendAlive: async () => false,
      dockerContainerSizeProvider: async () => null,
      removeDockerContainer: async () => ({ success: true }),
      readFile: async file => await fs.readFile(file, 'utf8'),
      lookupLinkedPullRequest: async () => null,
      lookupPullRequestState: async () => READY,
      env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
      sleepBeforeRecovery: async () => {},
      isolationRunner: { generateSessionId: () => 'recovery-1', executeWithIsolation: async () => ({ success: true }) },
      attachLog: async options => (uploads.push(options), true),
      runCommand: gh.runCommand,
    });
  } finally {
    resetSessionMonitorForTests();
    await fs.rm(dir, { recursive: true, force: true });
  }
  assert.equal(gh.posts.length, 0, `no comment on a ready pull request:\n${gh.posts.join('\n---\n')}`);
  assert.equal(uploads.length, 0, 'no "killed session" log upload');
  const completion = [...edits, ...sent].map(entry => entry.message).join('\n');
  assert.match(completion, /137/, 'Telegram still reports the kill');
});

// ---------------------------------------------------------------------------
// 3. A survived OOM event, reported when it happens.
// ---------------------------------------------------------------------------

function survivedSession(overrides = {}) {
  // Observed a minute ago: past the grace period, well within the max age.
  return { chatId: 1, messageId: 7, messageThreadId: 5, locale: 'en', urlContext: URL_CONTEXT, args: [PR], logPath: '/tmp/session.log', oomEventObservedAt: new Date(Date.now() - 60_000).toISOString(), oomEventCount: 2, ...overrides };
}

// The log is never read from disk in these unit tests.
const noLog = async () => '';

test('a survived OOM event is reported once: one GitHub comment and one Telegram message', async () => {
  const gh = createGhCommentRecorder();
  const { bot, sent } = fakeBot();
  const sessionInfo = survivedSession();
  let persisted = 0;
  const context = { bot, sessionName: 'live-1', sessionInfo, options: { runCommand: gh.runCommand, lookupPullRequestState: async () => OPEN, readFile: noLog }, persist: () => persisted++ };
  const first = await reportSurvivedOomEvent(context);
  assert.equal(first.reported, true);
  assert.equal(first.github, true);
  assert.equal(gh.posts.length, 1);
  assert.ok(gh.posts[0].includes(OOM_EVENT_NOTICE_MARKER));
  assert.match(gh.posts[0], /## ⚠️ Container OOM event — the work session keeps running/);
  assert.match(gh.posts[0], /OOM kills so far: 2/);
  assert.equal(sent.length, 1);
  assert.match(sent[0].message, /Container OOM event\* in working session `live-1` \(2 OOM kills\)/);
  assert.match(sent[0].message, /Reported on GitHub: https:\/\/github\.com\/link-assistant\/hive-mind\/pull\/2809#issuecomment-1/);
  assert.equal(sent[0].options.reply_to_message_id, 7);
  assert.equal(sent[0].options.message_thread_id, 5);
  assert.ok(sessionInfo.oomEventReportedAt, 'the flag is kept');
  assert.ok(persisted >= 1, 'and persisted');

  const again = await reportSurvivedOomEvent(context);
  assert.equal(again.skipped, 'already-reported');
  assert.equal(gh.posts.length, 1);
  assert.equal(sent.length, 1);
});

test('a merged or ready pull request gets the Telegram message only', async () => {
  for (const [state, reason, wording] of [
    [MERGED, 'pull-request-merged', /the pull request is merged/],
    [READY, 'pull-request-ready-to-merge', /the pull request is ready to merge/],
  ]) {
    const gh = createGhCommentRecorder();
    const { bot, sent } = fakeBot();
    const result = await reportSurvivedOomEvent({ bot, sessionName: 'live-2', sessionInfo: survivedSession(), options: { runCommand: gh.runCommand, lookupPullRequestState: async () => state, readFile: noLog } });
    assert.equal(result.githubSkipped, reason);
    assert.equal(gh.posts.length, 0);
    assert.equal(sent.length, 1);
    assert.match(sent[0].message, wording);
  }
});

test('an old observation (before a bot restart) is not reported late, and no event means nothing to report', async () => {
  const gh = createGhCommentRecorder();
  const { bot, sent } = fakeBot();
  const old = survivedSession({ oomEventObservedAt: new Date(Date.now() - OOM_EVENT_REPORT_MAX_AGE_MS - 60_000).toISOString() });
  assert.equal((await reportSurvivedOomEvent({ bot, sessionName: 'live-3', sessionInfo: old, options: { runCommand: gh.runCommand, lookupPullRequestState: async () => OPEN } })).skipped, 'stale');
  assert.ok(old.oomEventReportedAt, 'marked, so it is not checked again');
  assert.equal((await reportSurvivedOomEvent({ bot, sessionName: 'live-3', sessionInfo: survivedSession({ oomEventObservedAt: undefined }), options: { runCommand: gh.runCommand } })).skipped, 'no-oom-event');
  assert.equal(gh.posts.length, 0);
  assert.equal(sent.length, 0);
});

test('with --attach-logs the OOM comment carries the log so far', async () => {
  const gh = createGhCommentRecorder();
  const uploads = [];
  const attachLog = async options => {
    uploads.push(options);
    const { id } = gh.create(PR, `${options.leadingSection}\n\n<details>log</details>`);
    await options.onCommentPosted?.({ commentId: id });
    return true;
  };
  const result = await reportSurvivedOomEvent({ sessionName: 'live-4', sessionInfo: survivedSession({ args: [PR, '--attach-logs'] }), options: { runCommand: gh.runCommand, attachLog, lookupPullRequestState: async () => OPEN, readFile: noLog } });
  assert.equal(result.github, true);
  assert.equal(uploads.length, 1);
  assert.equal(uploads[0].logFile, '/tmp/session.log');
  assert.equal(uploads[0].targetType, 'pr');
  assert.equal(uploads[0].targetNumber, 2809);
  assert.match(uploads[0].leadingSection, /The working-session log up to this moment is below/);
  assert.equal(gh.posts.length, 1, 'one comment: notice and log together');
  assert.equal(result.githubUrl, `${PR}#issuecomment-1`);
});

test('the OOM notice wording', () => {
  const body = buildOomEventNotice({ sessionName: 's', observedAt: '2026-10-19T10:00:00.000Z', count: 0 });
  assert.match(body, /working session `s` at 2026-10-19T10:00:00.000Z/);
  assert.match(body, /OOM kills so far: 1/);
  assert.match(body, /<sub>Reported by Hive Mind<\/sub>/);
  assert.ok(body.endsWith(RECOVERY_LIFECYCLE_MARKER), 'a tool comment: solve never reads it as feedback');
});

test('the report waits about one poll, then skips GitHub when solve already commented on the kill', async () => {
  const gh = createGhCommentRecorder();
  const { bot, sent } = fakeBot();
  const fresh = survivedSession({ oomEventObservedAt: new Date().toISOString() });
  const options = { runCommand: gh.runCommand, lookupPullRequestState: async () => OPEN, readFile: noLog };
  assert.equal((await reportSurvivedOomEvent({ bot, sessionName: 'live-5', sessionInfo: fresh, options })).skipped, 'grace');
  assert.equal(fresh.oomEventReportedAt, undefined, 'checked again on the next poll');
  assert.ok(OOM_EVENT_REPORT_GRACE_MS > 0 && OOM_EVENT_REPORT_GRACE_MS < OOM_EVENT_REPORT_MAX_AGE_MS);

  const log = `[2026-10-19T10:00:00.000Z] [INFO] ${recoveryLogLine({ kind: 'tool', phase: 'waiting', attempt: 1, maxAttempts: 2 })}\n`;
  const result = await reportSurvivedOomEvent({ bot, sessionName: 'live-5', sessionInfo: survivedSession(), options: { ...options, readFile: async () => log } });
  assert.equal(result.githubSkipped, 'reported-in-process');
  assert.equal(gh.posts.length, 0, 'solve already posted the one comment for this kill');
  assert.equal(sent.length, 1, 'Telegram still learns about the OOM event');
  assert.match(sent[0].message, /already reported the killed process/);
});

test('end to end: an OOM event in a running session is reported on the first poll, and only once', { timeout: 15000 }, async () => {
  await initI18n('en');
  await preloadAllLocales();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-2809-live-'));
  const logPath = path.join(dir, 'session.log');
  await fs.writeFile(logPath, 'working…\n');
  const gh = createGhCommentRecorder();
  const { bot, sent } = fakeBot();
  const options = {
    statusProvider: async () => ({ exists: true, status: 'executing', exitCode: null, oomKilled: true, cgroupMemory: { oomKills: 3 }, isolation: 'docker', logPath }),
    exitFromLog: () => ({ finished: false, exitCode: null, endTime: null }),
    backendAlive: async () => true,
    dockerContainerSizeProvider: async () => null,
    hostDiskProvider: async () => null,
    readFile: async file => await fs.readFile(file, 'utf8'),
    lookupLinkedPullRequest: async () => null,
    lookupPullRequestState: async () => OPEN,
    reportLivePullRequestLink: async () => null,
    runCommand: gh.runCommand,
    attachLog: async () => assert.fail('no --attach-logs'),
    oomEventReportGraceMs: 0, // report on the first poll that sees the event
  };
  resetSessionMonitorForTests();
  try {
    trackSession('live-e2e', { chatId: 1, messageId: 7, startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000), command: 'solve', tool: 'claude', isolationBackend: 'docker', sessionId: 'live-e2e', logPath, locale: 'en', url: PR, urlContext: URL_CONTEXT, args: [PR] }, false);
    await monitorSessions(bot, Boolean(process.env.TEST_VERBOSE), options);
    await monitorSessions(bot, Boolean(process.env.TEST_VERBOSE), options);
  } finally {
    resetSessionMonitorForTests();
    await fs.rm(dir, { recursive: true, force: true });
  }
  assert.equal(gh.posts.length, 1, `one comment for the OOM event:\n${gh.posts.join('\n---\n')}`);
  assert.match(gh.posts[0], /Container OOM event — the work session keeps running/);
  assert.match(gh.posts[0], /OOM kills so far: 3/);
  const oomMessages = sent.filter(entry => /Container OOM event/.test(entry.message));
  assert.equal(oomMessages.length, 1, 'one Telegram message');
});

// ---------------------------------------------------------------------------
// 4. Counting OOM kills.
// ---------------------------------------------------------------------------

test('OOM kills are counted, never decrease, and are persisted when the count rises', () => {
  const sessionInfo = {};
  let persisted = 0;
  const persist = () => persisted++;
  assert.equal(markOomEventObserved(sessionInfo, persist), true);
  assert.equal(sessionInfo.oomEventCount, 1, 'an observation is at least one kill');
  assert.equal(persisted, 1);
  assert.equal(markOomEventObserved(sessionInfo, persist, { oomKills: 4 }), false, 'not a new observation');
  assert.equal(sessionInfo.oomEventCount, 4);
  assert.equal(persisted, 2, 'a higher count is persisted');
  markOomEventObserved(sessionInfo, persist, { oomKills: 4 });
  assert.equal(sessionInfo.oomEventCount, 4, 'the same counter reading is not counted twice');
  assert.equal(persisted, 2, 'nothing new to persist');
  markOomEventObserved(sessionInfo, persist, { oomKills: 2 });
  assert.equal(sessionInfo.oomEventCount, 6, 'a lower counter is a new container (a recovery): its kills are added, the total never decreases');
  assert.equal(persisted, 3);
});

test('Telegram shows the count when there was more than one OOM kill', async () => {
  await initI18n('en');
  await preloadAllLocales();
  assert.match(formatKillRecoverySection({ observedAt: 'T', count: 3 }), /recovered from out of memory\* \(3 OOM kills\)/);
  assert.match(formatKillRecoverySection({ observedAt: 'T', count: 9 }), /\(9 OOM kills\)/, 'the koz-3#15 case: 9 kills');
  assert.doesNotMatch(formatKillRecoverySection({ observedAt: 'T', count: 1 }), /OOM kills/);
  assert.doesNotMatch(formatKillRecoverySection({ observedAt: 'T' }), /OOM kills/);
  assert.match(formatKillRecoverySection({ observedAt: 'T', count: 3, locale: 'ru' }), /\(OOM-завершений: 3\)/);

  const recovered = await buildKillCompletionSections({ sessionName: 's', sessionInfo: { oomEventObservedAt: 'T', oomEventCount: 2, args: [] }, exitCode: 0, status: 'executed', readFile: async () => '' });
  assert.match(recovered.sections.join('\n'), /\(2 OOM kills\)/);
  const failed = await buildKillCompletionSections({ sessionName: 's', sessionInfo: { oomEventObservedAt: 'T', oomEventCount: 2, args: [] }, exitCode: 1, status: 'failed', readFile: async () => '' });
  assert.match(failed.sections.join('\n'), /A container OOM event \(2 OOM kills\) affected a child process/);
});
