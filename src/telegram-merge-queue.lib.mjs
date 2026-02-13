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

import { getAllReadyPRs, checkPRCIStatus, checkPRMergeable, mergePullRequest, waitForCI, ensureReadyLabel } from './github-merge.lib.mjs';
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

        // If merged, wait before processing next PR to allow CI to stabilize
        if (item.status === MergeItemStatus.MERGED && this.currentIndex < this.items.length - 1) {
          this.log(`Waiting ${MERGE_QUEUE_CONFIG.POST_MERGE_WAIT_MS / 1000}s before next PR...`);
          await this.sleep(MERGE_QUEUE_CONFIG.POST_MERGE_WAIT_MS);
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
      item.status = MergeItemStatus.MERGING;
      const mergeResult = await mergePullRequest(this.owner, this.repo, item.pr.number, {}, this.verbose);

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
    message += `${this.owner}/${this.repo}\n\n`;

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

    // Current item being processed
    if (update.current) {
      const statusEmoji = update.currentStatus === MergeItemStatus.WAITING_CI ? '⏱️' : '🔄';
      message += `${statusEmoji} ${update.current}\n\n`;
    }

    // PRs list with emojis
    message += `*Queue:*\n`;
    for (const item of update.items.slice(0, 10)) {
      message += `${item.emoji} \\#${item.prNumber}: ${this.escapeMarkdown(item.title.substring(0, 35))}${item.title.length > 35 ? '...' : ''}\n`;
    }

    if (update.items.length > 10) {
      message += `_...and ${update.items.length - 10} more_\n`;
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
    message += `${this.owner}/${this.repo}\n\n`;

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

    // Details
    if (report.items.length > 0) {
      message += `*Results:*\n`;
      for (const item of report.items) {
        const issueRef = item.issueNumber ? ` \\(Issue \\#${item.issueNumber}\\)` : '';
        message += `${item.emoji} \\#${item.prNumber}${issueRef}\n`;
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
