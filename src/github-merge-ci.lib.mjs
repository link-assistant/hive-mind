#!/usr/bin/env node
/**
 * GitHub Merge Queue CI Monitoring Library
 *
 * Provides utilities for monitoring CI/CD status on commits and branches.
 * Split from github-merge.lib.mjs to maintain file size limits.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1341
 */

import { getWorkflowRunsForSha } from './github-merge.lib.mjs';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

/**
 * Wait for all workflow runs triggered by a specific commit to complete
 * Issue #1341: Used to wait for post-merge CI before processing the next PR
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} sha - Commit SHA to monitor
 * @param {Object} options - Wait options
 * @param {number} options.timeout - Maximum wait time in ms (default: 60 minutes)
 * @param {number} options.pollInterval - Polling interval in ms (default: 30 seconds)
 * @param {Function} options.onStatusUpdate - Callback for status updates
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{success: boolean, status: string, runs: Array, failedRuns: Array, error: string|null}>}
 */
export async function waitForCommitCI(owner, repo, sha, options = {}, verbose = false) {
  const { timeout = 60 * 60 * 1000, pollInterval = 30 * 1000, onStatusUpdate = null } = options;

  const startTime = Date.now();
  let noRunsIterations = 0;
  const MAX_NO_RUNS_ITERATIONS = 10; // Wait up to ~5 minutes for runs to appear

  if (verbose) {
    console.log(`[VERBOSE] /merge: Waiting for CI runs on commit ${sha.substring(0, 7)} to complete...`);
  }

  while (Date.now() - startTime < timeout) {
    let runs;
    try {
      runs = await getWorkflowRunsForSha(owner, repo, sha, verbose);
    } catch (error) {
      console.error(`[ERROR] /merge: Error checking commit CI: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      continue;
    }

    // Handle case where no runs exist yet (CI hasn't started)
    if (runs.length === 0) {
      noRunsIterations++;
      if (noRunsIterations >= MAX_NO_RUNS_ITERATIONS) {
        // No CI runs after waiting - assume no CI is configured or it's optional
        if (verbose) {
          console.log(`[VERBOSE] /merge: No CI runs found for commit ${sha.substring(0, 7)} after ${MAX_NO_RUNS_ITERATIONS} checks. Proceeding.`);
        }
        return { success: true, status: 'no_runs', runs: [], failedRuns: [], error: null };
      }
      if (verbose) {
        console.log(`[VERBOSE] /merge: No CI runs yet for commit ${sha.substring(0, 7)} (attempt ${noRunsIterations}/${MAX_NO_RUNS_ITERATIONS}). Waiting...`);
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      continue;
    }

    // Reset counter when runs appear
    noRunsIterations = 0;

    // Check run statuses
    const completedRuns = runs.filter(r => r.status === 'completed');
    const inProgressRuns = runs.filter(r => r.status === 'in_progress' || r.status === 'queued' || r.status === 'waiting' || r.status === 'requested' || r.status === 'pending');
    const failedRuns = completedRuns.filter(r => r.conclusion === 'failure' || r.conclusion === 'timed_out' || r.conclusion === 'cancelled');
    const successRuns = completedRuns.filter(r => r.conclusion === 'success' || r.conclusion === 'skipped' || r.conclusion === 'neutral');

    // Report status
    if (onStatusUpdate) {
      try {
        await onStatusUpdate({
          sha,
          totalRuns: runs.length,
          completedRuns: completedRuns.length,
          inProgressRuns: inProgressRuns.length,
          failedRuns: failedRuns.length,
          successRuns: successRuns.length,
          runs,
          elapsedMs: Date.now() - startTime,
        });
      } catch (callbackError) {
        console.error(`[ERROR] /merge: Status update callback failed: ${callbackError.message}`);
      }
    }

    // All runs completed
    if (inProgressRuns.length === 0) {
      // Check for failures
      if (failedRuns.length > 0) {
        if (verbose) {
          console.log(`[VERBOSE] /merge: CI completed with ${failedRuns.length} failure(s) for commit ${sha.substring(0, 7)}`);
          for (const run of failedRuns) {
            console.log(`[VERBOSE] /merge:   - FAILED: ${run.name} (${run.conclusion}): ${run.html_url}`);
          }
        }
        return {
          success: false,
          status: 'failure',
          runs,
          failedRuns,
          error: `${failedRuns.length} CI run(s) failed: ${failedRuns.map(r => r.name).join(', ')}`,
        };
      }

      // All passed
      if (verbose) {
        console.log(`[VERBOSE] /merge: All ${completedRuns.length} CI runs passed for commit ${sha.substring(0, 7)}`);
      }
      return { success: true, status: 'success', runs, failedRuns: [], error: null };
    }

    // Still waiting
    if (verbose) {
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      console.log(`[VERBOSE] /merge: Waiting for ${inProgressRuns.length} CI run(s) to complete... (${elapsedSec}s elapsed)`);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  // Timeout reached
  return {
    success: false,
    status: 'timeout',
    runs: await getWorkflowRunsForSha(owner, repo, sha, verbose),
    failedRuns: [],
    error: `Timeout waiting for CI runs on commit ${sha.substring(0, 7)}`,
  };
}

/**
 * Check if the default branch has any recent failed CI runs
 * Issue #1341: Used to detect pre-existing failures before starting the merge queue
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branch - Branch name (usually 'main' or 'master')
 * @param {Object} options - Check options
 * @param {number} options.lookbackCount - Number of recent runs to check (default: 5)
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{healthy: boolean, failedRuns: Array, error: string|null}>}
 */
export async function checkBranchCIHealth(owner, repo, branch = 'main', options = {}, verbose = false) {
  const { lookbackCount = 5 } = options;

  try {
    // Get recent completed workflow runs on the branch
    const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?branch=${branch}&status=completed&per_page=${lookbackCount}" --jq '[.workflow_runs[] | {id: .id, name: .name, status: .status, conclusion: .conclusion, html_url: .html_url, head_sha: .head_sha, created_at: .created_at}]'`);
    const runs = JSON.parse(stdout.trim() || '[]');

    if (verbose) {
      console.log(`[VERBOSE] /merge: Checking ${runs.length} recent CI runs on ${owner}/${repo} branch ${branch}`);
    }

    if (runs.length === 0) {
      // No recent runs - assume healthy
      return { healthy: true, failedRuns: [], error: null };
    }

    // Check for failures in the most recent run(s)
    const latestSha = runs[0].head_sha;
    const latestRuns = runs.filter(r => r.head_sha === latestSha);
    const failedRuns = latestRuns.filter(r => r.conclusion === 'failure' || r.conclusion === 'timed_out');

    if (failedRuns.length > 0) {
      if (verbose) {
        console.log(`[VERBOSE] /merge: Found ${failedRuns.length} failed CI run(s) on ${branch}:`);
        for (const run of failedRuns) {
          console.log(`[VERBOSE] /merge:   - ${run.name}: ${run.conclusion} (${run.html_url})`);
        }
      }
      return {
        healthy: false,
        failedRuns,
        error: `${failedRuns.length} CI run(s) failed on ${branch}: ${failedRuns.map(r => r.name).join(', ')}`,
      };
    }

    if (verbose) {
      console.log(`[VERBOSE] /merge: Branch ${branch} CI is healthy (${latestRuns.length} runs checked)`);
    }

    return { healthy: true, failedRuns: [], error: null };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error checking branch CI health: ${error.message}`);
    }
    // On error, assume healthy to avoid blocking merges due to API issues
    return { healthy: true, failedRuns: [], error: null };
  }
}

/**
 * Get the merge commit SHA for a merged pull request
 * Issue #1341: Used to track the commit that triggers post-merge CI
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{sha: string|null, error: string|null}>}
 */
export async function getMergeCommitSha(owner, repo, prNumber, verbose = false) {
  try {
    const { stdout } = await exec(`gh pr view ${prNumber} --repo ${owner}/${repo} --json mergeCommit --jq '.mergeCommit.oid'`);
    const sha = stdout.trim();

    if (!sha || sha === 'null') {
      if (verbose) {
        console.log(`[VERBOSE] /merge: PR #${prNumber} has no merge commit (may not be merged yet)`);
      }
      return { sha: null, error: 'PR is not merged or merge commit not available' };
    }

    if (verbose) {
      console.log(`[VERBOSE] /merge: PR #${prNumber} merge commit: ${sha.substring(0, 7)}`);
    }

    return { sha, error: null };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error getting merge commit for PR #${prNumber}: ${error.message}`);
    }
    return { sha: null, error: error.message };
  }
}

export default {
  waitForCommitCI,
  checkBranchCIHealth,
  getMergeCommitSha,
};
