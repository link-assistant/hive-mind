/**
 * @hive-mind-test-suite default
 * One GitHub comment per kill (#3530): the reason, the log under --attach-logs,
 * and a "recovery pending" note that is removed once the recovery starts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { RECOVERY_PENDING_START_MARKER, RECOVERY_PENDING_END_MARKER, buildKillRecoveryNotice, buildRecoveryPendingBlock, describeRecoveryNotStarted, findPendingKillNoticeUrl, killNoticeSessionMarker, settleRecoveryPendingBlock, settleKillRecoveryNotice } from '../src/session-kill-recovery.lib.mjs';
import { announceKillOnPullRequest } from '../src/session-monitor.kill-sections.lib.mjs';
import { announcePendingKillNotice, finishKillNotice } from '../src/session-monitor.kill-notice.lib.mjs';
import { resumeAfterToolKill } from '../src/solve.tool-kill-resume.lib.mjs';
import { createGhCommentRecorder } from './helpers/gh-comment-recorder.mjs';

const PR = 'https://github.com/link-foundation/legal/pull/2';
const OOM = { cause: 'out-of-memory', summary: 'The container was OOM-killed.', evidence: ['container reports `State.OOMKilled = true`'] };

test('the pending note is a marked block the edit can find', () => {
  const block = buildRecoveryPendingBlock();
  assert.ok(block.startsWith(RECOVERY_PENDING_START_MARKER));
  assert.ok(block.endsWith(RECOVERY_PENDING_END_MARKER));
  assert.match(block, /Auto recovery \(resume or restart as per configuration\) is pending/);
  const body = buildKillRecoveryNotice({ diagnosis: OOM, exitCode: 137, sessionName: 'be86e099', recoveryPending: true, attachLogs: true, logInline: true });
  assert.ok(body.includes(block));
  assert.ok(body.includes(killNoticeSessionMarker('be86e099')));
  assert.doesNotMatch(body, /new working session was started|outcome pending/i, 'nothing is claimed before the recovery starts');
  assert.doesNotMatch(body, /--attach-logs|intermediate working-session log/i, 'the log is embedded, not announced');
});

test('settling removes the note on success and replaces it with the reason otherwise', () => {
  const body = `## Killed\n\nreason\n\n${buildRecoveryPendingBlock()}\n\nTo continue manually: …`;
  const started = settleRecoveryPendingBlock(body, { resumed: true });
  assert.doesNotMatch(started, /pending|recovery-pending/);
  assert.doesNotMatch(started, /\n{3,}/, 'no gap is left where the note was');
  assert.match(started, /reason\n\nTo continue manually/);
  const failed = settleRecoveryPendingBlock(body, { resumed: false, reason: 'already-running', detail: 'session b405f409 is already working on the pull request' });
  assert.match(failed, /Automatic recovery did not start:\*\* session b405f409 is already working on the pull request\. No replacement session was launched\./);
  assert.match(settleRecoveryPendingBlock(body, { resumed: false, reason: 'resource-wait-timeout' }), /did not start:\*\* resources did not become free and stable in time\. No replacement/);
  assert.equal(settleRecoveryPendingBlock('no markers here', { resumed: true }), null);
});

test('with --attach-logs the notice heads the log comment: one comment, not two', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'kill-comment-3530-'));
  const logPath = path.join(dir, 'session.log');
  await fs.writeFile(logPath, 'working…\n');
  const uploads = [];
  const gh = createGhCommentRecorder();
  try {
    const result = await announceKillOnPullRequest({
      pullRequestUrl: PR,
      sessionName: 'be86e099',
      sessionInfo: { args: [PR, '--attach-logs'], logPath },
      diagnosis: OOM,
      exitCode: 137,
      recoveryPending: true,
      runCommand: gh.runCommand,
      attachLog: async options => {
        uploads.push(options);
        await options.onCommentPosted({ commentId: '4242' });
        return true;
      },
    });
    assert.deepEqual(result, { posted: true, url: `${PR}#issuecomment-4242`, skipped: null, logUploaded: true });
    assert.equal(uploads.length, 1);
    assert.equal(gh.calls.length, 0, 'no separate notice comment');
    assert.deepEqual([uploads[0].targetType, uploads[0].targetNumber, uploads[0].owner, uploads[0].repo, uploads[0].logFile], ['pr', 2, 'link-foundation', 'legal', logPath]);
    assert.match(uploads[0].customTitle, /Working-session log \(killed session\)/);
    assert.match(uploads[0].leadingSection, /out of memory/i);
    assert.ok(uploads[0].leadingSection.includes(RECOVERY_PENDING_START_MARKER));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('a failed log upload still posts the notice, without claiming a log', async () => {
  const gh = createGhCommentRecorder();
  const result = await announceKillOnPullRequest({ pullRequestUrl: PR, sessionName: 's', sessionInfo: { args: ['--attach-logs'], logPath: '/nonexistent.log' }, diagnosis: OOM, exitCode: 137, recoveryPending: true, runCommand: gh.runCommand, attachLog: async () => false });
  assert.equal(result.posted, true);
  assert.equal(result.logUploaded, false);
  assert.equal(gh.posts.length, 1);
  assert.ok(gh.posts[0].includes(RECOVERY_PENDING_START_MARKER));
});

test('an issue-only task gets the notice only when a recovery is pending', async () => {
  const issue = 'https://github.com/o/r/issues/5';
  const sessionInfo = { args: [], url: issue, urlContext: { type: 'issue', owner: 'o', repo: 'r', number: 5, normalized: issue } };
  const gh = createGhCommentRecorder();
  assert.equal((await announceKillOnPullRequest({ sessionName: 's', sessionInfo, diagnosis: OOM, exitCode: 137, runCommand: gh.runCommand })).skipped, 'no-pull-request');
  assert.equal((await announceKillOnPullRequest({ sessionName: 's', sessionInfo, diagnosis: OOM, exitCode: 137, recoveryPending: true, runCommand: gh.runCommand })).url, `${issue}#issuecomment-1`);
});

test('the pending notice is posted once and settled once, even across repeated completions', async () => {
  const gh = createGhCommentRecorder();
  const persisted = [];
  const sessionInfo = { args: [PR, '--on-session-kill', 'resume'], url: PR, urlContext: { type: 'pull', owner: 'link-foundation', repo: 'legal', number: 2 } };
  const context = { pullRequestUrl: PR, sessionName: 'be86e099', sessionInfo, killReport: { killed: true, diagnosis: OOM, policy: 'resume' }, exitCode: 137, options: { runCommand: gh.runCommand }, persist: () => persisted.push({ ...sessionInfo.killNotice }) };
  await announcePendingKillNotice(context);
  await announcePendingKillNotice(context);
  assert.equal(gh.posts.length, 1);
  assert.equal(sessionInfo.killNotice.pending, true);
  await finishKillNotice({ ...context, killRecovery: { resumed: true, sessionId: '97de7fc8', attempt: 1, maxAttempts: 3 } });
  await finishKillNotice({ ...context, killRecovery: { resumed: true, sessionId: '97de7fc8', attempt: 1, maxAttempts: 3 } });
  assert.equal(gh.posts.length, 1, 'the recovery does not add a second kill comment');
  assert.equal(gh.patches.length, 1);
  assert.doesNotMatch(gh.current()[0], /is pending/);
  assert.doesNotMatch(gh.current()[0], /97de7fc8/, 'the recovery session announces itself in its own start comment');
  assert.equal(sessionInfo.killNotice.outcome, 'recovery-started');
  assert.deepEqual(
    persisted.map(notice => notice.pending),
    [true, false]
  );
});

test('a kill notice of an earlier attempt is not mistaken for this one', async () => {
  const gh = createGhCommentRecorder();
  const sessionInfo = { args: [], url: PR, killNotice: { sessionName: 'earlier-attempt', url: `${PR}#issuecomment-9`, pending: false } };
  const context = { pullRequestUrl: PR, sessionName: 'this-attempt', sessionInfo, killReport: { killed: true, diagnosis: OOM }, exitCode: 137, options: { runCommand: gh.runCommand } };
  await announcePendingKillNotice(context);
  assert.equal(gh.posts.length, 1, 'every kill gets its own comment');
  assert.equal(sessionInfo.killNotice.sessionName, 'this-attempt');
});

test('reporting failures never throw into the completion notification', async () => {
  const context = { pullRequestUrl: PR, sessionName: 's', sessionInfo: { args: [], url: PR }, killReport: { killed: true, diagnosis: OOM }, exitCode: 137, options: { runCommand: async () => Promise.reject(new Error('ENOENT gh')), killNoticeSettleDelayMs: 0 } };
  const pending = await announcePendingKillNotice(context);
  assert.equal(pending.posted, false);
  const finished = await finishKillNotice({ ...context, sessionInfo: { ...context.sessionInfo, killNotice: { sessionName: 's', url: `${PR}#issuecomment-1`, pending: true } }, killRecovery: { resumed: true } });
  assert.equal(finished.edited, false);
  const settled = await settleKillRecoveryNotice({ commentUrl: `${PR}#issuecomment-1`, outcome: { resumed: true }, runCommand: async () => Promise.reject(new Error('offline')) });
  assert.equal(settled.edited, false);
  assert.ok(settled.error);
});

/** The recorder, plus the comment listing `findPendingKillNoticeUrl` runs (its jq filter emulated). */
function ghWithListing({ failEdits = 0 } = {}) {
  const gh = createGhCommentRecorder();
  const listed = [];
  let edits = 0;
  const runCommand = async (command, args) => {
    if (args[0] === 'api' && /\/issues\/\d+\/comments$/.test(args[1])) {
      listed.push(args[1]);
      const marker = JSON.parse(/contains\(("[^)]*")\) and/.exec(args[args.indexOf('--jq') + 1])[1]);
      const url = gh
        .urls()
        .filter(entry => entry.body.includes(marker) && entry.body.includes(RECOVERY_PENDING_START_MARKER))
        .at(-1)?.url;
      return { code: 0, stdout: url ? `${url}\n` : '', stderr: '' };
    }
    if (args[0] === 'api' && args.includes('--input') && edits++ < failEdits) return { code: 1, stdout: '', stderr: 'HTTP 502: Bad Gateway' };
    return gh.runCommand(command, args);
  };
  return { ...gh, runCommand, listed };
}

