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
 *  - `finishWatch` emits the `finished` marker and, when an earlier log comment
 *    said "monitoring continues", posts the `Monitoring Ended` decision comment.
 *
 * Kept free of `use-m`/`command-stream` imports: `$` and the comment poster are
 * passed in, so tests drive it without GitHub.
 */

import { emitSolveProgress } from './solve-progress.lib.mjs';
import { withWatchdog } from './wait-watchdog.lib.mjs';
import { describeStopReason } from './automation-stop-reporting.lib.mjs';
import { MONITORING_ENDED_MARKER, buildSessionEndFooter, markMonitoringEnded, postTrackedComment, wasMonitoringPromisePublished } from './tool-comments.lib.mjs';
import { formatDuration } from './github-ci-stuck-runs.lib.mjs';

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

const DECISIONS = {
  merged: 'the pull request was merged.',
  'auto-merged': 'the pull request was merged automatically.',
  mergeable: 'the pull request is mergeable; it is ready to be merged (see the "Ready to merge" comment).',
  ready_for_review_blocked: 'the pull request is ready for review, but the merge is held back (see the "Ready for review" comment).',
};

/** Pure: the comment that closes the "monitoring continues" promise of the log comment. */
export const buildMonitoringEndedComment = ({ result = null, watchStartedAt = null, checks = 0, now = Date.now() } = {}) => {
  const reason = result?.reason || 'unknown';
  const decision = DECISIONS[reason] || `monitoring stopped: ${describeStopReason(reason).title} (reason code \`${reason}\`).`;
  const duration = Number.isFinite(watchStartedAt) ? ` after ${formatDuration(Math.max(0, now - watchStartedAt))}` : '';
  const lines = [`## 🏁 ${MONITORING_ENDED_MARKER}`, '', `Monitoring of this pull request ended${duration} (${checks} check${checks === 1 ? '' : 's'}).`, '', `**Decision:** ${decision}`];
  if (!DECISIONS[reason]) lines.push('', 'The comment above explains the stop and what to do next. Re-run the command to monitor this pull request again.');
  lines.push('', '---', buildSessionEndFooter());
  return lines.join('\n');
};

/**
 * End of the watch loop: `finished` marker, then the decision comment when a
 * log comment promised one. Never throws.
 */
export const finishWatch = async ({ result, watchStartedAt, checks = 0, $, owner, repo, prNumber, log, emit = emitSolveProgress, post = postTrackedComment, promised = wasMonitoringPromisePublished, now = Date.now() } = {}) => {
  markMonitoringEnded();
  const reason = result?.reason || 'unknown';
  emit({ phase: 'finished', decision: result?.success ? 'success' : 'stopped', reason, check: checks, since: iso(watchStartedAt) });
  if (!promised() || !$ || !prNumber) return { posted: false };
  try {
    const posted = await post({ $, owner, repo, targetNumber: prNumber, body: buildMonitoringEndedComment({ result, watchStartedAt, checks, now }) });
    if (typeof log === 'function') await log(posted?.ok === false ? `   ⚠️  Could not post the "${MONITORING_ENDED_MARKER}" comment` : `   💬 Posted "${MONITORING_ENDED_MARKER}" decision to #${prNumber}: ${reason}`);
    return { posted: posted?.ok !== false };
  } catch (error) {
    if (typeof log === 'function') await log(`   ⚠️  Could not post the "${MONITORING_ENDED_MARKER}" comment: ${error?.message || error}`);
    return { posted: false };
  }
};

/**
 * Run the watch loop with ISO-8601 UTC timestamps on its console lines (the AI
 * restarts inside it turn them off while the AI runs), then finish it.
 */
export const runWatchWithProgress = async ({ params, run, lib, $, log, finish = finishWatch }) => {
  const watch = { startedAt: Date.now(), checks: 0 };
  const timestamps = lib.isConsoleTimestampsEnabled();
  lib.setConsoleTimestamps(true);
  let result = null;
  try {
    result = await run(params, watch);
  } finally {
    lib.setConsoleTimestamps(timestamps);
    await finish({ result: result || { success: false, reason: 'watch_error' }, watchStartedAt: watch.startedAt, checks: watch.checks, $, owner: params.owner, repo: params.repo, prNumber: params.prNumber, log });
  }
  return result;
};

export default { runWatchWithProgress, WATCH_CHECK_DEADLINE_MS, WATCH_STALLED_CHECKS_LIMIT, describeWatchBlocker, createWatchProgress, createWatchStallGuard, buildMonitoringEndedComment, finishWatch };
