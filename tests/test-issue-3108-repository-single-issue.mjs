#!/usr/bin/env node

/**
 * Regression coverage for issue #3108: `/solve <repository-url>` on a
 * repository with exactly one open issue solves that issue directly instead of
 * creating a combined issue whose only sub-issue is that same issue.
 *
 * Reproduction (2026-10-11): `/codex https://github.com/link-foundation/lino-objects-codec`
 * found only #68 open and still created #69 "Address the single open issue in
 * link-foundation/lino-objects-codec", with #68 as its single sub-issue.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/3108
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { selectSingleIssueTarget } from '../src/solve.repository-mode.lib.mjs';
import { prepareRepositoryModeIssue, resolveRepositoryModeTarget } from '../src/solve.repository-mode.run.lib.mjs';
import { checkRepositoryModeWork, preflightRepositoryTarget, redirectRepositoryArgsToSingleIssue, replyIfRepositoryHasNoWork } from '../src/telegram-solve-repository-preflight.lib.mjs';
import { parseGitHubUrl } from '../src/github-url-parser.lib.mjs';

const OWNER = 'link-foundation';
const REPO = 'lino-objects-codec';
const REPOSITORY_URL = `https://github.com/${OWNER}/${REPO}`;
const repository = { owner: OWNER, repo: REPO, fullName: `${OWNER}/${REPO}`, url: REPOSITORY_URL };

function issueEntry(number, { pullRequest = false, createdAt = '2026-10-11T11:43:19Z' } = {}) {
  return {
    id: number * 1000,
    number,
    title: `Issue ${number}`,
    html_url: `${REPOSITORY_URL}/${pullRequest ? 'pull' : 'issues'}/${number}`,
    created_at: createdAt,
    ...(pullRequest ? { pull_request: { url: `https://api.github.com/repos/${OWNER}/${REPO}/pulls/${number}` } } : {}),
  };
}

/** Fake `gh`: lists `entries`, and records every call so tests can assert nothing was created. */
function fakeGh(entries) {
  const calls = [];
  const run = async (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === 'api' && String(args[1]).includes('/issues?')) return { code: 0, stdout: JSON.stringify(entries), stderr: '' };
    if (args[0] === 'issue' && args[1] === 'create') return { code: 0, stdout: `${REPOSITORY_URL}/issues/69\n`, stderr: '' };
    return { code: 0, stdout: '{}', stderr: '' };
  };
  const writes = () => calls.filter(call => (call[1] === 'issue' && call[2] === 'create') || call.some(part => String(part).includes('/sub_issues')));
  return { run, calls, writes };
}

const NO_THROTTLE = Object.freeze({ delayMs: 0 });

test('reproduction: a single open issue is solved directly, without creating a combined issue', async () => {
  const gh = fakeGh([issueEntry(68)]);
  const messages = [];
  const result = await resolveRepositoryModeTarget({ url: REPOSITORY_URL, run: gh.run, log: async message => messages.push(message), attachOptions: NO_THROTTLE });

  assert.equal(result.handled, true);
  assert.equal(result.error, undefined);
  assert.equal(result.noWork, undefined);
  assert.equal(result.singleIssue, true);
  assert.equal(result.issueUrl, `${REPOSITORY_URL}/issues/68`);
  // Same as `/solve <issue-url>`: no repository-mode overrides.
  assert.deepEqual(result.argvOverrides, {});
  assert.deepEqual(gh.writes(), [], 'no combined issue and no sub-issue attachment may be created');
  assert.equal(gh.calls.length, 1, 'only the open-issue listing is needed');
  assert.ok(messages.some(message => message.includes('Only one open issue: #68')));
});

test('pull requests do not count: one issue plus open pull requests is still a single issue', async () => {
  const gh = fakeGh([issueEntry(67, { pullRequest: true }), issueEntry(68), issueEntry(70, { pullRequest: true })]);
  const result = await resolveRepositoryModeTarget({ url: REPOSITORY_URL, run: gh.run, attachOptions: NO_THROTTLE });
  assert.equal(result.singleIssue, true);
  assert.equal(result.issueUrl, `${REPOSITORY_URL}/issues/68`);
  assert.deepEqual(gh.writes(), []);
});