test('no pending note is promised when no recovery can start', async () => {
  const gh = createGhCommentRecorder();
  const sessionInfo = { args: [], url: PR };
  const context = { pullRequestUrl: PR, sessionName: 's', sessionInfo, killReport: { killed: true, diagnosis: OOM }, exitCode: 137, options: { runCommand: gh.runCommand } };
  assert.deepEqual(await announcePendingKillNotice({ ...context, planRecovery: async () => false }), { posted: false, url: null, skipped: 'no-recovery-planned' });
  assert.equal(gh.posts.length, 0);
  assert.equal(sessionInfo.killNotice, undefined);
  await finishKillNotice({ ...context, killRecovery: { resumed: false, reason: 'max-attempts-reached' } });
  assert.equal(gh.posts.length, 1, 'the final notice is posted once the decision is known');
  assert.ok(!gh.posts[0].includes(RECOVERY_PENDING_START_MARKER));
  await announcePendingKillNotice({ ...context, sessionInfo: { args: [], url: PR }, planRecovery: async () => true });
  assert.ok(gh.posts[1].includes(RECOVERY_PENDING_START_MARKER), 'a plannable recovery still gets the pending note');
});

test('reasons a recovery did not start are written in plain words', () => {
  for (const reason of ['policy-report', 'stopped-by-user', 'no-session-id', 'not-resumable', 'max-attempts-reached', 'plan-error', 'start-failed', 'resource-wait-timeout', 'already-running', 'start-error', 'no-plan', 'no-isolation-runner', 'no-tracker', 'no-isolation-backend']) {
    const text = describeRecoveryNotStarted({ reason });
    assert.ok(text && !text.includes(reason), `${reason} -> ${text}`);
  }
  assert.equal(describeRecoveryNotStarted({ reason: 'already-running', detail: 'session x is working on it' }), 'session x is working on it');
  assert.ok(describeRecoveryNotStarted({ reason: 'something-new' }));
});

