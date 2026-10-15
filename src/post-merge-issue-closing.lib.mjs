/**
 * Close every issue a merged pull request intends to close, including the ones
 * GitHub leaves open (issues #3354, #3355, #3357 and #3358).
 *
 * GitHub closes linked issues only for merges into the default branch, and even
 * there it missed 13 issues in 4 of 723 merges (router#643, router#555,
 * agent#325, agent#326). This is the single post-merge implementation: /merge,
 * solve auto-merge, the Telegram merge queue, the merged-PR sweeper and the
 * `close-linked-issues` command all use {@link closeIntendedIssuesAfterMerge}.
 *
 * "Intended" is what the merged description closes under the #3174 rules: a
 * positive closing keyword, for an issue the description does not keep open
 * (a negated closing keyword, "Part of") and that is this pull request's work.
 * A `Fixes` line in the link-repair block counts only for an issue in the
 * primary issue's current scope, which the merge guard required anyway: a
 * stale repair line never closes anything.
 */
import { DEFERRAL_REASONS, fetchClosingIssueReferences, fetchPullRequestIssueScope, ghJson, isSameRepository, issueKey, runLinkGh, splitForeignReferences, splitPullRequestScope, splitRepairBlock } from './issue-link-verification.lib.mjs';
import { extractOpenIssueMentions, prClosesIssue } from './github-linking.lib.mjs';
import { closeCompletedParents } from './close-completed-parents.lib.mjs';

/** Backoff between checks after a default-branch merge, then 60 s until the timeout. */
export const POST_MERGE_BACKOFF_MS = [10_000, 20_000, 40_000, 60_000];
export const POST_MERGE_TIMEOUT_MS = 5 * 60_000;

const FALSE_VALUES = /^(?:false|0|no|off)$/i;

/** A boolean option, or the `HIVE_MIND_*` environment default (on unless "false"). */
export const resolveEnvSwitch = (value, name, env = process.env) => (typeof value === 'boolean' ? value : !FALSE_VALUES.test(String(env[name] ?? '').trim()));

/** --auto-close-linked-issues / HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES, on by default (#3354). */
export const resolveAutoCloseLinkedIssues = (value, env = process.env) => resolveEnvSwitch(value, 'HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES', env);

/** The issue-closing options of a parsed command line, for {@link closeIntendedIssuesAfterMerge} and the merge guard. */
export const issueClosingOptions = (argv = {}, env = process.env) => ({
  autoCloseLinkedIssues: resolveAutoCloseLinkedIssues(argv.autoCloseLinkedIssues, env),
  allowCrossRepositoryClosing: resolveEnvSwitch(argv.allowCrossRepositoryClosing, 'HIVE_MIND_ALLOW_CROSS_REPOSITORY_CLOSING', env),
  closeCompletedParents: resolveEnvSwitch(argv.closeCompletedParents, 'HIVE_MIND_CLOSE_COMPLETED_PARENTS', env),
});

const SWITCH_ENVIRONMENT = { autoCloseLinkedIssues: 'HIVE_MIND_AUTO_CLOSE_LINKED_ISSUES', allowCrossRepositoryClosing: 'HIVE_MIND_ALLOW_CROSS_REPOSITORY_CLOSING', closeCompletedParents: 'HIVE_MIND_CLOSE_COMPLETED_PARENTS' };

/**
 * Write the explicit switches of a long-running process (bot, hive) to its
 * environment, so the merge queue, the sweeper and the solve processes it
 * starts all follow them. Returns the resolved options.
 */
export function applyIssueClosingEnvironment(argv = {}, env = process.env) {
  const options = issueClosingOptions(argv, env);
  for (const [name, variable] of Object.entries(SWITCH_ENVIRONMENT)) if (typeof argv[name] === 'boolean') env[variable] = String(options[name]);
  return options;
}

/** Log text for each reason an issue named by the description is not closed. */
const SKIP_REASONS = {
  not_closed_by_description: 'no closing keyword in the description',
  repair_only: 'only a "Fixes" line the link repair appended, for an issue outside the current scope',
  cross_repository: 'a closing reference to another repository that the author did not write, or a sub-issue there',
};