test('the single-issue shortcut also applies to a dry run, since it creates nothing either way', async () => {
  const gh = fakeGh([issueEntry(68)]);
  const result = await resolveRepositoryModeTarget({ url: REPOSITORY_URL, run: gh.run, dryRun: true });
  assert.equal(result.singleIssue, true);
  assert.equal(result.issueUrl, `${REPOSITORY_URL}/issues/68`);
  assert.deepEqual(gh.writes(), []);
});

test('two open issues still create a combined issue with both as sub-issues', async () => {
  const gh = fakeGh([issueEntry(68), issueEntry(71, { createdAt: '2026-10-11T15:00:00Z' })]);
  const result = await resolveRepositoryModeTarget({ url: REPOSITORY_URL, run: gh.run, attachOptions: NO_THROTTLE });
  assert.equal(result.singleIssue, undefined);
  assert.equal(result.issueUrl, `${REPOSITORY_URL}/issues/69`);
  assert.equal(result.issue.attached.length, 2);
  assert.equal(result.argvOverrides.ensureAllSubIssuesAddressed, true);
});

test('no open issues is still the #2266 no-work result, not a single issue', async () => {
  const gh = fakeGh([issueEntry(70, { pullRequest: true })]);
  const result = await resolveRepositoryModeTarget({ url: REPOSITORY_URL, run: gh.run });
  assert.equal(result.noWork, true);
  assert.equal(result.singleIssue, undefined);
});

test('selectSingleIssueTarget returns the issue only when there is exactly one', () => {
  assert.equal(selectSingleIssueTarget({ repository, issues: [] }), null);
  assert.equal(selectSingleIssueTarget({ repository, issues: [{ number: 1 }, { number: 2 }] }), null);
  assert.equal(selectSingleIssueTarget({ repository, issues: null }), null);
  assert.deepEqual(selectSingleIssueTarget({ repository, issues: [{ number: 68, url: `${REPOSITORY_URL}/issues/68` }] }), { number: 68, url: `${REPOSITORY_URL}/issues/68` });
  // An entry without html_url still yields a usable issue URL.
  assert.equal(selectSingleIssueTarget({ repository, issues: [{ number: 68, url: '' }] }).url, `${REPOSITORY_URL}/issues/68`);
  assert.equal(selectSingleIssueTarget({ repository: { owner: OWNER, repo: REPO }, issues: [{ number: 68 }] }).url, `${REPOSITORY_URL}/issues/68`);
});

test('prepareRepositoryModeIssue exposes the single issue for every caller', async () => {
  const single = await prepareRepositoryModeIssue({ repository, run: fakeGh([issueEntry(68)]).run });
  assert.equal(single.singleIssue.number, 68);
  const many = await prepareRepositoryModeIssue({ repository, run: fakeGh([issueEntry(68), issueEntry(71)]).run });
  assert.equal(many.singleIssue, null);
});

test('the issue — not the capped native-attachment list — decides: 101 open issues is not a single issue', async () => {
  const entries = Array.from({ length: 101 }, (_, index) => issueEntry(index + 1));
  const prepared = await prepareRepositoryModeIssue({ repository, run: fakeGh(entries).run, limit: 1 });
  assert.equal(prepared.selected.length, 1);
  assert.equal(prepared.singleIssue, null);
});

// ---------------------------------------------------------------------------
// Telegram: echo and launch the issue URL instead of the repository URL
// ---------------------------------------------------------------------------

const repositoryParsed = parseGitHubUrl(REPOSITORY_URL);

test('Telegram preflight reports the single issue and does not reply', async () => {
  const replies = [];
  const preflight = await preflightRepositoryTarget({ ctx: { message: { message_id: 1 } }, parsed: repositoryParsed, locale: 'en', run: fakeGh([issueEntry(68)]).run, reply: async (...args) => replies.push(args) });
  assert.equal(preflight.repliedNoWork, false);
  assert.equal(preflight.singleIssue.url, `${REPOSITORY_URL}/issues/68`);
  assert.deepEqual(replies, []);

  const work = await checkRepositoryModeWork({ parsed: repositoryParsed, run: fakeGh([issueEntry(68)]).run });
  assert.equal(work.singleIssue.number, 68);
});

