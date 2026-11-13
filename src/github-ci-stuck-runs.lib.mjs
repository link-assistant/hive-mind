/**
 * CI signals that must not hold the auto-merge consensus forever (issue #4048).
 *
 * Two separate `solve --auto-restart-until-mergeable` sessions polled for 12+
 * hours (296 and 88 checks) and never announced "ready to merge":
 *
 *  1. Out-of-band failure. A `workflow_dispatch` run (a manually started eval
 *     workflow) failed on the PR's HEAD commit. Its check runs show up on
 *     `GET /commits/{sha}/check-runs`, so the CheckRuns mechanism reported
 *     `failure` on every check. GitHub, however, does not attach dispatch /
 *     schedule check suites to the pull request: the PR stayed
 *     MERGEABLE/CLEAN, `getMergeBlockers` correctly ignored the failure
 *     (issue #2031), and `checkCIConsensus` disagreed with it forever.
 *
 *  2. Ghost runs. During the 2026-11-11 GitHub Actions/Webhooks incident,
 *     36 workflow runs on three older PR commits were created and then stayed
 *     `queued` with `jobs.total_count = 0` for days. The AllCommits mechanism
 *     waited for them to complete, and they never did.
 *
 * Everything here is pure or takes its I/O as injected functions, so the
 * regression tests can replay both cases without network access.
 */

/**
 * Workflow-run events whose check suites GitHub does not associate with a pull
 * request. Their results never reach the PR's merge state (statusCheckRollup),
 * so they must not decide whether the PR is mergeable either.
 */
export const OUT_OF_BAND_EVENTS = Object.freeze(['workflow_dispatch', 'schedule', 'repository_dispatch', 'workflow_run']);

const NON_PASSING_CONCLUSIONS = new Set(['failure', 'error', 'timed_out', 'action_required', 'cancelled', 'stale']);

/** True when GitHub itself says the PR can be merged right now (#2031). */
export const isAuthoritativeCleanMergeState = mergeStatus => mergeStatus?.mergeable === true && mergeStatus?.mergeableState === 'MERGEABLE' && mergeStatus?.mergeStateStatus === 'CLEAN';

/**
 * Split the non-passing check runs of a commit into those from out-of-band
 * workflow runs and those that really belong to the pull request.
 *
 * A check run is joined to its workflow run through the check suite id
 * (`check_run.check_suite.id === workflow_run.check_suite_id`). A check with
 * no matching workflow run (third-party apps, commit statuses) is treated as
 * PR-relevant: only proven out-of-band results are dropped.
 *
 * @param {Array} checks - `ciStatus.checks` from getDetailedCIStatus
 * @param {Array} runs - workflow runs for the same SHA from getWorkflowRunsForSha
 * @returns {{ outOfBand: Array, relevant: Array }} non-passing checks only
 */
export const partitionOutOfBandChecks = (checks = [], runs = []) => {
  const eventBySuite = new Map();
  for (const run of runs || []) {
    if (run?.checkSuiteId != null) eventBySuite.set(String(run.checkSuiteId), run);
  }
  const outOfBand = [];
  const relevant = [];
  for (const check of checks || []) {
    const pending = check?.conclusion == null && check?.status !== 'completed';
    if (!pending && !NON_PASSING_CONCLUSIONS.has(check?.conclusion)) continue;
    const run = check?.checkSuiteId != null ? eventBySuite.get(String(check.checkSuiteId)) : null;
    if (run && OUT_OF_BAND_EVENTS.includes(run.event)) outOfBand.push({ ...check, event: run.event, workflowRunUrl: run.html_url || null });
    else relevant.push(check);
  }
  return { outOfBand, relevant };
};

/**
 * Milliseconds a run has been waiting without starting. For a run that never
 * started `run_started_at` equals `created_at`; after a re-run it is the start
 * of the new attempt, so a freshly re-run ghost is not judged by its original
 * creation time.
 */
export const queuedForMs = (run, now = Date.now()) => {
  const created = new Date(run?.runStartedAt || run?.createdAt || NaN).getTime();
  return Number.isFinite(created) ? Math.max(0, now - created) : 0;
};

/**
 * Find "ghost" runs: `status=queued`, older than `minAgeMs`, and no job was
 * ever created for them. A run legitimately waiting for a runner already has
 * its jobs (in `queued` state); a run held by a concurrency group is
 * `pending`, and one waiting for approval is `waiting`/`action_required`.
 *
 * @param {Array} runs - workflow runs (getWorkflowRunsForSha shape)
 * @param {Object} options
 * @param {number} options.minAgeMs - minimum time in `queued`
 * @param {Function} options.getJobsCount - async (runId) => number|null
 * @param {number} [options.now]
 * @returns {Promise<Array>} ghost runs, each with `queuedForMs`
 */
export const findGhostQueuedRuns = async (runs = [], { minAgeMs, getJobsCount, now = Date.now() } = {}) => {
  const ghosts = [];
  for (const run of runs || []) {
    if (run?.status !== 'queued') continue;
    const age = queuedForMs(run, now);
    if (age < minAgeMs) continue;
    // null (lookup failed) is not proof of a ghost run, so it keeps blocking.
    const jobs = typeof getJobsCount === 'function' ? await getJobsCount(run.id) : null;
    if (jobs === 0) ghosts.push({ ...run, queuedForMs: age });
  }
  return ghosts;
};

