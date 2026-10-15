/**
 * The pull request that belongs to a session's own issue (#2891).
 *
 * GitHub links every PR whose description closes an issue, so a sub-issue is
 * also linked to its parent's plan PR (router#724 -> #721 on `issue-720-*` and
 * #749 on `issue-724-*`). Kill-recovery notices, completion links and log
 * attachments must use the session's own PR: the one on branch `issue-<n>-*`,
 * never one whose branch belongs to another issue.
 */
const ISSUE_BRANCH_RE = /^issue-(\d+)-/i;
const PULL_URL_RE = /https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\/pull\/([0-9]+)/g;
// `📍 PR URL: <url>` (new PR) and `PR URL: <url>` (continue mode) from solve.
const LABELED_PULL_URL_RE = /PR URL:\s+(https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[0-9]+)/g;

/** Issue number encoded in a solve branch name, or null for any other branch. */
export function branchIssueNumber(branch) {
  const match = ISSUE_BRANCH_RE.exec(String(branch || ''));
  return match ? Number(match[1]) : null;
}

/**
 * Pick the session's own PR from the PRs linked to its issue.
 * Order: branch `issue-<n>-*`; then a known non-issue branch; then a PR whose
 * branch is unknown (REST fallback). A PR on another issue's branch: never.
 *
 * @returns {Object|null} The selected PR, or null.
 */
export function selectSessionPullRequest(linkedPRs, issueNumber, { rejected = null } = {}) {
  const wanted = Number(issueNumber);
  const candidates = (linkedPRs || []).filter(pr => pr?.url);
  const owner = branch => branchIssueNumber(branch);
  for (const pr of candidates) if (pr.headRefName && owner(pr.headRefName) !== null && owner(pr.headRefName) !== wanted) rejected?.(pr);
  return candidates.find(pr => owner(pr.headRefName) === wanted) || candidates.find(pr => pr.headRefName && owner(pr.headRefName) === null) || candidates.find(pr => !pr.headRefName) || null;
}

/**
 * Default linked-PR lookup used by the session monitor.
 * @param {Object} ctx - `{owner, repo, number}` of the session's issue
 * @param {Object} [options]
 * @param {Function} [options.batchCheckPullRequestsForIssues] - Injected for tests
 * @param {Set<string>} [options.rejectedUrls] - Receives URLs of other issues' PRs
 */
export async function lookupSessionPullRequestUrl(ctx, { batchCheckPullRequestsForIssues = null, rejectedUrls = null, verbose = false } = {}) {
  const batchCheck = batchCheckPullRequestsForIssues || (await import('./github.lib.mjs')).batchCheckPullRequestsForIssues;
  const result = await batchCheck(ctx.owner, ctx.repo, [ctx.number]);
  const linkedPRs = result?.[ctx.number]?.linkedPRs || [];
  const selected = selectSessionPullRequest(linkedPRs, ctx.number, {
    rejected: pr => {
      rejectedUrls?.add(pr.url);
      if (verbose) console.log(`[VERBOSE] Ignoring linked PR ${pr.url} for ${ctx.owner}/${ctx.repo}#${ctx.number}: its branch ${pr.headRefName} belongs to another issue (#2891)`);
    },
  });
  if (verbose && selected) console.log(`[VERBOSE] Found the session's own PR ${selected.url} (branch ${selected.headRefName || 'unknown'}) for issue ${ctx.owner}/${ctx.repo}#${ctx.number}`);
  return selected?.url || null;
}

/**
 * Session-log PR search, usable chunk by chunk: `onText` returns the PR URL
 * solve printed on a `PR URL:` line (which ends the scan); otherwise `result()`
 * gives the first same-repository PR URL not known to belong to another issue.
 */
export function createSessionPullRequestUrlScanner(ctx, { rejectedUrls = null } = {}) {
  const owner = String(ctx?.owner || '').toLowerCase();
  const repo = String(ctx?.repo || '').toLowerCase();
  const accept = url => {
    const [, matchOwner, matchRepo, number] = /github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/.exec(url);
    if ((owner && matchOwner.toLowerCase() !== owner) || (repo && matchRepo.toLowerCase() !== repo)) return null;
    const normalized = `https://github.com/${matchOwner}/${matchRepo}/pull/${number}`;
    return rejectedUrls?.has(normalized) ? null : normalized;
  };
  let first = null;
  return {
    onText(text) {
      const value = String(text || '');
      for (const match of value.matchAll(LABELED_PULL_URL_RE)) {
        const url = accept(match[1]);
        if (url) return url;
      }
      if (!first) for (const match of value.matchAll(PULL_URL_RE)) if ((first = accept(match[0]))) break;
      return null;
    },
    result: () => first,
  };
}

/** {@link createSessionPullRequestUrlScanner} over one text. */
export function findSessionPullRequestUrlInText(text, ctx, options = {}) {
  const scanner = createSessionPullRequestUrlScanner(ctx, options);
  return scanner.onText(text) || scanner.result();
}