test('Telegram preflight keeps the #2266 no-work reply and the boolean wrapper', async () => {
  const replies = [];
  const params = { ctx: { message: { message_id: 1 } }, parsed: repositoryParsed, locale: 'en', run: fakeGh([]).run, translate: key => key, reply: async (...args) => replies.push(args) };
  assert.deepEqual(await preflightRepositoryTarget(params), { repliedNoWork: true, singleIssue: null });
  assert.equal(await replyIfRepositoryHasNoWork(params), true);
  assert.equal(replies.length, 2);
  assert.equal(await replyIfRepositoryHasNoWork({ ...params, run: fakeGh([issueEntry(68)]).run }), false);
});

test('Telegram preflight failures report no single issue, so the CLI decides', async () => {
  const preflight = await preflightRepositoryTarget({ ctx: { message: { message_id: 1 } }, parsed: repositoryParsed, locale: 'en', run: async () => ({ code: 1, stdout: '', stderr: 'GitHub unavailable' }) });
  assert.deepEqual(preflight, { repliedNoWork: false, singleIssue: null });
});

test('the command from the issue is rewritten to the issue URL, keeping every option', () => {
  const args = [REPOSITORY_URL, '--think', 'xhigh', '--auto-merge', '--tool', 'codex', '--attach-logs', '--verbose'];
  const redirect = redirectRepositoryArgsToSingleIssue({ args, parsed: repositoryParsed, singleIssue: { number: 68, url: `${REPOSITORY_URL}/issues/68` } });
  assert.deepEqual(redirect.args, [`${REPOSITORY_URL}/issues/68`, '--think', 'xhigh', '--auto-merge', '--tool', 'codex', '--attach-logs', '--verbose']);
  assert.equal(redirect.parsed.type, 'issue');
  assert.equal(redirect.parsed.number, 68);
  assert.equal(redirect.parsed.canonical, `${REPOSITORY_URL}/issues/68`);
  assert.deepEqual(args[0], REPOSITORY_URL, 'the input array is not mutated');
});

test('the redirect is skipped when it cannot be applied safely', () => {
  const singleIssue = { number: 68, url: `${REPOSITORY_URL}/issues/68` };
  assert.equal(redirectRepositoryArgsToSingleIssue({ args: ['--verbose'], parsed: repositoryParsed, singleIssue }), null, 'repository URL not found in args');
  assert.equal(redirectRepositoryArgsToSingleIssue({ args: [REPOSITORY_URL], parsed: repositoryParsed, singleIssue: { number: 68, url: 'not a url' } }), null);
  assert.equal(redirectRepositoryArgsToSingleIssue({ args: [REPOSITORY_URL], parsed: repositoryParsed, singleIssue: null }), null);
});

test('Telegram applies the redirect after the no-work check and before queueing or launching', async () => {
  const source = await readFile(new URL('../src/telegram-bot.mjs', import.meta.url), 'utf8');
  const preflight = source.indexOf('const repositoryPreflight = await preflightRepositoryTarget');
  const redirect = source.indexOf('redirectRepositoryArgsToSingleIssue({', preflight);
  const normalizedUrl = source.indexOf('const normalizedUrl = validation.parsed.canonical', redirect);
  const queueCheck = source.indexOf('solveQueue.findByUrl(normalizedUrl)', redirect);
  const launch = source.indexOf("executeAndUpdateMessage(ctx, startingMessage, 'solve'", redirect);

  assert.ok(preflight > 0, 'the repository preflight must be wired into /solve');
  assert.ok(redirect > preflight, 'the single-issue redirect must follow the preflight');
  assert.ok(normalizedUrl > redirect, 'the echoed URL must be computed from the redirected target');
  assert.ok(queueCheck > redirect, 'duplicate detection must use the issue URL');
  assert.ok(launch > redirect, 'the session must receive the redirected arguments');
});
