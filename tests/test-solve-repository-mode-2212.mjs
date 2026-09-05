#!/usr/bin/env node

/**
 * Tests for issue #2212:
 *   - `/solve <github-repository-url>` (repository mode)
 *   - `--ensure-all-sub-issues-addressed`
 *
 * Covers the pure helpers (network-free), the `gh` argument builders, the
 * orchestration against a fake `gh` runner, and the CLI option definition and
 * config-level normalization of the new flag.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2212
 */

import assert from 'node:assert/strict';

import { MAX_SUB_ISSUES_PER_PARENT, REPOSITORY_MODE_MARKER, buildClosingKeywordBlock, buildCombinedIssueBody, buildCombinedIssueTitle, buildOpenIssuesApiArgs, buildRepositoryModeSummaryLines, isPullRequestEntry, normalizeOpenIssueEntry, selectOldestOpenIssues } from '../src/solve.repository-mode.lib.mjs';
import { attachSubIssues, parseRepositoryModeUrl, prepareRepositoryModeIssue, resolveRepositoryModeTarget } from '../src/solve.repository-mode.run.lib.mjs';
import { DEFAULT_ENSURE_SUB_ISSUES_LIMIT, buildEnsureSubIssuesFeedback, buildMissingReferenceBlock, findMissingSubIssueReferences, formatEnsureSubIssuesLimit, normalizeEnsureSubIssuesLimit, normalizeSubIssueEntry } from '../src/solve.ensure-sub-issues.detect.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS, parseArguments } from '../src/solve.config.lib.mjs';
import { validateGitHubUrl } from '../src/solve.validation.lib.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const issueEntry = (number, { id = number * 10, title = `Issue ${number}`, createdAt = `2024-01-${String(number).padStart(2, '0')}T00:00:00Z`, pullRequest = false } = {}) => ({
  number,
  id,
  title,
  html_url: `https://github.com/o/r/issues/${number}`,
  created_at: createdAt,
  ...(pullRequest ? { pull_request: { url: 'x' } } : {}),
});

// ---------------------------------------------------------------------------
// Reproducing the issue: a repository URL used to be rejected outright
// ---------------------------------------------------------------------------

test('reproduction: validateGitHubUrl alone still rejects a repository URL', () => {
  // solve.mjs used to hand the raw URL straight to this validator, which is why
  // `/solve https://github.com/owner/repo` failed with
  // "URL type 'repo' is not supported". Repository mode now runs *before* this
  // validator and substitutes a real issue URL.
  const originalError = console.error;
  console.error = () => {};
  try {
    const result = validateGitHubUrl('https://github.com/link-assistant/hive-mind');
    assert.equal(result.isValid, false);
  } finally {
    console.error = originalError;
  }
});

test('repository mode recognizes exactly the URLs the validator rejects', () => {
  assert.deepEqual(parseRepositoryModeUrl('https://github.com/link-assistant/hive-mind'), {
    owner: 'link-assistant',
    repo: 'hive-mind',
    fullName: 'link-assistant/hive-mind',
    url: 'https://github.com/link-assistant/hive-mind',
  });
  assert.equal(parseRepositoryModeUrl('https://github.com/o/r/issues/1'), null);
  assert.equal(parseRepositoryModeUrl('https://github.com/o/r/pull/1'), null);
  assert.equal(parseRepositoryModeUrl('not a url'), null);
});

// ---------------------------------------------------------------------------
// gh argument builders
// ---------------------------------------------------------------------------

test('open-issues query parameters go into the endpoint, never into -f fields', () => {
  const args = buildOpenIssuesApiArgs({ owner: 'o', repo: 'r' });
  // `gh api -f key=value` switches the request to POST, which makes the issues
  // endpoint answer HTTP 422 ("title wasn't supplied"). Verified live against
  // the GitHub API while implementing #2212.
  assert.ok(!args.includes('-f'), `-f must not be used: ${args.join(' ')}`);
  assert.ok(!args.includes('-F'), `-F must not be used: ${args.join(' ')}`);
  assert.deepEqual(args, ['api', 'repos/o/r/issues?state=open&sort=created&direction=asc&per_page=100', '--paginate']);
});

