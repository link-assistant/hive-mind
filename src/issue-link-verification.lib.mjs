/** GitHub boundaries for pull request ↔ issue links (issue #2335). All reads fail closed. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';
import { githubLimits } from './config.lib.mjs';
import { parseRequiredClosingReferences, isRepositoryModeIssueBody } from './solve.repository-mode.lib.mjs';
import { normalizeSubIssueEntry } from './solve.ensure-sub-issues.detect.lib.mjs';
import { extractBranchIssueNumber, extractClosingIssueReferences, extractOpenIssueMentions, extractPartialIssueMentions, prClosesIssue, pullRequestClosesIssue, resolvePullRequestIssueNumber } from './github-linking.lib.mjs';

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
 * issues it deliberately keeps open ("Part of #7", "#7 stays open"). The first
 * entry, the primary issue, stays required unless the description explicitly
 * marks the pull request as partial for it ("Part of #1"), as a tracking
 * umbrella solved one sub-issue at a time asks for (#3282). `keepOpen` maps
 * further issue keys to the reason they are not this pull request's work
 * ({@link splitPullRequestScope}). A positive closing keyword always wins.
 * Returns `reasons`: issue key → why it was deferred.
 */
export function splitDescriptionScope(issues, body, repository, { keepOpen = new Map() } = {}) {
  const open = extractOpenIssueMentions(body, repository.owner, repository.repo);
  const partial = extractPartialIssueMentions(body, repository.owner, repository.repo);
  const closes = issue => prClosesIssue(body, issue.number, issue.owner, issue.repo, { allowShortReference: isSameRepository(issue, repository) });
  const reasons = new Map();
  issues.forEach((issue, index) => {
    if (!isSameRepository(issue, repository) || closes(issue)) return;
    if (index === 0 && partial.has(Number(issue.number))) reasons.set(issueKey(issue), 'partial');
    else if (index > 0 && open.has(Number(issue.number))) reasons.set(issueKey(issue), 'description');
    else if (index > 0 && keepOpen.has(issueKey(issue))) reasons.set(issueKey(issue), keepOpen.get(issueKey(issue)));
  });
  // A sub-issue is required only through a required parent, so keeping an
  // umbrella's child open also keeps that child's own sub-issues open.
  for (let changed = true; changed;) {
    changed = false;
    for (const issue of issues.slice(1)) {
      if (reasons.has(issueKey(issue)) || !issue.parents?.length || !issue.parents.every(parent => reasons.has(parent)) || closes(issue)) continue;
      reasons.set(issueKey(issue), 'parent');
      changed = true;
    }
  }
  return { required: issues.filter(issue => !reasons.has(issueKey(issue))), deferred: issues.filter(issue => reasons.has(issueKey(issue))), reasons };
}

/** Issues per GraphQL request in {@link fetchOtherPullRequestClaims}. */
const CLAIMS_BATCH_SIZE = 50;

/** One page of the pull requests that cross-reference an issue, after `cursor` (a query variable). */
const CROSS_REFERENCES = cursor => `timelineItems(first:100${cursor ? `, after:${cursor}` : ''}, itemTypes:[CROSS_REFERENCED_EVENT]) { pageInfo { hasNextPage endCursor } nodes { ... on CrossReferencedEvent { source { ... on PullRequest { number state body url repository { nameWithOwner } } } } } }`;

/**
 * Open pull requests other than `prNumber` that would close each issue: the
 * ones GitHub links (closedByPullRequestsReferences, default-branch PRs and
 * sidebar links) and cross-referencing ones whose description closes the issue
 * (needed for PRs stacked on another branch, such as #2407 for #2406).
 * Cross-references are read to the last page: a busy umbrella has more than
 * 100, and the open pull request is usually among the newest.
 * Returns issue key → ["owner/repo#N", …]. Read failures throw.
 */
