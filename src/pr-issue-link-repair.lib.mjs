/** Repair every required issue link after each AI working session. */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeDeferrals, ghJson, fetchRequiredIssueScope, isSameRepository, issueKey, missingIssueLinks, runLinkGh, splitPullRequestScope, splitRepairBlock } from './issue-link-verification.lib.mjs';
import { extractClosingIssueReferences, extractNegatedClosingReferences } from './github-linking.lib.mjs';
import { buildIssueReference } from './pr-issue-linking.lib.mjs';
import { writeSanitizedPublicationFile } from './token-sanitization.lib.mjs';
import { CLOSING_REFERENCES_LEFT_OUT_MARKER } from './tool-comments.lib.mjs';

/** Publish through a sanitized temporary file that is always removed. */
const publishFile = async ({ run, owner, repo, prNumber, body, command = 'edit' }) => {
  const directory = await mkdtemp(join(tmpdir(), 'hive-mind-issue-links-'));
  const bodyFile = join(directory, 'body.md');
  return writeSanitizedPublicationFile(bodyFile, body)
    .then(() => run(['pr', command, String(prNumber), '--repo', `${owner}/${repo}`, '--body-file', bodyFile]))
    .finally(() => rm(directory, { recursive: true, force: true }));
};
const publishBody = options => publishFile({ ...options, command: 'edit' });

/**
 * Issue #3174: a closing reference the session removed is not added back, so
 * merging will not close that issue. The working session summary is posted
 * before this repair runs, so the pull request gets its own notice, once per
 * set of issues. Best-effort: a failure is logged and never fails the repair.
 */
export const reportLeftOutClosingReferences = async ({ run, owner, repo, prNumber, conflicts, argv = {}, logger = async () => {} }) => {
  if (!conflicts?.length) return false;
  const keys = [...conflicts].sort();
  const tag = `<!-- hive-mind:closing-references-left-out ${keys.join(' ')} -->`;
  try {
    const pages = await ghJson(run, ['api', `repos/${owner}/${repo}/issues/${prNumber}/comments`, '--paginate', '--slurp']);
    if ((Array.isArray(pages) ? pages.flat() : []).some(comment => String(comment?.body || '').includes(tag))) return false;
    const references = keys.map(key => (key.startsWith(`${owner}/${repo}#`) && !argv.fork ? `#${key.split('#').pop()}` : key));
    const one = references.length === 1;
    const body = [tag, `⚠️ **${CLOSING_REFERENCES_LEFT_OUT_MARKER}**`, '', `A working session removed the \`Fixes\` line${one ? '' : 's'} an earlier repair added for ${references.join(', ')}. Hive Mind does not add ${one ? 'it' : 'them'} back, so merging this pull request will not close ${one ? 'that issue' : 'those issues'}.`, '', `If ${one ? 'it' : 'they'} should close with this pull request, add the line${one ? '' : 's'} to the description again.`].join('\n');
    const result = await publishFile({ run, owner, repo, prNumber, body, command: 'comment' });
    if ((result?.code ?? 0) !== 0) throw new Error(result.stderr?.toString().trim() || 'gh pr comment failed');
    return true;
  } catch (error) {
    await logger(`⚠️ Could not post the left-out closing references notice: ${error.message}`, { level: 'warning' });
    return false;
  }
};

const HISTORY_QUERY = 'query($owner:String!,$repo:String!,$number:Int!,$endCursor:String) { repository(owner:$owner,name:$repo) { pullRequest(number:$number) { userContentEdits(first:100,after:$endCursor) { nodes { diff } pageInfo { hasNextPage endCursor } } } } }';

/**
 * Issue keys a repair block ("---" then "Fixes #N" lines) closed in any earlier
 * revision of the description. GitHub keeps every revision in userContentEdits,
 * so this survives a session rewriting the whole description, where a hidden
 * marker would be lost. An unreadable history fails closed.
 */
async function fetchRepairedIssueKeys({ owner, repo, prNumber, run }) {
  const pages = await ghJson(run, ['api', 'graphql', '--paginate', '--slurp', '-f', `query=${HISTORY_QUERY}`, '-f', `owner=${owner}`, '-f', `repo=${repo}`, '-F', `number=${prNumber}`]);
  const keys = new Set();
  for (const page of Array.isArray(pages) ? pages : [pages]) {
    const nodes = page?.data?.repository?.pullRequest?.userContentEdits?.nodes;
    if (page?.errors || !Array.isArray(nodes)) throw new Error(`Cannot read the description history of PR #${prNumber}`);
    for (const { diff } of nodes) {
      for (const line of splitRepairBlock(String(diff || '').replace(/\r\n/g, '\n')).lines) {
        for (const reference of extractClosingIssueReferences(line)) keys.add(issueKey({ owner: reference.owner || owner, repo: reference.repo || repo, number: reference.number }));
      }
    }
  }
  return keys;
}

