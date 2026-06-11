#!/usr/bin/env node

/**
 * GitHub Issue Auto-Close Diagnosis & Fallback Library
 *
 * Root cause of issue #1895:
 * GitHub only registers a pull request's closing references (the
 * `closingIssuesReferences` GraphQL connection) and only auto-closes the
 * referenced issues when the pull request targets the repository's
 * **default branch**. When a PR uses a closing keyword such as
 * `Fixes #49` / `Closes #50` but targets a non-default branch (for example a
 * stacked / sub-issue branch like `issue-47-...`), GitHub:
 *
 *   1. leaves `closingIssuesReferences` empty, so automatic linking detection
 *      reports "ISSUE LINK MISSING" even though the keyword is present, and
 *   2. does not close the linked issue when the PR is merged, so the PR is
 *      "closed without its issue to be closed as well".
 *
 * This module provides:
 *   - pure helpers to diagnose *why* a closing reference is missing, and
 *   - an action helper that explicitly closes the linked issue after a merge
 *     into a non-default branch, where GitHub would not do it for us.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1895
 * @see https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue
 */

import { prClosesIssue, extractLinkedIssueNumber } from './github-linking.lib.mjs';
import { wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs';

/**
 * Determine whether GitHub will automatically close a PR's linked issues when
 * the PR is merged, based on the branch it targets.
 *
 * GitHub only auto-closes linked issues for PRs merged into the repository's
 * default branch.
 *
 * @param {string|null|undefined} baseBranch - The branch the PR targets (baseRefName)
 * @param {string|null|undefined} defaultBranch - The repository's default branch
 * @returns {boolean|null} true if GitHub will auto-close, false if it will not,
 *   or null when the answer cannot be determined (missing input).
 */
export function gitHubAutoClosesOnMerge(baseBranch, defaultBranch) {
  if (!baseBranch || !defaultBranch) {
    return null;
  }
  return String(baseBranch).trim() === String(defaultBranch).trim();
}

/**
 * Classify the issue-linking status of a pull request so callers can emit an
 * accurate diagnostic instead of the misleading "add Fixes #N" advice when the
 * keyword is already present.
 *
 * @param {Object} options
 * @param {string|null} [options.prBody] - Pull request body
 * @param {string|null} [options.prTitle] - Pull request title
 * @param {string|number} options.issueNumber - Issue the PR should close
 * @param {string|null} [options.owner] - Repository owner (for cross-repo refs)
 * @param {string|null} [options.repo] - Repository name (for cross-repo refs)
 * @param {string|null} [options.baseBranch] - Branch the PR targets
 * @param {string|null} [options.defaultBranch] - Repository default branch
 * @param {boolean} [options.githubLinked] - Whether GitHub already reports the
 *   issue in `closingIssuesReferences`
 * @returns {{
 *   hasClosingKeyword: boolean,
 *   githubLinked: boolean,
 *   autoCloses: boolean|null,
 *   targetsNonDefaultBranch: boolean,
 *   requiresManualClose: boolean,
 *   reason: string,
 * }}
 */
export function classifyIssueLinkStatus({ prBody = '', prTitle = '', issueNumber, owner = null, repo = null, baseBranch = null, defaultBranch = null, githubLinked = false } = {}) {
  const hasClosingKeyword = prClosesIssue(prBody, issueNumber, owner, repo) || prClosesIssue(prTitle, issueNumber, owner, repo);
  const autoCloses = gitHubAutoClosesOnMerge(baseBranch, defaultBranch);
  const targetsNonDefaultBranch = autoCloses === false;

  let reason;
  let requiresManualClose = false;

  if (githubLinked) {
    reason = 'github-linked';
  } else if (!hasClosingKeyword) {
    // The keyword is genuinely absent — the historical advice applies.
    reason = 'missing-keyword';
  } else if (targetsNonDefaultBranch) {
    // The keyword IS present, but the PR targets a non-default branch, so
    // GitHub never registers the closing reference and will not auto-close.
    reason = 'non-default-base-branch';
    requiresManualClose = true;
  } else {
    // Keyword present, base looks like default (or unknown): GitHub is
    // expected to register the link, possibly after a short delay.
    reason = 'keyword-present-link-pending';
  }

  return {
    hasClosingKeyword,
    githubLinked: Boolean(githubLinked),
    autoCloses,
    targetsNonDefaultBranch,
    requiresManualClose,
    reason,
  };
}

/**
 * Build the human-readable lines that explain a non-default-base-branch linking
 * failure. Shared so solve and merge code paths print the same explanation.
 *
 * @param {Object} options
 * @param {string|number} options.issueNumber
 * @param {string} options.baseBranch
 * @param {string} options.defaultBranch
 * @param {string} [options.issueRef] - Display reference such as `#49` or `owner/repo#49`
 * @returns {string[]}
 */
export function buildNonDefaultBranchExplanation({ issueNumber, baseBranch, defaultBranch, issueRef = `#${issueNumber}` }) {
  return [`The PR closing keyword for ${issueRef} is present, but the PR targets the`, `non-default branch '${baseBranch}' (the repository default is '${defaultBranch}').`, 'GitHub only registers closing references and auto-closes linked issues for', 'pull requests merged into the default branch, so:', `  • the automatic link to issue ${issueRef} will not appear, and`, `  • issue ${issueRef} will NOT be closed automatically when this PR merges.`, 'hive-mind will close the linked issue explicitly after the merge instead.'];
}

/**
 * After a PR has been merged, ensure the linked issue is closed when GitHub will
 * not do it automatically (i.e. the PR targeted a non-default branch).
 *
 * This is a no-op (returns a skipped result) when:
 *   - GitHub will auto-close the issue (PR merged into the default branch), or
 *   - the PR body/title does not contain a closing keyword for the issue, or
 *   - the issue is already closed.
 *
 * @param {Object} options
 * @param {Function} options.$ - command-stream `$` exec helper
 * @param {Function} [options.log] - async logger
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {string|number} options.prNumber
 * @param {string|number|null} [options.issueNumber] - Issue the PR should close
 *   (derived from the PR body closing keyword when omitted)
 * @param {string|null} [options.baseBranch] - Branch the PR targeted (fetched if omitted)
 * @param {string|null} [options.defaultBranch] - Repo default branch (fetched if omitted)
 * @param {string|null} [options.prBody] - PR body (fetched if omitted)
 * @param {string|null} [options.prTitle] - PR title (fetched if omitted)
 * @param {boolean} [options.verbose]
 * @returns {Promise<{closed: boolean, skipped: boolean, reason: string, error?: string}>}
 */
export async function ensureLinkedIssueClosedAfterMerge({ $: rawDollar, log = null, owner, repo, prNumber, issueNumber = null, baseBranch = null, defaultBranch = null, prBody = null, prTitle = null, verbose = false }) {
  // Issue #1726: route every `gh ...` call through the rate-limit-aware wrapper.
  const $ = wrapDollarWithGhRetry(rawDollar);
  const note = async message => {
    if (log) {
      await log(message, { verbose: true });
    } else if (verbose) {
      console.log(message);
    }
  };

  if (!owner || !repo || !prNumber) {
    return { closed: false, skipped: true, reason: 'missing-parameters' };
  }

  try {
    // Fetch PR metadata (base branch, body, title) if not provided.
    if (baseBranch === null || prBody === null || prTitle === null) {
      const prView = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json baseRefName,body,title`;
      if (prView.code === 0) {
        const data = JSON.parse(prView.stdout.toString().trim() || '{}');
        if (baseBranch === null) baseBranch = data.baseRefName ?? null;
        if (prBody === null) prBody = data.body ?? '';
        if (prTitle === null) prTitle = data.title ?? '';
      }
    }

    // Derive the linked issue from the PR body when the caller did not supply it.
    if (!issueNumber) {
      issueNumber = extractLinkedIssueNumber(prBody || '') || extractLinkedIssueNumber(prTitle || '');
    }
    if (!issueNumber) {
      await note(`[auto-close] PR #${prNumber} has no closing keyword identifying an issue; nothing to close`);
      return { closed: false, skipped: true, reason: 'no-linked-issue' };
    }

    // Fetch the repository default branch if not provided.
    if (defaultBranch === null) {
      const repoView = await $`gh api repos/${owner}/${repo} --jq .default_branch`;
      if (repoView.code === 0) {
        defaultBranch = repoView.stdout.toString().trim() || null;
      }
    }

    const status = classifyIssueLinkStatus({ prBody: prBody || '', prTitle: prTitle || '', issueNumber, owner, repo, baseBranch, defaultBranch });

    if (status.autoCloses === true) {
      await note(`[auto-close] GitHub will auto-close issue #${issueNumber} (PR #${prNumber} merged into default branch '${defaultBranch}')`);
      return { closed: false, skipped: true, reason: 'github-auto-closes' };
    }

    if (!status.hasClosingKeyword) {
      await note(`[auto-close] PR #${prNumber} has no closing keyword for issue #${issueNumber}; not closing it`);
      return { closed: false, skipped: true, reason: 'no-closing-keyword' };
    }

    if (status.autoCloses === null) {
      await note(`[auto-close] Could not determine base/default branch for PR #${prNumber}; leaving issue #${issueNumber} to GitHub`);
      return { closed: false, skipped: true, reason: 'unknown-branch' };
    }

    // Check current issue state — do not act if it is already closed.
    const issueState = await $`gh issue view ${issueNumber} --repo ${owner}/${repo} --json state,stateReason`;
    if (issueState.code === 0) {
      const data = JSON.parse(issueState.stdout.toString().trim() || '{}');
      if (String(data.state).toUpperCase() === 'CLOSED') {
        await note(`[auto-close] Issue #${issueNumber} is already closed`);
        return { closed: false, skipped: true, reason: 'already-closed' };
      }
    }

    // Close the issue explicitly, leaving an explanatory trail.
    const comment = [`Closed by #${prNumber}, which targeted the non-default branch \`${baseBranch}\` (repository default: \`${defaultBranch}\`).`, '', 'GitHub only auto-closes linked issues for pull requests merged into the default branch,', 'so hive-mind closed this issue explicitly after the merge.', '', '_Automated by hive-mind ([#1895](https://github.com/link-assistant/hive-mind/issues/1895))._'].join('\n');

    const closeResult = await $`gh issue close ${issueNumber} --repo ${owner}/${repo} --reason completed --comment ${comment}`;
    if (closeResult.code === 0) {
      if (log) {
        await log(`🔗 Closed issue #${issueNumber} explicitly (PR #${prNumber} merged into non-default branch '${baseBranch}')`);
      }
      return { closed: true, skipped: false, reason: 'closed-explicitly' };
    }

    return { closed: false, skipped: false, reason: 'close-command-failed', error: closeResult.stderr?.toString?.() || 'unknown error' };
  } catch (error) {
    return { closed: false, skipped: false, reason: 'exception', error: error.message };
  }
}

export default {
  gitHubAutoClosesOnMerge,
  classifyIssueLinkStatus,
  buildNonDefaultBranchExplanation,
  ensureLinkedIssueClosedAfterMerge,
};
