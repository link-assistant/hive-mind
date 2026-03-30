#!/usr/bin/env node
/**
 * GitHub Repository-Wide Actions Monitoring
 *
 * Issue #1503: Provides functions to check and wait for ALL active GitHub Actions
 * workflow runs across the entire repository (not just PR-specific ones).
 * This is the "absolute safety mechanism" that ensures no interacting CI/CD
 * pipelines can cause false positives.
 *
 * Modeled after the /merge command's waitForBranchCI pattern.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1503
 */

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

/**
 * Get ALL active (in_progress, queued, waiting, requested, pending) workflow runs
 * across the entire repository, regardless of branch.
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{runs: Array, hasActiveRuns: boolean, count: number}>}
 */
export async function getAllActiveRepoRuns(owner, repo, verbose = false) {
  try {
    // Query for all non-completed runs across the entire repository (no branch filter)
    const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?per_page=100" --jq '[.workflow_runs[] | select(.status=="in_progress" or .status=="queued" or .status=="waiting" or .status=="requested" or .status=="pending")] | map({id: .id, name: .name, status: .status, head_branch: .head_branch, head_sha: (.head_sha[:7]), created_at: .created_at, html_url: .html_url})'`);

    const runs = JSON.parse(stdout.trim() || '[]');

    if (verbose) {
      console.log(`[VERBOSE] repo-actions: Found ${runs.length} active run(s) across ${owner}/${repo}`);
      for (const run of runs) {
        console.log(`[VERBOSE] repo-actions:   - Run #${run.id}: ${run.name} (${run.status}) on branch ${run.head_branch} [${run.head_sha}]`);
      }
    }

    return { runs, hasActiveRuns: runs.length > 0, count: runs.length };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] repo-actions: Error checking active repo runs: ${error.message}`);
    }
    return { runs: [], hasActiveRuns: false, count: 0 };
  }
}

/**
 * Wait for ALL active workflow runs in the repository to complete.
 * This is the absolute safety mechanism — it blocks until every single
 * in-progress or queued run across ALL branches finishes.
 *
 * Uses the same pattern as waitForBranchCI from the /merge command.
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Object} options - Wait options
 * @param {number} options.timeout - Maximum wait time in ms (default: 45 minutes)
 * @param {number} options.pollInterval - Polling interval in ms (default: 5 minutes)
 * @param {Function} options.onStatusUpdate - Callback for status updates
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{success: boolean, waitedForRuns: boolean, completedRuns: number, timedOut: boolean, remainingRuns: Array}>}
 */
export async function waitForAllRepoActions(owner, repo, options = {}, verbose = false) {
  const {
    timeout = 45 * 60 * 1000, // 45 minutes
    pollInterval = 5 * 60 * 1000, // 5 minutes (matches user requirement)
    onStatusUpdate = null,
  } = options;

  const startTime = Date.now();
  let totalWaitedRuns = 0;

  if (verbose) {
    console.log(`[VERBOSE] repo-actions: Waiting for ALL active runs in ${owner}/${repo} to complete (timeout: ${timeout / 60000}min, poll: ${pollInterval / 60000}min)...`);
  }

  while (Date.now() - startTime < timeout) {
    let activeRuns;
    try {
      activeRuns = await getAllActiveRepoRuns(owner, repo, verbose);
    } catch (error) {
      console.error(`[ERROR] repo-actions: Error checking active repo runs: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      continue;
    }

    if (onStatusUpdate) {
      try {
        await onStatusUpdate({
          hasActiveRuns: activeRuns.hasActiveRuns,
          count: activeRuns.count,
          runs: activeRuns.runs,
          elapsedMs: Date.now() - startTime,
        });
      } catch (callbackError) {
        console.error(`[ERROR] repo-actions: Status update callback failed: ${callbackError.message}`);
      }
    }

    if (!activeRuns.hasActiveRuns) {
      if (verbose) {
        console.log(`[VERBOSE] repo-actions: No active runs in repository. All CI/CD complete.`);
      }
      return {
        success: true,
        waitedForRuns: totalWaitedRuns > 0,
        completedRuns: totalWaitedRuns,
        timedOut: false,
        remainingRuns: [],
      };
    }

    totalWaitedRuns = Math.max(totalWaitedRuns, activeRuns.count);

    if (verbose) {
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      const runSummary = activeRuns.runs.map(r => `${r.name}(${r.head_branch})`).join(', ');
      console.log(`[VERBOSE] repo-actions: Waiting for ${activeRuns.count} active run(s): ${runSummary} (${elapsedSec}s elapsed)`);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  // Timeout reached
  const finalRuns = await getAllActiveRepoRuns(owner, repo, verbose);
  return {
    success: false,
    waitedForRuns: true,
    completedRuns: totalWaitedRuns,
    timedOut: true,
    remainingRuns: finalRuns.runs,
  };
}

