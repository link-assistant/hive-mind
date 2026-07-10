#!/usr/bin/env node
/**
 * Wait helpers for Telegram merge queue.
 *
 * Split from telegram-merge-queue.lib.mjs to keep that file under the
 * repository line limit.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2013
 */

/**
 * Wait for an unfinished PR to become mergeable before CI/merge processing.
 *
 * @param {Object} processor - MergeQueueProcessor-like object
 * @param {Object} item - Merge queue item
 * @param {{mergeable: boolean, terminal?: boolean, reason?: string}} initialCheck
 * @param {Object} options
 * @param {Object} options.MergeItemStatus
 * @param {string} options.conflictSkipReason
 * @param {number} options.timeoutMs
 * @param {number} options.pollIntervalMs
 * @returns {Promise<{success: boolean, status: string, error: string|null}>}
 */
export async function waitForPRReady(processor, item, initialCheck, options) {
  const { MergeItemStatus, conflictSkipReason, timeoutMs, pollIntervalMs } = options;
  const startedAt = Date.now();
  let latestCheck = initialCheck;

  while (true) {
    if (processor.isCancelled) {
      return { success: false, status: 'cancelled', error: 'Cancelled' };
    }

    if (latestCheck?.terminal) {
      return {
        success: false,
        status: 'terminal',
        error: latestCheck.reason || 'GitHub repository, pull request, issue, or branch is no longer accessible',
      };
    }

    if (latestCheck?.mergeable) {
      item.status = MergeItemStatus.CHECKING_CI;
      item.error = null;
      return { success: true, status: 'ready', error: null };
    }

    if (latestCheck?.reason === conflictSkipReason) {
      return { success: false, status: 'conflict', error: conflictSkipReason };
    }

    if (Date.now() - startedAt >= timeoutMs) {
      const reason = latestCheck?.reason || 'PR did not become mergeable';
      return {
        success: false,
        status: 'timeout',
        error: `Timed out waiting for PR #${item.pr.number} to become mergeable: ${reason}`,
      };
    }

    item.status = MergeItemStatus.WAITING_READY;
    item.error = latestCheck?.reason || 'Waiting for PR to become mergeable';
    processor.log(`Waiting for PR #${item.pr.number} to become mergeable: ${item.error}`);
    if (processor.onProgress) {
      await processor.onProgress(processor.getProgressUpdate());
    }

    await processor.sleep(pollIntervalMs);
    latestCheck = await processor.checkPRMergeable(processor.owner, processor.repo, item.pr.number, processor.verbose);
  }
}

export default {
  waitForPRReady,
};
