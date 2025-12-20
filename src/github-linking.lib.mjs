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
  return [
    'close', 'closes', 'closed',
    'fix', 'fixes', 'fixed',
    'resolve', 'resolves', 'resolved'
  ];
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
  if (!prBody || !issueNumber) {
    return false;
  }

  const keywords = getGitHubLinkingKeywords();
  const issueNumStr = issueNumber.toString();

  // Build regex patterns for each valid format:
  // 1. KEYWORD #123
  // 2. KEYWORD owner/repo#123
  // 3. KEYWORD https://github.com/owner/repo/issues/123

  for (const keyword of keywords) {
    // Pattern 1: KEYWORD #123
    // Must have word boundary before keyword and # immediately before number
    const pattern1 = new RegExp(
      `\\b${keyword}\\s+#${issueNumStr}\\b`,
      'i'
    );

    if (pattern1.test(prBody)) {
      return true;
    }

    // Pattern 2: KEYWORD owner/repo#123 (for cross-repo or fork references)
    if (owner && repo) {
      const pattern2 = new RegExp(
        `\\b${keyword}\\s+${owner}/${repo}#${issueNumStr}\\b`,
        'i'
      );

      if (pattern2.test(prBody)) {
        return true;
      }
    }

    // Pattern 3: KEYWORD https://github.com/owner/repo/issues/123
    if (owner && repo) {
      const pattern3 = new RegExp(
        `\\b${keyword}\\s+https://github\\.com/${owner}/${repo}/issues/${issueNumStr}\\b`,
        'i'
      );

      if (pattern3.test(prBody)) {
        return true;
      }
    }

    // Pattern 4: Also check for any URL format (generic)
    const pattern4 = new RegExp(
      `\\b${keyword}\\s+https://github\\.com/[^/]+/[^/]+/issues/${issueNumStr}\\b`,
      'i'
    );

    if (pattern4.test(prBody)) {
      return true;
    }
  }

  return false;
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
    const pattern1 = new RegExp(
      `\\b${keyword}\\s+#(\\d+)\\b`,
      'i'
    );
    const match1 = prBody.match(pattern1);
    if (match1) {
      return match1[1];
    }

    // Try to match: KEYWORD owner/repo#123
    const pattern2 = new RegExp(
      `\\b${keyword}\\s+[^/\\s]+/[^/\\s]+#(\\d+)\\b`,
      'i'
    );
    const match2 = prBody.match(pattern2);
    if (match2) {
      return match2[1];
    }

    // Try to match: KEYWORD https://github.com/owner/repo/issues/123
    const pattern3 = new RegExp(
      `\\b${keyword}\\s+https://github\\.com/[^/]+/[^/]+/issues/(\\d+)\\b`,
      'i'
    );
    const match3 = prBody.match(pattern3);
    if (match3) {
      return match3[1];
    }
  }

  return null;
}
