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
 *   - pure helpers to diagnose *why* a closing reference is missing.
 * The post-merge close itself is closeIntendedIssuesAfterMerge in
 * post-merge-issue-closing.lib.mjs, shared by every merge path (#3357).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1895
 * @see https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue
 */

import { prClosesIssue } from './github-linking.lib.mjs';

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
export function classifyIssueLinkStatus({ prBody = '', issueNumber, owner = null, repo = null, baseBranch = null, defaultBranch = null, githubLinked = false } = {}) {
  // GitHub recognizes description closing references, not PR title mentions.
  const hasClosingKeyword = prClosesIssue(prBody, issueNumber, owner, repo);
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

export default {
  gitHubAutoClosesOnMerge,
  classifyIssueLinkStatus,
  buildNonDefaultBranchExplanation,
};
