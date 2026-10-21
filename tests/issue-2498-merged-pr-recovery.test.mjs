/**
 * @hive-mind-test-suite default
 * Issue #2498 follow-up (link-foundation/package-registry-manager#31): the session auto-merged its
 * pull request at 07:48:14 and exited 0 at 07:48:18. Docker's sticky `State.OOMKilled` flag (a
 * child process was OOM-killed at 06:23:56) still made the bot post
 * "⚠️ Working session recovered from out of memory" and upload an
 * "Intermediate working-session log (killed session)" AFTER the merge.
 *
 * A merged pull request means the work is fully done: nothing is recovered and no kill, recovery or
 * OOM notice is published — neither by the bot after the session ends, nor by solve's in-process
 * retry of a killed AI tool.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession, STALE_EXECUTING_MIN_AGE_MS } from '../src/session-monitor.lib.mjs';
import { buildKillCompletionSections } from '../src/session-monitor.kill-sections.lib.mjs';
import { buildKillRecoveryNotice } from '../src/session-kill-recovery.lib.mjs';
import { resolveFailedSessionPullRequestState } from '../src/github-pr-state.lib.mjs';
import { resumeAfterToolKill } from '../src/solve.tool-kill-resume.lib.mjs';
import { formatRecoveryLifecycle, parseRecoveryLogEvent, recoveryLogLine } from '../src/session-recovery-lifecycle.lib.mjs';
import { createGhCommentRecorder } from './helpers/gh-comment-recorder.mjs';

const PR_URL = 'https://github.com/link-foundation/package-registry-manager/pull/31';
const SESSION = 'ce5a24df-d07b-4e2a-b8d2-926bfcce3f77';
const OOM_OBSERVED_AT = '2026-10-06T06:23:56.266Z';
const MERGED = { merged: true, mergedAt: '2026-10-06T07:48:14Z', state: 'closed' };
const OPEN = { merged: false, mergedAt: null, state: 'open' };
const LOG_TAIL = ['📌 Session ID: 019a0f1e-codex-thread', '🎉 PR MERGED SUCCESSFULLY!', '   Pull request: #31 has been auto-merged', '==========', 'Finished: 2026-10-06 07:48:18.798', 'Exit Code: 0', ''].join('\n');

function sessionInfoFor(logPath) {
  return {
    chatId: 4242,
    messageId: 77,
    startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000),
    command: 'solve',
    tool: 'codex',
    isolationBackend: 'docker',
    sessionId: SESSION,
    logPath,
    locale: 'en',
    url: PR_URL,
    urlContext: { type: 'pull', owner: 'link-foundation', repo: 'package-registry-manager', number: 31, normalized: PR_URL },
    args: [PR_URL, '--auto-merge', '--attach-logs', '--on-session-kill', 'resume'],
    oomEventObservedAt: OOM_OBSERVED_AT,
  };
}

async function runCompletion({ exitCode, pullRequestState }) {
  await initI18n('en');
  await preloadAllLocales();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-2498-merged-'));
  const logPath = path.join(dir, 'session.log');
  await fs.writeFile(logPath, LOG_TAIL.replace('Exit Code: 0', `Exit Code: ${exitCode}`));
  const edits = [];
  const github = createGhCommentRecorder();
  const comments = github.posts;
  const uploads = [];
  const launches = [];
  const lookups = [];
  const bot = {
    telegram: {
      editMessageText: async (_chatId, messageId, _inline, message) => edits.push({ messageId, message }),
      sendMessage: async (_chatId, message) => (edits.push({ messageId: null, message }), { chat: { id: 4242 }, message_id: 1 }),
    },
  };
  const options = {
    statusProvider: async () => ({ exists: true, status: exitCode === 0 ? 'executed' : 'oom-killed', exitCode, oomKilled: true, isolation: 'docker', logPath }),
    exitFromLog: () => ({ finished: true, exitCode, endTime: '2026-10-06T07:48:18.798Z' }),
    backendAlive: async () => false,
    dockerContainerSizeProvider: async () => null,
    removeDockerContainer: async () => ({ success: true }),
    readFile: async file => await fs.readFile(file, 'utf8'),
    lookupLinkedPullRequest: async () => null,
    lookupPullRequestState: async url => (lookups.push(url), pullRequestState),
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    sleepBeforeRecovery: async () => {},
    isolationRunner: {
      generateSessionId: () => 'recovery-1',
      executeWithIsolation: async (...args) => (launches.push(args), { success: true }),
    },
    attachLog: async options => {
      uploads.push(options);
      // Like the real uploader: the leading section heads the posted log comment.
      const { id } = github.create(PR_URL, `${options.leadingSection || ''}\n\n<details>log</details>`);
      await options.onCommentPosted?.({ commentId: id });
      return true;
    },
    runCommand: github.runCommand,
  };
  resetSessionMonitorForTests();
  try {
    trackSession(SESSION, sessionInfoFor(logPath), false);
    await monitorSessions(bot, Boolean(process.env.TEST_VERBOSE), options);
  } finally {
    resetSessionMonitorForTests();
    await fs.rm(dir, { recursive: true, force: true });
  }
  return { completion: edits.find(edit => edit.messageId === 77)?.message || '', edits, comments, current: github.current(), uploads, launches, lookups };
}

test('package-registry-manager#31: an auto-merged session that exited 0 reports no recovery and uploads no "killed session" log', { timeout: 15000 }, async () => {
  const run = await runCompletion({ exitCode: 0, pullRequestState: MERGED });
  assert.deepEqual(run.lookups, [PR_URL], 'the merge state is checked even though the session succeeded');
  assert.equal(run.comments.length, 0, `no PR notice after the merge:\n${run.comments.join('\n---\n')}`);
  assert.equal(run.uploads.length, 0, 'no intermediate "killed session" log is uploaded');
  assert.equal(run.launches.length, 0, 'nothing is recovered');
  assert.match(run.completion, /finished successfully/);
  assert.doesNotMatch(run.completion, /recovered from out of memory|Kill diagnostics|OOM/i);
});

test('a session killed after its pull request merged is neither recovered nor offered a resume', { timeout: 15000 }, async () => {
  const run = await runCompletion({ exitCode: 137, pullRequestState: MERGED });
  assert.equal(run.launches.length, 0, 'no recovery session after the merge');
  assert.equal(run.comments.length, 0, 'no kill notice after the merge');
  assert.equal(run.uploads.length, 0);
  assert.match(run.completion, /Pull request merged, but the work session exited with code: 137/);
  assert.doesNotMatch(run.completion, /out of memory|To resume|solve --resume|recovering/i);
});

// Issue #2809: a survived OOM event is reported on GitHub when it happens (while
// the session runs), never after the session finished well; Telegram keeps it.
test('with the pull request still open, a survived OOM event is not reported on GitHub after a clean finish', { timeout: 15000 }, async () => {
  const run = await runCompletion({ exitCode: 0, pullRequestState: OPEN });
  assert.equal(run.launches.length, 0);
  assert.equal(run.comments.length, 0, `no OOM comment after the work finished well (issue #2809):\n${run.comments.join('\n---\n')}`);
  assert.equal(run.uploads.length, 0, 'solve already published its own final log; no duplicate "killed session" log');
  assert.match(run.completion, /recovered from out of memory/i, 'Telegram still reports the OOM event post-factum');
});

test('a killed session with an open pull request is still recovered (behaviour preserved)', { timeout: 15000 }, async () => {
  const run = await runCompletion({ exitCode: 137, pullRequestState: OPEN });
  assert.equal(run.launches.length, 1, `the open work is resumed:\n${run.comments.join('\n---\n')}\n${run.completion}`);
  // Issue #3530: with --attach-logs the one kill comment is the log upload, headed
  // by the notice and its pending note; no lifecycle comment reaches GitHub.
  assert.equal(run.uploads.length, 1);
  assert.equal(run.comments.length, 1, `one comment per kill:\n${run.comments.join('\n---\n')}`);
  assert.match(run.comments[0], /<!-- hive-mind:session-kill-notice -->/);
  assert.match(run.comments[0], /Auto recovery \(resume or restart as per configuration\) is pending/);
  assert.doesNotMatch(run.comments[0], /outcome pending/, 'recovery phases stay in Telegram');
  assert.doesNotMatch(run.current[0], /is pending|recovery-pending/, 'the note is removed once the recovery starts');
  assert.match(run.current[0], /<details>log<\/details>/, 'the embedded log survives the edit');
});

test('buildKillCompletionSections returns nothing to report once the pull request is merged', async () => {
  const report = await buildKillCompletionSections({ sessionName: SESSION, sessionInfo: { oomEventObservedAt: OOM_OBSERVED_AT, args: [] }, exitCode: 0, status: 'executed', pullRequestState: MERGED, readFile: async () => '' });
  assert.equal(report.skippedReason, 'pull-request-merged');
  assert.deepEqual(report.sections, []);
  assert.equal(report.recovered || report.killed || report.oomEventOnly, false);
});

test('the merge state is looked up for a kill or an OOM event, not for a plain success', async () => {
  const calls = [];
  const lookupPullRequestState = async url => (calls.push(url), MERGED);
  assert.equal(await resolveFailedSessionPullRequestState({ pullRequestUrl: PR_URL, outcome: { failed: false, killed: false }, lookupPullRequestState }), null);
  assert.deepEqual(await resolveFailedSessionPullRequestState({ pullRequestUrl: PR_URL, outcome: { failed: false, killed: false }, killEvidence: true, lookupPullRequestState }), MERGED);
  assert.deepEqual(await resolveFailedSessionPullRequestState({ pullRequestUrl: PR_URL, outcome: { failed: true, killed: true }, lookupPullRequestState }), MERGED);
  assert.equal(calls.length, 2);
});

test('the survived notice keeps the forced-kill wording and drops the --attach-logs hint', () => {
  const oom = buildKillRecoveryNotice({ diagnosis: { cause: 'out-of-memory', evidence: [] }, exitCode: 0, survived: true, attachLogs: false });
  assert.doesNotMatch(oom, /--attach-logs/);
  const forced = buildKillRecoveryNotice({ diagnosis: { cause: 'forced-kill', evidence: [] }, exitCode: 0, survived: true });
  assert.match(forced, /recovered from forced kill/);
});

function toolKillHarness(isWorkDone) {
  const comments = [];
  const logs = [];
  const runs = [];
  return {
    comments,
    logs,
    runs,
    run: () =>
      resumeAfterToolKill({
        toolResult: { success: false, exitCode: 137, sessionId: 'tool-session' },
        argv: { tool: 'claude' },
        env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
        $: () => {},
        owner: 'link-foundation',
        repo: 'package-registry-manager',
        prNumber: 31,
        postComment: async ({ body }) => (comments.push(body), { ok: true, commentId: 9 }),
        log: async line => logs.push(line),
        runIteration: async () => (runs.push(1), { success: true, exitCode: 0 }),
        isWorkDone,
      }),
  };
}

test('solve does not retry a killed AI tool once the pull request is merged, and posts nothing', async () => {
  const h = toolKillHarness(async () => true);
  const result = await h.run();
  assert.equal(result.workDone, true);
  assert.equal(result.resumed, false);
  assert.equal(h.runs.length, 0);
  assert.equal(h.comments.length, 0, 'no recovery comment after the merge');
  assert.equal(parseRecoveryLogEvent(h.logs.join('\n')), null, 'no lifecycle record for the monitor to publish');
  assert.match(h.logs.join('\n'), /already merged/);
});

test('a scheduled retry is cancelled when the pull request merges during the delay', async () => {
  let checks = 0;
  const h = toolKillHarness(async () => ++checks > 1);
  const result = await h.run();
  assert.equal(result.workDone, true);
  assert.equal(h.runs.length, 0, 'the retry never launches');
  // Issue #3530: the one kill comment is edited: its pending note now gives the reason.
  assert.equal(h.comments.length, 2, 'posted once, then edited once');
  assert.match(h.comments.at(-1), /Automatic recovery did not start:\*\* the pull request is already merged/);
  assert.match(h.comments.at(-1), /No replacement session was launched/);
  assert.doesNotMatch(h.comments.at(-1), /is pending/);
  assert.equal(parseRecoveryLogEvent(h.logs.join('\n'))?.phase, 'cancelled');
});

test('a failing merge check never blocks the retry (behaviour preserved)', async () => {
  const h = toolKillHarness(async () => {
    throw new Error('gh unavailable');
  });
  const result = await h.run();
  assert.equal(result.workDone, false);
  assert.equal(h.runs.length, 1);
  assert.match(h.logs.join('\n'), /Could not check whether the work is already done: gh unavailable/);
});

test('a cancelled tool retry is reported as cancelled when the enclosing run ends', () => {
  const line = recoveryLogLine({ kind: 'tool', phase: 'cancelled', attempt: 1, at: '2026-10-06T07:48:16.000Z', reason: 'the pull request is already merged' });
  assert.equal(parseRecoveryLogEvent(line)?.phase, 'cancelled');
  const text = formatRecoveryLifecycle({ kind: 'tool', phase: 'cancelled', attempt: 1, at: '2026-10-06T07:48:18.000Z', outerTerminal: true });
  assert.match(text, /Recovery cancelled/);
  assert.doesNotMatch(text, /completed successfully|failed/);
});
