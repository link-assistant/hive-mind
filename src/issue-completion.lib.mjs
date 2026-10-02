/** Completion evidence boundary for issue-scoped merges (issue #2406), layered on the issue link checks (issue #2335). All reads fail closed. */
import { closeLinkedIssuesAfterMerge, fetchPullRequestIssueScope, findIssueLinkBlocker, ghJson, ghPaginated, runLinkGh } from './issue-link-verification.lib.mjs';
import { buildRequirementsBlocker, evaluateRequirementsReport, extractExplicitRequirements, issueKey, requirementFeedback, requirementSourceDigest } from './issue-requirements.lib.mjs';

export { fetchRequiredIssueScope } from './issue-link-verification.lib.mjs';
export const runCompletionGh = runLinkGh;
export const completionJson = ghJson;

/** The link scope plus, for each required issue, its explicit requirements and a digest of every requirement source. */
export async function fetchRequirementsSnapshot({ owner, repo, prNumber, issueNumber = null, run = runCompletionGh }) {
  const snapshot = await fetchPullRequestIssueScope({ owner, repo, prNumber, issueNumber, run });
  if (snapshot.issues.length === 0) return snapshot;
  const feedback = (await Promise.all([ghPaginated(run, `repos/${owner}/${repo}/issues/${prNumber}/comments`), ghPaginated(run, `repos/${owner}/${repo}/pulls/${prNumber}/comments`), ghPaginated(run, `repos/${owner}/${repo}/pulls/${prNumber}/reviews`)])).flat();
  const issues = await Promise.all(
    snapshot.issues.map(async entry => {
      const source = entry.issue || (await ghJson(run, ['api', `repos/${entry.owner}/${entry.repo}/issues/${entry.number}`]));
      if (!source || source.pull_request || source.number !== entry.number || typeof source.title !== 'string' || (typeof source.body !== 'string' && source.body !== null)) throw new Error(`Invalid issue response for ${issueKey(entry)}`);
      const comments = await ghPaginated(run, `repos/${entry.owner}/${entry.repo}/issues/${entry.number}/comments`);
      return { owner: entry.owner, repo: entry.repo, number: entry.number, sourceDigest: requirementSourceDigest({ title: source.title, body: source.body || '', comments, feedback }), explicitRequirements: [...new Set([source.body || '', ...requirementFeedback([...comments, ...feedback]).map(comment => comment.body)].flatMap(extractExplicitRequirements))] };
    })
  );
  return { ...snapshot, issues };
}

/** Links first (issue #2335), then a current and complete requirements report for the same head commit. */
export async function checkIssueCompletionBeforeMerge({ owner, repo, prNumber, issueNumber = null, run = runCompletionGh, logger = async () => {}, verbose = false }) {
  try {
    const snapshot = await fetchRequirementsSnapshot({ owner, repo, prNumber, issueNumber, run });
    const { pr, headSha, issues } = snapshot;
    if (!issues.length) return { blocker: null, headSha, snapshot };
    const blocker = (await findIssueLinkBlocker(snapshot, { owner, repo, prNumber, run })) || evaluateRequirementsReport({ prBody: pr.body, headSha, issues });
    if (!blocker && verbose) await logger(`Requirements verified for ${issues.length} issue(s) at ${headSha}`, { verbose: true });
    return { blocker, headSha, snapshot };
  } catch (error) {
    await logger(`Could not verify issue completion before merge: ${error.message}`, { level: 'warning' });
    return { blocker: buildRequirementsBlocker([error.message], 'issue_completion_verification_failed'), headSha: null };
  }
}

/** GitHub does not auto-close references for non-default branch merges. */
export const closeVerifiedIssuesAfterMerge = (snapshot, options = {}) => closeLinkedIssuesAfterMerge(snapshot, { ...options, comment: `Completed by ${snapshot?.pr?.html_url}, merged into the non-default branch ${snapshot?.pr?.base?.ref}. Requirements were verified for ${snapshot?.headSha} before merging.` });
