/** GitHub boundaries for pull request ↔ issue links (issue #2335). All reads fail closed. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';
import { githubLimits } from './config.lib.mjs';
import { parseRequiredClosingReferences, isRepositoryModeIssueBody } from './solve.repository-mode.lib.mjs';
import { normalizeSubIssueEntry } from './solve.ensure-sub-issues.detect.lib.mjs';
import { extractBranchIssueNumber, extractClosingIssueReferences, extractOpenIssueMentions, prClosesIssue, resolvePullRequestIssueNumber } from './github-linking.lib.mjs';

const execFileAsync = promisify(execFile);
export const runLinkGh = args => ghWithRateLimitRetry(() => execFileAsync('gh', args, { maxBuffer: 20 * 1024 * 1024, timeout: githubLimits.execTimeoutMs }), { label: `issue links: gh ${args[0]}` });

export const issueKey = issue => `${issue?.owner}/${issue?.repo}#${issue?.number}`.toLowerCase();

export async function ghJson(run, args) {
  const result = await run(args);
  if ((result.code ?? 0) !== 0) throw new Error(result.stderr?.toString().trim() || `gh ${args[0]} exited with code ${result.code}`);
  const value = JSON.parse(result.stdout.toString());
  if (value?.errors) throw new Error(JSON.stringify(value.errors));
  return value;
}

/** Read all pages, with each page in a separate array. */
export const ghPaginated = async (run, endpoint) => {
  const pages = await ghJson(run, ['api', endpoint, '--paginate', '--slurp']);
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page))) throw new Error(`Invalid paginated response: ${endpoint}`);
  return pages.flat();
};

/** Required issues whose closing reference is absent; bare numbers count only for the PR's own repository. */
export function missingIssueLinks(prBody, issues, repository) {
  return issues.filter(issue => !prClosesIssue(prBody, issue.number, issue.owner, issue.repo, { allowShortReference: issue.owner.toLowerCase() === repository.owner.toLowerCase() && issue.repo.toLowerCase() === repository.repo.toLowerCase() }));
}

export const isSameRepository = (issue, repository) => issue?.owner?.toLowerCase() === repository?.owner?.toLowerCase() && issue?.repo?.toLowerCase() === repository?.repo?.toLowerCase();

/** The trailing "---" blocks of bare "Fixes <ref>" lines this repair appends. */
const REPAIR_BLOCK = /(?:^|\n\n---\n\n)((?:Fixes [^\s]+[ \t]*(?:\n|$))+)$/;

/** Split a description into the text before the repair blocks and their lines. */
export function splitRepairBlock(body) {
  let head = body;
  const lines = [];
  for (let match = head.match(REPAIR_BLOCK); match && match[0] !== ''; match = head.match(REPAIR_BLOCK)) {
    lines.unshift(
      ...match[1]
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
    );
    head = head.slice(0, match.index);
  }
  return { head, lines };
}

/**
 * Split a required scope into the issues the description must close and the
 * sub-issues it deliberately keeps open ("Part of #7", "#7 stays open"). The
 * first entry, the primary issue, is always required (issue #3174).
 */
export function splitDescriptionScope(issues, body, repository) {
  const open = extractOpenIssueMentions(body, repository.owner, repository.repo);
  const closes = issue => prClosesIssue(body, issue.number, issue.owner, issue.repo, { allowShortReference: isSameRepository(issue, repository) });
  const deferred = new Set(issues.filter((issue, index) => index > 0 && isSameRepository(issue, repository) && open.has(Number(issue.number))).map(issueKey));
  // A sub-issue is required only through a required parent, so keeping an
  // umbrella's child open also keeps that child's own sub-issues open.
  for (let changed = true; changed;) {
    changed = false;
    for (const issue of issues.slice(1)) {
      if (deferred.has(issueKey(issue)) || !issue.parents?.length || !issue.parents.every(parent => deferred.has(parent)) || closes(issue)) continue;
      deferred.add(issueKey(issue));
      changed = true;
    }
  }
  return { required: issues.filter(issue => !deferred.has(issueKey(issue))), deferred: issues.filter(issue => deferred.has(issueKey(issue))) };
}

/**
 * The issue and its sub-issue tree in the same repository. A pull request can
 * only fix code in its own repository, so sub-issues in other repositories are
 * collected in `foreign` and never required: merging #3225 closed eleven
 * formal-ai issues that nothing had fixed (issue #3276).
 */