/**
 * Split a merge snapshot into the issues to close and the ones it keeps open.
 * `skippedKeptOpen` holds { key, reason } for each, with the #3174 deferral
 * reasons (partial, description, parent, closed, created_after_pr, other_pr).
 */
export function selectIntendedIssues(snapshot) {
  const repository = snapshot?.repository;
  const body = snapshot?.pr?.body || '';
  const { head } = splitRepairBlock(body);
  const open = repository ? extractOpenIssueMentions(head, repository.owner, repository.repo) : new Set();
  const closes = (text, issue) => prClosesIssue(text, issue.number, issue.owner, issue.repo, { allowShortReference: isSameRepository(issue, repository) });
  const intended = [];
  const skippedKeptOpen = [];
  for (const issue of snapshot?.issues || []) {
    if (closes(head, issue) || (!issue.reference && closes(body, issue))) intended.push(issue);
    else skippedKeptOpen.push({ key: issueKey(issue), reason: !closes(body, issue) ? (open.has(Number(issue.number)) && isSameRepository(issue, repository) ? 'description' : 'not_closed_by_description') : 'repair_only' });
  }
  for (const issue of snapshot?.deferred || []) skippedKeptOpen.push({ key: issueKey(issue), reason: snapshot.reasons?.get(issueKey(issue)) || 'description' });
  for (const issue of snapshot?.foreignBlocked || []) skippedKeptOpen.push({ key: issueKey(issue), reason: 'cross_repository' });
  return { intended, skippedKeptOpen };
}

/** Human-readable reason for a skipped issue. */
export const describeSkipReason = reason => SKIP_REASONS[reason] || DEFERRAL_REASONS[reason] || reason;

/**
 * The scope of an already merged pull request, computed like the merge guard
 * does before a merge (for the sweeper and `close-linked-issues`). Foreign
 * references the guard would block are reported, never closed.
 */
export async function fetchMergedPullRequestSnapshot({ owner, repo, prNumber, issueNumber = null, run = runLinkGh, allowCrossRepositoryClosing = true }) {
  const snapshot = await fetchPullRequestIssueScope({ owner, repo, prNumber, issueNumber, run });
  const { head } = splitRepairBlock(snapshot.pr.body || '');
  const foreign = await splitForeignReferences({ ...snapshot, head, repository: { owner, repo }, allow: allowCrossRepositoryClosing, run });
  const blocked = new Set(foreign.blocked.map(issueKey));
  const issues = snapshot.issues.filter(issue => !blocked.has(issueKey(issue)));
  const split = issues.length ? await splitPullRequestScope({ issues, body: head, repository: { owner, repo }, pr: { ...snapshot.pr, number: Number(prNumber) }, run }) : { required: [], deferred: [], reasons: new Map() };
  // Issues GitHub links (a sidebar link, or a negated closing keyword, as agent#326 has for agent#322) that the
  // description does not close are reported as kept open, never closed.
  const known = new Set([...split.required, ...split.deferred, ...foreign.blocked].map(issueKey));
  const open = extractOpenIssueMentions(head, owner, repo);
  const slug = `${owner}/${repo}`.toLowerCase();
  for (const key of await fetchClosingIssueReferences({ owner, repo, prNumber, run })) {
    if (known.has(key)) continue;
    const [nameWithOwner, number] = key.split('#');
    const [issueOwner, issueRepo] = nameWithOwner.split('/');
    split.deferred.push({ owner: issueOwner, repo: issueRepo, number: Number(number) });
    split.reasons.set(key, nameWithOwner === slug && open.has(Number(number)) ? 'description' : 'not_closed_by_description');
  }
  return { ...snapshot, issues: split.required, deferred: split.deferred, reasons: split.reasons, foreignBlocked: foreign.blocked };
}

const defaultSleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Read an issue's state: 'open' or 'closed'. Anything else throws. */
async function readIssueState(issue, run) {
  const source = await ghJson(run, ['api', `repos/${issue.owner}/${issue.repo}/issues/${issue.number}`]);
  if (source?.state !== 'open' && source?.state !== 'closed') throw new Error('Cannot verify the issue state after the merge');
  return source.state;
}

