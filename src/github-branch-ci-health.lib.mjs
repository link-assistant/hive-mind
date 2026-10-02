#!/usr/bin/env node
/**
 * Decide whether a branch's CI is green, red or still running.
 *
 * Issue #2404: checking only the HEAD commit's workflow runs is not enough. Release
 * workflows push version-bump commits (e.g. `2.33.4`) with `GITHUB_TOKEN`, and GitHub does
 * not start workflows for such pushes. While the `Checks and release` run of the merge commit
 * underneath was still going (and later failed), main's HEAD was already the bump commit with
 * zero runs — which the old check reported as "healthy".
 *
 * The evaluator walks back along the first-parent chain until it finds the newest commit
 * whose own branch CI ran (`push` workflow runs) and judges that commit instead. A fresh HEAD
 * without runs is reported as pending for a short grace period, because GitHub may not have
 * registered the runs of a just-pushed commit yet.
 *
 * Pure logic with injected fetchers so it can be unit-tested without the GitHub API.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2404
 * @see https://docs.github.com/en/actions/security-for-github-actions/security-guides/automatic-token-authentication#using-the-github_token-in-a-workflow
 */

// Workflow run events that represent the branch's own CI for a pushed commit. Runs started by
// other events (issues, schedule, workflow_dispatch, ...) also carry the branch HEAD SHA, but
// they say nothing about whether that commit builds.
export const BRANCH_CI_EVENTS = new Set(['push']);
// How many first-parent commits to inspect when looking for the newest commit with branch CI.
export const BRANCH_CI_LOOKBACK_COMMITS = 10;
// A HEAD commit younger than this without any runs is treated as "CI not registered yet".
export const BRANCH_CI_START_GRACE_MS = 2 * 60 * 1000;

const PENDING_STATUSES = new Set(['in_progress', 'queued', 'waiting', 'requested', 'pending']);
// Issue #1952: `startup_failure` is a genuine failure. `cancelled` is intentionally not treated
// as a failure on the branch (usually a superseded or manual cancellation).
const FAILED_CONCLUSIONS = new Set(['failure', 'timed_out', 'startup_failure']);

const isBranchCIRun = run => run.event === undefined || run.event === null || BRANCH_CI_EVENTS.has(run.event);
const short = sha => (sha || '').substring(0, 7);

/**
 * Order commits along the first-parent chain starting at the branch HEAD.
 * @param {Array<{sha: string, parent?: string|null}>} commits - Commits as returned by the commits API (HEAD first)
 * @returns {Array} First-parent chain (HEAD first); stops when a parent is not in the list
 */
export function firstParentChain(commits) {
  if (!commits || commits.length === 0) return [];
  const bySha = new Map(commits.map(commit => [commit.sha, commit]));
  const chain = [];
  const seen = new Set();
  let current = commits[0];
  while (current && !seen.has(current.sha)) {
    chain.push(current);
    seen.add(current.sha);
    current = current.parent ? bySha.get(current.parent) : null;
  }
  return chain;
}

function judgeRuns({ branch, commit, runs, headSha, skipped, log }) {
  const base = { checkedSha: commit.sha, headSha, skippedCommits: skipped };
  const where = commit.sha === headSha ? `latest commit ${short(commit.sha)}` : `commit ${short(commit.sha)} (HEAD ${short(headSha)} has no CI of its own)`;
  const pendingRuns = runs.filter(run => PENDING_STATUSES.has(run.status));
  if (pendingRuns.length > 0) {
    log(`${pendingRuns.length} CI run(s) still in progress on ${branch} (${where})`);
    for (const run of pendingRuns) log(`  - ${run.name}: ${run.status} (${run.html_url})`);
    return { healthy: true, pending: true, failedRuns: [], pendingRuns, error: null, ...base };
  }
  const failedRuns = runs.filter(run => FAILED_CONCLUSIONS.has(run.conclusion));
  if (failedRuns.length > 0) {
    log(`Found ${failedRuns.length} failed CI run(s) on ${branch} (${where}):`);
    for (const run of failedRuns) log(`  - ${run.name}: ${run.conclusion} (${run.html_url})`);
    const suffix = commit.sha === headSha ? '' : ` (commit ${short(commit.sha)}, below HEAD ${short(headSha)})`;
    return { healthy: false, pending: false, failedRuns, pendingRuns: [], error: `${failedRuns.length} CI run(s) failed on ${branch}: ${failedRuns.map(run => run.name).join(', ')}${suffix}`, ...base };
  }
  log(`Branch ${branch} CI is healthy (${runs.length} run(s) passed for ${where})`);
  return { healthy: true, pending: false, failedRuns: [], pendingRuns: [], error: null, ...base };
}

