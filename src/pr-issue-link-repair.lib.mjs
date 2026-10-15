/** Repair every required issue link after each AI working session. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ghJson, fetchRequiredIssueScope, isSameRepository, issueKey, missingIssueLinks, runLinkGh, splitDescriptionScope, splitRepairBlock } from './issue-link-verification.lib.mjs';
import { extractClosingIssueReferences } from './github-linking.lib.mjs';
import { buildIssueReference } from './pr-issue-linking.lib.mjs';
import { writeSanitizedPublicationFile } from './token-sanitization.lib.mjs';

/** Publish through a sanitized temporary file that is always removed. */
const publishBody = async ({ run, owner, repo, prNumber, body }) => {
  const directory = await mkdtemp(join(tmpdir(), 'hive-mind-issue-links-'));
  const bodyFile = join(directory, 'body.md');
  return writeSanitizedPublicationFile(bodyFile, body)
    .then(() => run(['pr', 'edit', String(prNumber), '--repo', `${owner}/${repo}`, '--body-file', bodyFile]))
    .finally(() => rm(directory, { recursive: true, force: true }));
};

export async function repairRequiredIssueLinks({ owner, repo, issueNumber, prNumber, argv = {}, run = runLinkGh, logger = async () => {} }) {
  const issueRef = buildIssueReference({ owner, repo, issueNumber, fork: argv.fork });
  let body = '';
  try {
    if (!owner || !repo || !issueNumber || !prNumber) throw new Error('missing required pull request or issue data');
    const foreign = [];
    const scope = await fetchRequiredIssueScope({ owner, repo, issueNumber, run, foreign });
    const readBody = async () => {
      const pr = await ghJson(run, ['api', `repos/${owner}/${repo}/pulls/${prNumber}`]);
      if (typeof pr.body !== 'string' && pr.body !== null) throw new Error('Invalid pull request body');
      return pr.body || '';
    };
    body = await readBody();
    // Issue #3174: the agent's own text decides which sub-issues stay open, and a
    // line an earlier repair appended for such an issue (or for an issue in
    // another repository, #3276) is removed again instead of overriding the agent.
    const { head, lines } = splitRepairBlock(body);
    const { required, deferred } = splitDescriptionScope(scope, head, { owner, repo });
    const primary = scope[0];
    const dropped = [];
    const kept = lines.filter(line => {
      const [reference] = extractClosingIssueReferences(line);
      const target = reference && { owner: reference.owner || owner, repo: reference.repo || repo, number: Number(reference.number) };
      const drop = target && issueKey(target) !== issueKey(primary) && (!isSameRepository(target, { owner, repo }) || deferred.some(issue => issueKey(issue) === issueKey(target)));
      if (drop) dropped.push(issueKey(target));
      return !drop;
    });
    const withBlock = blockLines => (blockLines.length ? `${head}${head.length > 0 ? '\n\n---\n\n' : ''}${blockLines.join('\n')}` : head);
    const missing = missingIssueLinks(withBlock(kept), required, { owner, repo });
    if (foreign.length) await logger(`ℹ️  Not adding closing references for sub-issues in other repositories, which this pull request cannot fix: ${foreign.map(issueKey).join(', ')}`);
    if (deferred.length) await logger(`ℹ️  The description keeps these sub-issues open, so no closing reference is added: ${deferred.map(issue => `#${issue.number}`).join(', ')}`);
    if (!missing.length && !dropped.length) return { checked: true, updated: false, body, issueRef };
    const added = missing.map(issue => `Fixes ${isSameRepository(issue, { owner, repo }) && !argv.fork ? `#${issue.number}` : `${issue.owner}/${issue.repo}#${issue.number}`}`);
    const updatedBody = withBlock([...kept, ...added]);
    const result = await publishBody({ run, owner, repo, prNumber, body: updatedBody });
    if ((result.code ?? 0) !== 0) throw new Error(result.stderr?.toString().trim() || 'Could not update pull request body');
    body = await readBody();
    if (missingIssueLinks(body, required, { owner, repo }).length) throw new Error('Pull request links changed or were not saved after repair');
    if (dropped.length) await logger(`🔗 Removed ${dropped.length} closing reference(s) an earlier repair added for issues this pull request keeps open or cannot fix: ${dropped.join(', ')}`);
    if (missing.length) await logger(`🔗 Repaired ${missing.length} required issue-closing reference(s) in PR #${prNumber}.`);
    return { checked: true, updated: true, body, issueRef };
  } catch (error) {
    await logger(`⚠️ Could not verify all required PR issue links: ${error.message}`, { level: 'warning' });
    return { checked: false, updated: false, body, issueRef, error: error.message };
  }
}