test('a notice whose comment id was lost is found by its marker and settled', async () => {
  const gh = ghWithListing();
  gh.create(PR, `${killNoticeSessionMarker('other')}\n${buildRecoveryPendingBlock()}`);
  gh.create(PR, `${killNoticeSessionMarker('lost-id')}\n## Killed\n\n${buildRecoveryPendingBlock()}`);
  assert.equal(await findPendingKillNoticeUrl({ targetUrl: PR, sessionName: 'lost-id', runCommand: gh.runCommand }), `${PR}#issuecomment-2`);
  assert.equal(await findPendingKillNoticeUrl({ targetUrl: PR, sessionName: 'missing', runCommand: gh.runCommand }), null);
  const sessionInfo = { args: [], url: PR, killNotice: { sessionName: 'lost-id', url: null, pending: true } };
  const result = await finishKillNotice({ pullRequestUrl: PR, sessionName: 'lost-id', sessionInfo, killReport: { killed: true, diagnosis: OOM }, exitCode: 137, options: { runCommand: gh.runCommand, killNoticeSettleDelayMs: 0 }, killRecovery: { resumed: true } });
  assert.equal(result.edited, true);
  assert.equal(sessionInfo.killNotice.url, `${PR}#issuecomment-2`);
  assert.equal(gh.patches.length, 1);
  assert.equal(gh.patches[0].id, '2');
  assert.ok(gh.current()[0].includes(RECOVERY_PENDING_START_MARKER), "another session's notice is left alone");
});

