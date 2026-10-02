/**
 * Who ended a failed work session: the OOM event, or solve itself? (issue #2408)
 *
 * Docker's `State.OOMKilled` is a container-wide flag: moby sets it on every
 * OOM event of the container cgroup (daemon/monitor.go, `EventOOM`) and clears
 * it only when the container starts again (daemon/container/state.go,
 * `SetRunning`). Once any child is OOM-killed it stays `true`, so every later
 * exit of the container carries it. Issue #2301 resumes a session that exits with an
 * ordinary failure after such an event, because the lost child usually *is* why
 * the work failed.
 *
 * Issue #2408 showed the exception. The first session of link-foundation/
 * meta-language#196 survived an OOM event at 22:47 and then worked for another
 * eight hours, until solve stopped on purpose at 07:08 — "❌ Auto-restart limit
 * reached after 5 iterations". That exit 1 was a decision, not an OOM casualty,
 * yet it spent the whole OOM recovery budget, so the second, real OOM kill could
 * not be recovered and was announced as "❌ failed" six times over.
 *
 * When solve wrote one of the deliberate stop markers below at the end of its
 * log, the failure is solve's own verdict: it is reported (with the OOM event as
 * a warning) but not "recovered" by running the same command again.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2408
 */

import { readLogTailText } from './log-bounded-read.lib.mjs';

/** How much of the log end to scan; the markers are within the last few KB. */
export const DELIBERATE_STOP_TAIL_BYTES = 64 * 1024;

/**
 * Lines solve writes when it stops on purpose. Each is printed by solve itself
 * right before `safeExit(1, …)` — see solve.finalize.lib.mjs and
 * solve.auto-continue.lib.mjs.
 */
export const DELIBERATE_STOP_MARKERS = Object.freeze([
  { reason: 'auto-restart-limit', pattern: /Auto-restart limit reached/ },
  { reason: 'auto-resume-limit', pattern: /Auto-resume limit reached/ },
  { reason: 'usage-limit', pattern: /Usage limit reached - use --auto-resume-on-limit-reset/ },
]);

/**
 * Find a deliberate solve stop in a log tail.
 *
 * @param {string} tailText - The end of the work-session log
 * @returns {{reason: string, line: string}|null}
 */
export function findDeliberateSolveStop(tailText) {
  if (!tailText) return null;
  const lines = String(tailText).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    for (const { reason, pattern } of DELIBERATE_STOP_MARKERS) {
      if (pattern.test(lines[i])) return { reason, line: lines[i].trim() };
    }
  }
  return null;
}

/**
 * Read the log tail and look for a deliberate solve stop. Never throws.
 *
 * @param {string|null} logPath
 * @param {Object} [options]
 * @param {Function} [options.readFile] - Test seam returning the whole log text
 * @param {boolean} [options.verbose]
 * @returns {Promise<{reason: string, line: string}|null>}
 */
export async function detectDeliberateSolveStop(logPath, { readFile = null, verbose = false } = {}) {
  if (!logPath) return null;
  try {
    const text = readFile ? String((await readFile(logPath, 'utf8')) || '').slice(-DELIBERATE_STOP_TAIL_BYTES) : await readLogTailText(logPath, { maxBytes: DELIBERATE_STOP_TAIL_BYTES });
    const stop = findDeliberateSolveStop(text);
    if (verbose) {
      console.log(`[VERBOSE] Deliberate-stop scan of ${logPath}: ${stop ? `${stop.reason} ("${stop.line}")` : 'none found'} (issue #2408)`);
    }
    return stop;
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] Deliberate-stop scan of ${logPath} failed: ${error?.message || error}`);
    return null;
  }
}