test('open-issues request always paginates and clamps per_page to 1..100', () => {
  assert.ok(buildOpenIssuesApiArgs({ owner: 'o', repo: 'r' }).includes('--paginate'));
  assert.match(buildOpenIssuesApiArgs({ owner: 'o', repo: 'r', perPage: 30 })[1], /per_page=30$/);
  assert.match(buildOpenIssuesApiArgs({ owner: 'o', repo: 'r', perPage: 1000 })[1], /per_page=100$/);
  assert.match(buildOpenIssuesApiArgs({ owner: 'o', repo: 'r', perPage: 0 })[1], /per_page=100$/);
  assert.throws(() => buildOpenIssuesApiArgs({ owner: '', repo: 'r' }));
});

// ---------------------------------------------------------------------------
// Selecting the issues
// ---------------------------------------------------------------------------

test('pull requests are recognized and excluded from the selection', () => {
  assert.equal(isPullRequestEntry(issueEntry(1, { pullRequest: true })), true);
  assert.equal(isPullRequestEntry(issueEntry(1)), false);
  assert.equal(isPullRequestEntry(null), false);

  const { selected, totalOpen } = selectOldestOpenIssues([issueEntry(1), issueEntry(2, { pullRequest: true }), issueEntry(3)]);
  assert.deepEqual(
    selected.map(i => i.number),
    [1, 3]
  );
  assert.equal(totalOpen, 2);
});

test('selection is oldest-first regardless of input order', () => {
  const entries = [issueEntry(9, { createdAt: '2024-05-01T00:00:00Z' }), issueEntry(2, { createdAt: '2023-01-01T00:00:00Z' }), issueEntry(5, { createdAt: '2024-01-01T00:00:00Z' })];
  const { selected } = selectOldestOpenIssues(entries);
  assert.deepEqual(
    selected.map(i => i.number),
    [2, 5, 9]
  );
});

test('ties on created_at fall back to the issue number', () => {
  const entries = [issueEntry(8, { createdAt: '2024-01-01T00:00:00Z' }), issueEntry(3, { createdAt: '2024-01-01T00:00:00Z' })];
  assert.deepEqual(
    selectOldestOpenIssues(entries).selected.map(i => i.number),
    [3, 8]
  );
});

test('over the limit only the oldest N are kept and the rest are reported as skipped', () => {
  // The issue: "if we hit the limit, we should add 100 (or whatever the limit)
  // oldest only, and ignore others".
  const entries = Array.from({ length: 150 }, (_, index) => issueEntry(index + 1, { createdAt: new Date(Date.UTC(2024, 0, 1) + index * 86400000).toISOString() }));
  const { selected, totalOpen, skipped } = selectOldestOpenIssues(entries);
  assert.equal(selected.length, MAX_SUB_ISSUES_PER_PARENT);
  assert.equal(totalOpen, 150);
  assert.equal(skipped, 50);
  assert.equal(selected[0].number, 1);
  assert.equal(selected[selected.length - 1].number, 100);
});

test('GitHub sub-issue limit per parent is 100', () => {
  assert.equal(MAX_SUB_ISSUES_PER_PARENT, 100);
});

test('excluded issue numbers are never selected', () => {
  const { selected } = selectOldestOpenIssues([issueEntry(1), issueEntry(2), issueEntry(3)], { exclude: [2] });
  assert.deepEqual(
    selected.map(i => i.number),
    [1, 3]
  );
});

test('malformed entries are dropped instead of crashing the run', () => {
  const { selected, totalOpen } = selectOldestOpenIssues([null, 'x', {}, { number: 0 }, issueEntry(4)]);
  assert.deepEqual(
    selected.map(i => i.number),
    [4]
  );
  assert.equal(totalOpen, 1);
});

