/**
 * @hive-mind-test-suite default
 *
 * Issue #4091 (criteria c, e, f and g):
 *
 *  - c: the Telegram `/solve` reply shows the watch phase (blocker, time since
 *    start, deadline), refreshed at least every 10 minutes; `⏳ Executing...` is
 *    shown only while the AI runs.
 *  - e: a log comment does not say "working session is ended" while monitoring
 *    continues; a `Monitoring Ended` decision comment closes that promise.
 *  - f: `/stop` (CTRL+C, then SIGKILL after start-command's grace) during the
 *    watch loop: the loop parks before its next GitHub call, the interrupt
 *    handler uploads only the log tail and says "stopped by operator" with the
 *    last phase and blocker; the kill notice says the same.
 *  - g: watch-loop console lines carry ISO-8601 UTC timestamps, and markers
 *    behind a timestamp are still parsed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { readFileSync } from 'node:fs';
import { SOLVE_PROGRESS_REFRESH_MS, describeSolveProgressForDiagnostics, emitSolveProgress, formatSolveProgressStatus, getLastSolveProgress, parseSolveProgressEvent, reportSolveProgress, resetSolveProgressForTests, solveProgressLogLine } from '../src/solve-progress.lib.mjs';
import { AI_SESSION_ENDED_MONITORING_CONTINUES_MARKER, MONITORING_ENDED_MARKER, NOW_WORKING_SESSION_IS_ENDED_MARKER, buildSessionEndFooter, markMonitoringEnded, monitoringFollowsSession, noteMonitoringPromisePublished, resetSessionFooterStateForTests, wasMonitoringPromisePublished } from '../src/tool-comments.lib.mjs';
import { buildMonitoringEndedComment, createWatchProgress, finishWatch, runWatchWithProgress } from '../src/solve.watch-progress.lib.mjs';
import { createInterruptWrapper } from '../src/solve.interrupt.lib.mjs';
import { noteUploadedLogSize, prepareInterruptedLogUpload, resetUploadedLogSizesForTests } from '../src/log-upload-snapshot.lib.mjs';
import { describeKillCause } from '../src/session-kill-diagnostics.lib.mjs';
import { buildKillRecoveryNotice } from '../src/session-kill-recovery.lib.mjs';
import { markShutdownInProgress, parkIfShuttingDown, resetShutdownStateForTests } from '../src/interruptible-sleep.lib.mjs';
import { withConsoleTimestamp } from '../src/lib.mjs';

const T0 = Date.parse('2026-11-19T02:00:00Z');
const MINUTE = 60_000;
const src = file => readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');

/** The watch marker the incident would have printed at check #135. */
const watchEvent = (overrides = {}) => ({ phase: 'watch', check: 135, blocker: 'ci_not_started', blockerLabel: 'CI runs that have not started', detail: '1 run held by a concurrency queue (pending) for 4h', since: new Date(T0).toISOString(), deadline: '2026-11-19T04:15:00.000Z', at: '2026-11-19T03:00:00.000Z', ...overrides });

// ---------------------------------------------------------------- (c) Telegram status