/**
 * Evaluate the CI health of a branch.
 *
 * @param {Object} params
 * @param {string} params.branch - Branch name (for messages)
 * @param {Array<{sha: string, parent?: string|null, date?: string|null, message?: string}>} params.commits - Recent commits, HEAD first
 * @param {(sha: string) => Promise<Array>} params.getRuns - Fetch workflow runs for a commit SHA
 * @param {number} [params.now] - Current time in ms (injectable for tests)
 * @param {number} [params.graceMs] - Grace period for a fresh HEAD without runs
 * @param {number} [params.lookback] - Max first-parent commits to inspect
 * @param {(message: string) => void} [params.log] - Verbose logger
 * @returns {Promise<{healthy: boolean, pending: boolean, failedRuns: Array, pendingRuns: Array, error: string|null, headSha: string|null, checkedSha: string|null, skippedCommits: number}>}
 */
export async function evaluateBranchCIHealth({ branch, commits, getRuns, now = Date.now(), graceMs = BRANCH_CI_START_GRACE_MS, lookback = BRANCH_CI_LOOKBACK_COMMITS, log = () => {} }) {
  const chain = firstParentChain(commits).slice(0, lookback);
  const headSha = chain[0]?.sha || null;
  if (!headSha) {
    log(`Could not resolve HEAD SHA for ${branch}, assuming healthy`);
    return { healthy: true, pending: false, failedRuns: [], pendingRuns: [], error: null, headSha: null, checkedSha: null, skippedCommits: 0 };
  }

  let headRuns = [];
  for (let index = 0; index < chain.length; index++) {
    const commit = chain[index];
    const runs = await getRuns(commit.sha);
    if (index === 0) headRuns = runs;
    log(`Found ${runs.length} CI run(s) for ${index === 0 ? 'HEAD ' : ''}commit ${short(commit.sha)} on ${branch}${commit.message ? ` (${commit.message})` : ''}`);

    if (runs.some(isBranchCIRun)) {
      return judgeRuns({ branch, commit, runs, headSha, skipped: index, log });
    }

    const ageMs = commit.date ? now - Date.parse(commit.date) : Number.POSITIVE_INFINITY;
    if (index === 0 && ageMs < graceMs) {
      // GitHub may not have registered the runs of a just-pushed commit yet.
      log(`HEAD commit ${short(commit.sha)} on ${branch} was pushed ${Math.round(ageMs / 1000)}s ago and has no CI runs yet; treating as pending`);
      return { healthy: true, pending: true, failedRuns: [], pendingRuns: [], error: null, headSha, checkedSha: headSha, skippedCommits: 0 };
    }
    log(`Commit ${short(commit.sha)} on ${branch} has no ${[...BRANCH_CI_EVENTS].join('/')} CI runs (e.g. a release bump pushed with GITHUB_TOKEN); checking its parent`);
  }

  // No commit in the lookback window has branch CI — keep the pre-#2404 behaviour and judge HEAD's own runs.
  log(`No commit in the last ${chain.length} on ${branch} has branch CI runs; judging HEAD ${short(headSha)} by its own runs`);
  if (headRuns.length === 0) {
    return { healthy: true, pending: false, failedRuns: [], pendingRuns: [], error: null, headSha, checkedSha: headSha, skippedCommits: 0 };
  }
  return judgeRuns({ branch, commit: chain[0], runs: headRuns, headSha, skipped: 0, log });
}

export default {
  evaluateBranchCIHealth,
  firstParentChain,
  BRANCH_CI_EVENTS,
  BRANCH_CI_LOOKBACK_COMMITS,
  BRANCH_CI_START_GRACE_MS,
};