/** The explicit-close comment: names the pull request, its merge commit and why GitHub did not close the issue. */
export function buildClosingComment({ issue, pr, repository, mergeSha, defaultBranch }) {
  const commit = mergeSha ? ` (merged ${isSameRepository(issue, repository) ? mergeSha : `${repository.owner}/${repository.repo}@${mergeSha}`})` : ' (merged)';
  if (pr.base?.ref && defaultBranch && pr.base.ref !== defaultBranch) return `Closed by ${pr.html_url}${commit}: it was merged into \`${pr.base.ref}\`, not the default branch \`${defaultBranch}\`, and GitHub closes linked issues only for default-branch merges, although the description closes it.`;
  if (!isSameRepository(issue, repository)) return `Closed by ${pr.html_url}${commit}: GitHub did not close it after the merge (it closes an issue in another repository only when the merger can write to it), although the description closes it.`;
  return `Closed by ${pr.html_url}${commit}: GitHub did not close it after the merge although the description closes it.`;
}

/**
 * Verify, after a merge, that every intended issue is closed, and close the
 * ones still open (`mode: 'close'`) or only report them (`mode: 'report'`,
 * --no-auto-close-linked-issues). After a default-branch merge GitHub gets up
 * to `timeoutMs` (backoff 10 s → 60 s) to close them first; after a
 * non-default-branch merge they are closed at once. With `closeParents`,
 * parents whose work is complete are closed too (#3359).
 *
 * Returns { mode, pr, mergeSha, intended, closed, alreadyClosed, failed,
 * skippedKeptOpen, stillOpen, parents }; issue entries are "owner/repo#N"
 * keys, `failed` entries are { key, error }. Never throws.
 */
export async function closeIntendedIssuesAfterMerge(snapshot, { mode = 'close', run = runLinkGh, logger = async () => {}, sleep = defaultSleep, timeoutMs = Number(process.env.HIVE_MIND_POST_MERGE_CLOSE_TIMEOUT_MS ?? POST_MERGE_TIMEOUT_MS), backoffMs = POST_MERGE_BACKOFF_MS, closeParents = true, wait = true } = {}) {
  const result = { mode, pr: null, mergeSha: null, intended: [], closed: [], alreadyClosed: [], failed: [], skippedKeptOpen: [], stillOpen: [], parents: null };
  if (!snapshot?.pr) return result;
  const { intended, skippedKeptOpen } = selectIntendedIssues(snapshot);
  Object.assign(result, { intended: intended.map(issueKey), skippedKeptOpen });
  if (!intended.length) return result;
  const repository = snapshot.repository;
  const fail = async (issue, error) => {
    result.failed.push({ key: issueKey(issue), error: error.message });
    await logger(`Could not close linked issue ${issueKey(issue)} after the merge: ${error.message}`, { level: 'warning' });
  };
  let pr;
  let defaultBranch = snapshot.defaultBranch;
  try {
    pr = await ghJson(run, ['api', `repos/${repository.owner}/${repository.repo}/pulls/${snapshot.pr.number ?? snapshot.prNumber}`]);
    if (!pr?.merged && !pr?.merged_at) throw new Error('the pull request is not merged');
    defaultBranch ||= (await ghJson(run, ['api', `repos/${repository.owner}/${repository.repo}`])).default_branch;
    if (!defaultBranch || !pr.base?.ref) throw new Error('cannot determine the pull request base or the default branch');
  } catch (error) {
    for (const issue of intended) await fail(issue, error);
    return result;
  }
  result.pr = pr.html_url || null;
  result.mergeSha = pr.merge_commit_sha || null;
  // Poll while GitHub may still close the issues itself.
  let pending = intended;
  const onDefaultBranch = pr.base.ref === defaultBranch;
  for (let elapsed = 0, attempt = 0; ; attempt++) {
    const open = [];
    for (const issue of pending) {
      try {
        if ((await readIssueState(issue, run)) === 'closed') result.alreadyClosed.push(issueKey(issue));
        else open.push(issue);
      } catch (error) {
        await fail(issue, error);
      }
    }
    pending = open;
    const delay = Math.min(backoffMs[Math.min(attempt, backoffMs.length - 1)], timeoutMs - elapsed);
    if (!pending.length || !onDefaultBranch || !wait || delay <= 0) break;
    await sleep(delay);
    elapsed += delay;
  }
  for (const issue of pending) {
    if (mode !== 'close') {
      result.stillOpen.push(issueKey(issue));
      continue;
    }
    try {
      const comment = buildClosingComment({ issue, pr, repository, mergeSha: result.mergeSha, defaultBranch });
      const closed = await run(['issue', 'close', String(issue.number), '--repo', `${issue.owner}/${issue.repo}`, '--reason', 'completed', '--comment', comment]);
      if ((closed.code ?? 0) !== 0) throw new Error(closed.stderr?.toString().trim() || 'gh issue close failed');
      result.closed.push(issueKey(issue));
    } catch (error) {
      await fail(issue, error);
    }
  }
  const done = [...result.alreadyClosed, ...result.closed];
  if (closeParents && done.length) result.parents = await closeCompletedParents(done, { mode, run, logger });
  return result;
}

