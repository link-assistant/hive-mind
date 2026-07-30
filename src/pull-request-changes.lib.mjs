#!/usr/bin/env node

/**
 * Issue #2119: does the pull request actually contain any changes?
 *
 * Nobody asked that question before, and two separate false positives followed
 * from it. In the reproduction runs the AI tool produced nothing, so the branch
 * ended up with the solver's own scaffolding commit and a revert of it - a net
 * diff of zero files:
 *
 *   https://github.com/konard/test-hello-world-019fb330-00e1-73b9-955e-f357a1600d5b/pull/2
 *   https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/pull/2
 *
 * Yet the published pull request bodies claimed
 *
 *   ### Changes
 *   - 1 file(s) modified
 *   - 1 line(s) added
 *
 * (the stats were measured while the scaffolding commit was still in the diff
 * and never revisited), and the Kotlin run went on to post "✅ Ready to merge -
 * No pending changes" for a pull request that changed nothing at all.
 *
 * This module is the single place that answers the question, so both the
 * description writer and the mergeability watcher agree.
 */

import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';

/**
 * Measure the net diff of a pull request.
 *
 * The counts come from the unified diff rather than from the PR's `additions` /
 * `deletions` fields because those are per-commit sums: a commit and its revert
 * report 1 addition and 1 deletion while the net diff is empty.
 *
 * @param {Object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {number} params.prNumber
 * @param {Function} params.$ command-stream tagged-template executor
 * @returns {Promise<{hasChanges: boolean, filesChanged: number, additions: number, deletions: number, measured: boolean}>}
 *   `measured` is false when the diff could not be fetched, in which case
 *   callers must not treat the pull request as empty.
 */
export const getPullRequestChangeStats = async ({ owner, repo, prNumber, $ }) => {
  let diffOutput = '';
  let measured = false;
  try {
    const result = await ghWithRateLimitRetry(() => $`gh pr diff ${prNumber} --repo ${owner}/${repo}`, { label: `pr diff ${owner}/${repo}#${prNumber}` });
    if (result.code === 0) {
      diffOutput = result.stdout.toString();
      measured = true;
    }
  } catch {
    // Leave measured false: an unreachable API must not read as "no changes".
  }

  const filesChanged = (diffOutput.match(/^diff --git/gm) || []).length;
  const additions = (diffOutput.match(/^\+[^+]/gm) || []).length;
  const deletions = (diffOutput.match(/^-[^-]/gm) || []).length;

  return { hasChanges: filesChanged > 0, filesChanged, additions, deletions, measured };
};

/**
 * Render the "### Changes" section of a generated pull request description.
 *
 * When the diff is empty this says so instead of inventing a file count, so a
 * reviewer reading the description learns the same thing the diff would tell
 * them.
 *
 * @param {{hasChanges: boolean, filesChanged: number, additions: number, deletions: number, measured: boolean}} stats
 * @returns {string}
 */
export const formatChangeSummary = stats => {
  if (!stats.measured) {
    return '- The diff could not be read, so the change summary is unavailable';
  }
  if (!stats.hasChanges) {
    return '- No files were changed by this pull request yet';
  }
  return [`- ${stats.filesChanged} file(s) modified`, `- ${stats.additions} line(s) added`, `- ${stats.deletions} line(s) removed`].join('\n');
};

/**
 * The blocker to report when a pull request is otherwise mergeable but empty.
 *
 * Merging it would close the issue without changing anything, so this is
 * treated as a reason to restart the AI rather than as success. The shared
 * auto-restart budget bounds the retries and fails the run visibly once it is
 * exhausted.
 */
export const EMPTY_PULL_REQUEST_BLOCKER = 'The pull request contains no changes (its net diff is empty), so there is nothing to merge';

export default { getPullRequestChangeStats, formatChangeSummary, EMPTY_PULL_REQUEST_BLOCKER };
