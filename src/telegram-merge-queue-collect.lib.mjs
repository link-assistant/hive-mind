#!/usr/bin/env node
/**
 * Collects the pull requests a Telegram merge queue run will process.
 *
 * - Issue and pull request targets resolve their linked or selected PR
 *   (issue #2013).
 * - Repository targets sync the `ready` tags and collect every `ready` PR
 *   (issue #1367).
 * - With `dependabot`, repository targets also collect open Dependabot version
 *   bump PRs; `includeReadyPRs: false` collects only those and leaves the
 *   `ready` label untouched (issue #2885).
 *
 * Split from telegram-merge-queue.lib.mjs to keep that file under the
 * repository line limit.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2885
 */

import { mergeDependabotItems } from './github-merge-dependabot.lib.mjs';

/**
 * Message shown when there is nothing to merge.
 *
 * @param {Object} target - Merge target ({mode, issueNumber, prNumber})
 * @param {{dependabot: boolean, dependabotOnly: boolean}} options
 * @returns {string}
 */
export function getEmptyQueueMessage(target, { dependabot = false, dependabotOnly = false } = {}) {
  if (target?.mode === 'issue') return `No open PRs linked to issue #${target.issueNumber} found`;
  if (target?.mode === 'pull') return `Pull request #${target.prNumber} was not found`;
  if (dependabotOnly) return 'No open Dependabot PRs found';
  return dependabot ? "No PRs with 'ready' label or open Dependabot PRs found" : "No PRs with 'ready' label found";
}

/**
 * @param {Object} processor - MergeQueueProcessor-like object (owner, repo, verbose, target,
 *   dependabot, includeReadyPRs, log(), ensureReadyLabel(), syncReadyTags(), getAllReadyPRs(),
 *   fetchDependabotPullRequests(), resolveMergeTargetItemsWithWait())
 * @returns {Promise<{error: string|null, prs: Array, emptyMessage: string}>}
 */
export async function collectMergeQueuePRs(processor) {
  const { owner, repo, verbose, target } = processor;
  const isRepositoryTarget = !target?.mode || target.mode === 'repository';
  const dependabot = processor.dependabot === true && isRepositoryTarget;
  const dependabotOnly = dependabot && processor.includeReadyPRs === false;
  const emptyMessage = getEmptyQueueMessage(target, { dependabot, dependabotOnly });

  if (!dependabotOnly) {
    const labelResult = await processor.ensureReadyLabel(owner, repo, verbose);
    if (!labelResult.success) {
      return { error: labelResult.error, prs: [], emptyMessage };
    }
    if (labelResult.created) {
      processor.log("Created 'ready' label in repository");
    }
  }

  let prs = [];
  if (!isRepositoryTarget) {
    prs = await processor.resolveMergeTargetItemsWithWait();
  } else if (!dependabotOnly) {
    // Issue #1367: Sync 'ready' tags between linked PRs and issues before collecting the queue
    // This ensures the final list reflects all ready work regardless of where the tag was applied
    const syncResult = await processor.syncReadyTags(owner, repo, verbose);
    if (syncResult.synced > 0) {
      processor.log(`Synced 'ready' tag: ${syncResult.synced} item(s) updated`);
    }
    if (syncResult.errors > 0) {
      processor.log(`Tag sync had ${syncResult.errors} error(s) (non-fatal, proceeding)`);
    }
    prs = await processor.getAllReadyPRs(owner, repo, verbose);
  }

  if (dependabot) {
    const dependabotPRs = await processor.fetchDependabotPullRequests(owner, repo, verbose);
    processor.log(`Found ${dependabotPRs.length} open Dependabot PR(s)`);
    prs = mergeDependabotItems(prs, dependabotPRs);
  }

  return { error: null, prs, emptyMessage };
}

export default { collectMergeQueuePRs, getEmptyQueueMessage };
