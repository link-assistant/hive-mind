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

/** Issue number encoded in our `issue-<N>-<hash>` branch convention, or null. */
export function extractBranchIssueNumber(branch) {
  return branch?.match(/^issue-([1-9]\d*)-/)?.[1] || null;
}

/** Issue/PR numbers the text mentions in a repository other than owner/repo ("Unblocks other/project#320"). */
export function extractForeignIssueNumbers(text, owner, repo) {
  const pattern = /(?:https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/(?:issues|pull)\/|\b([\w.-]+)\/([\w.-]+)#)([1-9]\d*)\b/gi;
  const numbers = new Set();
  for (const match of getClosingReferenceText(text).matchAll(pattern)) {
    const slug = `${match[1] || match[3]}/${match[2] || match[4]}`.toLowerCase();
    if (!owner || !repo || slug !== `${owner}/${repo}`.toLowerCase()) numbers.add(match[5]);
  }
  return numbers;
}

/**
 * The issue a pull request solves.
 *
 * The branch convention recovers a primary issue whose closing reference was
 * deleted from the description (issue #2335). A branch name is only a hint,
 * though: command-stream#206 lived on `issue-320-…` because it was created
 * while solving link-assistant/agent#320, and its description said
 * "Fixes #205. Unblocks link-assistant/agent#320". Trusting the branch made
 * auto-merge demand the non-existent command-stream#320 (issue #2563).
 *
 * The branch number therefore loses to the description's same-repository
 * closing reference when the description names that number in another
 * repository, or when `branchIssueExists` is `false` (404/410 or a pull request).
 */
export function resolvePrimaryIssueNumber({ body, branch, owner, repo, branchIssueExists = null }) {
  const branchNumber = extractBranchIssueNumber(branch);
  const bodyNumber = extractLinkedIssueNumber(body, owner, repo);
  if (!branchNumber || !bodyNumber || branchNumber === bodyNumber) return branchNumber || bodyNumber;
  if (prClosesIssue(body, branchNumber, owner, repo)) return branchNumber;
  if (branchIssueExists === false || extractForeignIssueNumbers(body, owner, repo).has(branchNumber)) return bodyNumber;
  return branchNumber;
}

/** Lower-cased URL of the issue a pull request solves (resolved in the PR's own repository), or null. */
export function getPullRequestPrimaryIssueUrl(pr, owner = null, repo = null) {
  const source = (pr?.url || pr?.html_url)?.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/[1-9]\d*(?:$|[/?#])/i);
  const sourceOwner = source?.[1] || owner;
  const sourceRepo = source?.[2] || repo;
  if (!pr || !sourceOwner || !sourceRepo) return null;
  const number = resolvePrimaryIssueNumber({ body: pr.body, branch: pr.headRefName || pr.head?.ref, owner: sourceOwner, repo: sourceRepo });
  return number ? `https://github.com/${sourceOwner}/${sourceRepo}/issues/${number}`.toLowerCase() : null;
}

/** An ancestor's PR belongs to that ancestor even if its description closes descendants. */
export function isAncestorPullRequest(pr, ancestorUrls, owner, repo) {
  const primaryUrl = getPullRequestPrimaryIssueUrl(pr, owner, repo);
  return Boolean(primaryUrl) && ancestorUrls.some(url => url.toLowerCase() === primaryUrl);
}

/**
 * Whether a pull request is the issue's own solution draft (issue #2891).
 *
 * A plan PR on `issue-720-…` that says "Fixes #724" is linked to #724 by
 * GitHub, but it belongs to #720; so does a sibling PR that closes several
 * issues. Uses `pr.primaryIssueUrl` when the batch lookup already resolved it.
 */
export function isIssueOwnPullRequest(pr, issueNumber, owner, repo) {
  if (!pr || !issueNumber || !owner || !repo) return false;
  const primaryUrl = pr.primaryIssueUrl || getPullRequestPrimaryIssueUrl(pr, owner, repo);
  return Boolean(primaryUrl) && primaryUrl.toLowerCase() === `https://github.com/${owner}/${repo}/issues/${issueNumber}`.toLowerCase();
}

/**
 * {@link resolvePrimaryIssueNumber}, probing the branch issue only when the
 * branch and the description disagree. `checkIssueExists(number)` resolves to
 * true, false, or null when unknown (an unknown answer keeps the branch issue).
 */
export async function resolvePullRequestIssueNumber({ body, branch, owner, repo, checkIssueExists = null }) {
  const resolved = resolvePrimaryIssueNumber({ body, branch, owner, repo });
  const bodyNumber = extractLinkedIssueNumber(body, owner, repo);
  if (!checkIssueExists || !bodyNumber || resolved === bodyNumber || prClosesIssue(body, resolved, owner, repo)) return resolved;
  return resolvePrimaryIssueNumber({ body, branch, owner, repo, branchIssueExists: await checkIssueExists(resolved) });
}
