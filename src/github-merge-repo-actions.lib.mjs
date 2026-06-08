#!/usr/bin/env node
/**
 * GitHub Repository-Wide Actions Monitoring
 *
 * Issue #1503: Functions to check and wait for ALL active GitHub Actions
 * workflow runs across the entire repository. This is the "absolute safety
 * mechanism" modeled after the /merge command's waitForBranchCI pattern.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1503
 */

import { githubLimits } from './config.lib.mjs';
import { execGhWithRetry } from './github-rate-limit.lib.mjs';
// Issue #1722: raise exec maxBuffer above Node's 1 MB default for paginated gh
// API responses (workflow runs can easily exceed that on busy repos).
// Issue #1726: wrap with rate-limit retry so a 5,000/hr quota hit waits for
// reset instead of bubbling up as a generic fetch failure.
const exec = (cmd, opts = {}) =>
  execGhWithRetry(cmd, {
    execOptions: { maxBuffer: githubLimits.bufferMaxSize, ...opts },
  });

// Statuses we treat as "not yet finished".
const ACTIVE_RUN_STATUSES = ['in_progress', 'queued', 'waiting', 'requested', 'pending'];

/**
 * Get ALL active workflow runs across the entire repository (no branch filter).
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{runs: Array, hasActiveRuns: boolean, count: number}>}
 */
export async function getAllActiveRepoRuns(owner, repo, verbose = false) {
  // Issue #1722: filter on the server side per status to avoid pulling the full
  // history of workflow runs (which can exceed exec maxBuffer). Also: do not
  // swallow errors as "no active runs" — bubble them up so callers can retry
  // instead of merging on top of a still-running CI run.
  const seen = new Set();
  const runs = [];
  for (const status of ACTIVE_RUN_STATUSES) {
    const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?status=${status}&per_page=100" --paginate --slurp`);
    const pages = JSON.parse(stdout.trim() || '[]');
    for (const page of pages) {
      for (const run of page.workflow_runs || []) {
        if (seen.has(run.id)) continue;
        seen.add(run.id);
        runs.push({
          id: run.id,
          name: run.name,
          status: run.status,
          head_branch: run.head_branch,
          head_sha: run.head_sha?.slice(0, 7),
        });
      }
    }
  }
  if (verbose && runs.length > 0) {
    console.log(`[VERBOSE] repo-actions: ${runs.length} active run(s) in ${owner}/${repo}`);
    for (const r of runs) console.log(`[VERBOSE] repo-actions:   ${r.name} (${r.status}) on ${r.head_branch}`);
  }
  return { runs, hasActiveRuns: runs.length > 0, count: runs.length };
}

/**
 * Wait for ALL active workflow runs in the repository to complete.
 * Blocks until every in-progress/queued run across ALL branches finishes.
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Object} options - Wait options (timeout, pollInterval, onStatusUpdate)
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{success: boolean, waitedForRuns: boolean, timedOut: boolean, remainingRuns: Array}>}
 */
