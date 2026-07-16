#!/usr/bin/env node
/**
 * Unit tests for completion-message labeling of killed sessions (issue #1927,
 * requirement #1).
 *
 * The bug: an OOM-killed /solve (exit 137) was reported as "finished
 * successfully". These tests pin down the three-way outcome classification
 * (success / failure / kill) and that a kill is rendered with ❌ and an explicit
 * signal reason — never the green success message — while a synthesized status-
 * only kill (exit code unknown) does not show a misleading "(exit code: 1)".
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 */

import { classifySessionOutcome, getSessionCompletionExitCode, formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1927: killed-session completion labeling');
console.log('='.repeat(60));

// --- classifySessionOutcome ---------------------------------------------------
const oom = classifySessionOutcome({ exitCode: 137, status: 'executing' });
assert(oom.killed === true, 'exit 137 → killed');
assert(oom.failed === true, 'exit 137 → failed (a kill is a failure)');
assert(oom.signal && oom.signal.signal === 'SIGKILL', 'exit 137 → SIGKILL signal');

const term = classifySessionOutcome({ exitCode: 143, status: null });
assert(term.killed === true && term.signal.signal === 'SIGTERM', 'exit 143 → killed via SIGTERM');

const plainFail = classifySessionOutcome({ exitCode: 1, status: null });
assert(plainFail.failed === true, 'exit 1 → failed');
assert(plainFail.killed === false, 'exit 1 → NOT killed (no signal)');
assert(plainFail.signal === null, 'exit 1 → no signal');

const success = classifySessionOutcome({ exitCode: 0, status: 'executed' });
assert(success.failed === false && success.killed === false, 'exit 0 → success (not failed, not killed)');

// Status-only kill: the backend vanished, exit code unknown, but status says killed.
const statusKill = classifySessionOutcome({ exitCode: null, status: 'killed' });
assert(statusKill.killed === true, 'status "killed" with no exit code → killed');
const oomStatus = classifySessionOutcome({ exitCode: null, status: 'oom-killed' });
assert(oomStatus.killed === true, 'status "oom-killed" → killed');

// --- getSessionCompletionExitCode ---------------------------------------------
assert(getSessionCompletionExitCode({ exitCode: 137 }) === 137, 'explicit exitCode 137 wins');
assert(getSessionCompletionExitCode({ exitCode: null, statusResult: { exitCode: 143 } }) === 143, 'falls back to statusResult.exitCode');
assert(getSessionCompletionExitCode({ exitCode: null, statusResult: { status: 'killed' } }) === 1, 'a failure status with no code synthesizes exit 1');
assert(getSessionCompletionExitCode({ exitCode: null, statusResult: { status: 'executed' } }) === null, 'a success status with no code stays null');
assert(getSessionCompletionExitCode({ exitCode: 0 }) === 0, 'explicit exitCode 0 is preserved (not treated as missing)');

// --- formatSessionCompletionMessage (the regression) --------------------------
const baseArgs = {
  sessionName: 'sess-1927',
  sessionInfo: { isolationBackend: 'screen', startTime: new Date('2026-06-14T19:00:00.000Z') },
  observedEndTime: new Date('2026-06-14T19:10:49.822Z'),
};

const oomMessage = formatSessionCompletionMessage({
  ...baseArgs,
  statusResult: { status: 'killed', exitCode: 137, startTime: '2026-06-14T19:00:00.000Z', endTime: '2026-06-14T19:10:49.822Z' },
  exitCode: 137,
});
assert(oomMessage.startsWith('❌'), 'OOM-killed message starts with ❌ (never the ✅ success badge)');
assert(/Work session killed/.test(oomMessage), 'OOM-killed message says "Work session killed"');
assert(/SIGKILL/.test(oomMessage), 'OOM-killed message names the SIGKILL signal');
assert(/exit code: 137/.test(oomMessage), 'OOM-killed message shows the real exit code 137');
assert(!/finished successfully/.test(oomMessage), 'OOM-killed message NEVER says "finished successfully"');

const sigtermMessage = formatSessionCompletionMessage({
  ...baseArgs,
  statusResult: { status: 'terminated', exitCode: 143 },
  exitCode: 143,
});
assert(sigtermMessage.startsWith('❌') && /SIGTERM/.test(sigtermMessage) && /exit code: 143/.test(sigtermMessage), 'SIGTERM message shows ❌ + SIGTERM + exit code 143');

// Status-only kill: exit code is the synthesized sentinel 1 → must NOT be shown.
const statusOnlyKill = formatSessionCompletionMessage({
  ...baseArgs,
  statusResult: { status: 'killed' },
  exitCode: null,
});
assert(statusOnlyKill.startsWith('❌'), 'status-only kill starts with ❌');
assert(/Work session killed/.test(statusOnlyKill), 'status-only kill says "Work session killed"');
assert(!/exit code: 1\b/.test(statusOnlyKill), 'status-only kill suppresses the misleading "(exit code: 1)" sentinel');

const failMessage = formatSessionCompletionMessage({
  ...baseArgs,
  statusResult: { status: 'failed', exitCode: 1 },
  exitCode: 1,
});
assert(failMessage.startsWith('❌'), 'plain failure starts with ❌');
assert(/Work session failed/.test(failMessage) && /exit code: 1/.test(failMessage), 'plain failure shows "failed (exit code: 1)"');
assert(!/killed/.test(failMessage), 'plain failure is NOT labeled killed');

const successMessage = formatSessionCompletionMessage({
  ...baseArgs,
  statusResult: { status: 'executed', exitCode: 0 },
  exitCode: 0,
});
assert(successMessage.startsWith('✅'), 'success starts with ✅');
assert(/finished successfully/.test(successMessage), 'success says "finished successfully"');
assert(/sess-1927/.test(successMessage), 'completion message includes the session name');

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
