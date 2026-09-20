#!/usr/bin/env node

/**
 * GitHub Issue Linking Detection Library
 *
 * This module provides utilities to detect GitHub's reserved keywords for linking
 * pull requests to issues according to GitHub's official documentation:
 * https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue
 *
 * Valid linking keywords (case-insensitive):
 * - close, closes, closed
 * - fix, fixes, fixed
 * - resolve, resolves, resolved
 *
 * Valid formats:
 * - KEYWORD #ISSUE-NUMBER
 * - KEYWORD OWNER/REPO#ISSUE-NUMBER
 * - KEYWORD https://github.com/OWNER/REPO/issues/ISSUE-NUMBER
 */

/**
 * Get all valid GitHub linking keywords
 * @returns {string[]} Array of valid linking keywords
 */
export function getGitHubLinkingKeywords() {
  return ['close', 'closes', 'closed', 'fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved'];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildClosingReferencePatterns(keyword, issueNumber, owner = null, repo = null) {
  const issueNumStr = escapeRegExp(issueNumber);
  const separator = String.raw`(?:\s+|\s*:\s*)`;
  const prefix = String.raw`\b${keyword}${separator}`;
  const references = [String.raw`#${issueNumStr}\b`];

  if (owner && repo) {
    references.push(`${escapeRegExp(owner)}/${escapeRegExp(repo)}#${issueNumStr}\\b`);
    references.push(`https://github\\.com/${escapeRegExp(owner)}/${escapeRegExp(repo)}/issues/${issueNumStr}\\b`);
  }

  references.push(String.raw`[\w.-]+/[\w.-]+#${issueNumStr}\b`);
  references.push(`https://github\\.com/[^/\\s]+/[^/\\s]+/issues/${issueNumStr}\\b`);

  return references.map(reference => new RegExp(`${prefix}${reference}`, 'i'));
}

/**
 * Check whether text contains a GitHub closing keyword for a specific issue.
 *
 * This is the shared parser used by solve and hive code paths so they agree on
 * which PR body/title references are real closing links.
 *
 * @param {string} text - Pull request body or title text
 * @param {string|number} issueNumber - Issue number to check for
 * @param {string} [owner] - Repository owner for exact owner/repo references
 * @param {string} [repo] - Repository name for exact owner/repo references
 * @returns {boolean} True if a valid closing reference is found
 */
export function prClosesIssue(text, issueNumber, owner = null, repo = null) {
  if (!text || typeof text !== 'string' || issueNumber === null || issueNumber === undefined || String(issueNumber).trim() === '') {
    return false;
  }

  const issueNumStr = String(issueNumber).trim();

  for (const keyword of getGitHubLinkingKeywords()) {
    const patterns = buildClosingReferencePatterns(keyword, issueNumStr, owner, repo);
    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if PR body contains a valid GitHub linking keyword for the given issue
 *
 * @param {string} prBody - The pull request body text
 * @param {string|number} issueNumber - The issue number to check for
 * @param {string} [owner] - Repository owner (for cross-repo references)
 * @param {string} [repo] - Repository name (for cross-repo references)
 * @returns {boolean} True if a valid linking keyword is found
 */
export function hasGitHubLinkingKeyword(prBody, issueNumber, owner = null, repo = null) {
  return prClosesIssue(prBody, issueNumber, owner, repo);
}

/**
 * Extract issue number from PR body using GitHub linking keywords
 * This is used to find which issue a PR is linked to
 *
 * @param {string} prBody - The pull request body text
 * @returns {string|null} The issue number if found, null otherwise
 */
export function extractLinkedIssueNumber(prBody) {
  if (!prBody) {
    return null;
  }

  const keywords = getGitHubLinkingKeywords();

  for (const keyword of keywords) {
    // Try to match: KEYWORD #123
    const pattern1 = new RegExp(`\\b${keyword}\\s+#(\\d+)\\b`, 'i');
    const match1 = prBody.match(pattern1);
    if (match1) {
      return match1[1];
    }

    // Try to match: KEYWORD owner/repo#123
    const pattern2 = new RegExp(`\\b${keyword}\\s+[^/\\s]+/[^/\\s]+#(\\d+)\\b`, 'i');
    const match2 = prBody.match(pattern2);
    if (match2) {
      return match2[1];
    }

    // Try to match: KEYWORD https://github.com/owner/repo/issues/123
    const pattern3 = new RegExp(`\\b${keyword}\\s+https://github\\.com/[^/]+/[^/]+/issues/(\\d+)\\b`, 'i');
    const match3 = prBody.match(pattern3);
    if (match3) {
      return match3[1];
    }
  }

  return null;
}
