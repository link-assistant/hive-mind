#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #3684: kill recovery of one
 * `/solve https://github.com/link-foundation/browser-commander` run created
 * three combined ("umbrella") issues.
 *
 * Reproduction (2026-10-21), data saved under docs/case-studies/issue-3684/data:
 *   - run 1 found #179 and #180 and created #181 (pull request #182), then was
 *     killed by the container OOM killer;
 *   - recovery attempt 1 replayed the repository URL, counted #181 as a third
 *     open issue and created #183 (pull request #184);
 *   - recovery attempt 2 counted #181 and #183 too and created #185 (pull
 *     request #186).
 *
 * A combined issue of an earlier run is now never work, and an open combined
 * issue that already requires every open issue is reused instead of creating
 * another one. Every other step (scope update, sub-issue attachment) is done
 * only when it was not done yet.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

import { REPOSITORY_MODE_COMBINED_ISSUE_REASON, buildCombinedIssueBody, findRepositoryModeIssues, getRepositoryModeExclusionReason, parseRequiredClosingReferences, selectOldestOpenIssues, selectReusableRepositoryModeIssue } from '../src/solve.repository-mode.lib.mjs';
import { attachSubIssues, prepareRepositoryModeIssue, resolveRepositoryModeTarget } from '../src/solve.repository-mode.run.lib.mjs';
import { checkRepositoryModeWork } from '../src/telegram-solve-repository-preflight.lib.mjs';
import { buildListSubIssuesApiArgs } from '../src/task.split.lib.mjs';

const OWNER = 'link-foundation';
const REPO = 'browser-commander';
const REPOSITORY_URL = `https://github.com/${OWNER}/${REPO}`;
const repository = { owner: OWNER, repo: REPO, fullName: `${OWNER}/${REPO}`, url: REPOSITORY_URL };
const NO_THROTTLE = Object.freeze({ delayMs: 0 });

const readIssue = async number => JSON.parse(await readFile(new URL(`../docs/case-studies/issue-3684/data/issue-${number}.json`, import.meta.url), 'utf8'));
const real = Object.fromEntries(await Promise.all([179, 180, 181, 183, 185].map(async number => [number, await readIssue(number)])));
const nums = list => list.map(issue => issue.number);

/**
 * A fake GitHub that keeps state between runs: open issues, created and edited
 * issues, and the sub-issue relation (one parent per issue, as on GitHub).
 */
function fakeGitHub(initialIssues, { nextNumber = 300, listSubIssuesFails = false } = {}) {
  const issues = new Map(initialIssues.map(issue => [issue.number, { ...issue, state: issue.state || 'open' }]));
  const parentOf = new Map();
  const calls = [];
  let next = nextNumber;
  const ok = stdout => ({ code: 0, stdout: typeof stdout === 'string' ? stdout : JSON.stringify(stdout), stderr: '' });
  const argAfter = (args, flag) => args[args.indexOf(flag) + 1];

  const run = async (command, args) => {
    calls.push([command, ...args]);
    const endpoint = String(args[1] || '');
    if (args[0] === 'api' && endpoint.includes('/issues?state=open')) {
      return ok([...issues.values()].filter(issue => issue.state === 'open'));
    }
    if (args[0] === 'issue' && args[1] === 'create') {
      const number = next++;
      const body = await readFile(argAfter(args, '--body-file'), 'utf8');
      issues.set(number, { number, id: number * 1000, title: argAfter(args, '--title'), body, html_url: `${REPOSITORY_URL}/issues/${number}`, created_at: new Date(Date.UTC(2026, 9, 21, 16, 0, number % 60)).toISOString(), user: { login: 'konard', type: 'User' }, labels: [], state: 'open' });
      return ok(`${REPOSITORY_URL}/issues/${number}\n`);
    }
    if (args[0] === 'issue' && args[1] === 'edit') {
      const issue = issues.get(Number(args[2]));
      issue.title = argAfter(args, '--title');
      issue.body = await readFile(argAfter(args, '--body-file'), 'utf8');
      return ok('');
    }
    const subIssues = endpoint.match(/issues\/(\d+)\/sub_issues/);
    if (args[0] === 'api' && subIssues && !args.includes('POST')) {
      if (listSubIssuesFails) return { code: 1, stdout: '', stderr: 'HTTP 502' };
      const parent = Number(subIssues[1]);
      return ok([[...parentOf].filter(([, p]) => p === parent).map(([child]) => issues.get(child))]);
    }
    const postSubIssue = args.find(part => /issues\/\d+\/sub_issues$/.test(String(part)));
    if (args.includes('POST') && postSubIssue) {
      const parent = Number(postSubIssue.match(/issues\/(\d+)\/sub_issues/)[1]);
      const id = Number(String(args[args.length - 1]).split('=')[1]);
      const child = [...issues.values()].find(issue => issue.id === id);
      if (parentOf.has(child.number) && !args.includes('replace_parent=true')) return { code: 1, stdout: '', stderr: 'HTTP 422: Sub issue may only have one parent' };
      parentOf.set(child.number, parent);
      return ok('{}');
    }
    const parentRead = endpoint.match(/issues\/(\d+)\/parent$/);
    if (args[0] === 'api' && parentRead) {
      const parent = parentOf.get(Number(parentRead[1]));
      return ok(parent ? { ...issues.get(parent), html_url: `${REPOSITORY_URL}/issues/${parent}` } : null);
    }
    throw new Error(`unexpected gh call: ${args.join(' ')}`);
  };

  const created = () => calls.filter(call => call[1] === 'issue' && call[2] === 'create');
  const edited = () => calls.filter(call => call[1] === 'issue' && call[2] === 'edit');
  const attachments = () => calls.filter(call => call.includes('POST'));
  return { run, calls, issues, parentOf, created, edited, attachments };
}