export async function waitForAllRepoActions(owner, repo, options = {}, verbose = false) {
  const { timeout = 45 * 60 * 1000, pollInterval = 5 * 60 * 1000, onStatusUpdate = null } = options;
  const startTime = Date.now();
  let peakRunCount = 0;

  while (Date.now() - startTime < timeout) {
    let active;
    try {
      active = await getAllActiveRepoRuns(owner, repo, verbose);
    } catch (error) {
      // Issue #1722: do not silently treat fetch errors as "no active runs".
      // Log and retry on the next poll instead.
      console.error(`[ERROR] repo-actions: Error checking repo CI: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      continue;
    }
    if (onStatusUpdate) {
      try {
        await onStatusUpdate({ ...active, elapsedMs: Date.now() - startTime });
      } catch {
        // Ignore callback errors — continue monitoring
      }
    }
    if (!active.hasActiveRuns) {
      return { success: true, waitedForRuns: peakRunCount > 0, timedOut: false, remainingRuns: [] };
    }
    peakRunCount = Math.max(peakRunCount, active.count);
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }
  // Issue #1722: if the timeout-final check throws, surface that as an error
  // rather than reporting "no remaining runs".
  let finalRuns;
  try {
    finalRuns = await getAllActiveRepoRuns(owner, repo, verbose);
  } catch (error) {
    console.error(`[ERROR] repo-actions: Final CI check failed after timeout: ${error.message}`);
    return { success: false, waitedForRuns: true, timedOut: true, remainingRuns: [] };
  }
  return { success: false, waitedForRuns: true, timedOut: true, remainingRuns: finalRuns.runs };
}

/**
 * Get all commit SHAs for a pull request branch.
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<string[]>} Array of commit SHAs
 */
export async function getPRCommitShas(owner, repo, prNumber, verbose = false) {
  try {
    const { stdout } = await exec(`gh api "repos/${owner}/${repo}/pulls/${prNumber}/commits" --paginate --jq '[.[].sha]'`);
    const shas = JSON.parse(stdout.trim() || '[]');
    if (verbose && shas.length > 1) {
      console.log(`[VERBOSE] pr-commits: ${shas.length} commits on PR #${prNumber}`);
    }
    return shas;
  } catch {
    return [];
  }
}

/**
 * Issue #1712: Collect every active (in_progress / pending / queued / waiting / requested)
 * workflow run on the PR branch — across ALL commits, not only the head SHA.
 *
 * Why this exists: when the user watches `/merge`, the GitHub Actions tab shows yellow
 * dots for every commit that ever had a run, including older commits whose runs were
 * automatically cancelled by GitHub's concurrency group. The verbose log used to list
 * only the head-SHA runs, so a user comparing the log to the GitHub UI would see
 * "1 workflow run" in the log but two yellow dots on screen — looking like a bug.
 *
 * Returns runs grouped by SHA, deduplicated by run.id (a single run can be associated
 * with one SHA, but the same workflow file can produce runs on multiple SHAs).
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {string} headSha - The PR head SHA (used to mark which group is "current")
 * @param {boolean} verbose - Whether to log verbose output
 * @param {Function} getWorkflowRunsForSha - Function to get workflow runs for a SHA
 * @returns {Promise<{groups: Array<{sha: string, isHead: boolean, runs: Array}>, totalActive: number, headActive: number, otherActive: number}>}
 */
export async function getActivePRWorkflowRuns(owner, repo, prNumber, headSha, verbose, getWorkflowRunsForSha) {
  const shas = await getPRCommitShas(owner, repo, prNumber, false);
  if (shas.length === 0) {
    return { groups: [], totalActive: 0, headActive: 0, otherActive: 0 };
  }

  const ACTIVE_STATUSES = new Set(['in_progress', 'pending', 'queued', 'waiting', 'requested']);
  const groups = [];
  const seenRunIds = new Set();
  let totalActive = 0;
  let headActive = 0;
  let otherActive = 0;

  for (const sha of shas) {
    const runs = await getWorkflowRunsForSha(owner, repo, sha, false);
    const activeRuns = runs.filter(r => ACTIVE_STATUSES.has(r.status) && !seenRunIds.has(r.id));
    for (const r of activeRuns) seenRunIds.add(r.id);
    if (activeRuns.length === 0) continue;

    const isHead = sha === headSha;
    groups.push({ sha, isHead, runs: activeRuns });
    totalActive += activeRuns.length;
    if (isHead) headActive += activeRuns.length;
    else otherActive += activeRuns.length;
  }

  if (verbose && totalActive > 0) {
    console.log(`[VERBOSE] pr-commits: ${totalActive} active workflow run(s) across ${groups.length} commit(s) on PR #${prNumber} (${headActive} on HEAD, ${otherActive} on older commits)`);
  }

  return { groups, totalActive, headActive, otherActive };
}

/**
 * Check that workflow runs for ALL commits on the PR branch have completed.
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {boolean} verbose - Whether to log verbose output
 * @param {Function} getWorkflowRunsForSha - Function to get workflow runs for a SHA
 * @returns {Promise<{allComplete: boolean, totalCommits: number, pendingCommits: string[], details: Object[]}>}
 */
export async function checkAllPRCommitsCI(owner, repo, prNumber, verbose, getWorkflowRunsForSha) {
  const shas = await getPRCommitShas(owner, repo, prNumber, verbose);
  if (shas.length === 0) return { allComplete: true, totalCommits: 0, pendingCommits: [], details: [] };

  const details = [];
  const pendingCommits = [];
  for (const sha of shas) {
    const runs = await getWorkflowRunsForSha(owner, repo, sha, false);
    const inProgress = runs.filter(r => r.status !== 'completed');
    const complete = inProgress.length === 0;
    details.push({ sha: sha.substring(0, 7), total: runs.length, inProgress: inProgress.length, complete });
    if (!complete) pendingCommits.push(sha.substring(0, 7));
  }

  if (verbose && pendingCommits.length > 0) {
    console.log(`[VERBOSE] pr-commits: ${pendingCommits.length}/${shas.length} commits have in-progress CI: ${pendingCommits.join(', ')}`);
  }

  return { allComplete: pendingCommits.length === 0, totalCommits: shas.length, pendingCommits, details };
}

/**
 * Multi-mechanism CI consensus check. Requires Check Runs API, Workflow Runs API,
 * and optionally repo-wide active runs to ALL agree before concluding CI is complete.
 * Issue #1573: Also checks all PR commits' CI (not just head SHA) by default.
 * @param {Object} params
 * @returns {Promise<{allAgree: boolean, mechanisms: Object, ciStatus: Object, workflowRuns: Array}>}
 */
export async function checkCIConsensus({ owner, repo, prNumber, sha, waitForAllRepoActionsFlag, verbose, getDetailedCIStatus, getWorkflowRunsForSha }) {
  const ciStatus = await getDetailedCIStatus(owner, repo, prNumber, verbose);
  const checkRunsOK = ciStatus.status === 'success' || ciStatus.status === 'no_checks';

  const workflowRuns = await getWorkflowRunsForSha(owner, repo, sha, verbose);
  const workflowsOK = workflowRuns.length === 0 || workflowRuns.every(r => r.status === 'completed');

  let allCommitsOK = true;
  let allCommitsInfo = null;
  if (checkRunsOK && workflowsOK && prNumber) {
    allCommitsInfo = await checkAllPRCommitsCI(owner, repo, prNumber, verbose, getWorkflowRunsForSha);
    allCommitsOK = allCommitsInfo.allComplete;
  }

  // When enabled, block on ANY active CI/CD run in the repository regardless of branch.
  // This ensures safety when CI/CD pipelines interact or depend on each other.
  let repoOK = true;
  let repoInfo = null;
  if (waitForAllRepoActionsFlag) {
    repoInfo = await getAllActiveRepoRuns(owner, repo, verbose);
    repoOK = !repoInfo.hasActiveRuns;
  }

  const allAgree = checkRunsOK && workflowsOK && allCommitsOK && repoOK;
  const mechanisms = {
    checkRunsAPI: { complete: checkRunsOK, status: ciStatus.status },
    workflowRunsAPI: { complete: workflowsOK, total: workflowRuns.length, inProgress: workflowRuns.filter(r => r.status !== 'completed').length },
    allCommitsCI: allCommitsInfo ? { complete: allCommitsOK, totalCommits: allCommitsInfo.totalCommits, pendingCommits: allCommitsInfo.pendingCommits } : { skipped: true },
    repoActions: waitForAllRepoActionsFlag ? { complete: repoOK, count: repoInfo?.count ?? 0 } : { skipped: true },
  };

  if (verbose) {
    const repoLabel = waitForAllRepoActionsFlag ? `${repoOK}(${repoInfo?.count ?? 0} active)` : 'skip';
    const commitsLabel = allCommitsInfo ? `${allCommitsOK}(${allCommitsInfo.totalCommits} commits${allCommitsInfo.pendingCommits.length > 0 ? `, ${allCommitsInfo.pendingCommits.length} pending` : ''})` : 'skip';
    console.log(`[VERBOSE] consensus: CheckRuns=${checkRunsOK}(${ciStatus.status}), WorkflowRuns=${workflowsOK}(${workflowRuns.length}), AllCommits=${commitsLabel}, RepoActions=${repoLabel} → ${allAgree ? 'AGREE' : 'DISAGREE'}`);
  }
  return { allAgree, mechanisms, ciStatus, workflowRuns };
}
