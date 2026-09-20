#!/usr/bin/env node
/**
 * Unit tests for the shared session-status vocabulary (issue #1927).
 *
 * This module is the single source of truth that maps a raw process exit code to
 * a signal/kill label and decides whether a status string is running / terminal /
 * a failure / a kill. The OOM-killed /solve that started this issue exited 137
 * (128 + SIGKILL); these tests pin down that 137/139 read as a *kill*, 143/130
 * read as an orderly *termination*, and the status Sets agree across layers.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1927
 */

import { normalizeExitCode, classifyExitStatus, describeExitSignal, isExecutingSessionStatus, isTerminalSessionStatus, isKilledSessionStatus, isFailureSessionStatus, RUNNING_SESSION_STATUSES, KILLED_SESSION_STATUSES, FAILURE_SESSION_STATUSES, TERMINAL_SESSION_STATUSES } from '../src/session-status.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

console.log('Testing issue #1927: session-status vocabulary & exit-code classification');
console.log('='.repeat(60));

// --- normalizeExitCode --------------------------------------------------------
assert(normalizeExitCode(0) === 0, 'normalizeExitCode(0) === 0 (success is not "missing")');
assert(normalizeExitCode(137) === 137, 'normalizeExitCode(137) === 137');
assert(normalizeExitCode('143') === 143, 'normalizeExitCode("143") coerces numeric strings');
assert(normalizeExitCode(null) === null, 'normalizeExitCode(null) === null');
assert(normalizeExitCode(undefined) === null, 'normalizeExitCode(undefined) === null');
assert(normalizeExitCode('') === null, 'normalizeExitCode("") === null');
assert(normalizeExitCode('not-a-number') === null, 'normalizeExitCode(non-numeric) === null');
assert(normalizeExitCode(-1) === -1, 'normalizeExitCode(-1) preserves the sentinel');

// --- describeExitSignal -------------------------------------------------------
assert(describeExitSignal(0) === null, 'describeExitSignal(0) === null (not a signal)');
assert(describeExitSignal(1) === null, 'describeExitSignal(1) === null (ordinary failure)');
assert(describeExitSignal(128) === null, 'describeExitSignal(128) === null (boundary, not a signal)');

const sigkill = describeExitSignal(137);
assert(sigkill && sigkill.signal === 'SIGKILL', 'describeExitSignal(137).signal === SIGKILL');
assert(sigkill.signalNumber === 9, 'describeExitSignal(137).signalNumber === 9');
assert(/SIGKILL/.test(sigkill.reason) && /memory|kill/i.test(sigkill.reason), 'SIGKILL reason mentions OOM/forced kill');

const sigterm = describeExitSignal(143);
assert(sigterm && sigterm.signal === 'SIGTERM' && sigterm.signalNumber === 15, 'describeExitSignal(143) === SIGTERM (15)');

const sigsegv = describeExitSignal(139);
assert(sigsegv && sigsegv.signal === 'SIGSEGV' && sigsegv.signalNumber === 11, 'describeExitSignal(139) === SIGSEGV (11)');

const sigint = describeExitSignal(130);
assert(sigint && sigint.signal === 'SIGINT' && sigint.signalNumber === 2, 'describeExitSignal(130) === SIGINT (2)');

const unknownSignal = describeExitSignal(200);
assert(unknownSignal && unknownSignal.signalNumber === 72 && /signal 72/.test(unknownSignal.reason), 'describeExitSignal(200) falls back to SIG72 with a generic reason');

// --- classifyExitStatus -------------------------------------------------------
assert(classifyExitStatus(0) === 'executed', 'classifyExitStatus(0) === executed');
assert(classifyExitStatus(137) === 'killed', 'classifyExitStatus(137) === killed (SIGKILL/OOM)');
assert(classifyExitStatus(139) === 'killed', 'classifyExitStatus(139) === killed (SIGSEGV)');
assert(classifyExitStatus(143) === 'terminated', 'classifyExitStatus(143) === terminated (SIGTERM is orderly)');
assert(classifyExitStatus(130) === 'terminated', 'classifyExitStatus(130) === terminated (SIGINT is orderly)');
assert(classifyExitStatus(1) === 'failed', 'classifyExitStatus(1) === failed (ordinary non-zero)');
assert(classifyExitStatus(2) === 'failed', 'classifyExitStatus(2) === failed');
assert(classifyExitStatus(null) === null, 'classifyExitStatus(null) === null (unknown)');

// --- status predicates --------------------------------------------------------
assert(isExecutingSessionStatus('executing'), 'isExecutingSessionStatus(executing)');
assert(isExecutingSessionStatus('running'), 'isExecutingSessionStatus(running)');
assert(isExecutingSessionStatus('  EXECUTING  '), 'isExecutingSessionStatus trims and lowercases');
assert(!isExecutingSessionStatus('executed'), '!isExecutingSessionStatus(executed)');

assert(isTerminalSessionStatus('executed'), 'isTerminalSessionStatus(executed)');
assert(isTerminalSessionStatus('completed'), 'isTerminalSessionStatus(completed)');
assert(isTerminalSessionStatus('killed'), 'isTerminalSessionStatus(killed)');
assert(isTerminalSessionStatus('failed'), 'isTerminalSessionStatus(failed)');
assert(!isTerminalSessionStatus('executing'), '!isTerminalSessionStatus(executing)');

assert(isKilledSessionStatus('killed'), 'isKilledSessionStatus(killed)');
assert(isKilledSessionStatus('oom-killed'), 'isKilledSessionStatus(oom-killed)');
assert(isKilledSessionStatus('SIGKILL'), 'isKilledSessionStatus(SIGKILL) is case-insensitive');
assert(isKilledSessionStatus('terminated'), 'isKilledSessionStatus(terminated) — SIGTERM kills count as kills');
assert(!isKilledSessionStatus('executed'), '!isKilledSessionStatus(executed)');
assert(!isKilledSessionStatus('failed'), '!isKilledSessionStatus(failed) — a plain failure is not a kill');

assert(isFailureSessionStatus('failed'), 'isFailureSessionStatus(failed)');
assert(isFailureSessionStatus('timeout'), 'isFailureSessionStatus(timeout)');
assert(isFailureSessionStatus('killed'), 'isFailureSessionStatus(killed) — kills are failures');
assert(!isFailureSessionStatus('executed'), '!isFailureSessionStatus(executed) — success is not a failure');
assert(!isFailureSessionStatus('executing'), '!isFailureSessionStatus(executing)');

// --- Set relationships (cross-layer agreement) --------------------------------
assert(RUNNING_SESSION_STATUSES.has('executing'), 'RUNNING set contains executing');
assert(
  [...KILLED_SESSION_STATUSES].every(s => FAILURE_SESSION_STATUSES.has(s)),
  'KILLED ⊆ FAILURE'
);
assert(
  [...FAILURE_SESSION_STATUSES].every(s => TERMINAL_SESSION_STATUSES.has(s)),
  'FAILURE ⊆ TERMINAL'
);
assert(TERMINAL_SESSION_STATUSES.has('executed') && !FAILURE_SESSION_STATUSES.has('executed'), 'executed is terminal but not a failure');
assert(![...RUNNING_SESSION_STATUSES].some(s => TERMINAL_SESSION_STATUSES.has(s)), 'RUNNING and TERMINAL are disjoint');

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