export const formatDuration = ms => {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h ${minutes % 60}m` : `${Math.floor(hours / 24)}d ${hours % 24}h`;
};

/**
 * Human-readable reasons for a disagreeing consensus. The previous log line
 * ("CheckRuns=failure, WorkflowRuns=0 in-progress, AllCommits=3 pending of 60")
 * gave no hint which check or which run was holding the merge.
 */
export const describeConsensusDisagreement = mechanisms => {
  const reasons = [];
  const checkRuns = mechanisms?.checkRunsAPI;
  if (checkRuns && !checkRuns.complete) {
    const names = (checkRuns.relevantChecks || []).slice(0, 3).map(check => `${check.name} (${check.conclusion || check.status})`);
    reasons.push(`CheckRuns: ${checkRuns.status}${names.length ? ` — ${names.join(', ')}` : ''}`);
  }
  const workflowRuns = mechanisms?.workflowRunsAPI;
  if (workflowRuns && !workflowRuns.complete) {
    const ghosts = workflowRuns.ghostRuns || [];
    reasons.push(`WorkflowRuns: ${workflowRuns.inProgress} of ${workflowRuns.total} on HEAD not completed${ghosts.length ? ` (${ghosts.length} stuck in queued with no jobs, oldest ${formatDuration(Math.max(...ghosts.map(run => run.queuedForMs || 0)))})` : ''}`);
  }
  const allCommits = mechanisms?.allCommitsCI;
  if (allCommits && !allCommits.skipped && allCommits.complete === false) {
    reasons.push(`AllCommits: ${allCommits.pendingCommits.length} of ${allCommits.totalCommits} commits have runs not completed (${allCommits.pendingCommits.slice(0, 5).join(', ')})`);
  }
  const repoActions = mechanisms?.repoActions;
  if (repoActions && !repoActions.skipped && repoActions.count > 0) reasons.push(`RepoActions: ${repoActions.count} active run(s) in the repository`);
  return reasons;
};

/**
 * Decide what to do with ghost runs on the PR HEAD. Pure.
 *
 *  - an active GitHub incident on a CI-related component → wait for GitHub;
 *  - status page unreachable → wait (we cannot rule out an outage);
 *  - otherwise re-trigger each run that still has attempts left. A run that
 *    started on its own (jobs > 0 or status changed) is never touched,
 *    because it is no longer in `ghostRuns`.
 */
export const decideGhostRunAction = ({ ghostRuns = [], githubStatus = null, attemptsByRun = new Map(), maxAttempts = 2 } = {}) => {
  if (ghostRuns.length === 0) return { action: 'none', runs: [] };
  if (githubStatus?.ok && githubStatus.hasIssues) return { action: 'wait-for-github', runs: ghostRuns, incidents: githubStatus.activeIncidents || [] };
  if (githubStatus && githubStatus.ok === false && githubStatus.error !== 'disabled') return { action: 'wait-status-unknown', runs: ghostRuns, error: githubStatus.error };
  const retryable = ghostRuns.filter(run => (attemptsByRun.get(String(run.id)) || 0) < maxAttempts);
  if (retryable.length === 0) return { action: 'exhausted', runs: ghostRuns };
  return { action: 'retrigger', runs: retryable };
};

/**
 * Re-trigger ghost runs: a queued run cannot be re-run directly, so it is
 * cancelled first (force-cancel when a normal cancel is refused) and re-run by
 * rerunSettledGhostRuns once it reports `completed`. State lives in `state` so
 * the auto-merge loop can carry it across checks.
 *
 * @returns {Promise<Array<{runId, step, ok, error}>>}
 */
export const retriggerGhostRuns = async ({ runs, state, cancelWorkflowRun, owner, repo, verbose = false }) => {
  const results = [];
  for (const run of runs) {
    const key = String(run.id);
    state.attemptsByRun.set(key, (state.attemptsByRun.get(key) || 0) + 1);
    let cancel = await cancelWorkflowRun(owner, repo, run.id, { force: false, verbose });
    if (!cancel.success) cancel = await cancelWorkflowRun(owner, repo, run.id, { force: true, verbose });
    results.push({ runId: run.id, name: run.name, step: cancel.forced ? 'force-cancel' : 'cancel', ok: cancel.success, error: cancel.error || null });
    if (cancel.success) state.awaitingRerun.add(key);
  }
  return results;
};

/** Re-run previously cancelled ghost runs that are now `completed`. */
export const rerunSettledGhostRuns = async ({ state, runs = [], rerunWorkflowRun, owner, repo, verbose = false }) => {
  const results = [];
  for (const run of runs) {
    const key = String(run.id);
    if (!state.awaitingRerun.has(key) || run.status !== 'completed') continue;
    const rerun = await rerunWorkflowRun(owner, repo, run.id, verbose);
    results.push({ runId: run.id, name: run.name, step: 'rerun', ok: rerun.success, error: rerun.error || null });
    state.awaitingRerun.delete(key);
  }
  return results;
};

export const createGhostRunState = () => ({ attemptsByRun: new Map(), awaitingRerun: new Set(), lastNoticeKey: null });

export default {
  OUT_OF_BAND_EVENTS,
  isAuthoritativeCleanMergeState,
  partitionOutOfBandChecks,
  queuedForMs,
  findGhostQueuedRuns,
  formatDuration,
  describeConsensusDisagreement,
  decideGhostRunAction,
  retriggerGhostRuns,
  rerunSettledGhostRuns,
  createGhostRunState,
};
