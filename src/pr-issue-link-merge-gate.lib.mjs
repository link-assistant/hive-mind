#!/usr/bin/env node

/**
 * Re-ensure the "Fixes #N" link right before `--auto-merge` merges (issue #2395).
 *
 * The issue link is added when the pull request is created and re-checked after
 * each auto-restart, but any later session (or a tool process that survived a
 * stop) can rewrite the description without it. In konard/p-vs-np#623 the body
 * was rewritten 54 seconds before the auto-merge, so the pull request merged
 * "unattached to issue" and issue #567 stayed open. The merge is the last point
 * where this can be repaired, so the link is ensured here — and the merge is
 * held back when it cannot be ensured.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2395
 */

/** Merge blocker reason used when the pull request is not linked to its issue. */
export const ISSUE_LINK_UNVERIFIED_REASON = 'issue_link_unverified';

const loadEnsurePullRequestIssueLink = async () => (await import('./solve.results.lib.mjs')).ensurePullRequestIssueLink;

/**
 * Make sure the pull request description links (closes) the issue before merging.
 *
 * Adds the missing "Fixes" reference itself; fails closed when that is not
 * possible, so a pull request is never auto-merged without its issue link.
 *
 * @param {object} params
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string|number} params.issueNumber
 * @param {string|number} params.prNumber
 * @param {object} [params.argv]
 * @param {Function} [params.log]
 * @param {Function} [params.ensureLink] - `ensurePullRequestIssueLink` (injectable for tests)
 * @returns {Promise<{reason: string, message: string, details: string[], resolution: string}|null>} merge blocker, or null
 */
export const ensureIssueLinkBeforeMerge = async ({ owner, repo, issueNumber, prNumber, argv = {}, log = async () => {}, ensureLink = null }) => {
  if (!owner || !repo || !issueNumber || !prNumber) return null;
  const ensure = ensureLink || (await loadEnsurePullRequestIssueLink());

  let result;
  try {
    await log(`🔗 Ensuring PR #${prNumber} links issue #${issueNumber} before merging...`);
    result = await ensure({ prNumber, issueNumber, owner, repo, argv });
  } catch (error) {
    result = { checked: false, updated: false, error: error?.message || String(error) };
  }

  const linked = result?.checked === true && !result.error;
  if (linked) {
    if (result.updated) {
      await log(`   📝 The PR description had lost its link to issue #${issueNumber}; restored "Fixes ${result.issueRef}" before merging`, { level: 'warning' });
    }
    return null;
  }

  const error = result?.error || 'unknown error';
  await log(`   ⚠️  Could not ensure PR #${prNumber} links issue #${issueNumber}: ${error}`, { level: 'warning' });
  return {
    reason: ISSUE_LINK_UNVERIFIED_REASON,
    message: `Pull request #${prNumber} could not be verified to close issue #${issueNumber}`,
    details: [`Error: ${error}`],
    resolution: `Add "Fixes #${issueNumber}" to the pull request description.`,
  };
};

export default { ISSUE_LINK_UNVERIFIED_REASON, ensureIssueLinkBeforeMerge };
