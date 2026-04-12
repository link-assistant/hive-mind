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
 * Multi-mechanism CI consensus check. Requires Check Runs API, Workflow Runs API,
 * and optionally repo-wide active runs to ALL agree before concluding CI is complete.
 * @param {Object} params
 * @returns {Promise<{allAgree: boolean, mechanisms: Object, ciStatus: Object, workflowRuns: Array}>}
 */
export async function checkCIConsensus({ owner, repo, prNumber, sha, waitForAllRepoActionsFlag, verbose, getDetailedCIStatus, getWorkflowRunsForSha, prBranch }) {
  const ciStatus = await getDetailedCIStatus(owner, repo, prNumber, verbose);
  const checkRunsOK = ciStatus.status === 'success' || ciStatus.status === 'no_checks';

  const workflowRuns = await getWorkflowRunsForSha(owner, repo, sha, verbose);
  const workflowsOK = workflowRuns.length === 0 || workflowRuns.every(r => r.status === 'completed');

  let repoOK = true;
  let repoInfo = null;
  let filteredCount = 0;
  if (waitForAllRepoActionsFlag) {
    repoInfo = await getAllActiveRepoRuns(owner, repo, verbose);
    if (repoInfo.hasActiveRuns && checkRunsOK && workflowsOK && prBranch) {
      // Issue #1573: When the PR's own CI is fully passing, only block on runs
      // from the PR's own branch — not unrelated branches in the same repo.
      const relevantRuns = repoInfo.runs.filter(r => r.head_branch === prBranch);
      filteredCount = repoInfo.count - relevantRuns.length;
      if (verbose && filteredCount > 0) {
        const skipped = repoInfo.runs.filter(r => r.head_branch !== prBranch);
        for (const r of skipped) console.log(`[VERBOSE] consensus: skipping unrelated run "${r.name}" (${r.status}) on branch ${r.head_branch}`);
      }
      repoOK = relevantRuns.length === 0;
    } else {
      repoOK = !repoInfo.hasActiveRuns;
    }
  }

  const allAgree = checkRunsOK && workflowsOK && repoOK;
  const relevantCount = (repoInfo?.count ?? 0) - filteredCount;
  const mechanisms = {
    checkRunsAPI: { complete: checkRunsOK, status: ciStatus.status },
    workflowRunsAPI: { complete: workflowsOK, total: workflowRuns.length, inProgress: workflowRuns.filter(r => r.status !== 'completed').length },
    repoActions: waitForAllRepoActionsFlag ? { complete: repoOK, count: relevantCount, filteredCount } : { skipped: true },
  };

  if (verbose) {
    const repoLabel = waitForAllRepoActionsFlag ? `${repoOK}(${relevantCount} relevant${filteredCount > 0 ? `, ${filteredCount} skipped` : ''})` : 'skip';
    console.log(`[VERBOSE] consensus: CheckRuns=${checkRunsOK}(${ciStatus.status}), WorkflowRuns=${workflowsOK}(${workflowRuns.length}), RepoActions=${repoLabel} → ${allAgree ? 'AGREE' : 'DISAGREE'}`);
  }
  return { allAgree, mechanisms, ciStatus, workflowRuns };
}
