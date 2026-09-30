/** GitHub boundaries for complete issue delivery. All reads fail closed. */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';
import { parseRequiredClosingReferences, isRepositoryModeIssueBody } from './solve.repository-mode.lib.mjs';
import { normalizeSubIssueEntry } from './solve.ensure-sub-issues.detect.lib.mjs';
import { extractClosingIssueReferences } from './github-linking.lib.mjs';
import { buildRequirementsBlocker, evaluateRequirementsReport, extractExplicitRequirements, issueKey, missingIssueLinks, requirementFeedback, requirementSourceDigest } from './issue-requirements.lib.mjs';

const execFileAsync = promisify(execFile);
export const runCompletionGh = args => ghWithRateLimitRetry(() => execFileAsync('gh', args, { maxBuffer: 20 * 1024 * 1024 }), { label: `requirements: gh ${args[0]}` });

export async function completionJson(run, args) {
  const result = await run(args);
  if ((result.code ?? 0) !== 0) throw new Error(result.stderr?.toString().trim() || `gh ${args[0]} exited with code ${result.code}`);
  const value = JSON.parse(result.stdout.toString());
  if (value?.errors) throw new Error(JSON.stringify(value.errors));
  return value;
}

/** Read all pages, with each page in a separate array. */
const paginated = async (run, endpoint) => {
  const pages = await completionJson(run, ['api', endpoint, '--paginate', '--slurp']);
  if (!Array.isArray(pages) || pages.some(page => !Array.isArray(page))) throw new Error(`Invalid paginated response: ${endpoint}`);
  return pages.flat();
};

export async function fetchRequiredIssueScope({ owner, repo, issueNumber, run = runCompletionGh }) {
  const required = [{ owner, repo, number: Number(issueNumber) }];
  // Walk the complete hierarchy iteratively, deduplicating cycles and shared
  // references. Body-only issues retain their scope even if attachment failed.
  for (let index = 0; index < required.length; index++) {
    const parent = required[index];
    const endpoint = `repos/${parent.owner}/${parent.repo}/issues/${parent.number}`;
    const issue = await completionJson(run, ['api', endpoint]);
    if (!issue || issue.pull_request || issue.number !== parent.number || (typeof issue.body !== 'string' && issue.body !== null)) throw new Error('Invalid source issue response');
    parent.issue = issue;
    const subIssues = await paginated(run, `${endpoint}/sub_issues`);
    const requiredNumbers = parseRequiredClosingReferences(issue.body);
    if (isRepositoryModeIssueBody(issue.body) && requiredNumbers.length === 0) throw new Error('Repository-mode issue has no readable required closing-reference block');
    for (const raw of [...subIssues, ...requiredNumbers.map(number => ({ number }))]) {
      const entry = normalizeSubIssueEntry(raw, { owner: parent.owner, repo: parent.repo });
      if (!entry) throw new Error('Invalid required sub-issue');
      if (!required.some(existing => issueKey(existing) === issueKey(entry))) required.push(entry);
    }
  }
  return required;
}

export async function fetchRequirementsSnapshot({ owner, repo, prNumber, issueNumber = null, run = runCompletionGh }) {
  const pr = await completionJson(run, ['api', `repos/${owner}/${repo}/pulls/${prNumber}`]);
  if (!/^[a-f0-9]{40}$/i.test(pr?.head?.sha || '') || (typeof pr.body !== 'string' && pr.body !== null)) throw new Error('Invalid pull request response');
  // Recover an issue whose body reference was deleted, without confusing the PR
  // number with an issue number. Explicit issue context always takes precedence.
  const references = extractClosingIssueReferences(pr.body);
  const local = references.find(reference => !reference.owner || `${reference.owner}/${reference.repo}`.toLowerCase() === `${owner}/${repo}`.toLowerCase());
  issueNumber ||= pr.head.ref?.match(/^issue-(\d+)-/)?.[1] || local?.number;
  const required = issueNumber ? await fetchRequiredIssueScope({ owner, repo, issueNumber, run }) : [];
  for (const reference of references) {
    const entry = { owner: reference.owner || owner, repo: reference.repo || repo, number: Number(reference.number) };
    if (!required.some(existing => issueKey(existing) === issueKey(entry))) required.push(entry);
  }
  if (required.length === 0) return { pr, headSha: pr.head.sha, issues: [] };
  const feedback = (await Promise.all([paginated(run, `repos/${owner}/${repo}/issues/${prNumber}/comments`), paginated(run, `repos/${owner}/${repo}/pulls/${prNumber}/comments`), paginated(run, `repos/${owner}/${repo}/pulls/${prNumber}/reviews`)])).flat();
  const issues = await Promise.all(
    required.map(async entry => {
      const source = entry.issue || (await completionJson(run, ['api', `repos/${entry.owner}/${entry.repo}/issues/${entry.number}`]));
      if (!source || source.pull_request || source.number !== entry.number || typeof source.title !== 'string' || (typeof source.body !== 'string' && source.body !== null)) throw new Error(`Invalid issue response for ${issueKey(entry)}`);
      const comments = await paginated(run, `repos/${entry.owner}/${entry.repo}/issues/${entry.number}/comments`);
      return { owner: entry.owner, repo: entry.repo, number: entry.number, sourceDigest: requirementSourceDigest({ title: source.title, body: source.body || '', comments, feedback }), explicitRequirements: [...new Set([source.body || '', ...requirementFeedback([...comments, ...feedback]).map(comment => comment.body)].flatMap(extractExplicitRequirements))] };
    })
  );
  return { pr, headSha: pr.head.sha, issues };
}