test('normalizeOpenIssueEntry keeps the REST database id needed by the sub-issues API', () => {
  const normalized = normalizeOpenIssueEntry(issueEntry(7, { id: 4242 }));
  assert.equal(normalized.number, 7);
  assert.equal(normalized.id, 4242);
  assert.equal(normalized.url, 'https://github.com/o/r/issues/7');
  assert.equal(normalizeOpenIssueEntry({ number: 7 }).id, null);
});

// ---------------------------------------------------------------------------
// Combined issue content
// ---------------------------------------------------------------------------

test('closing keywords are repeated per issue (GitHub ignores comma lists)', () => {
  // "Fixes #1, #2" closes only #1 on GitHub, so one full keyword per issue.
  assert.equal(buildClosingKeywordBlock([{ number: 1 }, { number: 2 }]), 'Fixes #1\nFixes #2');
  assert.equal(buildClosingKeywordBlock([]), '');
  assert.equal(buildClosingKeywordBlock([{ number: 3 }], 'Closes'), 'Closes #3');
});

test('combined issue title reflects whether everything fit under the limit', () => {
  assert.equal(buildCombinedIssueTitle({ owner: 'o', repo: 'r', count: 3, totalOpen: 3 }), 'Address all 3 open issues in o/r');
  assert.equal(buildCombinedIssueTitle({ owner: 'o', repo: 'r', count: 1, totalOpen: 1 }), 'Address the single open issue in o/r');
  assert.equal(buildCombinedIssueTitle({ owner: 'o', repo: 'r', count: 100, totalOpen: 150 }), 'Address the 100 oldest open issues in o/r (of 150 open)');
});

test('combined issue body lists every issue and its required closing reference', () => {
  const issues = [normalizeOpenIssueEntry(issueEntry(5)), normalizeOpenIssueEntry(issueEntry(7))];
  const body = buildCombinedIssueBody({ repository: { owner: 'o', repo: 'r', url: 'https://github.com/o/r' }, issues, totalOpen: 2 });

  assert.ok(body.startsWith(REPOSITORY_MODE_MARKER));
  assert.ok(body.includes('- [ ] #5'));
  assert.ok(body.includes('- [ ] #7'));
  assert.ok(body.includes('Fixes #5\nFixes #7'));
  assert.ok(body.includes('single pull request'));
  assert.ok(body.includes('Open issues found in the repository: 2'));
});

test('combined issue body says how many issues were left out over the limit', () => {
  const issues = [normalizeOpenIssueEntry(issueEntry(1))];
  const body = buildCombinedIssueBody({ repository: { owner: 'o', repo: 'r', url: 'https://github.com/o/r' }, issues, totalOpen: 130, limit: 1 });
  assert.ok(body.includes('129'), body);
});

test('summary lines mention the skipped issues only when there are any', () => {
  const repository = { owner: 'o', repo: 'r' };
  assert.equal(buildRepositoryModeSummaryLines({ repository, totalOpen: 2, selectedCount: 2, skipped: 0 }).length, 2);
  assert.equal(buildRepositoryModeSummaryLines({ repository, totalOpen: 120, selectedCount: 100, skipped: 20 }).length, 3);
});

// ---------------------------------------------------------------------------
// Orchestration against a fake `gh`
// ---------------------------------------------------------------------------

const makeFakeRun = (entries, { createFails = false, attachFailsFor = [] } = {}) => {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === 'api' && String(args[1]).includes('/issues?')) {
      return { code: 0, stdout: JSON.stringify(entries), stderr: '' };
    }
    if (args[0] === 'issue' && args[1] === 'create') {
      if (createFails) return { code: 1, stdout: '', stderr: 'gh: create failed' };
      return { code: 0, stdout: 'https://github.com/o/r/issues/42\n', stderr: '' };
    }
    if (args.includes('-X') && args.some(part => String(part).includes('/sub_issues'))) {
      const idArg = args[args.length - 1];
      const id = Number(String(idArg).split('=')[1]);
      if (attachFailsFor.includes(id)) return { code: 1, stdout: '', stderr: 'Issue already has a parent' };
      return { code: 0, stdout: '{}', stderr: '' };
    }
    return { code: 0, stdout: '{}', stderr: '' };
  };
  return { run, calls };
};