/** Keys that are neither closed nor reported as kept open: what the caller must surface. */
export const unclosedIssueKeys = result => [...(result?.failed || []).map(entry => entry.key), ...(result?.stillOpen || [])];

/** Log lines for a {@link closeIntendedIssuesAfterMerge} result (empty when there was nothing to close). */
export function formatIssueClosingReport(result) {
  if (!result) return [];
  const lines = [];
  const list = keys => keys.join(', ');
  if (result.alreadyClosed.length) lines.push(`🔒 Closed by GitHub: ${list(result.alreadyClosed)}`);
  if (result.closed.length) lines.push(`🔒 Closed explicitly after the merge (GitHub did not): ${list(result.closed)}`);
  if (result.stillOpen.length) lines.push(`⚠️ Still open after the merge, not closed because --no-auto-close-linked-issues is set: ${list(result.stillOpen)}`);
  if (result.failed.length) lines.push(`⚠️ Could not close: ${result.failed.map(entry => `${entry.key} (${entry.error})`).join(', ')}`);
  if (result.skippedKeptOpen.length) lines.push(`ℹ️  Not closed, the description keeps them open: ${result.skippedKeptOpen.map(entry => `${entry.key} (${describeSkipReason(entry.reason)})`).join(', ')}`);
  const parents = result.parents;
  if (parents?.closed?.length) lines.push(`🔒 Closed completed parent issues: ${list(parents.closed)}`);
  if (parents?.wouldClose?.length) lines.push(`ℹ️  Completed parent issues not closed (report mode): ${list(parents.wouldClose)}`);
  if (parents?.keptOpen?.length) lines.push(`ℹ️  Parent issues kept open: ${parents.keptOpen.map(entry => `${entry.key} (${entry.reasons.join('; ')})`).join(', ')}`);
  if (parents?.failed?.length) lines.push(`⚠️ Could not check parent issues: ${parents.failed.map(entry => `${entry.key} (${entry.error})`).join(', ')}`);
  return lines;
}

/** A one-line summary for chat messages; empty when GitHub closed everything. */
export function summarizeIssueClosing(result) {
  if (!result) return '';
  const parts = [];
  if (result.closed.length) parts.push(`closed ${result.closed.join(', ')}`);
  if (result.stillOpen.length) parts.push(`still open ${result.stillOpen.join(', ')}`);
  if (result.failed.length) parts.push(`could not close ${result.failed.map(entry => entry.key).join(', ')}`);
  if (result.parents?.closed?.length) parts.push(`closed parents ${result.parents.closed.join(', ')}`);
  return parts.length ? `Linked issues: ${parts.join('; ')}` : '';
}

/** Append the closing result to a pull request comment body as a Markdown section. */
export function appendIssueClosingSection(body, result) {
  const lines = formatIssueClosingReport(result);
  return lines.length ? `${body}\n\n### Linked issues\n\n${lines.map(line => `- ${line}`).join('\n')}` : body;
}

/**
 * Merge-time entry point for {@link mergePullRequest}: the guard's snapshot,
 * then {@link closeIntendedIssuesAfterMerge} in the configured mode.
 */
export async function closeIssuesAfterMerge(snapshot, options = {}, { run = runLinkGh, logger = async () => {}, sleep } = {}) {
  const { autoCloseLinkedIssues, closeCompletedParents: parents } = issueClosingOptions(options);
  return closeIntendedIssuesAfterMerge(snapshot, { mode: autoCloseLinkedIssues ? 'close' : 'report', run, logger, sleep, closeParents: parents });
}