export async function fetchRequiredIssueScope({ owner, repo, issueNumber, run = runLinkGh, foreign = [] }) {
  const required = [{ owner, repo, number: Number(issueNumber) }];
  // Walk the complete hierarchy iteratively, deduplicating cycles and shared
  // references. Body-only issues retain their scope even if attachment failed.
  for (let index = 0; index < required.length; index++) {
    const parent = required[index];
    const endpoint = `repos/${parent.owner}/${parent.repo}/issues/${parent.number}`;
    const issue = await ghJson(run, ['api', endpoint]);
    if (!issue || issue.pull_request || issue.number !== parent.number || (typeof issue.body !== 'string' && issue.body !== null)) throw new Error('Invalid source issue response');
    parent.issue = issue;
    const subIssues = await ghPaginated(run, `${endpoint}/sub_issues`);
    const requiredNumbers = parseRequiredClosingReferences(issue.body);
    if (isRepositoryModeIssueBody(issue.body) && requiredNumbers.length === 0) throw new Error('Repository-mode issue has no readable required closing-reference block');
    for (const raw of [...subIssues, ...requiredNumbers.map(number => ({ number }))]) {
      const entry = normalizeSubIssueEntry(raw, { owner: parent.owner, repo: parent.repo });
      if (!entry) throw new Error('Invalid required sub-issue');
      if (!isSameRepository(entry, { owner, repo })) {
        if (!foreign.some(existing => issueKey(existing) === issueKey(entry))) foreign.push(entry);
        continue;
      }
      const existing = required.find(issue => issueKey(issue) === issueKey(entry));
      if (!existing) required.push({ ...entry, parents: [issueKey(parent)] });
      else if (existing.parents && !existing.parents.includes(issueKey(parent))) existing.parents.push(issueKey(parent));
    }
  }
  return required;
}

/**
 * Whether owner/repo#number is an issue: false when GitHub answers 404/410 or
 * the number is a pull request, null when the answer is unknown (issue #2563).
 */
export async function probeIssueExists({ owner, repo, number, run = runLinkGh }) {
  const missing = failure => (/HTTP (?:404|410)\b|"status":\s*"(?:404|410)"/.test(`${failure.stderr?.toString() ?? ''}${failure.stdout?.toString() ?? ''}${failure.message ?? ''}`) ? false : null);
  try {
    const result = await run(['api', `repos/${owner}/${repo}/issues/${number}`]);
    if ((result.code ?? 0) !== 0) return missing(result);
    const issue = JSON.parse(result.stdout.toString());
    return issue?.number === Number(number) ? !issue.pull_request : null;
  } catch (error) {
    return missing(error);
  }
}

/** The primary issue of a pull request, probing GitHub only when its branch and description disagree. */
export async function resolvePullRequestPrimaryIssue({ owner, repo, body, branch, run = runLinkGh, log = null }) {
  const issueNumber = await resolvePullRequestIssueNumber({ body, branch, owner, repo, checkIssueExists: number => probeIssueExists({ owner, repo, number, run }) });
  const branchNumber = extractBranchIssueNumber(branch);
  if (log && branchNumber && issueNumber !== branchNumber) await log(`ℹ️  Branch ${branch} suggests issue #${branchNumber}, but the description closes #${issueNumber} (#${branchNumber} belongs to another repository or does not exist in ${owner}/${repo})`);
  return issueNumber;
}

/** Every issue a pull request must close: the primary issue's scope plus its own positive references. */
export async function fetchPullRequestIssueScope({ owner, repo, prNumber, issueNumber = null, run = runLinkGh }) {
  const pr = await ghJson(run, ['api', `repos/${owner}/${repo}/pulls/${prNumber}`]);
  if (!/^[a-f0-9]{40}$/i.test(pr?.head?.sha || '') || (typeof pr.body !== 'string' && pr.body !== null)) throw new Error('Invalid pull request response');
  // Recover an issue whose body reference was deleted, without confusing the PR
  // number with an issue number. Explicit issue context always takes precedence.
  const references = extractClosingIssueReferences(pr.body);
  issueNumber ||= await resolvePullRequestPrimaryIssue({ owner, repo, body: pr.body, branch: pr.head.ref, run });
  const issues = issueNumber ? await fetchRequiredIssueScope({ owner, repo, issueNumber, run }) : [];
  for (const reference of references) {
    const entry = { owner: reference.owner || owner, repo: reference.repo || repo, number: Number(reference.number) };
    if (!issues.some(existing => issueKey(existing) === issueKey(entry))) issues.push(entry);
  }
  return { pr, headSha: pr.head.sha, issues };
}

export function buildIssueLinkBlocker(details, reason) {
  return { reason, message: 'Required issue links have not been verified for this pull request.', details, resolution: 'Add a positive closing reference (for example "Fixes #123") to the pull request description for every required issue, then re-run the command.' };
}

function buildForeignClosingBlocker(details) {
  return { reason: 'cross_repository_closing_references', message: 'Merging would close issues in another repository, which a pull request here cannot fix.', details, resolution: 'Remove the closing keywords (and any sidebar links) for these issues from the pull request; mention them without a keyword instead, for example "Part of other/project#7".' };
}

function buildUnintendedClosingBlocker(details) {
  return { reason: 'unintended_closing_references', message: 'GitHub would close issues that the pull request description keeps open.', details, resolution: 'Remove the closing keyword for these issues: GitHub closes "does not close #7" too. Write "#7 stays open" without a keyword, or remove the sidebar link, then re-run the command.' };
}