test('prepare collects the open issues without creating anything', async () => {
  const { run, calls } = makeFakeRun([issueEntry(1), issueEntry(2, { pullRequest: true }), issueEntry(3)]);
  const prepared = await prepareRepositoryModeIssue({ repository: { owner: 'o', repo: 'r', fullName: 'o/r', url: 'https://github.com/o/r' }, run });
  assert.deepEqual(
    prepared.selected.map(i => i.number),
    [1, 3]
  );
  assert.equal(prepared.totalOpen, 2);
  assert.equal(calls.length, 1);
});

test('resolve creates one combined issue and attaches every issue as a sub-issue', async () => {
  const { run, calls } = makeFakeRun([issueEntry(1, { id: 101 }), issueEntry(3, { id: 103 })]);
  const result = await resolveRepositoryModeTarget({ url: 'https://github.com/o/r', run });

  assert.equal(result.handled, true);
  assert.equal(result.error, undefined);
  assert.equal(result.issueUrl, 'https://github.com/o/r/issues/42');
  assert.equal(result.issue.attached.length, 2);

  const subIssueCalls = calls.filter(call => call.some(part => String(part).includes('/sub_issues')));
  assert.equal(subIssueCalls.length, 2);
  assert.ok(subIssueCalls[0].includes('sub_issue_id=101'));
  assert.ok(subIssueCalls[1].includes('sub_issue_id=103'));
  // The sub-issues API requires an explicit API version header.
  assert.ok(subIssueCalls[0].some(part => String(part).startsWith('X-GitHub-Api-Version:')));
});

test('resolve turns on deep analysis and the sub-issue check for the generated issue', async () => {
  const { run } = makeFakeRun([issueEntry(1)]);
  const result = await resolveRepositoryModeTarget({ url: 'https://github.com/o/r', run });
  assert.equal(result.argvOverrides['deep-analysis'], true);
  assert.equal(result.argvOverrides.deepAnalysis, true);
  assert.equal(result.argvOverrides['ensure-all-sub-issues-addressed'], true);
  assert.equal(result.argvOverrides.ensureAllSubIssuesAddressed, true);
});

test('resolve leaves issue and pull request URLs untouched', async () => {
  const { run, calls } = makeFakeRun([]);
  assert.deepEqual(await resolveRepositoryModeTarget({ url: 'https://github.com/o/r/issues/9', run }), { handled: false });
  assert.deepEqual(await resolveRepositoryModeTarget({ url: 'https://github.com/o/r/pull/9', run }), { handled: false });
  assert.equal(calls.length, 0);
});

test('resolve reports a repository with no open issues instead of creating an empty issue', async () => {
  const { run, calls } = makeFakeRun([issueEntry(1, { pullRequest: true })]);
  const result = await resolveRepositoryModeTarget({ url: 'https://github.com/o/r', run });
  assert.equal(result.handled, true);
  assert.match(result.error, /no open issues/);
  assert.equal(calls.filter(call => call[1] === 'issue').length, 0);
});

test('resolve reports a failure to create the combined issue', async () => {
  const { run } = makeFakeRun([issueEntry(1)], { createFails: true });
  const result = await resolveRepositoryModeTarget({ url: 'https://github.com/o/r', run });
  assert.equal(result.handled, true);
  assert.match(result.error, /Could not create the combined issue/);
});

test('a single unattachable issue does not abort the whole run', async () => {
  // An issue that already has a different parent is rejected by the API; the
  // run must continue with the rest.
  const { run } = makeFakeRun([issueEntry(1, { id: 101 }), issueEntry(2, { id: 102 })], { attachFailsFor: [101] });
  const messages = [];
  const result = await resolveRepositoryModeTarget({ url: 'https://github.com/o/r', run, log: async message => messages.push(message) });
  assert.equal(result.issue.attached.length, 1);
  assert.equal(result.issue.failed.length, 1);
  assert.equal(result.issue.failed[0].issue.number, 1);
  assert.ok(messages.some(message => message.includes('Could not attach #1')));
});