const CLOSING_QUERY = 'query($owner:String!,$repo:String!,$number:Int!,$endCursor:String) { repository(owner:$owner,name:$repo) { pullRequest(number:$number) { closingIssuesReferences(first:100,after:$endCursor) { nodes { number repository { nameWithOwner } } pageInfo { hasNextPage endCursor } } } } }';

export async function checkIssueCompletionBeforeMerge({ owner, repo, prNumber, issueNumber = null, run = runCompletionGh, logger = async () => {}, verbose = false }) {
  try {
    const snapshot = await fetchRequirementsSnapshot({ owner, repo, prNumber, issueNumber, run });
    const { pr, headSha, issues } = snapshot;
    if (!issues.length) return { blocker: null, headSha, snapshot };
    const missing = missingIssueLinks(pr.body, issues, { owner, repo });
    if (missing.length) return { blocker: { ...buildRequirementsBlocker(missing.map(issueKey), 'missing_closing_references'), message: 'The pull request description is missing required issue-closing references.' }, headSha, snapshot };
    const blocker = evaluateRequirementsReport({ prBody: pr.body, headSha, issues });
    if (blocker) return { blocker, headSha, snapshot };
    const repository = await completionJson(run, ['api', `repos/${owner}/${repo}`]);
    if (!repository.default_branch || !pr.base?.ref) throw new Error('Cannot determine the pull request base or repository default branch');
    snapshot.defaultBranch = repository.default_branch;
    if (pr.base.ref === repository.default_branch) {
      const pages = await completionJson(run, ['api', 'graphql', '--paginate', '--slurp', '-f', `query=${CLOSING_QUERY}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `number=${prNumber}`]);
      const linked = pages.flatMap(page => {
        const nodes = page?.data?.repository?.pullRequest?.closingIssuesReferences?.nodes;
        if (page?.errors || !Array.isArray(nodes)) throw new Error('Cannot read GitHub closing issue references');
        return nodes.map(node => `${node.repository.nameWithOwner}#${node.number}`.toLowerCase());
      });
      const unlinked = issues.filter(issue => !linked.includes(issueKey(issue)));
      if (unlinked.length) return { blocker: buildRequirementsBlocker(unlinked.map(issueKey), 'unverified_issue_links'), headSha, snapshot };
    }
    if (verbose) await logger(`Requirements verified for ${issues.length} issue(s) at ${headSha}`, { verbose: true });
    return { blocker: null, headSha, snapshot };
  } catch (error) {
    await logger(`Could not verify issue completion before merge: ${error.message}`, { level: 'warning' });
    return { blocker: buildRequirementsBlocker([error.message], 'issue_completion_verification_failed'), headSha: null };
  }
}

/** GitHub does not auto-close references for non-default branch merges. */
export async function closeVerifiedIssuesAfterMerge(snapshot, { run = runCompletionGh, logger = async () => {} } = {}) {
  const failed = [];
  if (!snapshot.issues.length || snapshot.pr.base.ref === snapshot.defaultBranch) return failed;
  for (const issue of snapshot.issues) {
    try {
      const source = await completionJson(run, ['api', `repos/${issue.owner}/${issue.repo}/issues/${issue.number}`]);
      if (source.state === 'closed') continue;
      if (source.state !== 'open') throw new Error('Cannot verify issue state after merge');
      const result = await run(['issue', 'close', String(issue.number), '--repo', `${issue.owner}/${issue.repo}`, '--reason', 'completed', '--comment', `Completed by ${snapshot.pr.html_url}, merged into the non-default branch ${snapshot.pr.base.ref}. Requirements were verified for ${snapshot.headSha} before merging.`]);
      if ((result.code ?? 0) !== 0) throw new Error(result.stderr?.toString() || 'Issue close failed');
    } catch (error) {
      failed.push(issueKey(issue));
      await logger(`Could not close verified issue ${issueKey(issue)} after merge: ${error.message}`, { level: 'warning' });
    }
  }
  return failed;
}
