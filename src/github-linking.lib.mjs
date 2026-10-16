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

const CLOSING_KEYWORD = /\b(close[sd]?|fix(?:es|ed)?|resolve[sd]?)(?:\s+|\s*:\s*)(?:https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/|([\w.-]+)\/([\w.-]+)#|#)([1-9]\d*)\b/gi;
const NEGATION = /\b(?:not|never|cannot|can['’]t|won['’]t|don['’]t|doesn['’]t|didn['’]t|without|unable to)\b/gi;

/**
 * Every closing keyword in the visible text, with `negated` set when the
 * keyword follows "does not" and similar words (PR agent#326, issue #322).
 * Only the current clause is inspected, so a later "but fixes #N" stays
 * independent. `phrase` is the negated wording, starting
 * at the last negation (and an auxiliary such as "does" right before it).
 */
function scanClosingKeywords(text) {
  const visible = getClosingReferenceText(text);
  return [...visible.matchAll(CLOSING_KEYWORD)].map(match => {
    const clause = visible
      .slice(0, match.index)
      .split(/[\n.!?;,]|\bbut\b/i)
      .at(-1);
    const negation = [...clause.matchAll(NEGATION)].at(-1);
    const reference = { owner: match[2] || match[4] || null, repo: match[3] || match[5] || null, number: match[6] };
    if (!negation) return { ...reference, negated: false };
    const auxiliary = clause.slice(0, negation.index).match(/\b(?:does|do|did|will|would|is|are|was|were|should|must|can|could)\s+$/i);
    const start = match.index - clause.length + negation.index - (auxiliary?.[0].length || 0);
    return { ...reference, negated: true, phrase: visible.slice(start, match.index + match[0].length).replace(/\s+/g, ' ') };
  });
}

/** Shared parser: repair, discovery, and merge checks must agree. */
export function extractClosingIssueReferences(text) {
  return scanClosingKeywords(text)
    .filter(reference => !reference.negated)
    .map(({ owner, repo, number }) => ({ owner, repo, number }));
}

/**
 * Negated closing keywords for issues of owner/repo ("does not close #N",
 * "won't fix #N") that the text does not also close. GitHub ignores the
 * negation and still closes that issue (link-assistant/calculator#261), so
 * callers treat it as kept open and warn about the wording (issue #3174).
 * Returns `{ owner, repo, number, phrase }`, once per issue.
 */
export function extractNegatedClosingReferences(text, owner = null, repo = null) {
  const seen = new Set();
  return scanClosingKeywords(text).filter(reference => {
    if (!reference.negated || seen.has(reference.number)) return false;
    if (reference.owner && owner && repo && `${reference.owner}/${reference.repo}`.toLowerCase() !== `${owner}/${repo}`.toLowerCase()) return false;
    seen.add(reference.number);
    return !prClosesIssue(text, reference.number, owner, repo);
  });
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

/** Longest "#A to #B" range expanded by {@link extractOpenIssueMentions}. */
const MAX_MENTION_RANGE = 500;

/**
 * Issue numbers of owner/repo the text names without a positive closing
 * keyword, for example "Part of #7", "#7 stays open" or "#236 to #246 stay
 * open" (issue #3174). These are issues the description deliberately keeps
 * open. A negated keyword ("does not close #7") counts as such a mention,
 * although GitHub still closes #7.
 */
export function extractOpenIssueMentions(text, owner, repo) {
  const numbers = collectIssueNumbers(getClosingReferenceText(text), `${owner}/${repo}`.toLowerCase());
  for (const number of numbers) if (prClosesIssue(text, number, owner, repo)) numbers.delete(number);
  return numbers;
}

/** Same-repository issue numbers in a span, expanding "#A to #B" ranges. */
function collectIssueNumbers(span, slug) {
  const numbers = new Set();
  const pattern = /(?:https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/issues\/|\b([\w.-]+)\/([\w.-]+)#|(?<![\w/#&])#)([1-9]\d*)\b(?:\s*(?:to|through|thru|–|—|-|\.\.)\s*#([1-9]\d*)\b)?/gi;
  for (const match of span.matchAll(pattern)) {
    const mentioned = match[1] || match[3] ? `${match[1] || match[3]}/${match[2] || match[4]}`.toLowerCase() : slug;
    if (mentioned !== slug) continue;
    const first = Number(match[5]);
    const last = match[6] && Number(match[6]) > first && Number(match[6]) - first <= MAX_MENTION_RANGE ? Number(match[6]) : first;
    for (let number = first; number <= last; number++) numbers.add(number);
    if (match[6]) numbers.add(Number(match[6]));
  }
  return numbers;
}

/** One issue reference, then more joined by ",", "and", "or", "&" or a range ("#236 to #246"). */
const REFERENCE = String.raw`(?:https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/|\b[\w.-]+\/[\w.-]+#|(?<![\w/#&])#)[1-9]\d*\b`;
const REFERENCE_LIST = String.raw`${REFERENCE}(?:(?:\s*,\s*(?:(?:and|or)\s+)?|\s+(?:and|or|to|through|thru)\s+|\s*(?:&|–|—|-|\.\.)\s*)${REFERENCE})*`;

/**
 * Issue numbers of owner/repo that the text explicitly marks as only partly
 * done by this pull request: "Part of #7", "Towards #7", "Progress on #7" or
 * "#7 stays open", including every issue of a list or a range ("#2 and #3
 * stay open", "#236 to #246 stay open"). Unlike a bare mention, this can keep
 * even the primary issue open, for example a tracking umbrella solved one
 * sub-issue at a time (#3282). A positive closing keyword for the same issue
 * still wins.
 */
export function extractPartialIssueMentions(text, owner, repo) {
  const visible = getClosingReferenceText(text);
  const slug = `${owner}/${repo}`.toLowerCase();
  // The gap before "stays open" has no "#": in "#1 is done and #2 stays open" only #2 stays open.
  const patterns = [new RegExp(String.raw`\b(?:part of|towards?|progress (?:on|towards?))\s+(?:issue\s+)?(${REFERENCE_LIST})`, 'gi'), new RegExp(String.raw`(${REFERENCE_LIST})[^.\n;!?#]{0,80}?\b(?:stays?|remains?|(?:is|are) kept|kept)\s+open\b`, 'gi')];
  const numbers = new Set();
  for (const pattern of patterns) {
    for (const match of visible.matchAll(pattern)) {
      for (const number of collectIssueNumbers(match[1], slug)) if (!prClosesIssue(text, number, owner, repo)) numbers.add(number);
    }
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

/** An ancestor's PR belongs to that ancestor even if its description closes descendants. */
export function isAncestorPullRequest(pr, ancestorUrls, owner, repo) {
  const source = (pr.url || pr.html_url)?.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+)\/pull\/[1-9]\d*(?:$|[/?#])/i);
  const sourceOwner = source?.[1] || owner;
  const sourceRepo = source?.[2] || repo;
  if (!sourceOwner || !sourceRepo) return false;
  const number = resolvePrimaryIssueNumber({ body: pr.body, branch: pr.headRefName || pr.head?.ref, owner: sourceOwner, repo: sourceRepo });
  if (!number) return false;
  const primaryUrl = `https://github.com/${sourceOwner}/${sourceRepo}/issues/${number}`.toLowerCase();
  return ancestorUrls.some(url => url.toLowerCase() === primaryUrl);
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
