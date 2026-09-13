#!/usr/bin/env node

/**
 * Regression coverage for issue #2247 (H3).
 *
 * Two of the three 2026-09-13 `solve --model formal-ai` reproduction runs
 * restarted five times with nothing changing between the sessions:
 *
 *   - Scala (`--tool agent`): each session wrote `Main.scala`, hit
 *     `/bin/sh: 1: scala: not found`, reported "Created and verified" and
 *     committed nothing, so every session ended with the same final message and
 *     the same one-line `git status --porcelain`;
 *   - Rust (`--tool codex`): each session echoed the same raw issue JSON and
 *     changed nothing at all.
 *
 * The issue's fix: "after each restart hash the final assistant message and
 * `git status --porcelain`; on the second identical pair stop, post one
 * *no progress between sessions* comment linking both logs, leave remaining
 * budget unused."
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { NO_PROGRESS_STOP_REASON, buildNoProgressDetails, buildSessionFingerprint, captureSessionOutcome, getLastSessionProgress, getRecordedSessions, normalizeSessionMessage, recordSessionOutcome, resetSessionProgress } from '../src/session-progress.lib.mjs';
import { STOP_REASONS, buildAutomationStopComment, describeStopReason } from '../src/automation-stop-reporting.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// The Scala run, reduced to what a session actually ended with.
const SCALA_MESSAGE = 'Created and verified Main.scala with Hello, World! output.';
const SCALA_STATUS = '?? Main.scala';
const SCALA_HEAD = '1111111111111111111111111111111111111111';

const scalaSession = (n, overrides = {}) => ({ finalMessage: SCALA_MESSAGE, gitStatus: SCALA_STATUS, head: SCALA_HEAD, sessionId: `scala-session-${n}`, logFile: `/tmp/scala-${n}.log`, label: `Auto-restart ${n}/5`, ...overrides });

// ---------------------------------------------------------------------------
// 1. Two identical sessions are a stall; anything that changed is not.
// ---------------------------------------------------------------------------

{
  resetSessionProgress();
  const first = recordSessionOutcome(scalaSession(1));
  assert.equal(first.repeated, false, 'the first session has nothing to compare against');
  assert.equal(first.previous, null);

  const second = recordSessionOutcome(scalaSession(2));
  assert.equal(second.repeated, true, 'the second identical session is the stall the issue describes');
  assert.equal(second.occurrences, 2);
  assert.equal(second.previous.sessionId, 'scala-session-1', 'the stop comment can name the earlier session');
  assert.equal(second.current.sessionId, 'scala-session-2');
  assert.equal(second.previous.logFile, '/tmp/scala-1.log', 'and link both logs');
  assert.equal(second.current.logFile, '/tmp/scala-2.log');
  assert.equal(getLastSessionProgress(), second, 'the restart loops read the latest verdict');
  assert.equal(getRecordedSessions().length, 2);
}

{
  // The Rust run: no working tree changes at all, same answer every time.
  resetSessionProgress();
  const json = '{"number":1,"title":"Hello World in Rust"}';
  recordSessionOutcome({ finalMessage: json, gitStatus: '', head: 'abc' });
  assert.equal(recordSessionOutcome({ finalMessage: json, gitStatus: '', head: 'abc' }).repeated, true, 'an empty working tree twice over is still a stall');
}

{
  // A session that commits has made progress, even though its final message is
  // unchanged and its working tree is now clean both times.
  resetSessionProgress();
  recordSessionOutcome({ finalMessage: SCALA_MESSAGE, gitStatus: '', head: 'aaaa' });
  assert.equal(recordSessionOutcome({ finalMessage: SCALA_MESSAGE, gitStatus: '', head: 'bbbb' }).repeated, false, 'a new commit is progress');
}

{
  // A session that wrote one more file has made progress.
  resetSessionProgress();
  recordSessionOutcome(scalaSession(1));
  assert.equal(recordSessionOutcome(scalaSession(2, { gitStatus: '?? Main.scala\n?? build.sbt' })).repeated, false, 'a changed working tree is progress');
}

{
  // Returning to an earlier state after real work is a revert, not a loop: the
  // next session may still do something new, so the run is not stopped.
  resetSessionProgress();
  recordSessionOutcome(scalaSession(1));
  recordSessionOutcome(scalaSession(2, { gitStatus: '?? Main.scala\n?? build.sbt' }));
  const third = recordSessionOutcome(scalaSession(3));
  assert.equal(third.repeated, false, 'only a back-to-back repeat stops the run');
  assert.equal(third.occurrences, 2, 'the earlier occurrence is still counted');
}

{
  // Cosmetic reflow of the same answer must not read as a different session.
  assert.equal(buildSessionFingerprint({ finalMessage: 'Created   and\nverified', gitStatus: '', head: '' }), buildSessionFingerprint({ finalMessage: 'Created and verified', gitStatus: '', head: '' }));
  assert.equal(normalizeSessionMessage('  a \n\n b  '), 'a b');
  assert.notEqual(buildSessionFingerprint({ finalMessage: 'a', gitStatus: '', head: '' }), buildSessionFingerprint({ finalMessage: 'b', gitStatus: '', head: '' }));
  // The three parts must not be able to bleed into each other.
  assert.notEqual(buildSessionFingerprint({ finalMessage: 'a', gitStatus: 'b', head: '' }), buildSessionFingerprint({ finalMessage: 'a b', gitStatus: '', head: '' }));
}

// ---------------------------------------------------------------------------
// 2. `captureSessionOutcome` reads the working tree and filters AI scratch.
// ---------------------------------------------------------------------------

const fakeDollar = responses => () => template => {
  const command = template.raw ? template.raw.join('') : String(template);
  const key = Object.keys(responses).find(candidate => command.includes(candidate));
  return Promise.resolve(responses[key] ?? { code: 1, stdout: '', stderr: '' });
};

{
  resetSessionProgress();
  const $ = fakeDollar({
    'git status --porcelain': { code: 0, stdout: '?? Main.scala\n?? .formal-ai/\n?? .playwright-mcp/\n' },
    'git rev-parse HEAD': { code: 0, stdout: `${SCALA_HEAD}\n` },
  });
  const captured = await captureSessionOutcome({ tempDir: '/tmp/task', toolResult: { resultSummary: SCALA_MESSAGE, sessionId: 'scala-session-1' }, $, logFile: '/tmp/scala-1.log', label: 'Auto-restart 1/5' });
  assert.equal(captured.current.gitStatus, '?? Main.scala', 'AI scratch directories are filtered out of the fingerprint');
  assert.equal(captured.current.head, SCALA_HEAD);
  assert.equal(captured.current.sessionId, 'scala-session-1');

  // `.formal-ai/` is rewritten by every session. Without the filter above, the
  // fingerprint would differ every time and this check could never fire on the
  // very runs that motivated it.
  const $second = fakeDollar({
    'git status --porcelain': { code: 0, stdout: '?? Main.scala\n?? .formal-ai/run-2/\n' },
    'git rev-parse HEAD': { code: 0, stdout: `${SCALA_HEAD}\n` },
  });
  const repeat = await captureSessionOutcome({ tempDir: '/tmp/task', toolResult: { resultSummary: SCALA_MESSAGE, sessionId: 'scala-session-2' }, $: $second, logFile: '/tmp/scala-2.log', label: 'Auto-restart 2/5' });
  assert.equal(repeat.repeated, true, 'churning scratch directories must not hide an otherwise identical session');
}

{
  // A failed session is fingerprinted through its error message.
  resetSessionProgress();
  const $ = fakeDollar({ 'git status --porcelain': { code: 0, stdout: '' }, 'git rev-parse HEAD': { code: 0, stdout: 'deadbeef\n' } });
  const failure = { success: false, errorInfo: { message: 'Identical tool call repeated 3 times, failing every time: mcp__playwright__browser_click({"target":""}).' } };
  await captureSessionOutcome({ tempDir: '/tmp/task', toolResult: failure, $ });
  const second = await captureSessionOutcome({ tempDir: '/tmp/task', toolResult: failure, $ });
  assert.equal(second.repeated, true, 'a session that fails the same way twice is also a stall');
}

{
  // An unreadable working tree records nothing: comparing two unknowns could
  // stop a healthy run.
  resetSessionProgress();
  const $ = () => () => Promise.reject(new Error('not a git repository'));
  assert.equal(await captureSessionOutcome({ tempDir: '/tmp/task', toolResult: {}, $ }), null);
  assert.equal(getRecordedSessions().length, 0);
  assert.equal(await captureSessionOutcome({ tempDir: null, toolResult: {}, $ }), null, 'no workspace means no fingerprint');
}

resetSessionProgress();

// ---------------------------------------------------------------------------
// 3. The stop is published once, as a comment naming both sessions.
// ---------------------------------------------------------------------------

assert.ok(Object.prototype.hasOwnProperty.call(STOP_REASONS, NO_PROGRESS_STOP_REASON), 'the reason is registered with the #2144 stop reporter');
const described = describeStopReason(NO_PROGRESS_STOP_REASON);
assert.equal(described.known, true);
assert.equal(described.canComment, true, 'the pull request is still there, so the stop must be published');

{
  const details = buildNoProgressDetails({ previous: { sessionId: 'scala-session-1', logFile: '/tmp/scala-1.log', label: 'Auto-restart 1/5' }, current: { sessionId: 'scala-session-2', logFile: '/tmp/scala-2.log', label: 'Auto-restart 2/5', gitStatus: SCALA_STATUS, head: SCALA_HEAD }, remainingIterations: 3 });
  const body = buildAutomationStopComment({ reason: NO_PROGRESS_STOP_REASON, mode: 'watch', message: 'Two consecutive AI sessions ended the same way.', details });
  assert.ok(body.includes('/tmp/scala-1.log') && body.includes('/tmp/scala-2.log'), 'the comment links both logs');
  assert.ok(body.includes('scala-session-1') && body.includes('scala-session-2'));
  assert.ok(body.includes('?? Main.scala'), 'and shows the working tree both sessions left behind');
  assert.ok(body.includes('3 restart iterations of the configured budget were left unused'), 'and states that the budget was deliberately not spent');
  assert.ok(body.includes(NO_PROGRESS_STOP_REASON));
}

{
  const details = buildNoProgressDetails({ previous: null, current: { gitStatus: '' }, remainingIterations: null });
  assert.ok(
    details.some(line => line.includes('Neither session left anything uncommitted')),
    'the Rust run left an empty working tree'
  );
  assert.ok(!details.some(line => line.includes('left unused')), 'an unlimited budget has no remaining count to report');
}

// A long status is truncated so the comment stays readable.
{
  const status = Array.from({ length: 25 }, (_, i) => `?? file-${i}.txt`).join('\n');
  const details = buildNoProgressDetails({ current: { gitStatus: status } });
  assert.ok(details.some(line => line.includes('... and 15 more')));
}

// ---------------------------------------------------------------------------
// 4. Every session is fingerprinted, and both restart loops honour the verdict.
// ---------------------------------------------------------------------------

const read = async relativePath => readFile(join(repoRoot, relativePath), 'utf8');

const restartShared = await read('src/solve.restart-shared.lib.mjs');
assert.ok(restartShared.includes("'./session-progress.lib.mjs'"), 'the shared restart chokepoint records every restart session');
assert.ok(restartShared.includes('const sessionProgress = await captureSessionOutcome({ tempDir, toolResult, $, log'), 'it fingerprints the session it just ran');

const solveMain = await read('src/solve.mjs');
assert.ok(/captureSessionOutcome\(\{ tempDir, toolResult, \$, log, logFile: getLogFile\(\), label: 'Primary session' \}\)/.test(solveMain), 'the primary session is fingerprinted too, so the first restart can already be refused');

for (const [file, mode] of [
  ['src/solve.watch.lib.mjs', 'watch'],
  ['src/solve.auto-merge.lib.mjs', 'auto-restart-until-mergeable'],
]) {
  const source = await read(file);
  assert.ok(source.includes('failOnNoProgressBetweenSessions'), `${file} stops on a repeated session`);
  assert.ok(source.includes('const sessionProgress = getLastSessionProgress();'), `${file} reads the verdict of the session it just ran`);
  assert.ok(source.includes(`mode: '${mode}'`), `${file} names itself in the stop comment`);
  assert.ok(source.includes('remainingIterations: getRemainingAutoRestartIterations()'), `${file} reports the budget it left unused`);
  // The check must come before the budget is charged for another iteration.
  assert.ok(source.indexOf('failOnNoProgressBetweenSessions({') < source.indexOf('consumeAutoRestartIteration();', source.indexOf('failOnNoProgressBetweenSessions({')), `${file} stops before claiming another iteration`);
}

const finalize = await read('src/solve.finalize.lib.mjs');
assert.ok(finalize.includes('hasNoProgressFailure()'), 'the run exits non-zero: the task is unfinished');
assert.ok(/safeExit\(1, 'No progress between sessions'\)/.test(finalize));

console.log('PASS: issue #2247 (H3) no-progress-between-sessions detection');
