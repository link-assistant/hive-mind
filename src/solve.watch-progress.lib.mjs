/**
 * Issue #4091: what the `--auto-restart-until-mergeable` watch loop tells the
 * outside world while it runs and when it stops.
 *
 *  - `createWatchProgress` prints a `[HIVE-MIND SOLVE]` phase marker on every
 *    check (phase `watch`, check number, current blocker, since, deadline). The
 *    Telegram session monitor turns it into the `/solve` reply header, and the
 *    kill diagnostics name it when the process is stopped.
 *  - `createWatchStallGuard` runs one GitHub probe of a check under a watchdog:
 *    a probe that does not answer within its deadline is logged with what it
 *    was waiting for and the check is skipped; several stalled checks in a row
 *    end monitoring with an explicit decision instead of hanging.
 *  - `finishWatch` emits the terminal progress marker. The watch loop
 *    publishes the disposition on GitHub.
 */

import { emitSolveProgress } from './solve-progress.lib.mjs';
import { withWatchdog } from './wait-watchdog.lib.mjs';
import { markMonitoringEnded } from './tool-comments.lib.mjs';

/** One GitHub probe of a check may take this long before the check is skipped. */
export const WATCH_CHECK_DEADLINE_MS = 10 * 60 * 1000;
/** This many skipped checks in a row end monitoring (`watch_stalled`). */
export const WATCH_STALLED_CHECKS_LIMIT = 3;

const BLOCKER_LABELS = {
  ci_pending: 'CI',
  ci_failure: 'failing CI',
  ci_cancelled: 'cancelled CI',
  ci_not_started: 'CI runs that have not started',
  ci_approval_required: 'CI approval',
  merge_conflict: 'merge conflict',
  draft: 'draft state',
  checking: 'the next GitHub check',
};

const iso = ms => (Number.isFinite(ms) ? new Date(ms).toISOString() : null);

/** `{ blocker, blockerLabel, detail }` of the first merge blocker, for the phase marker. */
export const describeWatchBlocker = (blockers = []) => {
  const first = (blockers || [])[0];
  if (!first) return { blocker: 'none', blockerLabel: 'nothing (no merge blockers)', detail: null };
  const detail = first.details?.length === 1 ? first.details[0] : first.message || null;
  return { blocker: first.type, blockerLabel: BLOCKER_LABELS[first.type] || String(first.type || 'unknown').replace(/_/g, ' '), detail: detail ? String(detail).slice(0, 300) : null };
};

/**
 * Phase markers of the watch loop.
 *
 * @param {Object} options
 * @param {number} options.watchStartedAt - ms
 * @param {number} options.watchTimeoutHours - 0: unlimited
 * @param {Function} [options.emit] - emitSolveProgress
 */
export const createWatchProgress = ({ watchStartedAt, watchTimeoutHours = 0, emit = emitSolveProgress } = {}) => {
  const since = iso(watchStartedAt);
  const timeoutAt = watchTimeoutHours > 0 ? watchStartedAt + watchTimeoutHours * 3600 * 1000 : null;
  let check = 0;
  const deadlineWith = stopAt => {
    const candidates = [timeoutAt, stopAt].filter(Number.isFinite);
    return candidates.length ? iso(Math.min(...candidates)) : null;
  };
  return {
    /** A check starts: nothing is known yet. */
    startCheck(number) {
      check = number;
      return emit({ phase: 'watch', check, blocker: 'checking', blockerLabel: BLOCKER_LABELS.checking, detail: null, since, deadline: deadlineWith(null) });
    },
    /** What the check found; `unstarted` is the stuck-CI monitor's decision for runs that have not started. */
    report({ blockers = [], unstarted = null } = {}) {
      const described = unstarted?.summary ? { blocker: unstarted.kind === 'approval' ? 'ci_approval_required' : 'ci_not_started', blockerLabel: unstarted.kind === 'approval' ? BLOCKER_LABELS.ci_approval_required : BLOCKER_LABELS.ci_not_started, detail: unstarted.summary } : describeWatchBlocker(blockers);
      return emit({ phase: 'watch', check, ...described, since, deadline: deadlineWith(unstarted?.stopAt ?? null) });
    },
    get check() {
      return check;
    },
  };
};

/**
 * Run a check's GitHub probe under a watchdog and count stalled checks.
 *
 * @returns {{ run: Function, stalledChecks: Function }} `run(name, operation)` resolves to
 *   `{ value }`, or `{ stalled: true, count, stop }` when the probe missed its deadline.
 */
export const createWatchStallGuard = ({ log, deadlineMs = WATCH_CHECK_DEADLINE_MS, limit = WATCH_STALLED_CHECKS_LIMIT, watchdog = withWatchdog, watchdogOptions = {} } = {}) => {
  let stalled = 0;
  return {
    async run(name, operation) {
      const result = await watchdog(name, operation, {
        log,
        deadlineMs,
        ...watchdogOptions,
        onTimeout: async () => ({ decision: stalled + 1 >= limit ? `stop monitoring: ${stalled + 1} checks in a row got no answer` : `skip this check (${stalled + 1}/${limit} stalled in a row) and retry at the next interval` }),
      });
      if (!result.timedOut) {
        stalled = 0;
        return { value: result.value };
      }
      stalled++;
      return { stalled: true, count: stalled, stop: stalled >= limit };
    },
    stalledChecks: () => stalled,
    deadlineMs,
    /**
     * One check's merge-blocker probe: its value, `{ stop, message }` when the stalls
     * reached the limit, or a throw (the loop logs "Check failed" and retries) for a
     * single stall. `afterProbe` runs once the probe settled (the /stop park).
     */
    async probeCheck(check, operation, afterProbe = async () => {}) {
      const probe = await this.run(`check #${check}: reading merge blockers`, operation);
      if (probe.stop) return { stop: true, message: `${probe.count} monitoring checks in a row got no answer from GitHub within ${deadlineMs / 60000} minutes each.` };
      if (probe.stalled) throw new Error(`GitHub did not answer check #${check} in time (stalled ${probe.count} time(s) in a row)`);
      await afterProbe();
      return { stop: false, value: probe.value };
    },
  };
};

/** Mark monitoring as finished for the Telegram monitor and later log uploads. */
export const finishWatch = ({ result, watchStartedAt, checks = 0, emit = emitSolveProgress } = {}) => {
  markMonitoringEnded();
  emit({ phase: 'finished', decision: result?.success ? 'success' : 'stopped', reason: result?.reason || 'unknown', check: checks, since: iso(watchStartedAt) });
};

/**
 * Run the watch loop with ISO-8601 UTC timestamps on its console lines (the AI
 * restarts inside it turn them off while the AI runs), then finish it.
 */
export const runWatchWithProgress = async ({ params, run, lib, finish = finishWatch }) => {
  const watch = { startedAt: Date.now(), checks: 0 };
  const timestamps = lib.isConsoleTimestampsEnabled();
  lib.setConsoleTimestamps(true);
  let result = null;
  try {
    result = await run(params, watch);
  } finally {
    lib.setConsoleTimestamps(timestamps);
    await finish({ result: result || { success: false, reason: 'watch_error' }, watchStartedAt: watch.startedAt, checks: watch.checks });
  }
  return result;
};

export default { runWatchWithProgress, WATCH_CHECK_DEADLINE_MS, WATCH_STALLED_CHECKS_LIMIT, describeWatchBlocker, createWatchProgress, createWatchStallGuard, finishWatch };
