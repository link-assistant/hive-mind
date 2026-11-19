/**
 * Issue #4091: HEAD workflow runs that have not started must not hold the
 * auto-restart-until-mergeable loop forever.
 *
 * A `solve` watch loop polled a pull request 135 times over 5 hours. Every
 * check run had passed and GitHub said the PR was `CLEAN`, but one workflow
 * run on the HEAD commit was `pending`: its workflow used a repository-wide
 * `concurrency` group, runs from other pull requests held that group, and the
 * run waited in GitHub's concurrency queue with zero jobs. `getMergeBlockers`
 * treated it as "CI still running", and the #4048 stuck-CI monitor skipped it
 * on purpose because it only handles ghost `queued` runs.
 *
 * Everything here is pure (or takes its I/O as injected functions):
 *
 *  - `classifyIncompleteRun` tells a run that has not started (`pending` in a
 *    concurrency queue, `waiting`/`action_required` for an approval, a ghost
 *    `queued` run with no jobs) from one that is really running;
 *  - `decideUnstartedRunWait` turns the classified runs into a bounded wait:
 *    wait → one PR notice after `pendingNoticeMinutes` → an explicit stop after
 *    `pendingStopMinutes` (and at least `pendingStopGraceMinutes` after the
 *    notice). Runs of these kinds are never cancelled or re-run here:
 *    cancelling a `pending` run would lose its place in the queue, and an
 *    approval can only be given by a person.
 */

import { formatDuration, queuedForMs } from './github-ci-stuck-runs.lib.mjs';
import { CI_WAIT_STUCK_MARKER } from './tool-comments.lib.mjs';

/** Kinds of a non-completed workflow run. */
export const RUN_KINDS = Object.freeze({
  CONCURRENCY_QUEUE: 'concurrency_queue',
  APPROVAL: 'approval',
  GHOST_QUEUED: 'ghost_queued',
  WAITING_FOR_RUNNER: 'waiting_for_runner',
  RUNNING: 'running',
});

/** Kinds that this module bounds (the #4048 monitor owns ghost `queued` runs). */
export const UNSTARTED_KINDS = Object.freeze([RUN_KINDS.CONCURRENCY_QUEUE, RUN_KINDS.APPROVAL]);

const APPROVAL_STATUSES = new Set(['waiting', 'action_required']);

/**
 * Classify one non-completed workflow run.
 *
 * @param {Object} run - getWorkflowRunsForSha shape (`status`, `createdAt`, `runStartedAt`)
 * @param {number|null} jobs - job count from getWorkflowRunJobsCount (null: lookup failed)
 * @returns {string} one of RUN_KINDS
 */
export const classifyIncompleteRun = (run, jobs) => {
  const status = run?.status;
  if (APPROVAL_STATUSES.has(status)) return RUN_KINDS.APPROVAL;
  // A pending run has no jobs until the concurrency group lets it start. A job
  // count above zero means it did start; null (lookup failed) keeps the status.
  if (status === 'pending') return jobs > 0 ? RUN_KINDS.RUNNING : RUN_KINDS.CONCURRENCY_QUEUE;
  if (status === 'queued') return jobs === 0 ? RUN_KINDS.GHOST_QUEUED : RUN_KINDS.WAITING_FOR_RUNNER;
  return RUN_KINDS.RUNNING;
};

/**
 * Classify every non-completed run, with its age and job count.
 *
 * @param {Array} runs - non-completed workflow runs
 * @param {Object} options
 * @param {Function} options.getJobsCount - async (runId) => number|null
 * @param {number} [options.now]
 * @returns {Promise<Array>} runs with `kind`, `jobs`, `ageMs` (and `queuedForMs` for the #4048 path)
 */