export async function fetchOtherPullRequestClaims({ owner, repo, prNumber, issues, run = runLinkGh }) {
  const own = `${owner}/${repo}#${prNumber}`.toLowerCase();
  const claims = new Map();
  for (let index = 0; index < issues.length; index += CLAIMS_BATCH_SIZE) {
    const batch = issues.slice(index, index + CLAIMS_BATCH_SIZE);
    const fields = batch.map(issue => `i${Number(issue.number)}: issue(number:${Number(issue.number)}) { closedByPullRequestsReferences(first:50) { nodes { number state repository { nameWithOwner } } } ${CROSS_REFERENCES()} }`);
    const response = await ghJson(run, ['api', 'graphql', '-f', `query=query($owner:String!,$repo:String!) { repository(owner:$owner,name:$repo) { ${fields.join(' ')} } }`, '-f', `owner=${owner}`, '-f', `repo=${repo}`]);
    for (const issue of batch) {
      const node = response?.data?.repository?.[`i${Number(issue.number)}`];
      const linked = node?.closedByPullRequestsReferences?.nodes;
      const referencing = node?.timelineItems?.nodes;
      if (!Array.isArray(linked) || !Array.isArray(referencing)) throw new Error(`Cannot read the pull requests that close ${issueKey(issue)}`);
      for (let page = node.timelineItems.pageInfo; page?.hasNextPage;) {
        const more = (await ghJson(run, ['api', 'graphql', '-f', `query=query($owner:String!,$repo:String!,$after:String!) { repository(owner:$owner,name:$repo) { issue(number:${Number(issue.number)}) { ${CROSS_REFERENCES('$after')} } } }`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-f', `after=${page.endCursor}`]))?.data?.repository?.issue?.timelineItems;
        if (!Array.isArray(more?.nodes) || !more.nodes.length) throw new Error(`Cannot read the pull requests that close ${issueKey(issue)}`);
        referencing.push(...more.nodes);
        page = more.pageInfo;
      }
      const keys = new Set();
      for (const pr of linked) if (pr?.state === 'OPEN') keys.add(`${pr.repository.nameWithOwner}#${pr.number}`.toLowerCase());
      for (const { source: pr } of referencing) if (pr?.number && pr.state === 'OPEN' && pullRequestClosesIssue(pr, issue.number, issue.owner, issue.repo)) keys.add(`${pr.repository.nameWithOwner}#${pr.number}`.toLowerCase());
      keys.delete(own);
      if (keys.size) claims.set(issueKey(issue), [...keys]);
    }
  }
  return claims;
}

/**
 * {@link splitDescriptionScope} for a pull request (issue #3174). Besides the
 * description, a native sub-issue is not this pull request's work when it is
 * already closed, when it was created after the pull request was opened (the
 * output of a plan, not its input), or when another open pull request closes
 * it. Issues a repository-mode block lists stay required (#2212).
 * Returns the split plus `claims` (issue key → other pull requests).
 */
export async function splitPullRequestScope({ issues, body, repository, pr, run = runLinkGh }) {
  const keepOpen = new Map();
  const openedAt = Date.parse(pr?.created_at || '');
  const candidates = [];
  for (const issue of issues.slice(1)) {
    if (issue.listed || !issue.parents?.length || !isSameRepository(issue, repository)) continue;
    if (issue.issue?.state === 'closed') keepOpen.set(issueKey(issue), 'closed');
    else if (Date.parse(issue.issue?.created_at || '') > openedAt) keepOpen.set(issueKey(issue), 'created_after_pr');
    else candidates.push(issue);
  }
  // Only ask GitHub about the issues this pull request would otherwise close.
  const { required } = splitDescriptionScope(issues, body, repository, { keepOpen });
  const asked = candidates.filter(issue => required.includes(issue) && !prClosesIssue(body, issue.number, issue.owner, issue.repo));
  const claims = asked.length && pr?.number ? await fetchOtherPullRequestClaims({ ...repository, prNumber: pr.number, issues: asked, run }) : new Map();
  for (const key of claims.keys()) keepOpen.set(key, 'other_pr');
  return { ...splitDescriptionScope(issues, body, repository, { keepOpen }), claims };
}

/** Log text for each deferral reason of {@link splitDescriptionScope}. */
export const DEFERRAL_REASONS = {
  partial: 'only partly done here, as the description says',
  description: 'kept open by the description',
  parent: 'sub-issues of issues kept open',
  closed: 'already closed',
  created_after_pr: 'created after this pull request was opened',
  other_pr: 'closed by another open pull request',
};

/** One entry per reason: "closed by another open pull request: #2 (o/r#9), #3 (o/r#9)". */
export function describeDeferrals({ deferred, reasons, claims = new Map() }) {
  const groups = new Map();
  for (const issue of deferred) {
    const reason = reasons.get(issueKey(issue));
    groups.set(reason, [...(groups.get(reason) || []), issue]);
  }
  return [...groups].map(([reason, group]) => `${DEFERRAL_REASONS[reason] || reason}: ${group.map(issue => `#${issue.number}${claims.has(issueKey(issue)) ? ` (${claims.get(issueKey(issue)).join(', ')})` : ''}`).join(', ')}`);
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
    const listed = new Set(requiredNumbers.map(Number));
    for (const raw of [...subIssues, ...requiredNumbers.map(number => ({ number }))]) {
      const entry = normalizeSubIssueEntry(raw, { owner: parent.owner, repo: parent.repo });
      if (!entry) throw new Error('Invalid required sub-issue');
      if (!isSameRepository(entry, { owner, repo })) {
        if (!foreign.some(existing => issueKey(existing) === issueKey(entry))) foreign.push(entry);
        continue;
      }
      // A repository-mode block lists issues the combined pull request must close (#2212).
      const isListed = isSameRepository(entry, parent) && listed.has(entry.number);
      const existing = required.find(issue => issueKey(issue) === issueKey(entry));
      if (!existing) required.push({ ...entry, parents: [issueKey(parent)], listed: isListed });
      else if (existing.parents) {
        if (!existing.parents.includes(issueKey(parent))) existing.parents.push(issueKey(parent));
        existing.listed ||= isListed;
      }
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

/**
 * Every issue a pull request must close: the primary issue's scope plus its own
 * positive references (marked `reference`). `subIssues` holds the scope's
 * sub-issues in other repositories, which are never required (#3276).
 */
export async function fetchPullRequestIssueScope({ owner, repo, prNumber, issueNumber = null, run = runLinkGh }) {
  const pr = await ghJson(run, ['api', `repos/${owner}/${repo}/pulls/${prNumber}`]);
  if (!/^[a-f0-9]{40}$/i.test(pr?.head?.sha || '') || (typeof pr.body !== 'string' && pr.body !== null)) throw new Error('Invalid pull request response');
  // Recover an issue whose body reference was deleted, without confusing the PR
  // number with an issue number. Explicit issue context always takes precedence.
  const references = extractClosingIssueReferences(pr.body);
  issueNumber ||= await resolvePullRequestPrimaryIssue({ owner, repo, body: pr.body, branch: pr.head.ref, run });
  const subIssues = [];
  const issues = issueNumber ? await fetchRequiredIssueScope({ owner, repo, issueNumber, run, foreign: subIssues }) : [];
  for (const reference of references) {
    const entry = { owner: reference.owner || owner, repo: reference.repo || repo, number: Number(reference.number), reference: true };
    if (!issues.some(existing => issueKey(existing) === issueKey(entry))) issues.push(entry);
  }
  return { pr, prNumber: Number(prNumber), headSha: pr.head.sha, issues, repository: { owner, repo }, subIssues };
}

const PARENT_FIELDS = Array.from({ length: 8 }).reduce(inner => `parent { number repository { nameWithOwner } ${inner} }`, '');

/** Whether an ancestor of the issue (sub-issues API, any repository) is one of `keys`. Read failures throw. */
async function hasAncestorIn(issue, keys, run) {
  const response = await ghJson(run, ['api', 'graphql', '-f', `query=query($owner:String!,$repo:String!,$number:Int!) { repository(owner:$owner,name:$repo) { issue(number:$number) { ${PARENT_FIELDS} } } }`, '-f', `owner=${issue.owner}`, '-f', `repo=${issue.repo}`, '-F', `number=${issue.number}`]);
  const node = response?.data?.repository?.issue;
  if (!node) throw new Error(`Cannot read the parents of ${issueKey(issue)}`);
  for (let parent = node.parent; parent; parent = parent.parent) if (keys.has(`${parent.repository.nameWithOwner}#${parent.number}`.toLowerCase())) return true;
  return false;
}

/**
 * Issue #3358: closing references to other repositories. One the author wrote
 * in the description head is allowed (it is closed explicitly after the
 * merge). One only the repair block holds, or one for an issue below the pull
 * request's issue tree (a sub-issue at any depth), stays blocked, as does
 * every one when `allow` is off (#3276). So does one that only a colon form in
 * the middle of a line closes, such as "a suggested fix: <issue URL>" (#3469).
 */
export async function splitForeignReferences({ issues, subIssues = [], head, repository, allow = true, run = runLinkGh }) {
  const foreign = issues.filter(issue => !isSameRepository(issue, repository));
  if (!allow) return { allowed: [], blocked: foreign };
  const tree = new Set([...issues.filter(issue => !issue.reference), ...subIssues].map(issueKey));
  const split = { allowed: [], blocked: [] };
  for (const issue of foreign) {
    // Issue #3469: "a suggested fix: <its URL>" is not a decision to close it.
    const written = prClosesIssue(head, issue.number, issue.owner, issue.repo, { allowShortReference: false, declaredOnly: true });
    split[written && !tree.has(issueKey(issue)) && !(await hasAncestorIn(issue, tree, run)) ? 'allowed' : 'blocked'].push(issue);
  }
  return split;
}

export function buildIssueLinkBlocker(details, reason) {
  return { reason, message: 'Required issue links have not been verified for this pull request.', details, resolution: 'Add a positive closing reference (for example "Fixes #123") to the pull request description for every required issue, then re-run the command.' };
}

function buildForeignClosingBlocker(details) {
  return { reason: 'cross_repository_closing_references', message: 'Merging would close issues in another repository, which a pull request here cannot fix.', details, resolution: 'Remove the closing keywords (and any sidebar links) for these issues from the pull request; mention them without a keyword instead, for example "Part of other/project#7". GitHub also reads "fix:", "closes:" or "resolved:" right before an issue link as a closing keyword, as in "a suggested fix: <issue URL>"; write "reported upstream: <issue URL>" instead.' };
}

function buildUnintendedClosingBlocker(details) {
  return { reason: 'unintended_closing_references', message: "GitHub would close issues that the pull request description keeps open, or that are not this pull request's work.", details, resolution: 'Remove the closing keyword for these issues: GitHub closes "does not close #7" too. Write "#7 stays open" without a keyword, or remove the sidebar link, then re-run the command.' };
}

const CLOSING_QUERY = 'query($owner:String!,$repo:String!,$number:Int!,$endCursor:String) { repository(owner:$owner,name:$repo) { pullRequest(number:$number) { closingIssuesReferences(first:100,after:$endCursor) { nodes { number repository { nameWithOwner } } pageInfo { hasNextPage endCursor } } } } }';

/** GitHub's closing issue references of a pull request (what a default-branch merge closes), as lower-case keys. */
export async function fetchClosingIssueReferences({ owner, repo, prNumber, run = runLinkGh }) {
  const pages = await ghJson(run, ['api', 'graphql', '--paginate', '--slurp', '-f', `query=${CLOSING_QUERY}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `number=${prNumber}`]);
  return pages.flatMap(page => {
    const nodes = page?.data?.repository?.pullRequest?.closingIssuesReferences?.nodes;
    if (page?.errors || !Array.isArray(nodes)) throw new Error('Cannot read GitHub closing issue references');
    return nodes.map(node => `${node.repository.nameWithOwner}#${node.number}`.toLowerCase());
  });
}

/**
 * Verify, right before merging, that the description closes every required
 * issue and, for default-branch merges, that GitHub itself recognizes each link.
 */
export async function checkIssueLinksBeforeMerge({ owner, repo, prNumber, issueNumber = null, run = runLinkGh, logger = async () => {}, verbose = false, allowCrossRepositoryClosing = true }) {
  try {
    const snapshot = await fetchPullRequestIssueScope({ owner, repo, prNumber, issueNumber, run });
    const { pr } = snapshot;
    const { head } = splitRepairBlock(pr.body || '');
    // Issue #3276: never close an issue in another repository that the repair or a sub-issue tree put in the
    // description. Issue #3358: one the author wrote is allowed, unless --no-allow-cross-repository-closing.
    const foreign = await splitForeignReferences({ ...snapshot, head, repository: { owner, repo }, allow: allowCrossRepositoryClosing, run });
    if (foreign.blocked.length) return { blocker: buildForeignClosingBlocker(foreign.blocked.map(issueKey)), snapshot };
    // Issue #3174: sub-issues the description keeps open, or that are not this pull request's work, are not required,
    // and are not closed after a non-default-branch merge. "Fixes" lines an older repair appended do not override that.
    if (!snapshot.issues.length) return { blocker: null, snapshot };
    const { required: issues, deferred, reasons } = await splitPullRequestScope({ issues: snapshot.issues, body: head, repository: { owner, repo }, pr: { ...pr, number: Number(prNumber) }, run });
    Object.assign(snapshot, { issues, deferred, reasons });
    const missing = missingIssueLinks(pr.body, issues, { owner, repo });
    if (missing.length) return { blocker: { ...buildIssueLinkBlocker(missing.map(issueKey), 'missing_closing_references'), message: 'The pull request description is missing required issue-closing references.' }, snapshot };
    const repository = await ghJson(run, ['api', `repos/${owner}/${repo}`]);
    if (!repository.default_branch || !pr.base?.ref) throw new Error('Cannot determine the pull request base or repository default branch');
    snapshot.defaultBranch = repository.default_branch;
    if (pr.base.ref === repository.default_branch) {
      const linked = await fetchClosingIssueReferences({ owner, repo, prNumber, run });
      // An issue in another repository is closed explicitly after the merge (#3358).
      const unlinked = issues.filter(issue => isSameRepository(issue, { owner, repo }) && !linked.includes(issueKey(issue)));
      if (unlinked.length) return { blocker: buildIssueLinkBlocker(unlinked.map(issueKey), 'unverified_issue_links'), snapshot };
      // GitHub, not the description, decides what the merge closes: a negated
      // keyword ("does not close #7") or a sidebar link still closes the issue.
      const slug = `${owner}/${repo}`.toLowerCase();
      const foreignLinked = linked.filter(key => !key.startsWith(`${slug}#`) && !foreign.allowed.some(issue => issueKey(issue) === key));
      if (foreignLinked.length) return { blocker: buildForeignClosingBlocker(foreignLinked), snapshot };
      const open = extractOpenIssueMentions(head, owner, repo);
      const unintended = linked.filter(key => (open.has(Number(key.slice(slug.length + 1))) || deferred.some(issue => issueKey(issue) === key)) && !issues.some(issue => issueKey(issue) === key));
      if (unintended.length) return { blocker: buildUnintendedClosingBlocker(unintended), snapshot };
    }
    if (verbose) await logger(`Issue links verified for ${issues.length} issue(s) on PR #${prNumber}`, { verbose: true });
    return { blocker: null, snapshot };
  } catch (error) {
    await logger(`Could not verify issue links before merge: ${error.message}`, { level: 'warning' });
    return { blocker: buildIssueLinkBlocker([error.message], 'issue_link_verification_failed'), snapshot: null };
  }
}