const CLOSING_QUERY = 'query($owner:String!,$repo:String!,$number:Int!,$endCursor:String) { repository(owner:$owner,name:$repo) { pullRequest(number:$number) { closingIssuesReferences(first:100,after:$endCursor) { nodes { number repository { nameWithOwner } } pageInfo { hasNextPage endCursor } } } } }';

/**
 * Verify, right before merging, that the description closes every required
 * issue and, for default-branch merges, that GitHub itself recognizes each link.
 */
export async function checkIssueLinksBeforeMerge({ owner, repo, prNumber, issueNumber = null, run = runLinkGh, logger = async () => {}, verbose = false }) {
  try {
    const snapshot = await fetchPullRequestIssueScope({ owner, repo, prNumber, issueNumber, run });
    const { pr } = snapshot;
    // Issue #3276: never close an issue in another repository by merging here.
    const foreign = snapshot.issues.filter(issue => !isSameRepository(issue, { owner, repo }));
    if (foreign.length) return { blocker: buildForeignClosingBlocker(foreign.map(issueKey)), snapshot };
    // Issue #3174: sub-issues the description keeps open are not required, and are not closed after a non-default-branch merge.
    // Only the agent's text decides that: "Fixes" lines an older repair appended do not override it.
    const { head } = splitRepairBlock(pr.body || '');
    const { required: issues } = splitDescriptionScope(snapshot.issues, head, { owner, repo });
    snapshot.issues = issues;
    if (!issues.length) return { blocker: null, snapshot };
    const missing = missingIssueLinks(pr.body, issues, { owner, repo });
    if (missing.length) return { blocker: { ...buildIssueLinkBlocker(missing.map(issueKey), 'missing_closing_references'), message: 'The pull request description is missing required issue-closing references.' }, snapshot };
    const repository = await ghJson(run, ['api', `repos/${owner}/${repo}`]);
    if (!repository.default_branch || !pr.base?.ref) throw new Error('Cannot determine the pull request base or repository default branch');
    snapshot.defaultBranch = repository.default_branch;
    if (pr.base.ref === repository.default_branch) {
      const pages = await ghJson(run, ['api', 'graphql', '--paginate', '--slurp', '-f', `query=${CLOSING_QUERY}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `number=${prNumber}`]);
      const linked = pages.flatMap(page => {
        const nodes = page?.data?.repository?.pullRequest?.closingIssuesReferences?.nodes;
        if (page?.errors || !Array.isArray(nodes)) throw new Error('Cannot read GitHub closing issue references');
        return nodes.map(node => `${node.repository.nameWithOwner}#${node.number}`.toLowerCase());
      });
      const unlinked = issues.filter(issue => !linked.includes(issueKey(issue)));
      if (unlinked.length) return { blocker: buildIssueLinkBlocker(unlinked.map(issueKey), 'unverified_issue_links'), snapshot };
      // GitHub, not the description, decides what the merge closes: a negated
      // keyword ("does not close #7") or a sidebar link still closes the issue.
      const slug = `${owner}/${repo}`.toLowerCase();
      const foreignLinked = linked.filter(key => !key.startsWith(`${slug}#`));
      if (foreignLinked.length) return { blocker: buildForeignClosingBlocker(foreignLinked), snapshot };
      const open = extractOpenIssueMentions(head, owner, repo);
      const unintended = linked.filter(key => open.has(Number(key.slice(slug.length + 1))) && !issues.some(issue => issueKey(issue) === key));
      if (unintended.length) return { blocker: buildUnintendedClosingBlocker(unintended), snapshot };
    }
    if (verbose) await logger(`Issue links verified for ${issues.length} issue(s) on PR #${prNumber}`, { verbose: true });
    return { blocker: null, snapshot };
  } catch (error) {
    await logger(`Could not verify issue links before merge: ${error.message}`, { level: 'warning' });
    return { blocker: buildIssueLinkBlocker([error.message], 'issue_link_verification_failed'), snapshot: null };
  }
}

/** GitHub does not auto-close references for non-default branch merges. */
export async function closeLinkedIssuesAfterMerge(snapshot, { run = runLinkGh, logger = async () => {} } = {}) {
  const failed = [];
  if (!snapshot?.issues?.length || snapshot.pr.base.ref === snapshot.defaultBranch) return failed;
  for (const issue of snapshot.issues) {
    try {
      const source = await ghJson(run, ['api', `repos/${issue.owner}/${issue.repo}/issues/${issue.number}`]);
      if (source.state === 'closed') continue;
      if (source.state !== 'open') throw new Error('Cannot verify issue state after merge');
      const result = await run(['issue', 'close', String(issue.number), '--repo', `${issue.owner}/${issue.repo}`, '--reason', 'completed', '--comment', `Closed by ${snapshot.pr.html_url}, merged into the non-default branch ${snapshot.pr.base.ref}, whose description links this issue.`]);
      if ((result.code ?? 0) !== 0) throw new Error(result.stderr?.toString() || 'Issue close failed');
    } catch (error) {
      failed.push(issueKey(issue));
      await logger(`Could not close linked issue ${issueKey(issue)} after merge: ${error.message}`, { level: 'warning' });
    }
  }
  return failed;
}
