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

import { getAllReadyPRs, checkPRCIStatus, checkPRMergeable, mergePullRequest, waitForCI, ensureReadyLabel, waitForBranchCI, getDefaultBranch, waitForCommitCI, checkBranchCIHealth, getMergeCommitSha, getPRStatus, syncReadyTags, closeLinkedIssueIfNotAutoClosed } from './github-merge.lib.mjs';
import { resolveMergeTargetItems } from './github-merge-targets.lib.mjs';
import { waitForPRReady as waitForPRReadyHelper } from './telegram-merge-wait.lib.mjs';
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
  WAITING_READY: 'waiting_ready',
  WAITING_CI: 'waiting_ci',
  READY_TO_MERGE: 'ready_to_merge',
  MERGING: 'merging',
  MERGED: 'merged',
  FAILED: 'failed',
  SKIPPED: 'skipped',
  // Issue #1805: states reached during the post-queue `--auto-resolve` pass.
  // RESOLVING is set while a `/solve <pr> --auto-merge` session is being
  // spawned for a previously-skipped PR; RESOLVE_FAILED records that the
  // spawn (or the resolution itself) didn't succeed.
  RESOLVING: 'resolving',
  RESOLVE_FAILED: 'resolve_failed',
};

/**
 * Marker that identifies SKIPPED items that the auto-resolve pass should
 * pick up. The same string is returned by `checkPRMergeable()` for
 * `mergeStateStatus === 'DIRTY'` (see github-merge.lib.mjs), so matching
 * on it keeps the two modules in sync without sharing extra state.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1805
 */
