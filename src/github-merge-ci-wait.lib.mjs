#!/usr/bin/env node
/**
 * GitHub Merge CI Wait Loops
 *
 * The long-running CI polling loops used by the /merge command.
 * Split from github-merge.lib.mjs to maintain file size limits.
 *
 * Every wait here is cancellable: the poll delay is slept in short steps via
 * `cancellableSleep`, so pressing the Cancel button takes effect within ~100ms
 * instead of after a full poll interval.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2072
 */

import { checkPRCIStatus, getActiveBranchRuns } from './github-merge.lib.mjs';
import { cancellableSleep } from './interruptible-sleep.lib.mjs';

/**
 * Wait for CI/CD to complete with polling
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {Object} options - Wait options
 * @param {number} options.timeout - Maximum wait time in ms (default: 30 minutes)
 * @param {number} options.pollInterval - Polling interval in ms (default: 30 seconds)
 * @param {Function} options.onStatusUpdate - Callback for status updates
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{success: boolean, status: string, error: string|null}>}
 */
export async function waitForCI(owner, repo, prNumber, options = {}, verbose = false) {
  const {
    timeout = 30 * 60 * 1000,
    pollInterval = 30 * 1000,
    onStatusUpdate = null,
    // Issue #1269: Add timeout for callback to prevent infinite blocking
    callbackTimeout = 60 * 1000, // 1 minute max for callback
    isCancelled = null, // Issue #1407: Support early exit when cancellation is requested
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    // Issue #1407: Check for cancellation before each poll to allow early exit
    if (isCancelled?.()) return { success: false, status: 'cancelled', error: 'Operation was cancelled' };

    let ciStatus;
    try {
      ciStatus = await checkPRCIStatus(owner, repo, prNumber, verbose);
    } catch (error) {
      // Issue #1269: Log and continue on CI check errors instead of crashing
      console.error(`[ERROR] /merge: Error checking CI status for PR #${prNumber}: ${error.message}`);
      verbose && console.error(`[VERBOSE] /merge: CI check error details:`, error);
      // Wait and retry
      await cancellableSleep(pollInterval, isCancelled);
      continue;
    }

    if (onStatusUpdate) {
      // Issue #1269: Wrap callback with timeout to prevent infinite blocking; #1346: capture and clear timeout handle to prevent dangling timer
      try {
        let callbackTimeoutId;
        await Promise.race([
          onStatusUpdate(ciStatus),
          new Promise((_, reject) => {
            callbackTimeoutId = setTimeout(() => reject(new Error(`Callback timeout after ${callbackTimeout}ms`)), callbackTimeout);
          }),
        ]).finally(() => clearTimeout(callbackTimeoutId));
      } catch (callbackError) {
        // Issue #1269: Log callback errors but continue processing
        console.error(`[ERROR] /merge: Status update callback failed for PR #${prNumber}: ${callbackError.message}`);
        verbose && console.error(`[VERBOSE] /merge: Callback error details:`, callbackError);
        // Continue processing even if callback fails - don't let UI issues block merging
      }
    }

    if (ciStatus.status === 'success') {
      return { success: true, status: 'success', error: null };
    }

    if (ciStatus.status === 'failure') {
      return { success: false, status: 'failure', error: 'CI checks failed' };
    }

    if (ciStatus.status === 'terminal_github_entity_error') {
      return {
        success: false,
        status: 'terminal_github_entity_error',
        error: ciStatus.error || 'GitHub repository, pull request, issue, or branch is no longer accessible',
      };
    }

    if (ciStatus.status === 'pending') {
      if (verbose) {
        console.log(`[VERBOSE] /merge: Waiting for CI... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
      }
      await cancellableSleep(pollInterval, isCancelled);
      continue;
    }

    // Unknown status - wait and retry
    await cancellableSleep(pollInterval, isCancelled);
  }

  return { success: false, status: 'timeout', error: 'CI check timeout exceeded' };
}

/**
 * Wait for all active workflow runs on a branch to complete
 * Issue #1307: Ensures all CI runs on target branch are complete before merging
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branch - Branch name (default: main)
 * @param {Object} options - Wait options
 * @param {number} options.timeout - Maximum wait time in ms (default: 45 minutes)
 * @param {number} options.pollInterval - Polling interval in ms (default: 30 seconds)
 * @param {Function} options.onStatusUpdate - Callback for status updates
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{success: boolean, waitedForRuns: boolean, completedRuns: number, error: string|null}>}
 */
export async function waitForBranchCI(owner, repo, branch = 'main', options = {}, verbose = false) {
  const { timeout = 45 * 60 * 1000, pollInterval = 30 * 1000, onStatusUpdate = null, isCancelled = null } = options;

  const startTime = Date.now();
  let totalWaitedRuns = 0;

  if (verbose) {
    console.log(`[VERBOSE] /merge: Checking for active CI runs on ${owner}/${repo} branch ${branch}...`);
  }

  while (Date.now() - startTime < timeout) {
    if (isCancelled?.()) return { success: false, waitedForRuns: totalWaitedRuns > 0, completedRuns: totalWaitedRuns, error: 'Operation was cancelled' };
    let activeRuns;
    try {
      activeRuns = await getActiveBranchRuns(owner, repo, branch, verbose);
    } catch (error) {
      // Log and continue on errors
      console.error(`[ERROR] /merge: Error checking branch CI: ${error.message}`);
      await cancellableSleep(pollInterval, isCancelled);
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
        // Log callback errors but continue
        console.error(`[ERROR] /merge: Status update callback failed: ${callbackError.message}`);
      }
    }

    if (!activeRuns.hasActiveRuns) {
      if (verbose) {
        console.log(`[VERBOSE] /merge: No active CI runs on ${branch} branch. Ready to proceed.`);
      }
      return {
        success: true,
        waitedForRuns: totalWaitedRuns > 0,
        completedRuns: totalWaitedRuns,
        error: null,
      };
    }

    totalWaitedRuns = Math.max(totalWaitedRuns, activeRuns.count);

    if (verbose) {
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      console.log(`[VERBOSE] /merge: Waiting for ${activeRuns.count} active runs on ${branch}... (${elapsedSec}s elapsed)`);
    }

    await cancellableSleep(pollInterval, isCancelled);
  }

  // Issue #2072: a cancel landing as the timeout expires must still report 'cancelled'
  // rather than falling through to the extra API round-trip below.
  if (isCancelled?.()) return { success: false, waitedForRuns: totalWaitedRuns > 0, completedRuns: totalWaitedRuns, error: 'Operation was cancelled' };

  // Timeout reached
  // Issue #1722: if the final check throws, do NOT silently report "ready".
  // Treat it the same as still-active (force a timeout failure), so /merge
  // waits/retries instead of merging on top of a still-running CI run.
  let finalCheck;
  try {
    finalCheck = await getActiveBranchRuns(owner, repo, branch, verbose);
  } catch (error) {
    return {
      success: false,
      waitedForRuns: true,
      completedRuns: totalWaitedRuns,
      error: `Timeout reached and final CI check failed on ${branch}: ${error.message}`,
    };
  }
  if (finalCheck.hasActiveRuns) {
    return {
      success: false,
      waitedForRuns: true,
      completedRuns: totalWaitedRuns - finalCheck.count,
      error: `Timeout waiting for ${finalCheck.count} CI runs on ${branch} branch`,
    };
  }

  return {
    success: true,
    waitedForRuns: totalWaitedRuns > 0,
    completedRuns: totalWaitedRuns,
    error: null,
  };
}

export default {
  waitForCI,
  waitForBranchCI,
};
