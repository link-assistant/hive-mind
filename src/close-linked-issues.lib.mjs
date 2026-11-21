/**
 * `close-linked-issues` (issue #3356): close what merged pull requests intend
 * to close, by hand or from a workflow, with the same logic as the merge paths
 * and the merged-PR sweeper.
 *
 *   close-linked-issues --pr <url> [--pr <url> ...] [--dry-run]
 *   close-linked-issues --repo owner/repo|--owner owner --since <ISO date> [--dry-run]
 *
 * `--dry-run` lists what would be closed and why each other issue is skipped
 * (for example the negated reference to agent#322 in agent#326). `--since` is the explicit backfill:
 * without it, nothing merged before the sweeper was enabled is touched.
 */
import { parseArgs } from 'node:util';
import { runLinkGh } from './issue-link-verification.lib.mjs';
import { closeIntendedIssuesAfterMerge, describeSkipReason, fetchMergedPullRequestSnapshot, formatIssueClosingReport, issueClosingOptions } from './post-merge-issue-closing.lib.mjs';
import { sweepMergedPullRequests, sweepScope } from './merged-pr-sweeper.lib.mjs';

export const CLOSE_LINKED_ISSUES_USAGE = `Usage:
  close-linked-issues --pr <pull request URL> [--pr <url> ...] [--dry-run]
  close-linked-issues (--repo <owner/repo> | --owner <owner>) --since <ISO date> [--dry-run]

Closes the issues a merged pull request's description closes that are still
open, with a comment naming the pull request and its merge commit. Issues the
description keeps open ("does not close #N", "Part of #N") are never closed.

Options:
  --pr <url>                           A merged pull request (repeatable)
  --repo <owner/repo>, --owner <name>  Backfill scope, with --since
  --since <ISO date>                   Backfill pull requests merged since then
  --dry-run                            List what would be closed and why, close nothing
  --no-allow-cross-repository-closing  Skip closing references to other repositories
  --no-close-completed-parents         Do not close completed parent issues
  -h, --help                           Show this help`;

const OPTIONS = {
  pr: { type: 'string', multiple: true },
  repo: { type: 'string' },
  owner: { type: 'string' },
  since: { type: 'string' },
  'dry-run': { type: 'boolean' },
  'allow-cross-repository-closing': { type: 'boolean' },
  'close-completed-parents': { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

export const parsePullRequestUrl = url => {
  const match = String(url).match(/^(?:https?:\/\/github\.com\/)?([^/\s]+)\/([^/\s]+)\/pull\/(\d+)(?:[/?#].*)?$/);
  if (!match) throw new Error(`Not a pull request URL: ${url}`);
  return { owner: match[1], repo: match[2], prNumber: Number(match[3]) };
};

/** Dry-run lines: what would be closed, and why each other issue is not. */
export function formatDryRun(key, result) {
  const lines = [`${key}${result.pr ? ` (${result.pr})` : ''}:`];
  for (const issue of result.stillOpen) lines.push(`  would close ${issue}: the description closes it and it is still open`);
  for (const issue of result.alreadyClosed) lines.push(`  already closed ${issue}`);
  for (const entry of result.closedNotCompleted || []) lines.push(`  already closed ${entry.key} as ${entry.reason.replace('_', ' ')}, not by this merge`);
  for (const entry of result.skippedKeptOpen) lines.push(`  skip ${entry.key}: ${describeSkipReason(entry.reason)}`);
  for (const entry of result.failed) lines.push(`  cannot check ${entry.key}: ${entry.error}`);
  for (const parent of result.parents?.wouldClose || []) lines.push(`  would close completed parent ${parent}`);
  for (const parent of result.parents?.keptOpen || []) lines.push(`  parent ${parent.key} stays open: ${parent.reasons.join('; ')}`);
  if (lines.length === 1) lines.push('  nothing to close');
  return lines;
}

/** Run the command; returns the exit code (1 when an issue could not be checked or closed). */
export async function runCloseLinkedIssues(argv, { run = runLinkGh, print = console.log, now = Date.now(), env = process.env, sleep } = {}) {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, options: OPTIONS, allowNegative: true, strict: true }));
    if (!values.help && !values.pr?.length && !values.since) throw new Error('Give --pr <url>, or --repo/--owner with --since');
    if (values.since && !values.pr?.length && !values.repo && !values.owner) throw new Error('--since needs --repo or --owner');
    if (values.since && Number.isNaN(Date.parse(values.since))) throw new Error(`Invalid --since date: ${values.since}`);
  } catch (error) {
    print(`${error.message}\n\n${CLOSE_LINKED_ISSUES_USAGE}`);
    return 2;
  }
  if (values.help) {
    print(CLOSE_LINKED_ISSUES_USAGE);
    return 0;
  }
  const dryRun = Boolean(values['dry-run']);
  const options = issueClosingOptions({ autoCloseLinkedIssues: !dryRun, allowCrossRepositoryClosing: values['allow-cross-repository-closing'], closeCompletedParents: values['close-completed-parents'] }, env);
  const mode = dryRun ? 'report' : 'close';
  const results = [];
  for (const url of values.pr || []) {
    const ref = parsePullRequestUrl(url);
    const key = `${ref.owner}/${ref.repo}#${ref.prNumber}`;
    try {
      const snapshot = await fetchMergedPullRequestSnapshot({ ...ref, run, allowCrossRepositoryClosing: options.allowCrossRepositoryClosing });
      // Run on the merge event (the example workflow), GitHub may still be closing the issues itself: wait what is left of its time (#3356).
      results.push({ key, result: await closeIntendedIssuesAfterMerge(snapshot, { mode, run, wait: !dryRun, waitFromMerge: true, now, sleep, closeParents: options.closeCompletedParents }) });
    } catch (error) {
      results.push({ key, result: null, error: error.message });
    }
  }
  if (values.since && !values.pr?.length) {
    const scope = sweepScope(values.repo ? { owner: values.repo.split('/')[0], repo: values.repo.split('/')[1] } : { owner: values.owner });
    const since = new Date(values.since).toISOString();
    const swept = await sweepMergedPullRequests({ scopes: [scope], state: { enabledAt: since, checked: {} }, since, now, windowMs: Math.max(0, now - Date.parse(since)), graceMs: 0, options, run });
    results.push(...swept.results, ...swept.errors.map(entry => ({ key: entry.key || entry.scope, result: null, error: entry.error })));
  }
  let failed = false;
  for (const { key, result, error } of results) {
    if (!result) {
      failed = true;
      print(`${key}: cannot check: ${error}`);
      continue;
    }
    failed ||= result.failed.length > 0 || Boolean(result.parents?.failed?.length);
    if (dryRun) for (const line of formatDryRun(key, result)) print(line);
    else for (const line of [`${key}${result.pr ? ` (${result.pr})` : ''}:`, ...formatIssueClosingReport(result).map(line => `  ${line}`)]) print(line);
  }
  if (!results.length) print('No merged pull requests found.');
  return failed ? 1 : 0;
}