const openIssue = number => ({ ...real[number], state: 'open' });
const resolve = (gh, extra = {}) => resolveRepositoryModeTarget({ url: REPOSITORY_URL, run: gh.run, attachOptions: NO_THROTTLE, ...extra });

test('the saved data really is the incident: #181, #183 and #185 are combined issues listing the earlier ones', () => {
  assert.deepEqual(parseRequiredClosingReferences(real[181].body), [179, 180]);
  assert.deepEqual(parseRequiredClosingReferences(real[183].body), [179, 180, 181]);
  assert.deepEqual(parseRequiredClosingReferences(real[185].body), [179, 180, 181, 183]);
});

test('reproduction: a combined issue of an earlier run is not work', () => {
  // Before recovery attempt 1: #179, #180 and the combined issue #181 were open.
  const { selected, excluded } = selectOldestOpenIssues([openIssue(179), openIssue(180), openIssue(181)]);
  assert.deepEqual(nums(selected), [179, 180], '#181 was selected as a third issue, so a new combined issue was created');
  assert.deepEqual(nums(excluded), [181]);
  assert.equal(excluded[0].reason, REPOSITORY_MODE_COMBINED_ISSUE_REASON);
  assert.equal(getRepositoryModeExclusionReason(real[183]), REPOSITORY_MODE_COMBINED_ISSUE_REASON);
  assert.equal(getRepositoryModeExclusionReason(real[179]), null);
});

test('reproduction: recovery attempt 1 reuses #181 instead of creating #183', async () => {
  const gh = fakeGitHub([openIssue(179), openIssue(180), openIssue(181)]);
  gh.parentOf.set(179, 181);
  gh.parentOf.set(180, 181);
  const messages = [];
  const result = await resolve(gh, { log: async message => messages.push(message) });

  assert.equal(result.error, undefined);
  assert.equal(result.reused, true);
  assert.equal(result.issueUrl, `${REPOSITORY_URL}/issues/181`);
  assert.deepEqual(gh.created(), [], 'no new combined issue');
  assert.deepEqual(gh.edited(), [], '#181 already requires #179 and #180: nothing to update');
  assert.deepEqual(gh.attachments(), [], '#179 and #180 already are sub-issues of #181');
  assert.equal(result.argvOverrides.ensureAllSubIssuesAddressed, true, 'still solved as a repository-mode issue');
  assert.ok(messages.some(message => message.includes('Reusing the open combined issue #181')));
  assert.ok(messages.some(message => message.includes(REPOSITORY_MODE_COMBINED_ISSUE_REASON)));
});

test('reproduction: with #181 and #183 both open, recovery attempt 2 reuses one of them instead of creating #185', async () => {
  const gh = fakeGitHub([openIssue(179), openIssue(180), openIssue(181), openIssue(183)]);
  gh.parentOf.set(179, 183);
  gh.parentOf.set(180, 183);
  gh.parentOf.set(181, 183);
  const result = await resolve(gh);
  assert.equal(result.reused, true);
  assert.equal(result.issueUrl, `${REPOSITORY_URL}/issues/183`, 'the newest combined issue that requires every open issue');
  assert.deepEqual(gh.created(), []);
  assert.deepEqual(gh.attachments(), []);
});