export async function repairRequiredIssueLinks({ owner, repo, issueNumber, prNumber, argv = {}, run = runLinkGh, logger = async () => {} }) {
  const issueRef = buildIssueReference({ owner, repo, issueNumber, fork: argv.fork });
  let body = '';
  try {
    if (!owner || !repo || !issueNumber || !prNumber) throw new Error('missing required pull request or issue data');
    const foreign = [];
    const scope = await fetchRequiredIssueScope({ owner, repo, issueNumber, run, foreign });
    const readPull = async () => {
      const pr = await ghJson(run, ['api', `repos/${owner}/${repo}/pulls/${prNumber}`]);
      if (typeof pr.body !== 'string' && pr.body !== null) throw new Error('Invalid pull request body');
      return { ...pr, number: Number(prNumber), body: pr.body || '' };
    };
    const pr = await readPull();
    body = pr.body;
    // Issue #3174: the agent's own text decides which sub-issues stay open, and a
    // line an earlier repair appended for such an issue (or for an issue in
    // another repository, #3276) is removed again instead of overriding the agent.
    // Closed sub-issues, sub-issues created after the pull request was opened and
    // sub-issues another open pull request closes are not this pull request's work.
    const { head, lines } = splitRepairBlock(body);
    const split = await splitPullRequestScope({ issues: scope, body: head, repository: { owner, repo }, pr, run });
    const { required, deferred } = split;
    const dropped = [];
    const kept = lines.filter(line => {
      const [reference] = extractClosingIssueReferences(line);
      const target = reference && { owner: reference.owner || owner, repo: reference.repo || repo, number: Number(reference.number) };
      const drop = target && (!isSameRepository(target, { owner, repo }) || deferred.some(issue => issueKey(issue) === issueKey(target)));
      if (drop) dropped.push(issueKey(target));
      return !drop;
    });
    const withBlock = blockLines => (blockLines.length ? `${head}${head.length > 0 ? '\n\n---\n\n' : ''}${blockLines.join('\n')}` : head);
    // Never undo the agent: a sub-issue line an earlier repair added and a
    // session then removed stays removed. The primary issue (#2335) and issues
    // of a repository-mode block (#2212) are always restored. The merge guard
    // still reports the removed issue as missing, so a human decides.
    let missing = missingIssueLinks(withBlock(kept), required, { owner, repo });
    const candidates = missing.filter(issue => issueKey(issue) !== issueKey(scope[0]) && !issue.listed && !issue.reference);
    const repaired = candidates.length ? await fetchRepairedIssueKeys({ owner, repo, prNumber, run }) : new Set();
    const conflicts = candidates.filter(issue => repaired.has(issueKey(issue))).map(issueKey);
    missing = missing.filter(issue => !conflicts.includes(issueKey(issue)));
    for (const { number, phrase } of extractNegatedClosingReferences(head, owner, repo)) await logger(`⚠️ '${phrase}' still closes #${number} on GitHub; write '#${number} stays open' instead`, { level: 'warning' });
    if (foreign.length) await logger(`ℹ️  Not adding closing references for sub-issues in other repositories, which this pull request cannot fix: ${foreign.map(issueKey).join(', ')}`);
    if (deferred.length) await logger(`ℹ️  No closing reference is added for issues this pull request keeps open: ${describeDeferrals(split).join('; ')}`);
    for (const key of conflicts) await logger(`⚠️ #${key.split('#').pop()} was removed from the description by the session; not re-adding its closing reference`, { level: 'warning' });
    await reportLeftOutClosingReferences({ run, owner, repo, prNumber, conflicts, argv, logger });
    if (!missing.length && !dropped.length) return { checked: true, updated: false, body, issueRef, conflicts };
    const added = missing.map(issue => `Fixes ${isSameRepository(issue, { owner, repo }) && !argv.fork ? `#${issue.number}` : `${issue.owner}/${issue.repo}#${issue.number}`}`);
    const updatedBody = withBlock([...kept, ...added]);
    const result = await publishBody({ run, owner, repo, prNumber, body: updatedBody });
    if ((result.code ?? 0) !== 0) throw new Error(result.stderr?.toString().trim() || 'Could not update pull request body');
    body = (await readPull()).body;
    const expected = required.filter(issue => !conflicts.includes(issueKey(issue)));
    if (missingIssueLinks(body, expected, { owner, repo }).length) throw new Error('Pull request links changed or were not saved after repair');
    if (dropped.length) await logger(`🔗 Removed ${dropped.length} closing reference(s) an earlier repair added for issues this pull request keeps open or cannot fix: ${dropped.join(', ')}`);
    if (missing.length) await logger(`🔗 Repaired ${missing.length} required issue-closing reference(s) in PR #${prNumber}.`);
    return { checked: true, updated: true, body, issueRef, conflicts };
  } catch (error) {
    await logger(`⚠️ Could not verify all required PR issue links: ${error.message}`, { level: 'warning' });
    return { checked: false, updated: false, body, issueRef, error: error.message };
  }
}
