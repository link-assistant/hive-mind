#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

/**
 * Pre-flight checks that run before the --auto-merge / --auto-restart-until-mergeable
 * watch loop is entered: mode detection, base-branch guard, fork detection and
 * merge-permission verification.
 *
 * Extracted from solve.auto-merge.lib.mjs (issue #1593) to keep that file under the
 * 1350-line advisory threshold while the issue #2182 guard rails were added. Same
 * pattern as solve.auto-merge-attempt.lib.mjs (issue #2144).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1593
 */

if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}
const use = globalThis.use;

const { $: __rawDollar$ } = await use('command-stream');
const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
const $ = wrapDollarWithGhRetry(__rawDollar$);

const lib = await import('./lib.mjs');
const { log, formatAligned } = lib;

const { checkMergePermissions } = await import('./github-merge.lib.mjs');
const { checkForExistingComment } = await import('./solve.auto-merge-helpers.lib.mjs');
const { READY_TO_MERGE_MARKER, postTrackedComment } = await import('./tool-comments.lib.mjs');
const { ensurePullRequestBaseBranch } = await import('./solve.pr-base-guard.lib.mjs');

/**
 * Issue #1323: notify the maintainer on the pull request that auto-merge was
 * requested but cannot be performed, without posting the same comment twice.
 */
const postManualMergeNotice = async ({ owner, repo, prNumber, reason, verbose, footer }) => {
  try {
    const readyToMergeSignature = `## ✅ ${READY_TO_MERGE_MARKER}`;
    if (await checkForExistingComment(owner, repo, prNumber, readyToMergeSignature, verbose)) {
      await log(formatAligned('', `Skipping duplicate "${READY_TO_MERGE_MARKER}" comment`, '', 2));
      return;
    }
    const commentBody = `${readyToMergeSignature}\n\nThis pull request is ready to be merged. Auto-merge was requested (\`--auto-merge\`) but cannot be performed because ${reason}\n\nPlease merge manually.\n\n---\n*${footer}*`;
    // Issue #1625: Track so this doesn't falsely count as AI-authored.
    await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: commentBody });
    await log(formatAligned('', '💬 Posted merge readiness notification to PR', '', 2));
  } catch {
    // Don't fail if comment posting fails
  }
};

/**
 * Run every check that can stop auto-merge before the watch loop starts.
 *
 * @param {Object} params - the same params object `startAutoRestartUntilMergeable` receives
 * @returns {Promise<{stop: boolean, result?: (Object|null)}>} `stop: true` means the
 *   caller must return `result` immediately instead of entering the watch loop.
 */
export const runAutoMergePreflight = async params => {
  const { argv, owner, repo, prNumber } = params;
  const isAutoMerge = argv.autoMerge || false;
  const isAutoRestartUntilMergeable = argv.autoRestartUntilMergeable || false;

  if (!isAutoMerge && !isAutoRestartUntilMergeable) {
    return { stop: true, result: null }; // Neither mode enabled
  }

  if (!prNumber) {
    await log('');
    await log(formatAligned('⚠️', 'Auto-restart-until-mergeable:', 'Requires a pull request'));
    await log(formatAligned('', 'Note:', 'This mode only works with existing PRs', 2));
    return { stop: true, result: null };
  }

  await ensurePullRequestBaseBranch({
    owner,
    repo,
    prNumber,
    argv,
    log,
    formatAligned,
    $,
    onMismatch: isAutoMerge ? 'throw' : 'restore',
    operation: isAutoMerge ? 'auto-merge' : 'auto-restart-until-mergeable',
  });

  // Issue #1226: Check if running in fork mode — auto-merge cannot work without write access
  if (argv.fork && isAutoMerge) {
    await log('');
    await log(formatAligned('⚠️', 'Auto-merge:', 'Cannot auto-merge fork PRs'));
    await log(formatAligned('', 'Reason:', 'Fork contributors do not have write access to merge PRs to upstream repositories', 2));
    await log(formatAligned('', 'Action:', 'PR is ready for manual merge by a repository maintainer', 2));
    await log('');
    await postManualMergeNotice({ owner, repo, prNumber, verbose: argv.verbose, reason: 'this PR was created from a fork (no write access to the target repository).', footer: 'hive-mind with --auto-merge flag (fork mode)' });
    return { stop: true, result: { success: false, reason: 'fork_no_write_access' } };
  }

  // Issue #1226: Verify merge permissions before entering the auto-merge/restart loop
  if (isAutoMerge && owner && repo) {
    const { canMerge, permission } = await checkMergePermissions(owner, repo, argv.verbose);
    if (!canMerge) {
      await log('');
      await log(formatAligned('⚠️', 'Auto-merge:', 'Insufficient permissions to merge'));
      await log(formatAligned('', 'Permission level:', permission || 'unknown', 2));
      await log(formatAligned('', 'Required:', 'push, maintain, or admin access', 2));
      await log(formatAligned('', 'Action:', 'PR is ready for manual merge by a repository maintainer', 2));
      await log('');
      await postManualMergeNotice({ owner, repo, prNumber, verbose: argv.verbose, reason: `the authenticated user lacks write access to \`${owner}/${repo}\` (current permission: \`${permission || 'unknown'}\`).`, footer: 'hive-mind with --auto-merge flag' });
      return { stop: true, result: { success: false, reason: 'insufficient_permissions' } };
    }
  }

  // --auto-merge implies --auto-restart-until-mergeable
  if (isAutoMerge) {
    argv.autoRestartUntilMergeable = true;
  }

  return { stop: false };
};

export default { runAutoMergePreflight };