test('any number of repeated runs create exactly one combined issue and attach every issue once', async () => {
  const gh = fakeGitHub([openIssue(179), openIssue(180)]);
  const urls = [];
  for (let run = 0; run < 4; run++) urls.push((await resolve(gh)).issueUrl);

  assert.equal(gh.created().length, 1);
  assert.deepEqual(new Set(urls).size, 1, `every run must land on the same combined issue: ${urls.join(', ')}`);
  assert.equal(gh.attachments().length, 2, 'each issue is attached once');
  assert.deepEqual(gh.edited(), []);
  assert.equal(gh.parentOf.get(179), 300);
  assert.equal(gh.parentOf.get(180), 300);
});

test('an issue opened after the combined issue updates its scope instead of creating another one', async () => {
  const gh = fakeGitHub([openIssue(179), openIssue(180), openIssue(181)]);
  gh.parentOf.set(179, 181);
  gh.parentOf.set(180, 181);
  gh.issues.set(190, { number: 190, id: 190000, title: 'A new bug', body: 'Steps...', html_url: `${REPOSITORY_URL}/issues/190`, created_at: '2026-10-21T19:00:00Z', user: { login: 'konard', type: 'User' }, labels: [], state: 'open' });
  const messages = [];
  const result = await resolve(gh, { log: async message => messages.push(message) });

  assert.equal(result.issueUrl, `${REPOSITORY_URL}/issues/181`);
  assert.equal(result.issue.updated, true);
  assert.deepEqual(gh.created(), []);
  assert.equal(gh.edited().length, 1);
  assert.deepEqual(parseRequiredClosingReferences(gh.issues.get(181).body), [179, 180, 190]);
  assert.doesNotMatch(gh.issues.get(181).body, /#181 /, 'the combined issue does not list itself');
  assert.match(gh.issues.get(181).title, /Address all 3 open issues/);
  assert.equal(gh.attachments().length, 1, 'only the new issue is attached');
  assert.equal(gh.parentOf.get(190), 181);
  assert.ok(messages.some(message => message.includes('updating its scope')));

  // The next run finds nothing left to do.
  const callsBefore = gh.calls.length;
  await resolve(gh);
  assert.equal(gh.edited().length, 1);
  assert.equal(gh.attachments().length, 1);
  assert.equal(gh.calls.length - callsBefore, 2, 'only the open-issue and sub-issue listings');
});

test('a single open issue that a combined issue already requires goes to that combined issue', async () => {
  // #180 was fixed, #179 is still open: the run that started the pull request must continue it.
  const gh = fakeGitHub([openIssue(179), openIssue(181)]);
  gh.parentOf.set(179, 181);
  const result = await resolve(gh);
  assert.equal(result.singleIssue, undefined);
  assert.equal(result.issueUrl, `${REPOSITORY_URL}/issues/181`);
  assert.deepEqual(gh.created(), []);
});

test('a single open issue no combined issue requires is still solved directly (issue #3108)', async () => {
  const gh = fakeGitHub([openIssue(181), { ...openIssue(179), number: 195, id: 195000, html_url: `${REPOSITORY_URL}/issues/195` }]);
  const result = await resolve(gh);
  assert.equal(result.singleIssue, true);
  assert.equal(result.issueUrl, `${REPOSITORY_URL}/issues/195`);
  assert.deepEqual(gh.created(), []);
  assert.deepEqual(gh.edited(), []);
});

test('only a leftover combined issue open is no work, not a new combined issue', async () => {
  // browser-commander today: #185 is open, every issue it lists is closed.
  const gh = fakeGitHub([openIssue(185)]);
  const result = await resolve(gh);
  assert.equal(result.noWork, true);
  assert.match(result.message, /#185/);
  assert.deepEqual(gh.created(), []);
});

test('the Telegram preflight agrees with the CLI: no single-issue redirect when a combined issue requires the issue', async () => {
  const gh = fakeGitHub([openIssue(179), openIssue(181)]);
  const work = await checkRepositoryModeWork({ parsed: { type: 'repo', owner: OWNER, repo: REPO }, run: gh.run });
  assert.equal(work.noWork, false);
  assert.equal(work.singleIssue, null);
});

test('a dry run reports the reuse and changes nothing', async () => {
  const gh = fakeGitHub([openIssue(179), openIssue(180), openIssue(181)]);
  const result = await resolve(gh, { dryRun: true });
  assert.equal(result.prepared.reuse.issue.number, 181);
  assert.equal(result.prepared.reuse.covers, true);
  assert.equal(gh.calls.length, 1);
});

test('a failed sub-issue listing still attaches nothing twice', async () => {
  const gh = fakeGitHub([openIssue(179), openIssue(180), openIssue(181)], { listSubIssuesFails: true });
  gh.parentOf.set(179, 181);
  gh.parentOf.set(180, 181);
  const result = await resolve(gh);
  assert.equal(result.error, undefined);
  assert.equal(result.issue.attached.length, 2, 'both are recognized as attached already');
  assert.equal(result.issue.failed.length, 0);
  assert.equal(result.issue.moved.length, 0, 'never "moved" to the parent it already has');
  assert.deepEqual(nums(gh.calls.filter(call => call.includes('replace_parent=true'))), []);
});

test('attachSubIssues treats "already a sub-issue of this parent" as done', async () => {
  const gh = fakeGitHub([openIssue(179), openIssue(181)]);
  gh.parentOf.set(179, 181);
  const result = await attachSubIssues({ parentIssue: { owner: OWNER, repo: REPO, number: 181 }, issues: [{ number: 179, id: real[179].id }], run: gh.run, delayMs: 0 });
  assert.deepEqual(nums(result.attached), [179]);
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.moved, []);
});

test('selectReusableRepositoryModeIssue prefers the newest covering combined issue, else the newest one', () => {
  const candidates = findRepositoryModeIssues([openIssue(181), openIssue(183), openIssue(179)]);
  assert.deepEqual(nums(candidates), [181, 183]);
  assert.equal(selectReusableRepositoryModeIssue({ candidates, issues: [{ number: 179 }, { number: 180 }] }).issue.number, 183);
  const update = selectReusableRepositoryModeIssue({ candidates, issues: [{ number: 179 }, { number: 190 }] });
  assert.equal(update.issue.number, 183);
  assert.equal(update.covers, false);
  assert.deepEqual(update.missing, [190]);
  assert.equal(selectReusableRepositoryModeIssue({ candidates, issues: [{ number: 190 }] }), null, 'a single uncovered issue is solved directly');
  assert.equal(selectReusableRepositoryModeIssue({ candidates: [], issues: [{ number: 179 }, { number: 180 }] }), null);
});

test('the prepared body for a reused combined issue never lists it as an issue left out', async () => {
  const gh = fakeGitHub([openIssue(179), openIssue(180), openIssue(181), openIssue(183)]);
  const prepared = await prepareRepositoryModeIssue({ repository, run: gh.run });
  assert.equal(prepared.reuse.issue.number, 183);
  assert.doesNotMatch(prepared.body, /- #183 /);
  assert.match(prepared.body, /- #181 .* — combined issue generated by an earlier/);
  assert.deepEqual(parseRequiredClosingReferences(prepared.body), [179, 180]);
  assert.equal(buildCombinedIssueBody({ repository, issues: prepared.allIssues, totalOpen: 3 }).includes('Fixes #181'), false);
});

test('the sub-issue listing reads every page', () => {
  const args = buildListSubIssuesApiArgs({ owner: OWNER, repo: REPO, number: 181 });
  assert.ok(args.includes('--paginate'));
  assert.ok(args.includes('--slurp'));
  assert.match(args[1], /repos\/link-foundation\/browser-commander\/issues\/181\/sub_issues/);
});

test('--verbose traces the reuse decision of a --resume replay', async () => {
  const gh = fakeGitHub([openIssue(179), openIssue(180), openIssue(181)]);
  gh.parentOf.set(179, 181);
  gh.parentOf.set(180, 181);
  const messages = [];
  await resolve(gh, { log: async message => messages.push(message), verbose: true, resumeId: 'd85c9a23-5c61-45c3-b1e1-7d099f9ef893' });
  assert.ok(messages.some(message => message.includes('replayed with --resume d85c9a23-5c61-45c3-b1e1-7d099f9ef893') && message.includes('#181 (requires #179, #180)')));
  assert.ok(messages.some(message => message.includes('decision: reuse #181 (covers every issue)')));
  const quiet = [];
  await resolve(gh, { log: async message => quiet.push(message) });
  assert.equal(
    quiet.some(message => message.includes('[VERBOSE]')),
    false
  );
});
