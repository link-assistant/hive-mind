#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #3176: repository mode (`/solve <repo-url>`)
 * selected every open issue as work, including status pages that a bot or a
 * scheduled workflow maintains. link-assistant/calculator#258 ("Coverage gap
 * report", opened weekly by github-actions[bot]) ended up in the required
 * closing block of the combined issue as `Fixes #258`; the workflow reopened it,
 * and the next repository-mode run selected it again.
 *
 * Open issues are now skipped when a bot opened them (unless
 * --include-bot-issues), when they carry a label from --skip-issue-labels, or
 * when their body contains the `<!-- hive-mind:skip -->` marker. Skipped issues
 * are listed in the combined issue with the reason, and never in its closing
 * block.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { DEFAULT_SKIP_ISSUE_LABELS, REPOSITORY_MODE_SKIP_MARKER, REQUIRED_CLOSING_REFERENCES_HEADING, buildCombinedIssueBody, buildRepositoryModeSummaryLines, getRepositoryModeExclusionReason, parseRequiredClosingReferences, parseSkipIssueLabels, repositoryModeSelectionFromArgv, selectOldestOpenIssues } from '../src/solve.repository-mode.lib.mjs';
import { prepareRepositoryModeIssue, resolveRepositoryModeTarget } from '../src/solve.repository-mode.run.lib.mjs';
import { checkRepositoryModeWork } from '../src/telegram-solve-repository-preflight.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS, parseArguments } from '../src/solve.config.lib.mjs';

const repository = { owner: 'link-assistant', repo: 'calculator', fullName: 'link-assistant/calculator', url: 'https://github.com/link-assistant/calculator' };

const human = { login: 'konard', type: 'User' };
const actionsBot = { login: 'github-actions[bot]', type: 'Bot' };

const entry = (number, { created = `2026-10-${String(number % 28 || 1).padStart(2, '0')}T00:00:00Z`, user = human, labels = [], body = '', title = `Issue ${number}` } = {}) => ({
  number,
  id: number * 10,
  title,
  html_url: `https://github.com/link-assistant/calculator/issues/${number}`,
  created_at: created,
  user,
  labels,
  body,
});

// The three open issues of link-assistant/calculator on 2026-10-13.
const calculatorEntries = () => [entry(247, { title: 'A real bug', created: '2026-10-08T00:00:00Z' }), entry(254, { title: 'A real feature', created: '2026-10-10T00:00:00Z' }), entry(258, { title: 'Coverage gap report', created: '2026-10-12T14:25:19Z', user: actionsBot, body: '<!-- calculator:coverage-gap-report -->\n# Coverage gap report\n...' })];

const runReturning = entries => async () => ({ code: 0, stdout: JSON.stringify(entries), stderr: '' });

test('reproduction: the bot-maintained coverage report is not selected as work', () => {
  const { selected, excluded, totalOpen } = selectOldestOpenIssues(calculatorEntries());
  assert.deepEqual(
    selected.map(issue => issue.number),
    [247, 254]
  );
  assert.equal(totalOpen, 2, 'totalOpen counts the issues that are eligible as work');
  assert.deepEqual(
    excluded.map(issue => issue.number),
    [258]
  );
  assert.match(excluded[0].reason, /bot/i);
  assert.match(excluded[0].reason, /github-actions\[bot\]/);
});

test('--include-bot-issues keeps bot-authored issues', () => {
  const { selected, excluded } = selectOldestOpenIssues(calculatorEntries(), { includeBotIssues: true });
  assert.deepEqual(
    selected.map(issue => issue.number),
    [247, 254, 258]
  );
  assert.deepEqual(excluded, []);
});

test('a login ending in [bot] counts as a bot even without user.type', () => {
  assert.match(getRepositoryModeExclusionReason(entry(1, { user: { login: 'renovate[bot]' } })), /renovate\[bot\]/);
  assert.equal(getRepositoryModeExclusionReason(entry(1)), null);
});

test('issues carrying a skip label are left out, case-insensitively', () => {
  const entries = [entry(1), entry(2, { labels: [{ name: 'Dashboard' }] }), entry(3, { labels: ['hive-mind:skip'] }), entry(4, { labels: [{ name: 'bug' }] })];
  const { selected, excluded } = selectOldestOpenIssues(entries);
  assert.deepEqual(
    selected.map(issue => issue.number),
    [1, 4]
  );
  assert.deepEqual(
    excluded.map(issue => [issue.number, issue.reason]),
    [
      [2, 'label "Dashboard"'],
      [3, 'label "hive-mind:skip"'],
    ]
  );
  assert.ok(DEFAULT_SKIP_ISSUE_LABELS.includes('hive-mind:skip'));
});

test('a custom label list replaces the defaults, and an empty one disables label skipping', () => {
  const entries = [entry(1, { labels: [{ name: 'dashboard' }] }), entry(2, { labels: [{ name: 'report' }] })];
  assert.deepEqual(
    selectOldestOpenIssues(entries, { skipLabels: ['report'] }).selected.map(issue => issue.number),
    [1]
  );
  assert.deepEqual(
    selectOldestOpenIssues(entries, { skipLabels: [] }).selected.map(issue => issue.number),
    [1, 2]
  );
});

test('an issue whose body carries the skip marker is left out', () => {
  const entries = [entry(1), entry(2, { body: `Weekly report\n\n${REPOSITORY_MODE_SKIP_MARKER}\n` }), entry(3, { body: '<!--hive-mind:SKIP-->' })];
  const { selected, excluded } = selectOldestOpenIssues(entries);
  assert.deepEqual(
    selected.map(issue => issue.number),
    [1]
  );
  assert.deepEqual(
    excluded.map(issue => issue.number),
    [2, 3]
  );
  assert.match(excluded[0].reason, /marker/);
});

