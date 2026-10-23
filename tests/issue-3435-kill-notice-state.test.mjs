/**
 * @hive-mind-test-suite default
 * Issue #3435: the kill notice must always show the real recovery state, and its
 * exit line must say which process each exit code belongs to.
 *
 *   1. The fallback notice (no pending note was posted) never says "a new working
 *      session was started … not yet confirmed" — it renders the decision.
 *   2. When the recovery session itself fails or is killed, the inherited notice
 *      is edited once with "Recovery attempt N/M ended: exit …"; a new comment is
 *      posted only when that edit fails.
 *   3. "Exit code: 1 (solve); the AI tool (claude) exited 137 (SIGKILL, cgroup OOM)"
 *      on GitHub and in Telegram, with "cgroup OOM" only on OOM evidence.
 *   4. Side risk: when solve already commented on the kill of its AI tool (the
 *      in-process path), the monitor posts no second notice for the same event.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initI18n, preloadAllLocales } from '../src/i18n.lib.mjs';
import { detectToolExitCode, describeSessionExitCodes, exitCodeSignal, findInProcessKillReport, findToolExitCode } from '../src/session-tool-exit.lib.mjs';
import { buildKillRecoveryNotice, buildRecoveryPendingBlock, killNoticeSessionMarker, findPendingKillNoticeUrl } from '../src/session-kill-recovery.lib.mjs';
import { buildKillCompletionSections } from '../src/session-monitor.kill-sections.lib.mjs';
import { announcePendingKillNotice, finishKillNotice } from '../src/session-monitor.kill-notice.lib.mjs';
import { recoveryLogLine } from '../src/session-recovery-lifecycle.lib.mjs';
import { formatRecoveryAttemptOutcome, insertRecoveryOutcome, reportRecoveryAttemptOutcome } from '../src/session-kill-recovery-outcome.lib.mjs';
import { monitorSessions, resetSessionMonitorForTests, trackSession, STALE_EXECUTING_MIN_AGE_MS } from '../src/session-monitor.lib.mjs';
import { createGhCommentRecorder } from './helpers/gh-comment-recorder.mjs';

const PR = 'https://github.com/link-assistant/hive-mind/pull/3435';
const OOM = { cause: 'out-of-memory', summary: 'The container was OOM-killed.', evidence: [] };
const CLAUDE_137 = ['[2026-10-17T10:00:00.000Z] [INFO] working…', '[2026-10-17T10:05:00.000Z] [ERROR] ', '[2026-10-17T10:05:00.000Z] [ERROR] ❌ Claude command failed with exit code 137', '[2026-10-17T10:05:01.000Z] [INFO] cleanup'].join('\n');

// ---------------------------------------------------------------------------
// 3. Which process an exit code belongs to.
// ---------------------------------------------------------------------------

test('the AI tool exit line is found in the solve log, prefixed or not; the last one wins', () => {
  assert.deepEqual(findToolExitCode(CLAUDE_137), { tool: 'claude', label: 'Claude', exitCode: 137, line: '[2026-10-17T10:05:00.000Z] [ERROR] ❌ Claude command failed with exit code 137' });
  assert.equal(findToolExitCode('❌ Codex command failed with exit code 1\n❌ Qwen Code command failed with exit code 143').tool, 'qwen');
  assert.equal(findToolExitCode('❌ Claude CLI failed with exit code 2').exitCode, 2);
  assert.equal(findToolExitCode('❌ OpenCode command failed with exit code 9').tool, 'opencode');
  assert.equal(findToolExitCode('❌ Gemini command failed with exit code 3').tool, 'gemini');
  assert.equal(findToolExitCode('❌ Codex validation failed with exit code 1'), null, 'a validation failure is not the tool run');
  assert.equal(findToolExitCode('the assistant said: "❌ Claude command failed with exit code 137"'), null, 'quoted text mid-line is not the exit line');
  assert.equal(findToolExitCode(''), null);
});

test('the log tail is read with a bound and from the current attempt only', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'tool-exit-3435-'));
  const logPath = path.join(dir, 'solve.log');
  try {
    const earlier = '❌ Claude command failed with exit code 1\n';
    await fs.writeFile(logPath, `${earlier}${'x'.repeat(300 * 1024)}\n❌ Codex command failed with exit code 137\n`);
    assert.equal((await detectToolExitCode(logPath)).tool, 'codex');
    await fs.writeFile(logPath, `${earlier}later attempt, no tool line\n`);
    assert.equal(await detectToolExitCode(logPath, { minByteOffset: Buffer.byteLength(earlier) }), null, "an earlier attempt's line is not this attempt's");
    assert.equal(await detectToolExitCode(path.join(dir, 'missing.log')), null, 'never throws');
    assert.equal((await detectToolExitCode('/seam', { readFile: async () => CLAUDE_137 })).exitCode, 137);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('the exit line names both processes, and says "cgroup OOM" only with OOM evidence', () => {
  const toolExit = { tool: 'claude', exitCode: 137 };
  assert.equal(describeSessionExitCodes({ exitCode: 1, toolExit, oomEvidence: true }), '1 (solve); the AI tool (claude) exited 137 (SIGKILL, cgroup OOM)');
  assert.equal(describeSessionExitCodes({ exitCode: 1, toolExit }), '1 (solve); the AI tool (claude) exited 137 (SIGKILL)');
  assert.equal(describeSessionExitCodes({ exitCode: 1, toolExit, oomEvidence: true, cause: 'forced-kill' }), '1 (solve); the AI tool (claude) exited 137 (SIGKILL)', 'another diagnosed cause rules the OOM killer out');
  assert.equal(describeSessionExitCodes({ exitCode: 137, processLabel: 'fix', oomEvidence: true }), '137 (fix, SIGKILL, cgroup OOM)');
  assert.equal(describeSessionExitCodes({ exitCode: 143 }), '143 (solve, SIGTERM)');
  assert.equal(describeSessionExitCodes({ exitCode: null }), null);
  assert.equal(exitCodeSignal(137), 'SIGKILL');
  assert.equal(exitCodeSignal(1), null);
});

test('the kill notice exit line uses the same wording', () => {
  const body = buildKillRecoveryNotice({ diagnosis: OOM, exitCode: 1, oomEventOnly: true, observedAt: '2026-10-17T10:04:00.000Z', toolExit: { tool: 'claude', exitCode: 137 }, oomEvidence: true });
  assert.match(body, /- \*\*Exit code:\*\* 1 \(solve\); the AI tool \(claude\) exited 137 \(SIGKILL, cgroup OOM\)/);
  assert.match(buildKillRecoveryNotice({ exitCode: 137 }), /- \*\*Exit code:\*\* 137 \(solve, SIGKILL\)$/m);
});

test('the Telegram report and the notice get the tool exit from the same log scan', async () => {
  const sessionInfo = { args: [], logPath: '/solve.log', oomEventObservedAt: '2026-10-17T10:04:00.000Z', command: 'solve' };
  const report = await buildKillCompletionSections({ sessionName: 's', sessionInfo, statusResult: { logPath: '/solve.log' }, exitCode: 1, status: 'failed', readFile: async () => CLAUDE_137, statFile: async () => ({ mtimeMs: Date.parse('2026-10-17T10:05:01.000Z') }) });
  assert.equal(report.oomEventOnly, true);
  assert.deepEqual([report.toolExit?.tool, report.toolExit?.exitCode, report.oomEvidence], ['claude', 137, true]);
  assert.ok(
    report.sections.some(section => section.includes('later failed with exit code 1 (solve); the AI tool (claude) exited 137 (SIGKILL, cgroup OOM)')),
    report.sections.join('\n---\n')
  );

  const killed = await buildKillCompletionSections({ sessionName: 's', sessionInfo: { args: [], logPath: '/solve.log' }, statusResult: { logPath: '/solve.log' }, exitCode: 137, status: 'killed', readFile: async () => CLAUDE_137, statFile: async () => ({ mtimeMs: Date.now() }) });
  assert.equal(killed.killed, true);
  assert.ok(
    killed.sections.some(section => /Exit code: 137 \(solve, SIGKILL\); the AI tool \(claude\) exited 137 \(SIGKILL\)/.test(section)),
    `without OOM evidence no "cgroup OOM":\n${killed.sections.join('\n---\n')}`
  );
});

// ---------------------------------------------------------------------------
// 1. Every path renders the real state.
// ---------------------------------------------------------------------------

test('a notice is never "a new working session was started … not yet confirmed"', () => {
  const legacy = buildKillRecoveryNotice({ diagnosis: OOM, exitCode: 137, resumed: true, recoverySessionId: 'replacement', attempt: 1, maxAttempts: 3 });
  assert.doesNotMatch(legacy, /new working session was started|not yet confirmed|outcome pending/i);
  assert.match(legacy, /## ⚠️ Working session restarted after a kill/, 'the title states what is known: a restart, not a recovery');
  assert.match(legacy, /Automatic recovery started\*\* \(attempt 1\/3\) in working session `replacement`/);

  const notStarted = buildKillRecoveryNotice({ diagnosis: OOM, exitCode: 137, recoveryOutcome: { resumed: false, reason: 'max-attempts-reached' } });
  assert.match(notStarted, /❌ \*\*Automatic recovery did not start:\*\* all automatic recovery attempts are used up\. No replacement session was launched\./);
  assert.doesNotMatch(notStarted, /This working session did not continue/);
});

test('the fallback notice (no pending note was posted) renders the decision, not a launch acceptance', async () => {
  const gh = createGhCommentRecorder();
  const context = { pullRequestUrl: PR, sessionName: 'parent', sessionInfo: { args: [], url: PR }, killReport: { killed: true, diagnosis: OOM, policy: 'resume' }, exitCode: 137, options: { runCommand: gh.runCommand } };
  await finishKillNotice({ ...context, killRecovery: { resumed: true, sessionId: 'recovery-1', attempt: 1, maxAttempts: 3 } });
  assert.equal(gh.posts.length, 1);
  assert.doesNotMatch(gh.posts[0], /new working session was started|not yet confirmed|outcome pending/i);
  assert.match(gh.posts[0], /Automatic recovery started\*\* \(attempt 1\/3\) in working session `recovery-1`/);

  const refused = createGhCommentRecorder();
  await finishKillNotice({ ...context, sessionInfo: { args: [], url: PR }, options: { runCommand: refused.runCommand }, killRecovery: { resumed: false, reason: 'already-running', detail: 'session b405f409 is already working on the pull request' } });
  assert.match(refused.posts[0], /Automatic recovery did not start:\*\* session b405f409 is already working on the pull request\./);
});

// ---------------------------------------------------------------------------
// 2. A failed or killed recovery session edits the inherited notice once.
// ---------------------------------------------------------------------------

test('the outcome line says which attempt ended, how, and what happens next', () => {
  assert.equal(formatRecoveryAttemptOutcome({ attempt: 1, maxAttempts: 3, exitLine: '1 (solve)', killRecovery: { resumed: true, sessionId: 'r2', attempt: 2, maxAttempts: 3 } }), '🔁 **Recovery attempt 1/3 ended:** exit 1 (solve). Recovery attempt 2/3 started in working session `r2`.');
  assert.equal(formatRecoveryAttemptOutcome({ attempt: 3, maxAttempts: 3, exitLine: '137 (solve, SIGKILL)', killRecovery: { resumed: false, reason: 'max-attempts-reached' } }), '🔁 **Recovery attempt 3/3 ended:** exit 137 (solve, SIGKILL). No further attempt: all automatic recovery attempts are used up.');
  assert.equal(formatRecoveryAttemptOutcome({ attempt: 2, maxAttempts: null, exitLine: '1 (solve)' }), '🔁 **Recovery attempt 2 ended:** exit 1 (solve). No further attempt was started automatically.');
  const body = `## Killed\n\ntext\n\n<sub>Reported by Hive Mind</sub>`;
  const once = insertRecoveryOutcome(body, 'r1', 'LINE');
  assert.match(once, /text\n\n<!-- hive-mind:recovery-outcome:r1 -->\nLINE\n\n<sub>Reported by Hive Mind<\/sub>$/);
  assert.equal(insertRecoveryOutcome(once, 'r1', 'LINE'), null, 'the same attempt is never added twice');
  assert.match(insertRecoveryOutcome(once, 'r2', 'NEXT'), /LINE\n\n<!-- hive-mind:recovery-outcome:r2 -->\nNEXT\n\n<sub>/);
  assert.match(insertRecoveryOutcome('no footer', 'r1', 'LINE'), /^no footer\n\n<!-- hive-mind:recovery-outcome:r1 -->\nLINE$/);
});

function recoveryContext({ gh, killNotice, exitCode = 1, status = 'failed', killRecovery = undefined, killReport = {}, extra = {} }) {
  const persisted = [];
  const sessionInfo = { args: [PR, '--on-session-kill', 'resume'], url: PR, command: 'solve', logPath: '/recovery.log', killRecoveryOfSession: 'parent', killRecoveryAttempts: 1, killRecoveryResumed: true, killNotice, ...extra };
  return {
    persisted,
    sessionInfo,
    context: { pullRequestUrl: PR, sessionName: 'recovery-1', sessionInfo, killReport, exitCode, status, killRecovery, options: { runCommand: gh.runCommand, readFile: async () => CLAUDE_137, env: {} }, persist: () => persisted.push(sessionInfo.killRecoveryOutcomeReportedAt) },
  };
}

test('a failed recovery session edits the inherited notice once, and posts nothing new', async () => {
  const gh = createGhCommentRecorder();
  const { url } = gh.create(PR, `${killNoticeSessionMarker('parent')}\n## ❌ Working session was killed: out of memory\n\n🔄 **Automatic recovery started** (attempt 1/3).\n\n<sub>Reported by Hive Mind</sub>`);
  const { context, sessionInfo, persisted } = recoveryContext({ gh, killNotice: { sessionName: 'parent', url, pending: true } });
  const first = await reportRecoveryAttemptOutcome(context);
  const again = await reportRecoveryAttemptOutcome(context);
  assert.deepEqual([first.edited, first.posted], [true, false]);
  assert.equal(again.skipped, 'already-reported');
  assert.equal(gh.posts.length, 1, 'no new comment');
  assert.equal(gh.patches.length, 1, 'edited once');
  assert.match(gh.current()[0], /🔁 \*\*Recovery attempt 1\/3 ended:\*\* exit 1 \(solve\); the AI tool \(claude\) exited 137 \(SIGKILL\)\. No further attempt was started automatically\.\n\n<sub>Reported by Hive Mind<\/sub>$/);
  assert.ok(sessionInfo.killRecoveryOutcomeReportedAt);
  assert.equal(persisted.length, 1);
});

test('a killed recovery session names the next attempt in the inherited notice', async () => {
  const gh = createGhCommentRecorder();
  const { url } = gh.create(PR, `${killNoticeSessionMarker('parent')}\n## killed\n\n<sub>Reported by Hive Mind</sub>`);
  const { context } = recoveryContext({ gh, killNotice: { sessionName: 'parent', url }, exitCode: 137, status: 'killed', killReport: { killed: true, oomEvidence: true, toolExit: null, diagnosis: OOM }, killRecovery: { resumed: true, sessionId: 'recovery-2', attempt: 2, maxAttempts: 3 } });
  await reportRecoveryAttemptOutcome(context);
  assert.match(gh.current()[0], /Recovery attempt 1\/3 ended:\*\* exit 137 \(solve, SIGKILL, cgroup OOM\)\. Recovery attempt 2\/3 started in working session `recovery-2`\./);
});

test('the inherited notice is found by its marker when its id is unknown, and only a failed edit posts a comment', async () => {
  const gh = createGhCommentRecorder();
  const listed = [];
  const runCommand = async (command, args) => {
    if (args[0] === 'api' && /\/issues\/\d+\/comments$/.test(args[1])) {
      listed.push(args.at(-1));
      const markers = [...args[args.indexOf('--jq') + 1].matchAll(/contains\(("[^)]*")\)/g)].map(match => JSON.parse(match[1]));
      const url = gh
        .urls()
        .filter(entry => markers.every(marker => entry.body.includes(marker)))
        .at(-1)?.url;
      return { code: 0, stdout: url ? `${url}\n` : '', stderr: '' };
    }
    return gh.runCommand(command, args);
  };
  gh.create(PR, `${killNoticeSessionMarker('parent')}\n## settled\n\n<sub>Reported by Hive Mind</sub>`);
  assert.equal(await findPendingKillNoticeUrl({ targetUrl: PR, sessionName: 'parent', runCommand }), null, 'a settled notice is not pending');
  assert.equal(await findPendingKillNoticeUrl({ targetUrl: PR, sessionName: 'parent', runCommand, pendingOnly: false }), `${PR}#issuecomment-1`);
  const { context } = recoveryContext({ gh: { runCommand }, killNotice: { sessionName: 'recovery-1', url: `${PR}#issuecomment-99` } });
  const found = await reportRecoveryAttemptOutcome(context);
  assert.equal(found.edited, true, 'the notice of another session is not used; the parent notice is looked up');
  assert.equal(gh.patches[0].id, '1');

  const broken = createGhCommentRecorder();
  const { context: lost } = recoveryContext({ gh: broken, killNotice: { sessionName: 'parent', url: `${PR}#issuecomment-404` } });
  const fallback = await reportRecoveryAttemptOutcome({ ...lost, options: { ...lost.options, runCommand: broken.runCommand } });
  assert.deepEqual([fallback.edited, fallback.posted], [false, true]);
  assert.equal(broken.posts.length, 1, 'one short comment when the notice cannot be edited');
  assert.match(broken.posts[0], /Recovery attempt 1\/3 ended:\*\* exit 1 \(solve\)/);
  assert.match(broken.posts[0], /<!-- hive-mind:recovery-outcome:recovery-1 -->/);
});

test('nothing is edited for a successful recovery, a session that is no recovery, or a merged / ready pull request', async () => {
  const gh = createGhCommentRecorder();
  const { url } = gh.create(PR, `${killNoticeSessionMarker('parent')}\n<sub>Reported by Hive Mind</sub>`);
  const base = recoveryContext({ gh, killNotice: { sessionName: 'parent', url } }).context;
  assert.equal((await reportRecoveryAttemptOutcome({ ...base, exitCode: 0, status: 'executed' })).skipped, 'not-failed');
  assert.equal((await reportRecoveryAttemptOutcome({ ...base, sessionInfo: { ...base.sessionInfo, killRecoveryOfSession: undefined } })).skipped, 'not-a-recovery');
  assert.equal((await reportRecoveryAttemptOutcome({ ...base, pullRequestState: { merged: true } })).skipped, 'pull-request-merged');
  assert.equal((await reportRecoveryAttemptOutcome({ ...base, pullRequestState: { merged: false, readyToMerge: true } })).skipped, 'pull-request-ready-to-merge');
  assert.equal(gh.patches.length, 0);
});

test('end to end: the monitor edits the parent notice when the recovery session fails', { timeout: 15000 }, async () => {
  await initI18n('en');
  await preloadAllLocales();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-3435-'));
  const logPath = path.join(dir, 'session.log');
  await fs.writeFile(logPath, `${CLAUDE_137}\n==========\nFinished: 2026-10-17 10:05:02.000\nExit Code: 1\n`);
  const gh = createGhCommentRecorder();
  const { url } = gh.create(PR, `${killNoticeSessionMarker('parent')}\n## ❌ Working session was killed: out of memory\n\n${buildRecoveryPendingBlock()}\n\n<sub>Reported by Hive Mind</sub>`);
  const edits = [];
  const bot = { telegram: { editMessageText: async (_c, messageId, _i, message) => edits.push(message), sendMessage: async (_c, message) => (edits.push(message), { chat: { id: 1 }, message_id: 2 }) } };
  resetSessionMonitorForTests();
  try {
    trackSession(
      'recovery-1',
      {
        chatId: 1,
        messageId: 7,
        startTime: new Date(Date.now() - STALE_EXECUTING_MIN_AGE_MS - 60_000),
        command: 'solve',
        tool: 'claude',
        isolationBackend: 'docker',
        sessionId: 'recovery-1',
        logPath,
        locale: 'en',
        url: PR,
        urlContext: { type: 'pull', owner: 'link-assistant', repo: 'hive-mind', number: 3435, normalized: PR },
        args: [PR, '--on-session-kill', 'resume'],
        killRecoveryOfSession: 'parent',
        killRecoveryAttempts: 1,
        killRecoveryResumed: true,
        killNotice: { sessionName: 'parent', url, pending: true },
      },
      false
    );
    await monitorSessions(bot, Boolean(process.env.TEST_VERBOSE), {
      statusProvider: async () => ({ exists: true, status: 'executed', exitCode: 1, isolation: 'docker', logPath }),
      // The footer must be newer than the recovery start, or it belongs to an earlier attempt.
      exitFromLog: () => ({ finished: true, exitCode: 1, endTime: new Date().toISOString() }),
      backendAlive: async () => false,
      dockerContainerSizeProvider: async () => null,
      removeDockerContainer: async () => ({ success: true }),
      readFile: async file => await fs.readFile(file, 'utf8'),
      lookupLinkedPullRequest: async () => null,
      lookupPullRequestState: async () => ({ merged: false, mergedAt: null, state: 'open' }),
      env: { HIVE_MIND_SESSION_KILL_RESUME_DELAY: '0' },
      runCommand: gh.runCommand,
      attachLog: async () => true,
    });
  } finally {
    resetSessionMonitorForTests();
    await fs.rm(dir, { recursive: true, force: true });
  }
  assert.equal(gh.posts.length, 1, `no new comment:\n${gh.posts.join('\n---\n')}`);
  assert.equal(gh.patches.length, 1);
  assert.match(gh.current()[0], /Recovery attempt 1\/3 ended:\*\* exit 1 \(solve\); the AI tool \(claude\) exited 137 \(SIGKILL\)/);
  assert.ok(edits.length > 0, 'Telegram still gets the completion');
});

// ---------------------------------------------------------------------------
// 4. Side risk: solve already reported the in-process kill.
// ---------------------------------------------------------------------------

test('the in-process kill report is found only when solve commented on the kill', () => {
  const prefixed = line => `[2026-10-17T10:05:00.000Z] [INFO] ${line}`;
  assert.deepEqual(findInProcessKillReport(prefixed(recoveryLogLine({ kind: 'tool', phase: 'waiting', attempt: 1, maxAttempts: 2 }))), { phase: 'waiting', attempt: 1, commentUrl: null });
  assert.equal(findInProcessKillReport(recoveryLogLine({ kind: 'tool', phase: 'completed', attempt: 1, commentUrl: `${PR}#issuecomment-5` })).commentUrl, `${PR}#issuecomment-5`);
  assert.ok(findInProcessKillReport(recoveryLogLine({ kind: 'tool', phase: 'failed', attempt: 3, reason: 'automatic recovery budget 2/2 is spent' })), 'the spent-budget comment is a report');
  assert.equal(findInProcessKillReport(recoveryLogLine({ kind: 'tool', phase: 'failed', attempt: 1, reason: 'automatic recovery budget 0/0 is spent' })), null, 'a zero budget posts no comment');
  assert.equal(findInProcessKillReport(recoveryLogLine({ kind: 'container', phase: 'waiting', attempt: 1 })), null, "the monitor's own records do not count");
  assert.equal(findInProcessKillReport('the assistant printed [HIVE-MIND RECOVERY] {"kind":"tool","phase":"waiting"}'), null, 'quoted text mid-line is no record');
  assert.equal(findInProcessKillReport(''), null);
});

test('a failed run whose AI tool kill solve already reported gets no second notice; Telegram and the recovery stay', async () => {
  const log = `${recoveryLogLine({ kind: 'tool', phase: 'waiting', attempt: 1, maxAttempts: 2 })}\n${CLAUDE_137}`;
  const sessionInfo = { args: [], logPath: '/solve.log', oomEventObservedAt: '2026-10-17T10:04:00.000Z', command: 'solve', url: PR };
  const report = await buildKillCompletionSections({ sessionName: 's', sessionInfo, statusResult: { logPath: '/solve.log' }, exitCode: 1, status: 'failed', readFile: async () => log, statFile: async () => ({ mtimeMs: Date.parse('2026-10-17T10:05:01.000Z') }) });
  assert.equal(report.oomEventOnly, true);
  assert.equal(report.noticeSkippedReason, 'reported-in-process');
  assert.equal(report.skippedReason, null, 'only the GitHub notice is skipped, not the recovery');
  assert.ok(
    report.sections.some(section => /container OOM event/.test(section)),
    'Telegram keeps the OOM section'
  );

  const gh = createGhCommentRecorder();
  const context = { pullRequestUrl: PR, sessionName: 's', sessionInfo, killReport: report, exitCode: 1, options: { runCommand: gh.runCommand } };
  assert.equal((await announcePendingKillNotice(context)).skipped, 'reported-in-process');
  assert.equal((await finishKillNotice({ ...context, killRecovery: { resumed: false, reason: 'policy-report' } })).skipped, 'reported-in-process');
  assert.equal(gh.posts.length, 0, 'solve already posted the one comment for this kill');

  const unreported = await buildKillCompletionSections({ sessionName: 's', sessionInfo, statusResult: { logPath: '/solve.log' }, exitCode: 1, status: 'failed', readFile: async () => CLAUDE_137, statFile: async () => ({ mtimeMs: Date.parse('2026-10-17T10:05:01.000Z') }) });
  assert.equal(unreported.noticeSkippedReason, null, 'without the record the monitor still reports');
});
