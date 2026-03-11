#!/usr/bin/env node
/**
 * Telegram Merge Queue Library
 *
 * Sequential merge processing for the /merge command.
 * Processes PRs one by one, waiting for CI/CD to complete after each merge.
 *
 * Features:
 * - Sequential PR processing (one at a time)
 * - CI/CD status monitoring after each merge (every 5 minutes)
 * - Progress updates to Telegram with progress bar in code block
 * - Cancelable operations via inline button
 * - Error handling with verbose logs vs user-friendly messages
 * - Per-repository concurrency control
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1143
 */

import { getAllReadyPRs, checkPRCIStatus, checkPRMergeable, mergePullRequest, waitForCI, ensureReadyLabel, waitForBranchCI, getDefaultBranch, waitForCommitCI, checkBranchCIHealth, getMergeCommitSha, syncReadyTags } from './github-merge.lib.mjs';
import { mergeQueue as mergeQueueConfig } from './config.lib.mjs';
import { getProgressBar } from './limits.lib.mjs';

/**
 * Status enum for merge queue operations
 */
export const MergeStatus = {
  IDLE: 'idle',
  RUNNING: 'running',
  PAUSED: 'paused',
  COMPLETED: 'completed',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

/**
 * Status enum for individual merge items
 */
export const MergeItemStatus = {
  PENDING: 'pending',
  CHECKING_CI: 'checking_ci',
  WAITING_CI: 'waiting_ci',
  READY_TO_MERGE: 'ready_to_merge',
  MERGING: 'merging',
  MERGED: 'merged',
  FAILED: 'failed',
  SKIPPED: 'skipped',
};

/**
 * Configuration for merge queue operations
 * Values are loaded from config.lib.mjs which supports environment variable overrides.
 *
 * Configurable via environment variables:
 * - HIVE_MIND_MERGE_QUEUE_MAX_PRS: Maximum PRs per session (default: 10)
 * - HIVE_MIND_MERGE_QUEUE_CI_POLL_INTERVAL_MS: CI polling interval (default: 300000 = 5 minutes)
 * - HIVE_MIND_MERGE_QUEUE_CI_TIMEOUT_MS: CI timeout (default: 1800000 = 30 minutes)
 * - HIVE_MIND_MERGE_QUEUE_POST_MERGE_WAIT_MS: Post-merge wait (default: 10000 = 10 seconds)
 * - HIVE_MIND_MERGE_QUEUE_MERGE_METHOD: Merge method (default: 'merge', options: 'merge', 'squash', 'rebase')
 */
export const MERGE_QUEUE_CONFIG = {
  // CI/CD wait settings - check every 5 minutes per issue #1143 feedback
  CI_POLL_INTERVAL_MS: mergeQueueConfig.ciPollIntervalMs,
  CI_TIMEOUT_MS: mergeQueueConfig.ciTimeoutMs,

  // Post-merge wait settings
  POST_MERGE_WAIT_MS: mergeQueueConfig.postMergeWaitMs,

  // Telegram message update interval - same as CI polling
  MESSAGE_UPDATE_INTERVAL_MS: mergeQueueConfig.ciPollIntervalMs,

  // Maximum PRs to process in one session (configurable, default 10)
  MAX_PRS_PER_SESSION: mergeQueueConfig.maxPrsPerSession,

  // Merge method: 'merge', 'squash', or 'rebase' (Issue #1269)
  // gh pr merge requires explicit method when running non-interactively
  MERGE_METHOD: mergeQueueConfig.mergeMethod,

  // Issue #1307: Wait for target branch CI before first merge
  WAIT_FOR_TARGET_BRANCH_CI: mergeQueueConfig.waitForTargetBranchCI,
  TARGET_BRANCH_CI_TIMEOUT_MS: mergeQueueConfig.targetBranchCITimeoutMs,
  TARGET_BRANCH_CI_POLL_INTERVAL_MS: mergeQueueConfig.targetBranchCIPollIntervalMs,

  // Issue #1341: Wait for post-merge CI to complete before merging next PR
  WAIT_FOR_POST_MERGE_CI: mergeQueueConfig.waitForPostMergeCI,
  STOP_ON_POST_MERGE_CI_FAILURE: mergeQueueConfig.stopOnPostMergeCIFailure,
  CHECK_BRANCH_CI_HEALTH_BEFORE_START: mergeQueueConfig.checkBranchCIHealthBeforeStart,
  POST_MERGE_CI_TIMEOUT_MS: mergeQueueConfig.postMergeCITimeoutMs,
  POST_MERGE_CI_POLL_INTERVAL_MS: mergeQueueConfig.postMergeCIPollIntervalMs,
};

/**
 * Merge queue item representing a PR to merge
 */
class MergeQueueItem {
  constructor(prData) {
    this.pr = prData.pr;
    this.issue = prData.issue || null;
    this.sortDate = prData.sortDate || new Date(prData.pr.createdAt);
    this.status = MergeItemStatus.PENDING;
    this.error = null;
    this.ciStatus = null;
    this.startedAt = null;
    this.completedAt = null;
    // Issue #1341: Track merge commit SHA for post-merge CI waiting
    this.mergeCommitSha = null;
  }

  /**
   * Get a display-friendly description
   */
  getDescription() {
    const issueRef = this.issue ? ` (Issue #${this.issue.number})` : '';
    return `PR #${this.pr.number}: ${this.pr.title}${issueRef}`;
  }

  /**
   * Get emoji for current status
   */
  getStatusEmoji() {
    switch (this.status) {
      case MergeItemStatus.PENDING:
        return '⏳';
      case MergeItemStatus.CHECKING_CI:
        return '🔍';
      case MergeItemStatus.WAITING_CI:
        return '⏱️';
      case MergeItemStatus.READY_TO_MERGE:
        return '✅';
      case MergeItemStatus.MERGING:
        return '🔄';
      case MergeItemStatus.MERGED:
        return '✅';
      case MergeItemStatus.FAILED:
        return '❌';
      case MergeItemStatus.SKIPPED:
        return '⏭️';
      default:
        return '❓';
    }
  }
}

/**
 * Merge Queue Processor
 * Handles sequential merging of PRs with CI/CD monitoring
 */
export class MergeQueueProcessor {
  constructor(options = {}) {
    this.owner = options.owner;
    this.repo = options.repo;
    this.verbose = options.verbose || false;
    this.onProgress = options.onProgress || null;
    this.onComplete = options.onComplete || null;
    this.onError = options.onError || null;

    // State
    this.items = [];
    this.currentIndex = 0;
    this.status = MergeStatus.IDLE;
    this.isCancelled = false;
    this.startedAt = null;
    this.completedAt = null;
    this.error = null;

    // Statistics
    this.stats = {
      total: 0,
      merged: 0,
      failed: 0,
      skipped: 0,
    };
  }

  /**
   * Log message if verbose mode is enabled
   */
  log(message) {
    if (this.verbose) {
      console.log(`[VERBOSE] /merge-queue: ${message}`);
    }
  }

  /**
   * Initialize the merge queue by fetching ready PRs
   * @returns {Promise<{success: boolean, error: string|null}>}
   */
  async initialize() {
    try {
      this.log(`Initializing merge queue for ${this.owner}/${this.repo}`);

      // Ensure ready label exists
      const labelResult = await ensureReadyLabel(this.owner, this.repo, this.verbose);
      if (!labelResult.success) {
        return { success: false, error: labelResult.error };
      }
      if (labelResult.created) {
        this.log("Created 'ready' label in repository");
      }

      // Issue #1367: Sync 'ready' tags between linked PRs and issues before collecting the queue
      // This ensures the final list reflects all ready work regardless of where the tag was applied
      const syncResult = await syncReadyTags(this.owner, this.repo, this.verbose);
      if (syncResult.synced > 0) {
        this.log(`Synced 'ready' tag: ${syncResult.synced} item(s) updated`);
      }
      if (syncResult.errors > 0) {
        this.log(`Tag sync had ${syncResult.errors} error(s) (non-fatal, proceeding)`);
      }

      // Fetch all ready PRs
      const readyPRs = await getAllReadyPRs(this.owner, this.repo, this.verbose);

      if (readyPRs.length === 0) {
        return { success: true, error: null, message: "No PRs with 'ready' label found" };
      }

      // Limit to max PRs per session
      const limitedPRs = readyPRs.slice(0, MERGE_QUEUE_CONFIG.MAX_PRS_PER_SESSION);

      // Create queue items
      this.items = limitedPRs.map(pr => new MergeQueueItem(pr));
      this.stats.total = this.items.length;

      this.log(`Initialized with ${this.items.length} PRs to merge`);

      return {
        success: true,
        error: null,
        count: this.items.length,
        truncated: readyPRs.length > MERGE_QUEUE_CONFIG.MAX_PRS_PER_SESSION,
      };
    } catch (error) {
      this.log(`Initialization error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start processing the merge queue
   * @returns {Promise<{success: boolean, stats: Object, error: string|null}>}
   */
  async run() {
    if (this.status === MergeStatus.RUNNING) {
      return { success: false, stats: this.stats, error: 'Queue is already running' };
    }

    if (this.items.length === 0) {
      return { success: true, stats: this.stats, error: null };
    }

    this.status = MergeStatus.RUNNING;
    this.startedAt = new Date();
    this.isCancelled = false;

    try {
      // Issue #1341: Check if the default branch has any failed CI runs before starting
      // This prevents merging on top of a broken branch
      if (MERGE_QUEUE_CONFIG.CHECK_BRANCH_CI_HEALTH_BEFORE_START) {
        const healthCheckResult = await this.checkBranchCIHealthBeforeStart();
        if (!healthCheckResult.healthy) {
          this.status = MergeStatus.FAILED;
          this.error = healthCheckResult.error;
          this.completedAt = new Date();
          // Store the failed runs for the error report
          this.branchCIFailedRuns = healthCheckResult.failedRuns;

          if (this.onError) {
            await this.onError(new Error(healthCheckResult.error));
          }

          return {
            success: false,
            stats: this.stats,
            error: healthCheckResult.error,
          };
        }
      }

      // Issue #1307: Wait for any active CI runs on the target branch before processing
      // This prevents merging while post-merge CI from previous merges is still running
      if (MERGE_QUEUE_CONFIG.WAIT_FOR_TARGET_BRANCH_CI) {
        await this.waitForTargetBranchCI();
      }

      // Process each PR sequentially
      for (this.currentIndex = 0; this.currentIndex < this.items.length; this.currentIndex++) {
        if (this.isCancelled) {
          this.status = MergeStatus.CANCELLED;
          break;
        }

        const item = this.items[this.currentIndex];
        await this.processItem(item);

        // Report progress
        if (this.onProgress) {
          await this.onProgress(this.getProgressUpdate());
        }

        // Issue #1341: If merged successfully, wait for post-merge CI to complete
        // This ensures each PR's CI completes (including releases) before merging the next
        if (item.status === MergeItemStatus.MERGED && this.currentIndex < this.items.length - 1) {
          if (MERGE_QUEUE_CONFIG.WAIT_FOR_POST_MERGE_CI && item.mergeCommitSha) {
            const postMergeCIResult = await this.waitForPostMergeCI(item);

            // Issue #1341: Stop the queue if post-merge CI failed
            if (!postMergeCIResult.success && MERGE_QUEUE_CONFIG.STOP_ON_POST_MERGE_CI_FAILURE) {
              this.status = MergeStatus.FAILED;
              this.error = postMergeCIResult.error;
              this.completedAt = new Date();
              // Store the failed runs for the error report
              this.postMergeCIFailedRuns = postMergeCIResult.failedRuns;

              if (this.onError) {
                await this.onError(new Error(postMergeCIResult.error));
              }

              return {
                success: false,
                stats: this.stats,
                error: postMergeCIResult.error,
              };
            }
          } else {
            // Fallback: short wait before processing next PR
            this.log(`Waiting ${MERGE_QUEUE_CONFIG.POST_MERGE_WAIT_MS / 1000}s before next PR...`);
            await this.sleep(MERGE_QUEUE_CONFIG.POST_MERGE_WAIT_MS);
          }
        }
      }

      this.completedAt = new Date();
      this.status = this.isCancelled ? MergeStatus.CANCELLED : MergeStatus.COMPLETED;

      if (this.onComplete) {
        await this.onComplete(this.getFinalReport());
      }

      return {
        success: true,
        stats: this.stats,
        error: null,
      };
    } catch (error) {
      this.status = MergeStatus.FAILED;
      this.error = error.message;
      this.completedAt = new Date();

      if (this.onError) {
        await this.onError(error);
      }

      return {
        success: false,
        stats: this.stats,
        error: error.message,
      };
    }
  }

  /**
   * Process a single merge queue item
   * @param {MergeQueueItem} item
   */
  async processItem(item) {
    this.log(`Processing ${item.getDescription()}`);
    item.startedAt = new Date();

    try {
      // Step 1: Check if PR is mergeable
      item.status = MergeItemStatus.CHECKING_CI;
      const mergeableCheck = await checkPRMergeable(this.owner, this.repo, item.pr.number, this.verbose);

      if (!mergeableCheck.mergeable) {
        item.status = MergeItemStatus.SKIPPED;
        item.error = mergeableCheck.reason;
        this.stats.skipped++;
        this.log(`Skipped PR #${item.pr.number}: ${mergeableCheck.reason}`);
        return;
      }

      // Step 2: Check CI status
      const ciStatus = await checkPRCIStatus(this.owner, this.repo, item.pr.number, this.verbose);
      item.ciStatus = ciStatus;

      if (ciStatus.status === 'failure') {
        item.status = MergeItemStatus.FAILED;
        item.error = 'CI checks failed';
        this.stats.failed++;
        this.log(`Failed PR #${item.pr.number}: CI checks failed`);
        return;
      }

      // Step 3: Wait for CI if pending
      if (ciStatus.status === 'pending') {
        item.status = MergeItemStatus.WAITING_CI;

        const waitResult = await waitForCI(
          this.owner,
          this.repo,
          item.pr.number,
          {
            timeout: MERGE_QUEUE_CONFIG.CI_TIMEOUT_MS,
            pollInterval: MERGE_QUEUE_CONFIG.CI_POLL_INTERVAL_MS,
            onStatusUpdate: async status => {
              item.ciStatus = status;
              if (this.onProgress) {
                await this.onProgress(this.getProgressUpdate());
              }
            },
          },
          this.verbose
        );

        if (!waitResult.success) {
          item.status = MergeItemStatus.FAILED;
          item.error = waitResult.error;
          this.stats.failed++;
          this.log(`Failed PR #${item.pr.number}: ${waitResult.error}`);
          return;
        }
      }

      // Step 4: Merge the PR
      // Issue #1269: Pass the configured merge method to prevent "not running interactively" error
      item.status = MergeItemStatus.MERGING;
      const mergeResult = await mergePullRequest(this.owner, this.repo, item.pr.number, { mergeMethod: MERGE_QUEUE_CONFIG.MERGE_METHOD }, this.verbose);

      if (!mergeResult.success) {
        item.status = MergeItemStatus.FAILED;
        item.error = mergeResult.error;
        this.stats.failed++;
        this.log(`Failed to merge PR #${item.pr.number}: ${mergeResult.error}`);
        return;
      }

      // Success!
      item.status = MergeItemStatus.MERGED;
      item.completedAt = new Date();
      this.stats.merged++;
      this.log(`Successfully merged PR #${item.pr.number}`);

      // Issue #1341: Get the merge commit SHA for post-merge CI tracking
      // Need a small delay to allow GitHub to update the PR state
      await this.sleep(5000);
      const mergeCommitResult = await getMergeCommitSha(this.owner, this.repo, item.pr.number, this.verbose);
      if (mergeCommitResult.sha) {
        item.mergeCommitSha = mergeCommitResult.sha;
        this.log(`PR #${item.pr.number} merge commit: ${mergeCommitResult.sha.substring(0, 7)}`);
      } else {
        this.log(`Could not get merge commit SHA for PR #${item.pr.number}: ${mergeCommitResult.error}`);
      }
    } catch (error) {
      item.status = MergeItemStatus.FAILED;
      item.error = error.message;
      item.completedAt = new Date();
      this.stats.failed++;
      // Issue #1269: Always log errors (not just in verbose mode) for debugging
      console.error(`[ERROR] /merge-queue: Error processing PR #${item.pr.number}: ${error.message}`);
      if (error.stack) {
        console.error(`[ERROR] /merge-queue: Stack trace: ${error.stack.split('\n').slice(0, 5).join('\n')}`);
      }
      this.log(`Error processing PR #${item.pr.number}: ${error.message}`);
    }
  }

  /**
   * Cancel the merge queue operation
   */
  cancel() {
    this.isCancelled = true;
    this.log('Cancellation requested');
  }

  /**
   * Wait for any active CI runs on the target branch to complete
   * Issue #1307: Prevents merging while post-merge CI from previous merges is still running
   * @returns {Promise<void>}
   */
  async waitForTargetBranchCI() {
    // Track if we're waiting for CI (for progress updates)
    this.waitingForTargetBranchCI = true;
    this.targetBranchCIStatus = null;

    try {
      // Get the default branch (usually 'main' or 'master')
      const targetBranch = await getDefaultBranch(this.owner, this.repo, this.verbose);
      this.log(`Checking for active CI runs on ${targetBranch} branch before processing queue...`);

      const waitResult = await waitForBranchCI(
        this.owner,
        this.repo,
        targetBranch,
        {
          timeout: MERGE_QUEUE_CONFIG.TARGET_BRANCH_CI_TIMEOUT_MS,
          pollInterval: MERGE_QUEUE_CONFIG.TARGET_BRANCH_CI_POLL_INTERVAL_MS,
          onStatusUpdate: async status => {
            this.targetBranchCIStatus = status;

            // Report progress while waiting
            if (this.onProgress) {
              await this.onProgress(this.getProgressUpdate());
            }
          },
        },
        this.verbose
      );

      if (!waitResult.success) {
        // Log warning but don't fail - proceed with merge anyway
        console.warn(`[WARN] /merge-queue: ${waitResult.error}. Proceeding with merge anyway.`);
      } else if (waitResult.waitedForRuns) {
        this.log(`Waited for ${waitResult.completedRuns} CI runs to complete on ${targetBranch} branch`);
      } else {
        this.log(`No active CI runs on ${targetBranch} branch. Ready to proceed.`);
      }
    } finally {
      this.waitingForTargetBranchCI = false;
      this.targetBranchCIStatus = null;
    }
  }

  /**
   * Check if the default branch has any failed CI runs before starting the queue
   * Issue #1341: Prevents merging on top of a broken branch
   * @returns {Promise<{healthy: boolean, failedRuns: Array, error: string|null}>}
   */
  async checkBranchCIHealthBeforeStart() {
    try {
      const targetBranch = await getDefaultBranch(this.owner, this.repo, this.verbose);
      this.log(`Checking CI health on ${targetBranch} branch before starting queue...`);

      const healthResult = await checkBranchCIHealth(this.owner, this.repo, targetBranch, {}, this.verbose);

      if (!healthResult.healthy) {
        this.log(`Branch ${targetBranch} has ${healthResult.failedRuns.length} failed CI run(s)`);
        return {
          healthy: false,
          failedRuns: healthResult.failedRuns,
          error: `Cannot start merge queue: ${healthResult.error}. Please fix the CI failures first.`,
        };
      }

      this.log(`Branch ${targetBranch} CI is healthy. Ready to proceed.`);
      return {
        healthy: true,
        failedRuns: [],
        error: null,
      };
    } catch (error) {
      // On error, assume healthy to avoid blocking merges due to API issues
      console.warn(`[WARN] /merge-queue: Error checking branch CI health: ${error.message}. Proceeding anyway.`);
      return {
        healthy: true,
        failedRuns: [],
        error: null,
      };
    }
  }

  /**
   * Wait for post-merge CI to complete for a merged PR
   * Issue #1341: Ensures each PR's CI completes (including releases) before merging the next
   * @param {MergeQueueItem} item - The merged PR item
   * @returns {Promise<{success: boolean, failedRuns: Array, error: string|null}>}
   */
  async waitForPostMergeCI(item) {
    if (!item.mergeCommitSha) {
      this.log(`No merge commit SHA available for PR #${item.pr.number}, skipping post-merge CI wait`);
      return { success: true, failedRuns: [], error: null };
    }

    // Track that we're waiting for post-merge CI (for progress updates)
    this.waitingForPostMergeCI = true;
    this.postMergeCIStatus = null;
    this.currentPostMergePR = item.pr.number;

    try {
      this.log(`Waiting for post-merge CI on commit ${item.mergeCommitSha.substring(0, 7)} (PR #${item.pr.number})...`);

      const waitResult = await waitForCommitCI(
        this.owner,
        this.repo,
        item.mergeCommitSha,
        {
          timeout: MERGE_QUEUE_CONFIG.POST_MERGE_CI_TIMEOUT_MS,
          pollInterval: MERGE_QUEUE_CONFIG.POST_MERGE_CI_POLL_INTERVAL_MS,
          onStatusUpdate: async status => {
            this.postMergeCIStatus = status;

            // Report progress while waiting
            if (this.onProgress) {
              await this.onProgress(this.getProgressUpdate());
            }
          },
        },
        this.verbose
      );

      if (waitResult.success) {
        if (waitResult.status === 'no_runs') {
          this.log(`No CI runs found for merge commit ${item.mergeCommitSha.substring(0, 7)}. Proceeding.`);
        } else {
          this.log(`Post-merge CI completed successfully for PR #${item.pr.number}`);
        }
        return { success: true, failedRuns: [], error: null };
      } else {
        this.log(`Post-merge CI failed for PR #${item.pr.number}: ${waitResult.error}`);
        return {
          success: false,
          failedRuns: waitResult.failedRuns || [],
          error: waitResult.error,
        };
      }
    } finally {
      this.waitingForPostMergeCI = false;
      this.postMergeCIStatus = null;
      this.currentPostMergePR = null;
    }
  }

  /**
   * Get current progress update
   */
  getProgressUpdate() {
    const currentItem = this.items[this.currentIndex];
    const processed = this.stats.merged + this.stats.failed + this.stats.skipped;

    return {
      status: this.status,
      current: currentItem ? currentItem.getDescription() : null,
      currentStatus: currentItem ? currentItem.status : null,
      progress: {
        processed,
        total: this.stats.total,
        percentage: Math.round((processed / this.stats.total) * 100),
      },
      stats: { ...this.stats },
      items: this.items.map(item => ({
        prNumber: item.pr.number,
        title: item.pr.title,
        status: item.status,
        error: item.error,
        emoji: item.getStatusEmoji(),
      })),
    };
  }

  /**
   * Get final report
   */
  getFinalReport() {
    const duration = this.completedAt && this.startedAt ? Math.round((this.completedAt - this.startedAt) / 1000) : 0;

    return {
      status: this.status,
      duration: `${Math.floor(duration / 60)}m ${duration % 60}s`,
      stats: { ...this.stats },
      items: this.items.map(item => ({
        prNumber: item.pr.number,
        title: item.pr.title,
        issueNumber: item.issue ? item.issue.number : null,
        status: item.status,
        error: item.error,
        emoji: item.getStatusEmoji(),
      })),
    };
  }

  /**
   * Format a Telegram message for the current progress
   * Progress bar is rendered in a code block for better style (per issue #1143)
   * @returns {string}
   */
  formatProgressMessage() {
    const update = this.getProgressUpdate();

    let message = `*Merge Queue*\n`;
    // Issue #1292: Escape owner/repo for MarkdownV2 (may contain hyphens, underscores, etc.)
    message += `${this.escapeMarkdown(this.owner)}/${this.escapeMarkdown(this.repo)}\n\n`;

    // Progress bar in code block for better style
    const progressBar = getProgressBar(update.progress.percentage);
    message += '```\n';
    message += `${progressBar} ${update.progress.percentage}%\n`;
    message += `${update.progress.processed}/${update.progress.total} PRs processed\n`;
    message += '```\n\n';

    // Status summary with emojis
    message += `✅ Merged: ${update.stats.merged}  `;
    message += `❌ Failed: ${update.stats.failed}  `;
    message += `⏭️ Skipped: ${update.stats.skipped}  `;
    message += `⏳ Pending: ${update.stats.total - update.progress.processed}\n\n`;

    // Issue #1307: Show waiting status for target branch CI
    if (this.waitingForTargetBranchCI && this.targetBranchCIStatus) {
      const elapsedSec = Math.round(this.targetBranchCIStatus.elapsedMs / 1000);
      const elapsedMin = Math.floor(elapsedSec / 60);
      const elapsedSecRemainder = elapsedSec % 60;
      message += `⏱️ Waiting for ${this.targetBranchCIStatus.count} CI run\\(s\\) on target branch to complete \\(${elapsedMin}m ${elapsedSecRemainder}s\\)\\.\\.\\.\n\n`;
    } else if (this.waitingForTargetBranchCI) {
      message += `⏱️ Checking for active CI runs on target branch\\.\\.\\.\n\n`;
    }

    // Issue #1341: Show waiting status for post-merge CI
    if (this.waitingForPostMergeCI && this.postMergeCIStatus) {
      const elapsedSec = Math.round(this.postMergeCIStatus.elapsedMs / 1000);
      const elapsedMin = Math.floor(elapsedSec / 60);
      const elapsedSecRemainder = elapsedSec % 60;
      const completed = this.postMergeCIStatus.completedRuns || 0;
      const total = this.postMergeCIStatus.totalRuns || 0;
      const inProgress = total - completed;
      message += `⏱️ Waiting for post\\-merge CI \\(PR \\#${this.currentPostMergePR}\\): ${inProgress} in progress, ${completed}/${total} completed \\(${elapsedMin}m ${elapsedSecRemainder}s\\)\\.\\.\\.\n\n`;
    } else if (this.waitingForPostMergeCI) {
      message += `⏱️ Waiting for post\\-merge CI \\(PR \\#${this.currentPostMergePR}\\)\\.\\.\\.\n\n`;
    }

    // Current item being processed
    if (update.current && !this.waitingForTargetBranchCI && !this.waitingForPostMergeCI) {
      const statusEmoji = update.currentStatus === MergeItemStatus.WAITING_CI ? '⏱️' : '🔄';
      // Issue #1339: escape the current item description for MarkdownV2
      message += `${statusEmoji} ${this.escapeMarkdown(update.current)}\n\n`;
    }

    // Show errors/failures/skips inline so user gets immediate feedback (Issue #1269, #1294)
    // Include both FAILED and SKIPPED items with their reasons
    const problemItems = update.items.filter(item => (item.status === MergeItemStatus.FAILED || item.status === MergeItemStatus.SKIPPED) && item.error);
    if (problemItems.length > 0) {
      message += `⚠️ *Issues:*\n`;
      for (const item of problemItems.slice(0, 5)) {
        const statusEmoji = item.status === MergeItemStatus.FAILED ? '❌' : '⏭️';
        // Issue #1339: escape the ellipsis '...' for MarkdownV2 (periods are reserved)
        message += `  ${statusEmoji} \\#${item.prNumber}: ${this.escapeMarkdown(item.error.substring(0, 50))}${item.error.length > 50 ? '\\.\\.\\.' : ''}\n`;
      }
      if (problemItems.length > 5) {
        // Issue #1339: escape the ellipsis '...' for MarkdownV2
        message += `  _\\.\\.\\.and ${problemItems.length - 5} more issues_\n`;
      }
      message += '\n';
    }

    // PRs list with emojis
    message += `*Queue:*\n`;
    for (const item of update.items.slice(0, 10)) {
      // Issue #1339: escape the ellipsis '...' for MarkdownV2 (periods are reserved)
      message += `${item.emoji} \\#${item.prNumber}: ${this.escapeMarkdown(item.title.substring(0, 35))}${item.title.length > 35 ? '\\.\\.\\.' : ''}\n`;
    }

    if (update.items.length > 10) {
      // Issue #1339: escape the ellipsis '...' for MarkdownV2
      message += `_\\.\\.\\.and ${update.items.length - 10} more_\n`;
    }

    return message;
  }

  /**
   * Format a Telegram message for the final report
   * Progress bar is rendered in a code block for better style (per issue #1143)
   * @returns {string}
   */
  formatFinalMessage() {
    const report = this.getFinalReport();

    let statusEmoji, statusText;
    switch (report.status) {
      case MergeStatus.COMPLETED:
        statusEmoji = '✅';
        statusText = 'Completed';
        break;
      case MergeStatus.FAILED:
        statusEmoji = '❌';
        statusText = 'Failed';
        break;
      case MergeStatus.CANCELLED:
        statusEmoji = '🛑';
        statusText = 'Cancelled';
        break;
      default:
        statusEmoji = '❓';
        statusText = report.status;
    }

    let message = `${statusEmoji} *Merge Queue ${statusText}*\n`;
    // Issue #1292: Escape owner/repo for MarkdownV2 (may contain hyphens, underscores, etc.)
    message += `${this.escapeMarkdown(this.owner)}/${this.escapeMarkdown(this.repo)}\n\n`;

    // Final progress bar in code block
    const percentage = report.stats.total > 0 ? Math.round((report.stats.merged / report.stats.total) * 100) : 0;
    const progressBar = getProgressBar(percentage);
    message += '```\n';
    message += `${progressBar} ${percentage}%\n`;
    message += `Duration: ${report.duration}\n`;
    message += '```\n\n';

    // Summary with emojis
    message += `✅ Merged: ${report.stats.merged}  `;
    message += `❌ Failed: ${report.stats.failed}  `;
    message += `⏭️ Skipped: ${report.stats.skipped}  `;
    message += `📋 Total: ${report.stats.total}\n\n`;

    // Issue #1341: Show branch CI health failure details if applicable
    if (this.branchCIFailedRuns && this.branchCIFailedRuns.length > 0) {
      message += `⚠️ *Branch CI Failures \\(blocked queue\\):*\n`;
      for (const run of this.branchCIFailedRuns.slice(0, 3)) {
        const runName = this.escapeMarkdown(run.name);
        // Format the URL for MarkdownV2 - need to escape special characters
        const runUrl = run.html_url ? `[View](${run.html_url.replace(/[)]/g, '\\)')})` : '';
        message += `  ❌ ${runName} ${runUrl}\n`;
      }
      if (this.branchCIFailedRuns.length > 3) {
        message += `  _\\.\\.\\.and ${this.branchCIFailedRuns.length - 3} more_\n`;
      }
      message += '\n';
    }

    // Issue #1341: Show post-merge CI failure details if applicable
    if (this.postMergeCIFailedRuns && this.postMergeCIFailedRuns.length > 0) {
      message += `⚠️ *Post\\-Merge CI Failures \\(stopped queue\\):*\n`;
      for (const run of this.postMergeCIFailedRuns.slice(0, 3)) {
        const runName = this.escapeMarkdown(run.name);
        // Format the URL for MarkdownV2 - need to escape special characters
        const runUrl = run.html_url ? `[View](${run.html_url.replace(/[)]/g, '\\)')})` : '';
        message += `  ❌ ${runName} ${runUrl}\n`;
      }
      if (this.postMergeCIFailedRuns.length > 3) {
        message += `  _\\.\\.\\.and ${this.postMergeCIFailedRuns.length - 3} more_\n`;
      }
      message += '\n';
    }

    // Details
    if (report.items.length > 0) {
      message += `*Results:*\n`;
      for (const item of report.items) {
        const issueRef = item.issueNumber ? ` \\(Issue \\#${item.issueNumber}\\)` : '';
        // Issue #1294: Show skip/fail reason so users understand what action is required
        let reasonText = '';
        if (item.error && (item.status === MergeItemStatus.SKIPPED || item.status === MergeItemStatus.FAILED)) {
          // Truncate long reasons and escape for MarkdownV2
          const truncatedReason = item.error.length > 50 ? item.error.substring(0, 47) + '...' : item.error;
          reasonText = `: ${this.escapeMarkdown(truncatedReason)}`;
        }
        message += `${item.emoji} \\#${item.prNumber}${issueRef}${reasonText}\n`;
      }
    }

    return message;
  }

  /**
   * Escape special characters for Telegram Markdown
   */
  escapeMarkdown(text) {
    return String(text).replace(/[_*[\]()~`>#+\-=|{}.!]/g, '\\$&');
  }

  /**
   * Sleep helper
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

/**
 * Create and run a merge queue processor
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Object} options - Processor options
 * @returns {Promise<MergeQueueProcessor>}
 */
export async function createMergeQueueProcessor(owner, repo, options = {}) {
  const processor = new MergeQueueProcessor({
    owner,
    repo,
    ...options,
  });

  return processor;
}

export default {
  MergeStatus,
  MergeItemStatus,
  MERGE_QUEUE_CONFIG,
  MergeQueueProcessor,
  createMergeQueueProcessor,
};
