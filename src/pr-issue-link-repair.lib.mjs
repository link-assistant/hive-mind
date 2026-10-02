/** Repair every required issue link after each AI working session. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ghJson, fetchRequiredIssueScope, missingIssueLinks, runLinkGh } from './issue-link-verification.lib.mjs';
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
    const required = await fetchRequiredIssueScope({ owner, repo, issueNumber, run });
    const readBody = async () => {
      const pr = await ghJson(run, ['api', `repos/${owner}/${repo}/pulls/${prNumber}`]);
      if (typeof pr.body !== 'string' && pr.body !== null) throw new Error('Invalid pull request body');
      return pr.body || '';
    };
    body = await readBody();
    const missing = missingIssueLinks(body, required, { owner, repo });
    if (!missing.length) return { checked: true, updated: false, body, issueRef };
    const lines = missing.map(issue => `Fixes ${issue.owner.toLowerCase() === owner.toLowerCase() && issue.repo.toLowerCase() === repo.toLowerCase() && !argv.fork ? `#${issue.number}` : `${issue.owner}/${issue.repo}#${issue.number}`}`);
    const updatedBody = `${body.trimEnd()}\n\n${lines.join('\n')}\n`.trimStart();
    const result = await publishBody({ run, owner, repo, prNumber, body: updatedBody });
    if ((result.code ?? 0) !== 0) throw new Error(result.stderr?.toString().trim() || 'Could not update pull request body');
    body = await readBody();
    if (missingIssueLinks(body, required, { owner, repo }).length) throw new Error('Pull request links changed or were not saved after repair');
    await logger(`🔗 Repaired ${missing.length} required issue-closing reference(s) in PR #${prNumber}.`);
    return { checked: true, updated: true, body, issueRef };
  } catch (error) {
    await logger(`⚠️ Could not verify all required PR issue links: ${error.message}`, { level: 'warning' });
    return { checked: false, updated: false, body, issueRef, error: error.message };
  }
}