export const classifyIncompleteRuns = async (runs = [], { getJobsCount, now = Date.now() } = {}) => {
  const classified = [];
  for (const run of runs || []) {
    if (!run || run.status === 'completed') continue;
    // in_progress runs already have jobs; skip the API call for them.
    const needsJobs = ['pending', 'queued', 'waiting', 'action_required'].includes(run.status);
    let jobs = null;
    if (needsJobs && typeof getJobsCount === 'function') {
      try {
        jobs = await getJobsCount(run.id);
      } catch {
        jobs = null;
      }
    }
    const ageMs = queuedForMs(run, now);
    classified.push({ ...run, kind: classifyIncompleteRun(run, jobs), jobs, ageMs, queuedForMs: ageMs });
  }
  return classified;
};

const KIND_TEXT = {
  [RUN_KINDS.CONCURRENCY_QUEUE]: 'not started: held by a concurrency queue (pending)',
  [RUN_KINDS.APPROVAL]: 'not started: approval needed',
  [RUN_KINDS.GHOST_QUEUED]: 'not started: queued with no jobs',
  [RUN_KINDS.WAITING_FOR_RUNNER]: 'queued, waiting for a runner',
  [RUN_KINDS.RUNNING]: 'running',
};

const jobsText = jobs => (jobs == null ? 'jobs unknown' : `${jobs} job${jobs === 1 ? '' : 's'}`);

/** ISO-8601 UTC without milliseconds, or '' for an invalid time. */
export const isoMinute = value => {
  const time = new Date(value ?? NaN);
  return Number.isFinite(time.getTime()) ? `${time.toISOString().slice(0, 19)}Z` : '';
};

/**
 * One log line for a classified run, for example
 * "W — not started: held by a concurrency queue (pending), 0 jobs, waiting 3h 28m (created 2026-11-18T21:42:21Z) — url".
 */
export const describeIncompleteRun = run => {
  const status = run.kind === RUN_KINDS.APPROVAL ? ` (${run.status})` : '';
  const created = isoMinute(run.createdAt);
  const parts = [`${run.name || `run ${run.id}`} — ${KIND_TEXT[run.kind] || run.status}${status}`, jobsText(run.jobs), `waiting ${formatDuration(run.ageMs || 0)}${created ? ` (created ${created})` : ''}`];
  return `${parts.join(', ')}${run.html_url ? ` — ${run.html_url}` : ''}`;
};

/** Short text for status lines (Telegram, phase markers). */
export const summarizeUnstartedRuns = runs => {
  const blocking = (runs || []).filter(run => UNSTARTED_KINDS.includes(run.kind));
  if (blocking.length === 0) return '';
  const first = blocking[0];
  const what = first.kind === RUN_KINDS.APPROVAL ? `approval needed (${first.status})` : 'pending, concurrency queue';
  const more = blocking.length > 1 ? ` (+${blocking.length - 1} more)` : '';
  return `${first.name || `run ${first.id}`} ${what}, ${jobsText(first.jobs)}, for ${formatDuration(first.ageMs || 0)}${more}`;
};

/**
 * Decide what the loop does about runs that have not started. Pure.
 *
 * The bounded wait applies only when every non-completed HEAD run is one that
 * has not started (concurrency queue or approval): while any run is running,
 * waiting for a runner, or is a ghost `queued` run (#4048 recovers those), the
 * loop keeps waiting as before.
 *
 * @param {Object} options
 * @param {Array} options.runs - classifyIncompleteRuns result
 * @param {number|null} options.noticePostedAt - when the notice for this commit was posted (ms), null: not yet
 * @param {Object} options.config - { pendingNoticeMinutes, pendingStopMinutes, pendingStopGraceMinutes }
 * @param {number} [options.now]
 * @returns {{ action: 'none'|'wait'|'notice'|'stop', runs: Array, kind?: string, reason?: string, ageMs?: number, stopAt?: number|null, message?: string, details?: string[] }}
 */
