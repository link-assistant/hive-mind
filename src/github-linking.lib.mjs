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

/** Ignore examples and hidden metadata when interpreting a closing declaration. */
export function getClosingReferenceText(text) {
  return String(text || '')
    .replace(/<!--[^]*?-->/g, ' ')
    .replace(/(^|\n)[ \t]*(`{3,}|~{3,})[^\n]*\n[^]*?(?:\n[ \t]*\2[^\n]*(?=\n|$)|$)/g, '\n')
    .replace(/(`+)[^]*?\1/g, ' ');
}

/** Shared parser: repair, discovery, and merge checks must agree. */
export function extractClosingIssueReferences(text) {
  const visible = getClosingReferenceText(text);
  const pattern = /\b(close[sd]?|fix(?:es|ed)?|resolve[sd]?)(?:\s+|\s*:\s*)(?:https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/|([\w.-]+)\/([\w.-]+)#|#)([1-9]\d*)\b/gi;
  const references = [];
  for (const match of visible.matchAll(pattern)) {
    // The old regex accepted "does not close #322" (PR agent#326).
    // Inspect the current clause, keeping a later "but fixes #N" independent.
    const clause = visible
      .slice(0, match.index)
      .split(/[\n.!?;,]|\bbut\b/i)
      .at(-1);
    if (/\b(?:not|never|cannot|can['’]t|won['’]t|don['’]t|doesn['’]t|didn['’]t|without|unable to)\b/i.test(clause)) continue;
    references.push({ owner: match[2] || match[4] || null, repo: match[3] || match[5] || null, number: match[6] });
  }
  return references;
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
export function prClosesIssue(text, issueNumber, owner = null, repo = null, { allowShortReference = true } = {}) {
  if (!issueNumber) return false;
  return extractClosingIssueReferences(text).some(reference => {
    if (reference.number !== String(issueNumber).trim()) return false;
    if (!reference.owner) return allowShortReference;
    if (!owner || !repo) return true;
    return reference.owner.toLowerCase() === owner.toLowerCase() && reference.repo.toLowerCase() === repo.toLowerCase();
  });
}

/** Bare issue numbers are relative to the source PR's repository. */
export function pullRequestClosesIssue(pr, issueNumber, owner = null, repo = null) {
  const url = pr.url || pr.html_url;
  const source = url?.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/[1-9]\d*(?:$|[/?#])/i);
  const allowShortReference = !owner || !repo || !url || Boolean(source && source[1].toLowerCase() === owner.toLowerCase() && source[2].toLowerCase() === repo.toLowerCase());
  return prClosesIssue(pr.body || '', issueNumber, owner, repo, { allowShortReference });
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
export function extractLinkedIssueNumber(prBody, owner = null, repo = null) {
  return extractClosingIssueReferences(prBody).find(reference => !reference.owner || !owner || !repo || (reference.owner.toLowerCase() === owner.toLowerCase() && reference.repo.toLowerCase() === repo.toLowerCase()))?.number || null;
}

/** Recover deleted primary references from our issue branch convention. */
export function resolvePrimaryIssueNumber({ body, branch, owner, repo }) {
  return branch?.match(/^issue-([1-9]\d*)-/)?.[1] || extractLinkedIssueNumber(body, owner, repo);
}
