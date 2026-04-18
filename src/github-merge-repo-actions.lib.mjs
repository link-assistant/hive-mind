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

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
const exec = promisify(execCallback);

/**
 * Get ALL active workflow runs across the entire repository (no branch filter).
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{runs: Array, hasActiveRuns: boolean, count: number}>}
 */
export async function getAllActiveRepoRuns(owner, repo, verbose = false) {
  try {
    const activeFilter = '.workflow_runs[] | select(.status=="in_progress" or .status=="queued" or .status=="waiting" or .status=="requested" or .status=="pending")';
    const fields = '{id: .id, name: .name, status: .status, head_branch: .head_branch, head_sha: (.head_sha[:7])}';
    const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?per_page=100" --jq '[${activeFilter}] | map(${fields})'`);
    const runs = JSON.parse(stdout.trim() || '[]');
    if (verbose && runs.length > 0) {
      console.log(`[VERBOSE] repo-actions: ${runs.length} active run(s) in ${owner}/${repo}`);
      for (const r of runs) console.log(`[VERBOSE] repo-actions:   ${r.name} (${r.status}) on ${r.head_branch}`);
    }
    return { runs, hasActiveRuns: runs.length > 0, count: runs.length };
  } catch {
    return { runs: [], hasActiveRuns: false, count: 0 };
  }
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
    const active = await getAllActiveRepoRuns(owner, repo, verbose);
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
  const finalRuns = await getAllActiveRepoRuns(owner, repo, verbose);
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