test('(c) the watch-phase status shows phase, blocker, time since start and deadline', () => {
  const status = formatSolveProgressStatus(watchEvent(), { now: T0 + 65 * MINUTE });
  assert.match(status, /Monitoring the pull request until it is mergeable/);
  assert.match(status, /Waiting for: CI runs that have not started: 1 run held by a concurrency queue \(pending\) for 4h/);
  assert.match(status, /Check #135 · monitoring for 1h 5m · gives up at 2026-11-19 04:15 UTC/);
  assert.match(status, /Status updated 2026-11-19 03:00 UTC/);
  assert.doesNotMatch(status, /Executing/);
});

test('(c) "⏳ Executing..." only for the AI phase; the log upload has its own status', () => {
  assert.equal(formatSolveProgressStatus({ phase: 'executing' }), '⏳ Executing...');
  assert.match(formatSolveProgressStatus({ phase: 'uploading-log' }), /Uploading the session log/);
  for (const event of [watchEvent(), { phase: 'uploading-log' }]) assert.doesNotMatch(formatSolveProgressStatus(event), /Executing/);
});

test('(c) the reply is refreshed at least every 10 minutes while the watch phase does not change', async () => {
  const log = ['AI output…', solveProgressLogLine({ phase: 'executing', at: '2026-11-19T01:00:00.000Z' }), solveProgressLogLine({ phase: 'uploading-log', at: '2026-11-19T01:50:00.000Z' }), `[2026-11-19T02:00:00.000Z] ${solveProgressLogLine(watchEvent())}`].join('\n');
  const sessionInfo = { command: 'solve', logPath: '/tmp/solve.log', chatId: 1, messageId: 2 };
  const edits = [];
  const bot = { telegram: {} };
  // The session monitor polls every 30 s; one hour of an unchanged blocker.
  for (let at = T0; at <= T0 + 60 * MINUTE; at += 30_000) {
    await reportSolveProgress({ bot, sessionName: 's1', sessionInfo, now: at, readTail: async () => log, editMessage: async (_telegram, _chat, _message, _inline, text) => edits.push({ at, text }) });
  }
  assert.ok(SOLVE_PROGRESS_REFRESH_MS <= 10 * MINUTE);
  assert.ok(edits.length >= 7, `expected a refresh every ${SOLVE_PROGRESS_REFRESH_MS / MINUTE} min, got ${edits.length} edits`);
  const times = [...edits.map(edit => edit.at), T0 + 60 * MINUTE];
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] <= 10 * MINUTE, `gap of ${(times[i] - times[i - 1]) / MINUTE} min`);
  assert.match(edits[0].text, /monitoring for 0s/);
  assert.match(edits.at(-1).text, /monitoring for 1h 0m/);
  assert.equal(sessionInfo.solveProgress.phase, 'watch');
  assert.match(sessionInfo.solveProgress.header, /Waiting for: CI runs that have not started/);
});

test('(c) before any marker the reply is left alone; after an AI restart it goes back to "⏳ Executing..." once', async () => {
  const sessionInfo = { command: 'solve', logPath: '/tmp/solve.log', chatId: 1, messageId: 2 };
  const edits = [];
  const report = (tail, now) => reportSolveProgress({ bot: { telegram: {} }, sessionName: 's1', sessionInfo, now, readTail: async () => tail, editMessage: async (...args) => edits.push(args[4]) });
  assert.equal(await report('AI output only', T0), null, 'no marker yet: the AI runs, the reply already says Executing');
  await report(solveProgressLogLine(watchEvent()), T0);
  await report('AI output after the restart, no marker in the tail', T0 + MINUTE);
  await report('more AI output', T0 + 2 * MINUTE);
  assert.equal(edits.length, 2);
  assert.match(edits[0], /Monitoring the pull request/);
  assert.match(edits[1], /⏳ Executing\.\.\./);
  // A finished marker leaves the reply to the completion message.
  assert.equal(await report(solveProgressLogLine({ phase: 'finished', reason: 'mergeable' }), T0 + 20 * MINUTE), null);
});

