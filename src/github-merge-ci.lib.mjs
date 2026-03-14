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
 * Issue #1425: Fixed to resolve the actual HEAD SHA first, then check CI for that SHA,
 *              so that in-progress runs on the latest commit are not mistaken for failures.
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branch - Branch name (usually 'main' or 'master')
 * @param {Object} options - Check options (currently unused, kept for API compatibility)
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{healthy: boolean, pending: boolean, failedRuns: Array, pendingRuns: Array, error: string|null}>}
 */
export async function checkBranchCIHealth(owner, repo, branch = 'main', options, verbose = false) {
  try {
    // Issue #1425: First, resolve the actual HEAD SHA of the branch.
    // This avoids the bug where only completed runs are queried: if the latest commit has
    // an in-progress CI run, querying ?status=completed would return the previous commit's
    // runs and could incorrectly report a failure from an older (now superseded) commit.
    let headSha;
    try {
      const { stdout: refOut } = await exec(`gh api "repos/${owner}/${repo}/git/ref/heads/${branch}" --jq '.object.sha'`);
      headSha = refOut.trim();
    } catch (refError) {
      if (verbose) {
        console.log(`[VERBOSE] /merge: Error resolving HEAD SHA for ${branch}: ${refError.message}`);
      }
      // On error, assume healthy to avoid blocking merges due to API issues
      return { healthy: true, pending: false, failedRuns: [], pendingRuns: [], error: null };
    }

    if (!headSha) {
      if (verbose) {
        console.log(`[VERBOSE] /merge: Could not resolve HEAD SHA for ${branch}, assuming healthy`);
      }
      return { healthy: true, pending: false, failedRuns: [], pendingRuns: [], error: null };
    }

    if (verbose) {
      console.log(`[VERBOSE] /merge: Checking CI for latest ${branch} commit ${headSha.substring(0, 7)}`);
    }

    // Issue #1425: Query CI runs specifically for the HEAD SHA (no status filter).
    // This ensures we see in-progress runs for the latest commit, not just completed ones.
    const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?head_sha=${headSha}&per_page=20" --jq '[.workflow_runs[] | {id: .id, name: .name, status: .status, conclusion: .conclusion, html_url: .html_url, head_sha: .head_sha, created_at: .created_at}]'`);
    const runs = JSON.parse(stdout.trim() || '[]');

    if (verbose) {
      console.log(`[VERBOSE] /merge: Found ${runs.length} CI run(s) for HEAD commit ${headSha.substring(0, 7)} on ${owner}/${repo} branch ${branch}`);
    }

    if (runs.length === 0) {
      // No runs for the latest commit - CI may not have started yet or is not configured.
      // Assume healthy to avoid blocking merges.
      return { healthy: true, pending: false, failedRuns: [], pendingRuns: [], error: null };
    }

    // Issue #1425: Check for in-progress runs on the latest commit.
    // If the latest commit's CI is still running, we should NOT report failure —
    // the previous commit's failure (which may appear in completed runs) is no longer relevant.
    const pendingRuns = runs.filter(r => r.status === 'in_progress' || r.status === 'queued' || r.status === 'waiting' || r.status === 'requested' || r.status === 'pending');
    if (pendingRuns.length > 0) {
      if (verbose) {
        console.log(`[VERBOSE] /merge: ${pendingRuns.length} CI run(s) still in progress on ${branch} (latest commit ${headSha.substring(0, 7)})`);
        for (const run of pendingRuns) {
          console.log(`[VERBOSE] /merge:   - ${run.name}: ${run.status} (${run.html_url})`);
        }
      }
      // Healthy but pending: caller should wait for CI rather than block the queue
      return { healthy: true, pending: true, failedRuns: [], pendingRuns, error: null };
    }

    // All runs for the latest commit are completed — check for failures
    const failedRuns = runs.filter(r => r.conclusion === 'failure' || r.conclusion === 'timed_out');

    if (failedRuns.length > 0) {
      if (verbose) {
        console.log(`[VERBOSE] /merge: Found ${failedRuns.length} failed CI run(s) on ${branch} (latest commit ${headSha.substring(0, 7)}):`);
        for (const run of failedRuns) {
          console.log(`[VERBOSE] /merge:   - ${run.name}: ${run.conclusion} (${run.html_url})`);
        }
      }
      return {
        healthy: false,
        pending: false,
        failedRuns,
        pendingRuns: [],
        error: `${failedRuns.length} CI run(s) failed on ${branch}: ${failedRuns.map(r => r.name).join(', ')}`,
      };
    }

    if (verbose) {
      console.log(`[VERBOSE] /merge: Branch ${branch} CI is healthy (${runs.length} run(s) passed for commit ${headSha.substring(0, 7)})`);
    }

    return { healthy: true, pending: false, failedRuns: [], pendingRuns: [], error: null };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error checking branch CI health: ${error.message}`);
    }
    // On error, assume healthy to avoid blocking merges due to API issues
    return { healthy: true, pending: false, failedRuns: [], pendingRuns: [], error: null };
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