test('a failed edit is retried, and a recovery that did not start is never left "pending"', async () => {
  const retried = ghWithListing({ failEdits: 1 });
  retried.create(PR, `${killNoticeSessionMarker('s')}\n${buildRecoveryPendingBlock()}`);
  const context = { pullRequestUrl: PR, sessionName: 's', killReport: { killed: true, diagnosis: OOM }, exitCode: 137 };
  const once = await finishKillNotice({ ...context, sessionInfo: { args: [], url: PR, killNotice: { sessionName: 's', url: `${PR}#issuecomment-1`, pending: true } }, options: { runCommand: retried.runCommand, killNoticeSettleDelayMs: 0 }, killRecovery: { resumed: false, reason: 'resource-wait-timeout' } });
  assert.deepEqual([once.edited, once.posted, retried.posts.length], [true, false, 1], 'the second attempt edits the note');
  assert.match(retried.current()[0], /did not start:\*\* resources did not become free/);

  const broken = ghWithListing({ failEdits: 99 });
  broken.create(PR, `${killNoticeSessionMarker('s')}\n${buildRecoveryPendingBlock()}`);
  const sessionInfo = { args: [], url: PR, killNotice: { sessionName: 's', url: `${PR}#issuecomment-1`, pending: true } };
  const failed = await finishKillNotice({ ...context, sessionInfo, options: { runCommand: broken.runCommand, killNoticeSettleDelayMs: 0, killNoticeSettleAttempts: 2 }, killRecovery: { resumed: false, reason: 'already-running', detail: 'session b405f409 is already working on the pull request' } });
  assert.deepEqual([failed.edited, failed.posted], [false, true]);
  assert.equal(broken.posts.length, 2, 'one short follow-up comment');
  assert.ok(broken.posts[1].includes(killNoticeSessionMarker('s')));
  assert.match(broken.posts[1], /Automatic recovery did not start\*\* for working session `s`: session b405f409 is already working on the pull request\. No replacement session was launched/);
  assert.equal(sessionInfo.killNotice.pending, false);

  const started = ghWithListing({ failEdits: 99 });
  started.create(PR, `${killNoticeSessionMarker('s')}\n${buildRecoveryPendingBlock()}`);
  await finishKillNotice({ ...context, sessionInfo: { args: [], url: PR, killNotice: { sessionName: 's', url: `${PR}#issuecomment-1`, pending: true } }, options: { runCommand: started.runCommand, killNoticeSettleDelayMs: 0 }, killRecovery: { resumed: true } });
  assert.equal(started.posts.length, 1, 'a started recovery announces itself; no follow-up');
});

test('every in-process kill gets its own comment, settled when its retry starts', async () => {
  const posts = [];
  let killed = 0;
  let nextId = 0;
  await resumeAfterToolKill({
    toolResult: { success: false, exitCode: 137, sessionId: 'tool' },
    argv: { tool: 'claude' },
    env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
    $: () => {},
    owner: 'link-foundation',
    repo: 'legal',
    prNumber: 2,
    log: async () => {},
    postComment: async ({ body, commentId }) => (posts.push({ body, commentId }), { ok: true, commentId: commentId || String(++nextId) }),
    runIteration: async () => (++killed === 1 ? { success: false, exitCode: 137, sessionId: 'tool' } : { success: true, exitCode: 0 }),
  });
  assert.deepEqual(
    posts.map(post => post.commentId ?? null),
    [null, '1', null, '2'],
    'post, settle, post, settle'
  );
  assert.match(posts[0].body, /pending:\*\* attempt 1\/3/);
  assert.match(posts[2].body, /pending:\*\* attempt 2\/3/);
  assert.doesNotMatch(posts[1].body, /pending/);
  assert.doesNotMatch(posts[3].body, /pending/);
});