test('(c) solve prints the executing marker when the AI starts and the uploading-log marker for every upload', () => {
  assert.match(src('solve.mjs'), /beginWorkingSession\(\);[^\n]*\n\s*\(await import\('\.\/solve-progress\.lib\.mjs'\)\)\.emitSolveProgress\(\{ phase: 'executing'/);
  assert.match(src('solve.restart-shared.lib.mjs'), /emitSolveProgress\(\{ phase: 'executing'/);
  assert.match(src('github.lib.mjs'), /emitSolveProgress\(\{ phase: 'uploading-log'/);
  assert.match(src('session-monitor.lib.mjs'), /reportSolveProgress\)\(\{ bot, sessionName, sessionInfo/);
});

test('(c) createWatchProgress marks every check, then what it found', () => {
  const events = [];
  const progress = createWatchProgress({ watchStartedAt: T0, watchTimeoutHours: 6, emit: event => events.push(event) });
  progress.startCheck(3);
  progress.report({ blockers: [{ type: 'ci_pending', details: ['CI / test is in progress'] }] });
  assert.deepEqual(events[0], { phase: 'watch', check: 3, blocker: 'checking', blockerLabel: 'the next GitHub check', detail: null, since: '2026-11-19T02:00:00.000Z', deadline: '2026-11-19T08:00:00.000Z' });
  assert.equal(events[1].blocker, 'ci_pending');
  assert.equal(events[1].detail, 'CI / test is in progress');
});

// ---------------------------------------------------------------- (e) comments

test('(e) the log comment footer does not end the working session while monitoring continues', () => {
  resetSessionFooterStateForTests();
  const watching = buildSessionEndFooter({ monitoringContinues: true });
  assert.ok(!watching.includes(NOW_WORKING_SESSION_IS_ENDED_MARKER));
  assert.ok(watching.includes(AI_SESSION_ENDED_MONITORING_CONTINUES_MARKER));
  assert.ok(watching.includes(`a final "${MONITORING_ENDED_MARKER}" comment will report the decision`));
  assert.ok(buildSessionEndFooter().includes(NOW_WORKING_SESSION_IS_ENDED_MARKER));
  assert.equal(monitoringFollowsSession({ autoRestartUntilMergeable: true }), true);
  assert.equal(monitoringFollowsSession({ autoMerge: true }), true);
  assert.equal(monitoringFollowsSession({}), false);
  markMonitoringEnded();
  assert.equal(monitoringFollowsSession({ autoRestartUntilMergeable: true }), false, 'once monitoring ended, later comments end the session');
  resetSessionFooterStateForTests();
  assert.match(src('github.lib.mjs'), /buildSessionEndFooter\(\{ monitoringContinues \}\)/);
});

test('(e) the end of monitoring posts a decision comment only when a log comment promised one', async () => {
  resetSessionFooterStateForTests();
  const posts = [];
  const events = [];
  const logs = [];
  const finish = () => finishWatch({ result: { success: false, reason: 'ci_not_started' }, watchStartedAt: T0, checks: 4, $: () => {}, owner: 'o', repo: 'r', prNumber: 7, log: async line => logs.push(line), emit: event => events.push(event), post: async args => (posts.push(args), { ok: true }), now: T0 + 15 * MINUTE });
  assert.deepEqual(await finish(), { posted: false });
  assert.equal(posts.length, 0);
  assert.deepEqual(events[0], { phase: 'finished', decision: 'stopped', reason: 'ci_not_started', check: 4, since: '2026-11-19T02:00:00.000Z' });

  resetSessionFooterStateForTests();
  noteMonitoringPromisePublished();
  assert.equal(wasMonitoringPromisePublished(), true);
  assert.deepEqual(await finish(), { posted: true });
  assert.equal(posts.length, 1);
  assert.equal(posts[0].targetNumber, 7);
  const body = posts[0].body;
  assert.match(body, /## 🏁 Monitoring Ended/);
  assert.match(body, /Monitoring of this pull request ended after 15m \(4 checks\)\./);
  assert.match(body, /\*\*Decision:\*\* monitoring stopped: .+ \(reason code `ci_not_started`\)\./);
  assert.ok(body.includes(NOW_WORKING_SESSION_IS_ENDED_MARKER), 'the decision comment is the one that ends the session');
  assert.ok(logs.some(line => line.includes('Posted "Monitoring Ended" decision to #7: ci_not_started')));
  assert.equal(monitoringFollowsSession({ autoRestartUntilMergeable: true }), false);
  resetSessionFooterStateForTests();
});

test('(e) decision texts for a merged and a mergeable pull request', () => {
  assert.match(buildMonitoringEndedComment({ result: { success: true, reason: 'mergeable' }, checks: 1 }), /\*\*Decision:\*\* the pull request is mergeable/);
  assert.match(buildMonitoringEndedComment({ result: { success: true, reason: 'merged' }, checks: 2 }), /\(2 checks\)\.\n\n\*\*Decision:\*\* the pull request was merged\./);
});

// ---------------------------------------------------------------- (f) /stop

test('(f) after /stop the watch loop parks before its next GitHub call', async () => {
  resetShutdownStateForTests();
  const logs = [];
  let parked = 0;
  await parkIfShuttingDown(async line => logs.push(line), undefined, { park: async () => parked++ });
  assert.equal(parked, 0, 'no shutdown: returns at once');
  markShutdownInProgress('SIGINT');
  await parkIfShuttingDown(
    async line => logs.push(line),
    reason => `🛑 Monitoring stopped: ${reason} received`,
    { park: async () => parked++ }
  );
  assert.equal(parked, 1);
  assert.deepEqual(logs, ['🛑 Monitoring stopped: SIGINT received']);
  resetShutdownStateForTests();

  // Wiring: the loop parks at the start of every check and right after the probe, before any restart or upload.
  const loop = src('solve.auto-merge.lib.mjs');
  assert.match(loop, /while \(true\) \{\n[^\n]*\n\s*await parkOnShutdown\(\);\n\s*watch\.checks = \+\+iteration;/);
  assert.match(loop, /stallGuard\.probeCheck\(iteration, \(\) => getMergeBlockers\([^)]*\), parkOnShutdown\)/);
});

test('(f) the interrupted log upload holds only what was not uploaded yet, capped', async () => {
  resetUploadedLogSizesForTests();
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-4091-tail-'));
  const logFile = path.join(dir, 'solve.log');
  try {
    await fs.writeFile(logFile, Buffer.concat([Buffer.alloc(3000, 'a'), Buffer.from('\nafter the last upload\n')]));
    const small = await prepareInterruptedLogUpload({ logFile, maxBytes: 10_000 });
    assert.equal(small.tail, false, 'a small log that was never uploaded goes up whole');
    noteUploadedLogSize(logFile, 3000);
    const tail = await prepareInterruptedLogUpload({ logFile, maxBytes: 10_000 });
    assert.equal(tail.tail, true);
    assert.equal(tail.fromByte, 3000);
    assert.match(tail.description, /since the last upload \(bytes 3000–3023 of 3023/);
    const content = await fs.readFile(tail.logFile, 'utf8');
    assert.match(content, /^\[hive-mind\] Interrupted session: the session log tail since the last upload/);
    assert.ok(content.endsWith('\nafter the last upload\n'));
    assert.ok(!content.includes('aaaa'));
    const capped = await prepareInterruptedLogUpload({ logFile, maxBytes: 10 });
    assert.equal(capped.toByte - capped.fromByte, 10);
    assert.match(capped.description, /the oldest .* of it skipped to fit/);
  } finally {
    resetUploadedLogSizesForTests();
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('(f) the interrupt handler names the last phase and uploads the log tail', async () => {
  const logs = [];
  const attached = [];
  const interrupt = createInterruptWrapper({
    cleanupContext: { tempDir: '/tmp/x', argv: { model: 'm', tool: 'claude' }, prNumber: 7, owner: 'o', repo: 'r' },
    checkForUncommittedChanges: async () => {},
    shouldAttachLogs: true,
    attachLogToGitHub: async options => attached.push(options),
    getLogFile: () => '/tmp/solve.log',
    sanitizeLogContent: s => s,
    $: async () => ({ stdout: '[]', code: 0 }),
    log: async line => logs.push(line),
    getLastProgress: () => watchEvent({ blocker: 'ci_pending', detail: 'W pending' }),
    prepareUpload: async () => ({ logFile: '/tmp/solve.log.interrupted-tail.log', tail: true, description: 'the session log tail since the last upload (bytes 10–20 of 20)' }),
  });
  await interrupt();
  const phase = 'phase `watch_until_mergeable`, check #135, waiting for ci_pending: W pending, since 2026-11-19T02:00:00.000Z, deadline 2026-11-19T04:15:00.000Z, last heartbeat 2026-11-19T03:00:00.000Z';
  assert.ok(logs.includes(`🛑 Stopped by operator (CTRL+C or /stop) during ${phase}`), logs.join('\n'));
  assert.equal(attached.length, 1);
  assert.equal(attached[0].logFile, '/tmp/solve.log.interrupted-tail.log');
  assert.equal(attached[0].customTitle, '🤖 Interrupted session log (tail since the last upload)');
  assert.equal(attached[0].errorMessage, `Session interrupted by user (CTRL+C) — stopped by operator during ${phase}. This comment holds the session log tail since the last upload (bytes 10–20 of 20).`);
});

test('(f) the kill notice after /stop says "stopped by operator" with the last phase and blocker', () => {
  const logText = ['AI output', `[2026-11-19T03:00:00.000Z] ${solveProgressLogLine(watchEvent({ blocker: 'ci_pending', detail: 'W pending' }))}`, '⚠️  Session interrupted by user (CTRL+C)'].join('\n');
  const diagnosis = describeKillCause({ logText, exitCode: 137 });
  assert.equal(diagnosis.stoppedByOperator, true);
  assert.match(diagnosis.lastPhase, /^phase `watch_until_mergeable`, check #135, waiting for ci_pending: W pending/);
  assert.match(diagnosis.summary, /^stopped by operator \(\/stop\) — CTRL\+C was sent, then the process was killed during phase `watch_until_mergeable`/);
  const notice = buildKillRecoveryNotice({ diagnosis, exitCode: 137, sessionName: 's1' });
  assert.match(notice, /## 🛑 Working session stopped by operator \(\/stop\)/);
  assert.match(notice, /- \*\*Last phase:\*\* phase `watch_until_mergeable`, check #135, waiting for ci_pending: W pending/);
  assert.match(notice, /It is not resumed automatically/);

  // Without the interrupt line and without an operator request, a SIGKILL stays a plain forced kill.
  assert.equal(describeKillCause({ logText: 'AI output', exitCode: 137 }).stoppedByOperator, false);
});

test('(f) describeSolveProgressForDiagnostics and the remembered last marker', () => {
  resetSolveProgressForTests();
  assert.equal(getLastSolveProgress(), null);
  const lines = [];
  emitSolveProgress(watchEvent(), { write: line => lines.push(line) });
  assert.equal(getLastSolveProgress().check, 135);
  assert.match(lines[0], /^\[HIVE-MIND SOLVE\] \{"phase":"watch"/);
  assert.equal(describeSolveProgressForDiagnostics({ phase: 'uploading-log', since: 'S' }), 'phase `uploading-log`, since S');
  resetSolveProgressForTests();
});

// ---------------------------------------------------------------- (g) timestamps

test('(g) withConsoleTimestamp prefixes every non-empty line with an ISO-8601 UTC time', () => {
  const now = new Date('2026-11-19T03:04:05.678Z');
  assert.equal(withConsoleTimestamp('🔄 Check #3:\n\n   CI pending', { enabled: true, now }), '[2026-11-19T03:04:05.678Z] 🔄 Check #3:\n\n[2026-11-19T03:04:05.678Z]    CI pending');
  assert.equal(withConsoleTimestamp('unchanged', { enabled: false, now }), 'unchanged');
});

test('(g) a timestamped marker line is still a marker', () => {
  const event = parseSolveProgressEvent(`noise\n[2026-11-19T03:04:05.678Z] ${solveProgressLogLine(watchEvent())}\nmore noise`);
  assert.equal(event.check, 135);
});

test('(g) the watch loop runs with timestamps on, restores them and always finishes', async () => {
  let enabled = false;
  const seen = [];
  const lib = { isConsoleTimestampsEnabled: () => enabled, setConsoleTimestamps: value => (enabled = value) };
  const finished = [];
  const result = await runWatchWithProgress({
    params: { owner: 'o', repo: 'r', prNumber: 7 },
    lib,
    run: async (_params, watch) => {
      seen.push(enabled);
      watch.checks = 5;
      return { success: true, reason: 'mergeable' };
    },
    finish: async args => finished.push(args),
  });
  assert.deepEqual(result, { success: true, reason: 'mergeable' });
  assert.deepEqual(seen, [true]);
  assert.equal(enabled, false);
  assert.equal(finished[0].checks, 5);
  assert.equal(finished[0].prNumber, 7);

  await assert.rejects(
    runWatchWithProgress({
      params: {},
      lib,
      run: async () => {
        throw new Error('boom');
      },
      finish: async args => finished.push(args),
    }),
    /boom/
  );
  assert.deepEqual(finished[1].result, { success: false, reason: 'watch_error' }, 'an error still ends monitoring with a decision');
  assert.equal(enabled, false);

  // AI restarts inside the loop print their own output without timestamps.
  assert.match(src('solve.restart-shared.lib.mjs'), /lib\.setConsoleTimestamps\?\.\(false\);\n\s*emitSolveProgress\(\{ phase: 'executing'/);
});