/**
 * Multi-mechanism CI status consensus check.
 * Runs multiple independent CI detection mechanisms and requires agreement
 * before concluding CI is complete. If mechanisms disagree, returns false
 * (indicating retry is needed).
 *
 * Mechanisms used:
 * 1. GitHub Check Runs API (getDetailedCIStatus)
 * 2. GitHub Workflow Runs API (getWorkflowRunsForSha)
 * 3. Repository-wide active runs (getAllActiveRepoRuns) — when enabled
 *
 * @param {Object} params
 * @param {string} params.owner - Repository owner
 * @param {string} params.repo - Repository name
 * @param {number} params.prNumber - PR number
 * @param {string} params.sha - Commit SHA to check
 * @param {boolean} params.waitForAllRepoActions - Whether to also check repo-wide actions
 * @param {boolean} params.verbose - Verbose logging
 * @param {Function} params.getDetailedCIStatus - CI status function
 * @param {Function} params.getWorkflowRunsForSha - Workflow runs function
 * @returns {Promise<{allAgree: boolean, mechanisms: Object}>}
 */
export async function checkCIConsensus(params) {
  const { owner, repo, prNumber, sha, waitForAllRepoActionsFlag, verbose, getDetailedCIStatus, getWorkflowRunsForSha } = params;

  // Mechanism 1: Check Runs API
  const ciStatus = await getDetailedCIStatus(owner, repo, prNumber, verbose);
  const checkRunsComplete = ciStatus.status === 'success' || ciStatus.status === 'no_checks';

  // Mechanism 2: Workflow Runs API
  const workflowRuns = await getWorkflowRunsForSha(owner, repo, sha, verbose);
  const allWorkflowRunsComplete = workflowRuns.length === 0 || workflowRuns.every(r => r.status === 'completed');
  const hasInProgressWorkflows = workflowRuns.some(r => r.status !== 'completed');

  // Mechanism 3: Repository-wide active runs (optional)
  let repoActionsComplete = true;
  let activeRepoRuns = null;
  if (waitForAllRepoActionsFlag) {
    activeRepoRuns = await getAllActiveRepoRuns(owner, repo, verbose);
    repoActionsComplete = !activeRepoRuns.hasActiveRuns;
  }

  const allAgree = checkRunsComplete && allWorkflowRunsComplete && repoActionsComplete;

  const mechanisms = {
    checkRunsAPI: { complete: checkRunsComplete, status: ciStatus.status },
    workflowRunsAPI: { complete: allWorkflowRunsComplete, total: workflowRuns.length, inProgress: workflowRuns.filter(r => r.status !== 'completed').length },
    repoActions: waitForAllRepoActionsFlag ? { complete: repoActionsComplete, count: activeRepoRuns?.count ?? 0 } : { skipped: true },
  };

  if (verbose) {
    console.log(`[VERBOSE] consensus: Check Runs=${checkRunsComplete ? 'complete' : 'pending'}(${ciStatus.status}), Workflow Runs=${allWorkflowRunsComplete ? 'complete' : `${hasInProgressWorkflows ? 'in-progress' : 'pending'}`}(${workflowRuns.length}), Repo Actions=${waitForAllRepoActionsFlag ? (repoActionsComplete ? 'complete' : `active(${activeRepoRuns?.count})`) : 'skipped'} → ${allAgree ? 'CONSENSUS' : 'DISAGREE'}`);
  }

  return { allAgree, mechanisms, ciStatus, workflowRuns };
}