test('attachSubIssues rejects entries without a REST id instead of sending a bad request', async () => {
  const { run, calls } = makeFakeRun([]);
  const { attached, failed } = await attachSubIssues({ parentIssue: { owner: 'o', repo: 'r', number: 1 }, issues: [{ number: 5, id: null }], run });
  assert.equal(attached.length, 0);
  assert.equal(failed.length, 1);
  assert.match(failed[0].error, /missing REST id/);
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// --ensure-all-sub-issues-addressed: detection
// ---------------------------------------------------------------------------

const subIssue = (number, title = `Sub ${number}`) => ({ number, title, repository_url: 'https://api.github.com/repos/o/r', html_url: `https://github.com/o/r/issues/${number}` });

test('default restart limit is 5', () => {
  assert.equal(DEFAULT_ENSURE_SUB_ISSUES_LIMIT, 5);
});

test('limit normalization mirrors the keep-working semantics', () => {
  assert.equal(normalizeEnsureSubIssuesLimit(true), 5);
  assert.equal(normalizeEnsureSubIssuesLimit(undefined), 0);
  assert.equal(normalizeEnsureSubIssuesLimit(null), 0);
  assert.equal(normalizeEnsureSubIssuesLimit(false), 0);
  assert.equal(normalizeEnsureSubIssuesLimit(3), 3);
  assert.equal(normalizeEnsureSubIssuesLimit('3'), 3);
  assert.equal(normalizeEnsureSubIssuesLimit('forever'), Infinity);
  assert.equal(normalizeEnsureSubIssuesLimit('unlimited'), Infinity);
  assert.equal(normalizeEnsureSubIssuesLimit(0), Infinity);
  assert.equal(formatEnsureSubIssuesLimit(Infinity), 'unlimited');
  assert.equal(formatEnsureSubIssuesLimit(5), '5');
});

test('sub-issue entries carry their own repository so cross-repo refs stay qualified', () => {
  const normalized = normalizeSubIssueEntry(subIssue(12), { owner: 'other', repo: 'other' });
  assert.equal(normalized.owner, 'o');
  assert.equal(normalized.repo, 'r');
  assert.equal(normalized.number, 12);
  assert.equal(normalizeSubIssueEntry({ number: 3 }, { owner: 'o', repo: 'r' }).owner, 'o');
  assert.equal(normalizeSubIssueEntry(null), null);
  assert.equal(normalizeSubIssueEntry({ number: 'x' }), null);
});

test('missing closing references are detected per sub-issue', () => {
  const text = 'Fixes #1\nCloses #2';
  const { missing, referenced, total } = findMissingSubIssueReferences({ text, subIssues: [subIssue(1), subIssue(2), subIssue(3)], owner: 'o', repo: 'r' });
  assert.equal(total, 3);
  assert.deepEqual(
    referenced.map(s => s.number),
    [1, 2]
  );
  assert.deepEqual(
    missing.map(s => s.number),
    [3]
  );
});

test('a comma separated keyword list only counts for the first issue', () => {
  // This is the exact GitHub behaviour the option exists to catch.
  const { missing } = findMissingSubIssueReferences({ text: 'Fixes #1, #2', subIssues: [subIssue(1), subIssue(2)], owner: 'o', repo: 'r' });
  assert.deepEqual(
    missing.map(s => s.number),
    [2]
  );
});

test('a plain mention without a closing keyword does not count as addressed', () => {
  const { missing } = findMissingSubIssueReferences({ text: 'Related to #1 and see #2', subIssues: [subIssue(1), subIssue(2)], owner: 'o', repo: 'r' });
  assert.deepEqual(
    missing.map(s => s.number),
    [1, 2]
  );
});

test('fully qualified and URL references are recognized', () => {
  const { missing } = findMissingSubIssueReferences({
    text: 'Fixes o/r#1\nResolves https://github.com/o/r/issues/2',
    subIssues: [subIssue(1), subIssue(2)],
    owner: 'o',
    repo: 'r',
  });
  assert.deepEqual(missing, []);
});

test('no sub-issues means nothing can be missing', () => {
  assert.deepEqual(findMissingSubIssueReferences({ text: '', subIssues: [] }), { missing: [], referenced: [], total: 0 });
});

test('the reference block uses one keyword per issue and qualifies cross-repo issues', () => {
  const foreign = { number: 9, title: 'Foreign', repository_url: 'https://api.github.com/repos/x/y' };
  const normalized = [subIssue(1), foreign].map(entry => normalizeSubIssueEntry(entry, { owner: 'o', repo: 'r' }));
  assert.equal(buildMissingReferenceBlock(normalized, { owner: 'o', repo: 'r' }), 'Fixes #1\nFixes x/y#9');
});

test('restart feedback names every missing sub-issue and the required references', () => {
  const missing = [subIssue(1), subIssue(2)].map(entry => normalizeSubIssueEntry(entry, { owner: 'o', repo: 'r' }));
  const feedback = buildEnsureSubIssuesFeedback({ missing, total: 3, iteration: 1, limit: 5, owner: 'o', repo: 'r', issueNumber: 42 }).join('\n');
  assert.ok(feedback.includes('#42'));
  assert.ok(feedback.includes('Restart 1/5'));
  assert.ok(feedback.includes('Sub 1'));
  assert.ok(feedback.includes('Sub 2'));
  assert.ok(feedback.includes('Fixes #1\nFixes #2'));
  assert.ok(/double check/i.test(feedback), feedback);
});

test('restart feedback reports an unlimited limit as "unlimited"', () => {
  const feedback = buildEnsureSubIssuesFeedback({ missing: [], total: 0, iteration: 2, limit: Infinity }).join('\n');
  assert.ok(feedback.includes('Restart 2/unlimited'));
});

// ---------------------------------------------------------------------------
// CLI wiring
// ---------------------------------------------------------------------------

test('--ensure-all-sub-issues-addressed is a documented (non-hidden) solve option', () => {
  const definition = SOLVE_OPTION_DEFINITIONS['ensure-all-sub-issues-addressed'];
  assert.ok(definition, 'option missing from SOLVE_OPTION_DEFINITIONS');
  assert.equal(definition.type, 'string');
  assert.notEqual(definition.hidden, true);
  assert.ok(definition.alias.includes('ensure-sub-issues'));
});

const parseFlag = async extraArgs => {
  const saved = process.argv;
  try {
    process.argv = ['node', 'solve.mjs', 'https://github.com/o/r/issues/1', ...extraArgs];
    const argv = await parseArguments();
    return argv.ensureAllSubIssuesAddressed;
  } finally {
    process.argv = saved;
  }
};

test('CLI: bare flag means the default of 5 restarts', async () => {
  assert.equal(normalizeEnsureSubIssuesLimit(await parseFlag(['--ensure-all-sub-issues-addressed'])), 5);
});

test('CLI: an explicit count is honored', async () => {
  assert.equal(normalizeEnsureSubIssuesLimit(await parseFlag(['--ensure-all-sub-issues-addressed=2'])), 2);
});

test('CLI: "forever" removes the limit', async () => {
  assert.equal(normalizeEnsureSubIssuesLimit(await parseFlag(['--ensure-all-sub-issues-addressed=forever'])), Infinity);
});

test('CLI: aliases work', async () => {
  assert.equal(normalizeEnsureSubIssuesLimit(await parseFlag(['--ensure-sub-issues'])), 5);
  assert.equal(normalizeEnsureSubIssuesLimit(await parseFlag(['--ensure-all-sub-issues=3'])), 3);
});

test('CLI: flag absent leaves the feature disabled', async () => {
  assert.equal(normalizeEnsureSubIssuesLimit(await parseFlag([])), 0);
});

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

let passed = 0;
for (const { name, fn } of tests) {
  try {
    await fn();
    passed++;
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exit(1);
  }
}

console.log(`All ${passed} issue #2212 repository-mode tests passed.`);