export const MERGE_CONFLICT_SKIP_REASON = 'PR has merge conflicts';

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

  // Issue #1807: Sequential auto-resolve — wait for each `/solve --auto-merge`
  // session to land its PR (or fail) before spawning the next one. These
  // timeouts apply to the polling loop in `waitForAutoResolveCompletion`.
  AUTO_RESOLVE_WAIT_TIMEOUT_MS: mergeQueueConfig.autoResolveWaitTimeoutMs,
  AUTO_RESOLVE_POLL_INTERVAL_MS: mergeQueueConfig.autoResolvePollIntervalMs,
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
      case MergeItemStatus.WAITING_READY:
        return '⏱️';
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
      // Issue #1805: auto-resolve pass states.
      case MergeItemStatus.RESOLVING:
        return '🛠️';
      case MergeItemStatus.RESOLVE_FAILED:
        return '⚠️';
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
    // Issue #1805: when true the queue runs a second pass after the normal
    // merge loop, spawning `/solve <pr> --auto-merge` for every PR that was
    // SKIPPED due to merge conflicts. The actual spawner is injected so
    // tests can run without touching the screen runtime.
    this.autoResolve = options.autoResolve === true;
    this.spawnSolveSession = typeof options.spawnSolveSession === 'function' ? options.spawnSolveSession : null;
    this.target = options.target || { mode: 'repository', owner: this.owner, repo: this.repo, url: `https://github.com/${this.owner}/${this.repo}` };
    this.waitForUnfinished = options.waitForUnfinished !== false;

    // State
    this.items = [];
    this.currentIndex = 0;
    this.status = MergeStatus.IDLE;
    this.isCancelled = false;
    this.startedAt = null;
    this.completedAt = null;
    this.error = null;
    // Issue #1805: track auto-resolve progress so the renderer can surface it.
    this.autoResolveActive = false;
    this.autoResolveCurrent = null;
    // Issue #1807: sequential auto-resolve — track which wait phase is active
    // for the current auto-resolve item so the progress message can render
    // distinct "spawning…", "waiting for merge…", and "waiting for CI…" lines.
    // Values: null | 'spawning' | 'awaiting-resolution' | 'awaiting-ci'.
    this.autoResolvePhase = null;
    this.autoResolveWaitStartedAt = null;
    // For dependency injection in tests (issue #1807) — when set, the
    // sequential auto-resolve pass uses this in place of `getPRStatus()`.
    this.getPRStatus = typeof options.getPRStatus === 'function' ? options.getPRStatus : getPRStatus;
    // Same idea for `getMergeCommitSha` so tests don't need to stub gh.
    this.getMergeCommitSha = typeof options.getMergeCommitSha === 'function' ? options.getMergeCommitSha : getMergeCommitSha;
    this.checkPRMergeable = typeof options.checkPRMergeable === 'function' ? options.checkPRMergeable : checkPRMergeable;
    this.checkPRCIStatus = typeof options.checkPRCIStatus === 'function' ? options.checkPRCIStatus : checkPRCIStatus;
    this.waitForCI = typeof options.waitForCI === 'function' ? options.waitForCI : waitForCI;
    this.mergePullRequest = typeof options.mergePullRequest === 'function' ? options.mergePullRequest : mergePullRequest;
    this.closeLinkedIssueIfNotAutoClosed = typeof options.closeLinkedIssueIfNotAutoClosed === 'function' ? options.closeLinkedIssueIfNotAutoClosed : closeLinkedIssueIfNotAutoClosed;
    this.resolveMergeTargetItems = typeof options.resolveMergeTargetItems === 'function' ? options.resolveMergeTargetItems : resolveMergeTargetItems;
    this.ensureReadyLabel = typeof options.ensureReadyLabel === 'function' ? options.ensureReadyLabel : ensureReadyLabel;
    this.syncReadyTags = typeof options.syncReadyTags === 'function' ? options.syncReadyTags : syncReadyTags;
    this.getAllReadyPRs = typeof options.getAllReadyPRs === 'function' ? options.getAllReadyPRs : getAllReadyPRs;
    this.targetItemsTimeoutMs = options.targetItemsTimeoutMs ?? MERGE_QUEUE_CONFIG.CI_TIMEOUT_MS;
    this.targetItemsPollIntervalMs = options.targetItemsPollIntervalMs ?? MERGE_QUEUE_CONFIG.CI_POLL_INTERVAL_MS;

    // Statistics
    this.stats = {
      total: 0,
      merged: 0,
      failed: 0,
      skipped: 0,
      // Issue #1805: number of skipped conflict PRs the auto-resolve pass
      // successfully handed off to `solve`, and the number that failed to
      // be handed off (e.g. screen runner missing).
      autoResolved: 0,
      autoResolveFailed: 0,
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
      const labelResult = await this.ensureReadyLabel(this.owner, this.repo, this.verbose);
      if (!labelResult.success) {
        return { success: false, error: labelResult.error };
      }
      if (labelResult.created) {
        this.log("Created 'ready' label in repository");
      }

      let readyPRs;
      if (this.target?.mode && this.target.mode !== 'repository') {
        readyPRs = await this.resolveMergeTargetItemsWithWait();
      } else {
        // Issue #1367: Sync 'ready' tags between linked PRs and issues before collecting the queue
        // This ensures the final list reflects all ready work regardless of where the tag was applied
        const syncResult = await this.syncReadyTags(this.owner, this.repo, this.verbose);
        if (syncResult.synced > 0) {
          this.log(`Synced 'ready' tag: ${syncResult.synced} item(s) updated`);
        }
        if (syncResult.errors > 0) {
          this.log(`Tag sync had ${syncResult.errors} error(s) (non-fatal, proceeding)`);
        }

        // Fetch all ready PRs
        readyPRs = await this.getAllReadyPRs(this.owner, this.repo, this.verbose);
      }

      if (readyPRs.length === 0) {
        const message = this.target?.mode === 'issue' ? `No open PRs linked to issue #${this.target.issueNumber} found` : this.target?.mode === 'pull' ? `Pull request #${this.target.prNumber} was not found` : "No PRs with 'ready' label found";
        return { success: true, error: null, message };
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
        targetMode: this.target?.mode || 'repository',
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

      // Issue #1805: After the normal queue settles, optionally hand off
      // every PR that was SKIPPED with a merge-conflict reason to the
      // `/solve <pr> --auto-merge` flow. This lets a single `/merge`
      // invocation both merge the easy PRs and dispatch conflict-resolution
      // sessions for the rest.
      if (this.autoResolve && !this.isCancelled) {
        await this.runAutoResolve();
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
   * Resolve targeted PR data, waiting for issue-linked PRs that may be created
   * shortly after a replied `/codex <issue>` message.
   *
   * @returns {Promise<Array<{pr: Object, issue: Object|null, sortDate: Date}>>}
   */
  async resolveMergeTargetItemsWithWait() {
    const maxPollInterval = Math.max(1, this.targetItemsPollIntervalMs || 1);
    const maxAttempts = Math.max(1, Math.ceil((this.targetItemsTimeoutMs || 0) / maxPollInterval));

    for (let attempt = 0; attempt <= maxAttempts; attempt++) {
      if (this.isCancelled) {
        return [];
      }

      const items = (await this.resolveMergeTargetItems(this.target, this.verbose)) || [];
      if (items.length > 0 || this.target?.mode !== 'issue') {
        return items;
      }

      if (attempt === maxAttempts) {
        return [];
      }

      this.log(`Waiting for a linked PR to appear for issue #${this.target.issueNumber}`);
      await this.sleep(this.targetItemsPollIntervalMs);
    }

    return [];
  }

  async waitForPRReady(item, initialCheck) {
    return waitForPRReadyHelper(this, item, initialCheck, {
      MergeItemStatus,
      conflictSkipReason: MERGE_CONFLICT_SKIP_REASON,
      timeoutMs: MERGE_QUEUE_CONFIG.CI_TIMEOUT_MS,
      pollIntervalMs: MERGE_QUEUE_CONFIG.CI_POLL_INTERVAL_MS,
    });
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
      const mergeableCheck = await this.checkPRMergeable(this.owner, this.repo, item.pr.number, this.verbose);

      if (mergeableCheck.terminal) {
        item.status = MergeItemStatus.FAILED;
        item.error = mergeableCheck.reason || 'GitHub repository, pull request, issue, or branch is no longer accessible';
        this.stats.failed++;
        this.log(`Failed PR #${item.pr.number}: ${item.error}`);
        return;
      }

      if (!mergeableCheck.mergeable) {
        if (!this.waitForUnfinished || mergeableCheck.reason === MERGE_CONFLICT_SKIP_REASON) {
          item.status = MergeItemStatus.SKIPPED;
          item.error = mergeableCheck.reason;
          this.stats.skipped++;
          this.log(`Skipped PR #${item.pr.number}: ${mergeableCheck.reason}`);
          return;
        }

        const waitForReadyResult = await this.waitForPRReady(item, mergeableCheck);
        if (!waitForReadyResult.success) {
          if (waitForReadyResult.status === 'cancelled' || waitForReadyResult.status === 'conflict') {
            item.status = MergeItemStatus.SKIPPED;
            item.error = waitForReadyResult.error;
            this.stats.skipped++;
            this.log(`Skipped PR #${item.pr.number}: ${waitForReadyResult.error}`);
            return;
          }

          item.status = MergeItemStatus.FAILED;
          item.error = waitForReadyResult.error;
          this.stats.failed++;
          this.log(`Failed PR #${item.pr.number}: ${waitForReadyResult.error}`);
          return;
        }
      }

      // Step 2: Check CI status
      const ciStatus = await this.checkPRCIStatus(this.owner, this.repo, item.pr.number, this.verbose);
      item.ciStatus = ciStatus;

      if (ciStatus.status === 'failure') {
        item.status = MergeItemStatus.FAILED;
        item.error = 'CI checks failed';
        this.stats.failed++;
        this.log(`Failed PR #${item.pr.number}: CI checks failed`);
        return;
      }

      if (ciStatus.status === 'terminal_github_entity_error') {
        item.status = MergeItemStatus.FAILED;
        item.error = ciStatus.error || 'GitHub repository, pull request, issue, or branch is no longer accessible';
        this.stats.failed++;
        this.log(`Failed PR #${item.pr.number}: ${item.error}`);
        return;
      }

      // Step 3: Wait for CI if pending
      if (ciStatus.status === 'pending') {
        item.status = MergeItemStatus.WAITING_CI;

        const waitResult = await this.waitForCI(
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
            // Issue #1407: Pass cancellation check so CI wait can abort early
            isCancelled: () => this.isCancelled,
          },
          this.verbose
        );

        if (!waitResult.success) {
          // Issue #1407: If cancelled during CI wait, mark as skipped (not failed)
          // so the queue can cleanly stop without misleading failure statistics
          if (waitResult.status === 'cancelled') {
            item.status = MergeItemStatus.SKIPPED;
            item.error = 'Cancelled';
            this.stats.skipped++;
            this.log(`Skipped PR #${item.pr.number}: cancelled during CI wait`);
            return;
          }
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
      const mergeResult = await this.mergePullRequest(this.owner, this.repo, item.pr.number, { mergeMethod: MERGE_QUEUE_CONFIG.MERGE_METHOD }, this.verbose);

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

      // Issue #1895: GitHub does not auto-close linked issues for PRs merged into
      // a non-default branch. Close the linked issue explicitly in that case.
      try {
        const closeResult = await this.closeLinkedIssueIfNotAutoClosed(this.owner, this.repo, item.pr.number, this.verbose);
        if (closeResult.closed) {
          this.log(`Closed linked issue #${closeResult.issueNumber} for PR #${item.pr.number} (merged into non-default branch)`);
        }
      } catch (closeError) {
        this.log(`Could not close linked issue for PR #${item.pr.number}: ${closeError.message}`);
      }

      // Issue #1341: Get the merge commit SHA for post-merge CI tracking
      // Need a small delay to allow GitHub to update the PR state
      await this.sleep(5000);
      const mergeCommitResult = await this.getMergeCommitSha(this.owner, this.repo, item.pr.number, this.verbose);
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
   * Issue #1805: Return queue items that were skipped because of merge
   * conflicts. These are the candidates the auto-resolve pass hands off
   * to `/solve <pr> --auto-merge`.
   *
   * @returns {MergeQueueItem[]}
   */
  getConflictedItems() {
    return this.items.filter(item => item.status === MergeItemStatus.SKIPPED && item.error === MERGE_CONFLICT_SKIP_REASON);
  }

  /**
   * Issue #1805 / #1807: Iterate every conflict-skipped item and hand it off
   * to a `/solve <pr-url> --auto-merge` session via the injected
   * `spawnSolveSession` callback. Sessions are processed STRICTLY
   * sequentially — for each PR we:
   *   1. Spawn the solve session and confirm the spawn succeeded.
   *   2. Poll the PR until it becomes MERGED or CLOSED, or until
   *      `AUTO_RESOLVE_WAIT_TIMEOUT_MS` elapses.
   *   3. If MERGED, await post-merge CI via `waitForPostMergeCI()` so the
   *      release pipeline drains before the next resolution starts.
   * This back-pressure is what keeps the conflict pass from spinning up
   * eight parallel Claude sessions (issue #1807).
   *
   * @returns {Promise<void>}
   */
  async runAutoResolve() {
    const conflicted = this.getConflictedItems();
    if (conflicted.length === 0) {
      this.log('Auto-resolve: no merge-conflict skips to process');
      return;
    }

    if (!this.spawnSolveSession) {
      // Guard against misconfiguration — the queue can't resolve without a
      // spawner. Surface this to the user via the same channel as other
      // queue feedback rather than throwing.
      this.log(`Auto-resolve: ${conflicted.length} conflict PR(s) but no spawnSolveSession callback provided`);
      for (const item of conflicted) {
        item.status = MergeItemStatus.RESOLVE_FAILED;
        item.autoResolveError = 'auto-resolve is not configured';
        this.stats.autoResolveFailed++;
      }
      if (this.onProgress) {
        await this.onProgress(this.getProgressUpdate());
      }
      return;
    }

    this.autoResolveActive = true;
    this.log(`Auto-resolve: dispatching ${conflicted.length} conflict PR(s) sequentially to /solve --auto-merge`);
    try {
      for (const item of conflicted) {
        if (this.isCancelled) {
          this.log('Auto-resolve: cancelled mid-pass');
          break;
        }

        item.status = MergeItemStatus.RESOLVING;
        this.autoResolveCurrent = item.pr.number;
        this.autoResolvePhase = 'spawning';
        this.autoResolveWaitStartedAt = new Date();
        if (this.onProgress) {
          await this.onProgress(this.getProgressUpdate());
        }

        // Step 1 — spawn the solve session.
        let spawned = false;
        try {
          const result = await this.spawnSolveSession({
            url: item.pr.url,
            owner: this.owner,
            repo: this.repo,
            prNumber: item.pr.number,
            title: item.pr.title,
          });

          if (result && result.success) {
            item.autoResolveSession = result.sessionName || result.session || null;
            this.log(`Auto-resolve: spawned solve session for PR #${item.pr.number}${item.autoResolveSession ? ` (session ${item.autoResolveSession})` : ''}`);
            spawned = true;
          } else {
            item.status = MergeItemStatus.RESOLVE_FAILED;
            item.autoResolveError = (result && (result.error || result.warning)) || 'spawn failed';
            this.stats.autoResolveFailed++;
            this.log(`Auto-resolve: failed to spawn solve session for PR #${item.pr.number}: ${item.autoResolveError}`);
          }
        } catch (error) {
          item.status = MergeItemStatus.RESOLVE_FAILED;
          item.autoResolveError = error.message || String(error);
          this.stats.autoResolveFailed++;
          console.error(`[ERROR] /merge-queue: auto-resolve error for PR #${item.pr.number}: ${item.autoResolveError}`);
        }

        if (!spawned) {
          this.autoResolvePhase = null;
          this.autoResolveWaitStartedAt = null;
          if (this.onProgress) {
            await this.onProgress(this.getProgressUpdate());
          }
          continue;
        }

        // Step 2 — wait for the spawned session to actually land (or fail)
        // before starting the next one. This is the heart of issue #1807.
        this.autoResolvePhase = 'awaiting-resolution';
        this.autoResolveWaitStartedAt = new Date();
        if (this.onProgress) {
          await this.onProgress(this.getProgressUpdate());
        }

        const waitResult = await this.waitForAutoResolveCompletion(item);

        if (waitResult.outcome === 'merged') {
          // Treat the PR as merged for accounting purposes. We bump the
          // dedicated `autoResolved` counter (kept for backwards-compat with
          // issue #1805 reporting) and also fold the merge into `stats.merged`
          // so the final report's success percentage reflects what the queue
          // ultimately accomplished.
          item.status = MergeItemStatus.MERGED;
          item.completedAt = new Date();
          this.stats.autoResolved++;
          this.stats.merged++;
          // The PR previously sat in `skipped` because of the merge conflict;
          // now that it's merged via auto-resolve, decrement that counter so
          // we don't double-count it.
          if (this.stats.skipped > 0) this.stats.skipped--;
          this.log(`Auto-resolve: PR #${item.pr.number} merged by solve session`);

          // Best-effort: capture the merge commit SHA so post-merge CI wait
          // has something to poll on.
          try {
            await this.sleep(5000);
            const sha = await this.getMergeCommitSha(this.owner, this.repo, item.pr.number, this.verbose);
            if (sha && sha.sha) {
              item.mergeCommitSha = sha.sha;
            }
          } catch (error) {
            this.log(`Auto-resolve: could not get merge commit SHA for PR #${item.pr.number}: ${error.message}`);
          }

          // Step 3 — drain the merged PR's CI before continuing. We reuse
          // the same `waitForPostMergeCI` path the main loop already uses so
          // release workflows finish before the next resolution starts.
          if (MERGE_QUEUE_CONFIG.WAIT_FOR_POST_MERGE_CI && item.mergeCommitSha && !this.isCancelled) {
            this.autoResolvePhase = 'awaiting-ci';
            this.autoResolveWaitStartedAt = new Date();
            if (this.onProgress) {
              await this.onProgress(this.getProgressUpdate());
            }
            const postCi = await this.waitForPostMergeCI(item);
            if (!postCi.success && MERGE_QUEUE_CONFIG.STOP_ON_POST_MERGE_CI_FAILURE) {
              // Stop the auto-resolve pass on CI failure so humans can
              // investigate before more resolutions run on a broken branch.
              // Mirrors the main loop's behaviour for issue #1341.
              this.postMergeCIFailedRuns = postCi.failedRuns;
              this.error = postCi.error;
              this.log(`Auto-resolve: stopping pass after post-merge CI failure for PR #${item.pr.number}`);
              break;
            }
          }
        } else if (waitResult.outcome === 'closed') {
          item.status = MergeItemStatus.RESOLVE_FAILED;
          item.autoResolveError = 'PR was closed without merging';
          this.stats.autoResolveFailed++;
          this.log(`Auto-resolve: PR #${item.pr.number} was closed without merging`);
        } else if (waitResult.outcome === 'cancelled') {
          this.log(`Auto-resolve: cancelled while waiting for PR #${item.pr.number}`);
          // Don't downgrade the item status — the user can resume later.
          break;
        } else if (waitResult.outcome === 'timeout') {
          item.status = MergeItemStatus.RESOLVE_FAILED;
          item.autoResolveError = `timed out after ${Math.round((MERGE_QUEUE_CONFIG.AUTO_RESOLVE_WAIT_TIMEOUT_MS || 0) / 60000)}m waiting for resolution`;
          this.stats.autoResolveFailed++;
          this.log(`Auto-resolve: timed out waiting for PR #${item.pr.number}`);
        } else {
          // 'error' — surface the cause but don't halt the whole pass.
          item.status = MergeItemStatus.RESOLVE_FAILED;
          item.autoResolveError = waitResult.error || 'unknown error while waiting';
          this.stats.autoResolveFailed++;
          this.log(`Auto-resolve: error waiting for PR #${item.pr.number}: ${item.autoResolveError}`);
        }

        this.autoResolvePhase = null;
        this.autoResolveWaitStartedAt = null;
        if (this.onProgress) {
          await this.onProgress(this.getProgressUpdate());
        }
      }
    } finally {
      this.autoResolveActive = false;
      this.autoResolveCurrent = null;
      this.autoResolvePhase = null;
      this.autoResolveWaitStartedAt = null;
    }
  }

  /**
   * Issue #1807: Poll the PR's lifecycle state until the spawned solve
   * session either lands (MERGED), gives up (CLOSED without merge), or the
   * caller hits a configured timeout. The polling cadence and overall
   * timeout come from `MERGE_QUEUE_CONFIG`. Cancellation is checked between
   * polls so the user can abort a long resolution wait via the inline
   * cancel button.
   *
   * Implementation note: we deliberately use `gh pr view --json
   * state,mergeStateStatus` rather than tracking the screen session
   * itself. `start-screen` keeps the screen alive after `solve` exits
   * (via `exec bash`), so the screen lifecycle is not a reliable
   * completion signal. The PR's lifecycle, on the other hand, is the
   * authoritative source of truth for "did the resolution succeed?".
   *
   * @param {MergeQueueItem} item
   * @returns {Promise<{outcome: 'merged'|'closed'|'cancelled'|'timeout'|'error', error?: string}>}
   */
  async waitForAutoResolveCompletion(item) {
    const timeout = MERGE_QUEUE_CONFIG.AUTO_RESOLVE_WAIT_TIMEOUT_MS;
    const pollInterval = MERGE_QUEUE_CONFIG.AUTO_RESOLVE_POLL_INTERVAL_MS;
    const startTime = Date.now();
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 5;

    this.log(`Auto-resolve: polling PR #${item.pr.number} until merged/closed (timeout=${Math.round(timeout / 60000)}m, poll=${Math.round(pollInterval / 1000)}s)`);

    while (Date.now() - startTime < timeout) {
      if (this.isCancelled) {
        return { outcome: 'cancelled' };
      }

      let status;
      try {
        status = await this.getPRStatus(this.owner, this.repo, item.pr.number, this.verbose);
      } catch (error) {
        consecutiveErrors++;
        this.log(`Auto-resolve: error polling PR #${item.pr.number} (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS}): ${error.message}`);
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          return { outcome: 'error', error: error.message };
        }
        await this.cancellableSleep(pollInterval);
        continue;
      }

      if (status && !status.error) {
        consecutiveErrors = 0;
        if (status.state === 'MERGED') {
          return { outcome: 'merged' };
        }
        if (status.state === 'CLOSED') {
          return { outcome: 'closed' };
        }
      } else if (status && status.error) {
        consecutiveErrors++;
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          return { outcome: 'error', error: status.error };
        }
      }

      await this.cancellableSleep(pollInterval);
    }

    return { outcome: 'timeout' };
  }

  /**
   * Issue #1807: Sleep helper that bails out as soon as cancellation is
   * requested. Used by the auto-resolve poll loop so a `cancel()` call
   * doesn't have to wait a full polling interval before taking effect.
   */
  async cancellableSleep(ms) {
    const step = Math.min(ms, 1000);
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (this.isCancelled) return;
      const remaining = deadline - Date.now();
      await this.sleep(Math.min(step, remaining));
    }
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
          // Issue #1588: Pass cancellation check so branch CI wait can abort early
          isCancelled: () => this.isCancelled,
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

      // Issue #1425: If the latest commit's CI is still in progress, wait for it to complete
      // rather than proceeding immediately. The WAIT_FOR_TARGET_BRANCH_CI step (below) will
      // also wait, but checking here ensures we don't skip the health check entirely.
      if (healthResult.pending) {
        this.log(`Branch ${targetBranch} has ${healthResult.pendingRuns.length} CI run(s) in progress on the latest commit. Will wait for them to complete.`);
        // Return healthy so the queue proceeds to the waitForTargetBranchCI step which handles waiting
        return {
          healthy: true,
          failedRuns: [],
          error: null,
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
          // Issue #1588: Pass cancellation check so post-merge CI wait can abort early
          isCancelled: () => this.isCancelled,
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
      // Issue #1805: surface auto-resolve progress so renderers/tests can
      // show what's happening during the post-queue pass.
      autoResolve: {
        enabled: this.autoResolve,
        active: this.autoResolveActive,
        currentPrNumber: this.autoResolveCurrent,
        // Issue #1807: expose the sequential wait phase so the progress
        // renderer (and tests) can show whether we're spawning, waiting on
        // resolution, or waiting on post-merge CI.
        phase: this.autoResolvePhase,
        waitElapsedMs: this.autoResolveWaitStartedAt ? Date.now() - this.autoResolveWaitStartedAt.getTime() : 0,
      },
      progress: {
        processed,
        total: this.stats.total,
        percentage: Math.round((processed / this.stats.total) * 100),
      },
      stats: { ...this.stats },
      items: this.items.map(item => ({
        prNumber: item.pr.number,
        // Issue #1805: expose PR/issue URLs so renderers can produce
        // clickable links instead of plain `\#NNN` text.
        prUrl: item.pr.url || null,
        issueNumber: item.issue ? item.issue.number : null,
        issueUrl: item.issue ? item.issue.url || null : null,
        title: item.pr.title,
        status: item.status,
        error: item.error,
        emoji: item.getStatusEmoji(),
        autoResolveSession: item.autoResolveSession || null,
        autoResolveError: item.autoResolveError || null,
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
      autoResolve: {
        enabled: this.autoResolve,
        resolved: this.stats.autoResolved,
        failed: this.stats.autoResolveFailed,
      },
      items: this.items.map(item => ({
        prNumber: item.pr.number,
        // Issue #1805: expose PR/issue URLs so renderers can produce
        // clickable links instead of plain `\#NNN` text.
        prUrl: item.pr.url || null,
        title: item.pr.title,
        issueNumber: item.issue ? item.issue.number : null,
        issueUrl: item.issue ? item.issue.url || null : null,
        status: item.status,
        error: item.error,
        emoji: item.getStatusEmoji(),
        autoResolveSession: item.autoResolveSession || null,
        autoResolveError: item.autoResolveError || null,
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

    // Issue #1407: Show cancelling indicator when cancellation requested but queue still running
    if (this.isCancelled) {
      message += `🛑 *Cancelling\\.\\.\\.*\n\n`;
    }

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

    // Issue #1805: surface the auto-resolve pass when it is currently
    // active. This appears in place of "current item" because by then the
    // main queue loop has finished.
    if (update.autoResolve && update.autoResolve.active && update.autoResolve.currentPrNumber) {
      const activeItem = update.items.find(it => it.prNumber === update.autoResolve.currentPrNumber);
      const link = activeItem ? this.formatPrLink(activeItem.prNumber, activeItem.title, activeItem.prUrl) : `\\#${update.autoResolve.currentPrNumber}`;
      // Issue #1807: differentiate the wait phases so the user can tell at
      // a glance whether we're still spawning, polling for merge, or
      // waiting on post-merge CI to drain.
      const phase = update.autoResolve.phase;
      const elapsedMs = update.autoResolve.waitElapsedMs || 0;
      const elapsedSec = Math.round(elapsedMs / 1000);
      const elapsedMin = Math.floor(elapsedSec / 60);
      const elapsedSecRemainder = elapsedSec % 60;
      const elapsed = elapsedMs > 0 ? ` \\(${elapsedMin}m ${elapsedSecRemainder}s\\)` : '';
      if (phase === 'awaiting-resolution') {
        message += `🛠️ Auto\\-resolving ${link}: waiting for resolution${elapsed}\\.\\.\\.\n\n`;
      } else if (phase === 'awaiting-ci') {
        message += `🛠️ Auto\\-resolving ${link}: waiting for post\\-merge CI${elapsed}\\.\\.\\.\n\n`;
      } else if (phase === 'spawning') {
        message += `🛠️ Auto\\-resolving ${link}: dispatching solve session${elapsed}\\.\\.\\.\n\n`;
      } else {
        message += `🛠️ Auto\\-resolving ${link}\n\n`;
      }
    } else if (update.current && !this.waitingForTargetBranchCI && !this.waitingForPostMergeCI) {
      // Current item being processed
      const statusEmoji = update.currentStatus === MergeItemStatus.WAITING_CI ? '⏱️' : '🔄';
      const currentItem = this.items[this.currentIndex];
      if (currentItem) {
        const link = this.formatPrLink(currentItem.pr.number, currentItem.pr.title, currentItem.pr.url);
        const issueSuffix = this.formatIssueRef(currentItem.issue ? currentItem.issue.number : null, currentItem.issue ? currentItem.issue.url : null);
        message += `${statusEmoji} ${link}${issueSuffix}\n\n`;
      } else {
        // Fallback: escape the description if we somehow don't have an item handle
        message += `${statusEmoji} ${this.escapeMarkdown(update.current)}\n\n`;
      }
    }

    // Show errors/failures/skips inline so user gets immediate feedback (Issue #1269, #1294)
    // Include both FAILED and SKIPPED items with their reasons
    const problemItems = update.items.filter(item => (item.status === MergeItemStatus.FAILED || item.status === MergeItemStatus.SKIPPED) && item.error);
    if (problemItems.length > 0) {
      message += `⚠️ *Issues:*\n`;
      for (const item of problemItems.slice(0, 5)) {
        const statusEmoji = item.status === MergeItemStatus.FAILED ? '❌' : '⏭️';
        // Issue #1805: emit the PR reference as a clickable link instead of plain text.
        const prRef = this.formatPrLink(item.prNumber, '', item.prUrl);
        message += `  ${statusEmoji} ${prRef}: ${this.escapeMarkdown(item.error.substring(0, 50))}${item.error.length > 50 ? '\\.\\.\\.' : ''}\n`;
      }
      if (problemItems.length > 5) {
        // Issue #1339: escape the ellipsis '...' for MarkdownV2
        message += `  _\\.\\.\\.and ${problemItems.length - 5} more issues_\n`;
      }
      message += '\n';
    }

    // PRs list with emojis (Issue #1805: render as clickable MarkdownV2 links)
    message += `*Queue:*\n`;
    for (const item of update.items.slice(0, 10)) {
      message += `${item.emoji} ${this.formatPrLink(item.prNumber, item.title, item.prUrl)}\n`;
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
    message += `📋 Total: ${report.stats.total}\n`;

    // Issue #1805: surface the auto-resolve pass summary when it ran. We
    // always show the line when the flag was set so users see "0 dispatched"
    // when there was nothing to do.
    if (report.autoResolve && report.autoResolve.enabled) {
      message += `🛠️ Auto\\-resolve dispatched: ${report.autoResolve.resolved}`;
      if (report.autoResolve.failed > 0) {
        message += `  ⚠️ Auto\\-resolve failed: ${report.autoResolve.failed}`;
      }
      message += '\n';
    }

    message += '\n';

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

    // Details (Issue #1805: render PR and issue references as clickable
    // MarkdownV2 links so the user can jump directly to the PR or issue).
    if (report.items.length > 0) {
      message += `*Results:*\n`;
      for (const item of report.items) {
        const prLink = this.formatPrLink(item.prNumber, item.title, item.prUrl);
        const issueRef = this.formatIssueRef(item.issueNumber, item.issueUrl);
        // Issue #1294: Show skip/fail reason so users understand what action is required
        let reasonText = '';
        const isAutoResolveState = item.status === MergeItemStatus.RESOLVING || item.status === MergeItemStatus.RESOLVE_FAILED;
        if (item.autoResolveError && isAutoResolveState) {
          const truncated = item.autoResolveError.length > 50 ? item.autoResolveError.substring(0, 47) + '...' : item.autoResolveError;
          reasonText = ` \\(${this.escapeMarkdown(truncated)}\\)`;
        } else if (item.error && (item.status === MergeItemStatus.SKIPPED || item.status === MergeItemStatus.FAILED)) {
          // Truncate long reasons and escape for MarkdownV2
          const truncatedReason = item.error.length > 50 ? item.error.substring(0, 47) + '...' : item.error;
          reasonText = `: ${this.escapeMarkdown(truncatedReason)}`;
        }
        message += `${item.emoji} ${prLink}${issueRef}${reasonText}\n`;
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
   * Issue #1805: Escape `)` and `\` inside a URL for a MarkdownV2 inline link.
   * URLs must NOT be passed through `escapeMarkdown()` because that would also
   * mangle characters that are valid inside URLs (`.`, `-`, `_`, etc.).
   */
  escapeMarkdownLinkUrl(url) {
    return String(url).replace(/[\\)]/g, '\\$&');
  }

  /**
   * Issue #1805: Build a clickable MarkdownV2 link for a PR's `\#N: title`
   * reference. Falls back to plain escaped text when no URL is available so
   * the message still renders correctly on legacy items.
   */
  formatPrLink(prNumber, title, url, options = {}) {
    const maxTitle = typeof options.maxTitle === 'number' ? options.maxTitle : 35;
    const trimmedTitle = title || '';
    const truncated = trimmedTitle.length > maxTitle ? trimmedTitle.substring(0, maxTitle) : trimmedTitle;
    const ellipsis = trimmedTitle.length > maxTitle ? '\\.\\.\\.' : '';
    const titlePart = trimmedTitle ? `: ${this.escapeMarkdown(truncated)}${ellipsis}` : '';
    const label = `\\#${prNumber}${titlePart}`;
    if (!url) return label;
    return `[${label}](${this.escapeMarkdownLinkUrl(url)})`;
  }

  /**
   * Issue #1805: Build the ` (Issue #N)` suffix as a clickable link. The
   * outer parentheses are literal MarkdownV2 (escaped), so the inner inline
   * link is not nested inside another entity.
   */
  formatIssueRef(issueNumber, url) {
    if (!issueNumber) return '';
    const label = `Issue \\#${issueNumber}`;
    if (!url) return ` \\(${label}\\)`;
    return ` \\([${label}](${this.escapeMarkdownLinkUrl(url)})\\)`;
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