export const decideUnstartedRunWait = ({ runs = [], noticePostedAt = null, config = {}, now = Date.now() } = {}) => {
  const unstarted = runs.filter(run => UNSTARTED_KINDS.includes(run.kind));
  if (unstarted.length === 0 || unstarted.length !== runs.length) return { action: 'none', runs: unstarted };
  // The youngest run decides: every blocking run must be older than a threshold.
  const ageMs = Math.min(...unstarted.map(run => run.ageMs || 0));
  const approval = unstarted.some(run => run.kind === RUN_KINDS.APPROVAL);
  const kind = approval ? RUN_KINDS.APPROVAL : RUN_KINDS.CONCURRENCY_QUEUE;
  const minute = 60 * 1000;
  const noticeMs = Math.max(0, Number(config.pendingNoticeMinutes) || 0) * minute;
  const stopMinutes = Number(config.pendingStopMinutes) || 0;
  const graceMs = Math.max(0, Number(config.pendingStopGraceMinutes) || 0) * minute;
  const stopByAge = stopMinutes > 0 ? now + Math.max(0, stopMinutes * minute - ageMs) : null;
  const stopAt = stopByAge == null ? null : Math.max(stopByAge, noticePostedAt == null ? now + graceMs : noticePostedAt + graceMs);
  const base = { runs: unstarted, kind, ageMs, stopAt };
  if (noticePostedAt == null) return { ...base, action: ageMs >= noticeMs || (stopByAge != null && stopByAge <= now) ? 'notice' : 'wait' };
  if (stopAt == null || now < stopAt) return { ...base, action: 'wait' };
  const reason = approval ? 'ci_approval_required' : 'ci_not_started';
  const message = approval ? `Approval needed: ${unstarted.length} workflow run(s) on the HEAD commit have waited ${formatDuration(ageMs)} for a maintainer or environment approval and never started.` : `${unstarted.length} workflow run(s) on the HEAD commit have waited ${formatDuration(ageMs)} in a concurrency queue (status \`pending\`, no jobs) and never started.`;
  return { ...base, action: 'stop', reason, message, details: unstarted.map(describeIncompleteRun) };
};

/**
 * Pure: the PR comment posted once per commit when HEAD runs have not started.
 */
export const buildUnstartedRunNoticeComment = ({ sha, runs = [], kind, ageMs = 0, stopAt = null }) => {
  const short = String(sha || '').substring(0, 7) || 'HEAD';
  const approval = kind === RUN_KINDS.APPROVAL;
  const lines = [`## ⚠️ ${CI_WAIT_STUCK_MARKER}`, ''];
  if (approval) {
    lines.push(`**Approval needed.** Every check run on \`${short}\` passed, but workflow runs on this commit are waiting for an approval and have not started for ${formatDuration(ageMs)}:`);
  } else {
    lines.push(`Every check run on \`${short}\` passed, but workflow runs on this commit have not started for ${formatDuration(ageMs)}. They are held by a \`concurrency\` group (status \`pending\`, no jobs): other runs of the same group are ahead of them.`);
  }
  lines.push('');
  for (const run of runs.slice(0, 10)) lines.push(`- ${describeIncompleteRun(run)}`);
  lines.push('');
  lines.push(approval ? 'A maintainer has to approve these runs (pending deployment / environment review, or first-time contributor approval) before they can start.' : 'These runs are not cancelled or re-run automatically: that would lose their place in the queue. They start when the runs ahead of them finish.');
  const deadline = stopAt ? isoMinute(stopAt) : '';
  lines.push('', deadline ? `Monitoring continues until ${deadline}. If the runs have still not started by then, monitoring stops and says so here.` : 'Monitoring continues; this comment is posted once per commit.');
  return lines.join('\n');
};

export default {
  RUN_KINDS,
  UNSTARTED_KINDS,
  classifyIncompleteRun,
  classifyIncompleteRuns,
  describeIncompleteRun,
  summarizeUnstartedRuns,
  decideUnstartedRunWait,
  buildUnstartedRunNoticeComment,
  isoMinute,
};
