/**
 * Completion evidence boundary for issue-scoped merges (issue #2406), layered
 * on the unchanged issue link checks (issue #2335). All reads fail closed.
 */
import { checkIssueLinksBeforeMerge, ghJson, ghPaginated, issueKey, runLinkGh } from './issue-link-verification.lib.mjs';
import { buildRequirementsBlocker, evaluateRequirementsReport, extractExplicitRequirements, requirementFeedback, requirementSourceDigest } from './issue-requirements.lib.mjs';

/**
 * For each required issue: its explicit acceptance criteria and a digest of
 * the issue, its comments, and the pull request conversation, inline comments
 * and reviews. Issues already read by the link check are not read again.
 */
export async function fetchRequirementSources({ owner, repo, prNumber, issues, run = runLinkGh }) {
  const feedback = (await Promise.all([ghPaginated(run, `repos/${owner}/${repo}/issues/${prNumber}/comments`), ghPaginated(run, `repos/${owner}/${repo}/pulls/${prNumber}/comments`), ghPaginated(run, `repos/${owner}/${repo}/pulls/${prNumber}/reviews`)])).flat();
  const requirements = await Promise.all(
    issues.map(async entry => {
      const source = entry.issue || (await ghJson(run, ['api', `repos/${entry.owner}/${entry.repo}/issues/${entry.number}`]));
      if (!source || source.pull_request || source.number !== entry.number || typeof source.title !== 'string' || (typeof source.body !== 'string' && source.body !== null)) throw new Error(`Invalid issue response for ${issueKey(entry)}`);
      const comments = await ghPaginated(run, `repos/${entry.owner}/${entry.repo}/issues/${entry.number}/comments`);
      const texts = [source.body || '', ...requirementFeedback([...comments, ...feedback]).map(comment => comment.body)];
      return { owner: entry.owner, repo: entry.repo, number: entry.number, sourceDigest: requirementSourceDigest({ title: source.title, body: source.body || '', comments, feedback }), explicitRequirements: [...new Set(texts.flatMap(extractExplicitRequirements))] };
    })
  );
  return { requirements };
}

/**
 * The same issue scope the merge guard requires, with requirement sources, for
 * the report template script. A link blocker is returned so it can be shown.
 */
export async function fetchRequirementsSnapshot({ owner, repo, prNumber, issueNumber = null, run = runLinkGh }) {
  const links = await checkIssueLinksBeforeMerge({ owner, repo, prNumber, issueNumber, run });
  if (!links.snapshot) throw new Error(links.blocker?.details?.join('; ') || 'Cannot read the pull request issue scope');
  const { headSha, issues } = links.snapshot;
  const { requirements } = issues.length ? await fetchRequirementSources({ owner, repo, prNumber, issues, run }) : { requirements: [] };
  return { headSha, issues: requirements, linkBlocker: links.blocker };
}

/**
 * Links first (issue #2335), then a current and complete requirements report
 * for the same head commit. `headSha` pins the merge with --match-head-commit;
 * `snapshot` is the link snapshot, passed on unchanged for post-merge closing.
 */
export async function checkIssueCompletionBeforeMerge({ owner, repo, prNumber, issueNumber = null, run = runLinkGh, logger = async () => {}, verbose = false, allowCrossRepositoryClosing = true }) {
  const links = await checkIssueLinksBeforeMerge({ owner, repo, prNumber, issueNumber, run, logger, verbose, allowCrossRepositoryClosing });
  const headSha = links.snapshot?.headSha ?? null;
  if (links.blocker || !links.snapshot?.issues?.length) return { ...links, headSha };
  try {
    const { snapshot } = links;
    const { requirements } = await fetchRequirementSources({ owner, repo, prNumber, issues: snapshot.issues, run });
    const blocker = evaluateRequirementsReport({ prBody: snapshot.pr.body, headSha, issues: requirements });
    if (!blocker && verbose) await logger(`Requirements verified for ${requirements.length} issue(s) at ${headSha}`, { verbose: true });
    return { blocker, snapshot, headSha, requirements };
  } catch (error) {
    await logger(`Could not verify issue completion before merge: ${error.message}`, { level: 'warning' });
    return { blocker: buildRequirementsBlocker([error.message], 'issue_completion_verification_failed'), snapshot: null, headSha: null };
  }
}