test('parseSkipIssueLabels: undefined means the defaults, "" and "none" mean no labels', () => {
  assert.deepEqual(parseSkipIssueLabels(undefined), [...DEFAULT_SKIP_ISSUE_LABELS]);
  assert.deepEqual(parseSkipIssueLabels(''), []);
  assert.deepEqual(parseSkipIssueLabels('none'), []);
  assert.deepEqual(parseSkipIssueLabels(' report, Dashboard ,,'), ['report', 'Dashboard']);
  assert.deepEqual(parseSkipIssueLabels(['a', 'b,c']), ['a', 'b', 'c']);
});

test('the combined issue lists skipped issues with their reason and keeps them out of the closing block', () => {
  const { selected, excluded } = selectOldestOpenIssues(calculatorEntries());
  const body = buildCombinedIssueBody({ repository, issues: selected, totalOpen: 3, excludedIssues: excluded, attachmentCount: selected.length });
  assert.deepEqual(parseRequiredClosingReferences(body), [247, 254]);
  const closingBlock = body.slice(body.indexOf(REQUIRED_CLOSING_REFERENCES_HEADING));
  assert.doesNotMatch(closingBlock, /#258/);
  assert.match(body, /- Open issues found in the repository: 3/);
  assert.match(body, /- Open issues skipped as not work \(bot-authored, skip label or skip marker\): 1/);
  assert.match(body, /## Issues left out of this run/);
  assert.match(body, /- #258 Coverage gap report — opened by bot github-actions\[bot\]/);
  assert.doesNotMatch(body, /intentionally left out of this run \(newest/, 'skipped issues are not counted as over the sub-issue limit');
  assert.ok(!body.includes(REPOSITORY_MODE_SKIP_MARKER), 'the combined issue must not mark itself as skipped');
});

test('the log summary names how many issues were skipped', () => {
  const lines = buildRepositoryModeSummaryLines({ totalOpen: 3, selectedCount: 2, requestedCount: 2, skipped: 0, excludedCount: 1 });
  assert.ok(lines.some(line => /Skipped \(not work\):\s+1/.test(line)));
});

test('prepareRepositoryModeIssue applies the exclusions to the combined issue', async () => {
  const prepared = await prepareRepositoryModeIssue({ repository, run: runReturning(calculatorEntries()) });
  assert.deepEqual(
    prepared.allIssues.map(issue => issue.number),
    [247, 254]
  );
  assert.deepEqual(
    prepared.excluded.map(issue => issue.number),
    [258]
  );
  assert.equal(prepared.totalOpen, 3);
  assert.equal(prepared.singleIssue, null);
  assert.deepEqual(parseRequiredClosingReferences(prepared.body), [247, 254]);
  assert.match(prepared.title, /Address all 2 open issues/);

  const withBots = await prepareRepositoryModeIssue({ repository, run: runReturning(calculatorEntries()), selection: { includeBotIssues: true } });
  assert.deepEqual(parseRequiredClosingReferences(withBots.body), [247, 254, 258]);
});

test('one real issue next to a bot report is solved directly', async () => {
  const prepared = await prepareRepositoryModeIssue({ repository, run: runReturning(calculatorEntries().filter(issue => issue.number !== 254)) });
  assert.equal(prepared.singleIssue?.number, 247);
});

test('a repository whose only open issues are status pages has no work', async () => {
  const onlyReport = calculatorEntries().filter(issue => issue.number === 258);
  const result = await resolveRepositoryModeTarget({ url: repository.url, run: runReturning(onlyReport) });
  assert.equal(result.noWork, true);
  assert.match(result.message, /no open issues to work on/);
  assert.match(result.message, /#258/);

  const preflight = await checkRepositoryModeWork({ parsed: { type: 'repo', owner: repository.owner, repo: repository.repo }, run: runReturning(onlyReport) });
  assert.equal(preflight.noWork, true);
  const preflightWithBots = await checkRepositoryModeWork({ parsed: { type: 'repo', owner: repository.owner, repo: repository.repo }, run: runReturning(onlyReport), selection: { includeBotIssues: true } });
  assert.equal(preflightWithBots.noWork, false);
});

const parseSolveArgs = async extraArgs => {
  const saved = process.argv;
  try {
    process.argv = ['node', 'solve.mjs', repository.url, ...extraArgs];
    return await parseArguments();
  } finally {
    process.argv = saved;
  }
};

test('CLI: --skip-issue-labels and --include-bot-issues reach the selection', async () => {
  assert.equal(SOLVE_OPTION_DEFINITIONS['skip-issue-labels']?.type, 'string');
  assert.equal(SOLVE_OPTION_DEFINITIONS['include-bot-issues']?.type, 'boolean');
  assert.deepEqual(repositoryModeSelectionFromArgv(await parseSolveArgs([])), { skipLabels: [...DEFAULT_SKIP_ISSUE_LABELS], includeBotIssues: false });
  assert.deepEqual(repositoryModeSelectionFromArgv(await parseSolveArgs(['--skip-issue-labels', 'report,ci', '--include-bot-issues'])), { skipLabels: ['report', 'ci'], includeBotIssues: true });
});

test('solve.mjs and the Telegram preflight pass the selection options', async () => {
  const solveSource = await readFile(new URL('../src/solve.mjs', import.meta.url), 'utf8');
  assert.match(solveSource, /resolveRepositoryModeTarget\(\{ url: issueUrl, log, selection: repositoryModeSelectionFromArgv\(argv\) \}\)/);
  const botSource = await readFile(new URL('../src/telegram-bot.mjs', import.meta.url), 'utf8');
  assert.match(botSource, /preflightRepositoryTarget\(\{[^}]*selection: repositoryModeSelectionFromArgv\(parsedSolveArgs\)/);
});
