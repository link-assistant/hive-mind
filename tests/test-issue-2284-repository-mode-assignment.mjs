#!/usr/bin/env node

/**
 * Tests for issue #2284: when `/solve <github-repository-url>` (repository
 * mode) takes on every open issue of a repository, it must assign the current
 * user to all of them — and to the combined issue — so GitHub shows which
 * issues are already in progress.
 *
 * Before the fix only the pull request received an assignee
 * (`gh pr create --assignee`); the combined issue and its sub-issues were left
 * unassigned (see docs/case-studies/issue-2284).
 *
 * The same case study found that a second repository-mode run could not
 * attach issues left over from an earlier, already closed combined issue
 * (HTTP 422 "Sub issue may only have one parent"), so those issues are now
 * moved away from a *closed* parent.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2284
 */

import assert from 'node:assert/strict';

import { buildAddAssigneeApiArgs, buildAssignableCheckApiArgs, buildCurrentUserLoginApiArgs, buildGetParentIssueApiArgs, isAlreadyHasParentError, responseListsAssignee } from '../src/solve.repository-mode.lib.mjs';
import { SUB_ISSUE_ATTACH_BACKOFF_MS, SUB_ISSUE_ATTACH_DELAY_MS, assignIssuesToCurrentUser, attachSubIssues, resolveRepositoryModeTarget } from '../src/solve.repository-mode.run.lib.mjs';
import { buildAddSubIssueApiArgs } from '../src/task.split.lib.mjs';

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

const NO_THROTTLE = Object.freeze({ delayMs: 0 });
const REPOSITORY = Object.freeze({ owner: 'o', repo: 'r' });

const issueEntry = number => ({
  number,
  id: number * 10,
  title: `Issue ${number}`,
  html_url: `https://github.com/o/r/issues/${number}`,
  created_at: `2024-01-${String(number).padStart(2, '0')}T00:00:00Z`,
});

const issueNumberOf = args => {
  const endpoint = args.find(part => /\/issues\/\d+\/assignees$/.test(String(part)));
  return endpoint ? Number(endpoint.match(/\/issues\/(\d+)\/assignees$/)[1]) : null;
};

/**
 * Fake `gh` that behaves like the GitHub API for the calls repository mode
 * makes. `assignees` tracks the resulting assignees per issue number.
 */
const makeFakeGh = ({ openIssues = [], login = 'solver', userFails = false, assignable = true, silentlyDrop = [], failAssign = {}, rateLimitOnce = [], parents = {} } = {}) => {
  const calls = [];
  // Current parent per sub-issue REST id: { number, state }.
  const parentOf = new Map(Object.entries(parents).map(([id, parent]) => [Number(id), parent]));
  const assignees = new Map();
  const rateLimited = new Set();
  const run = async (command, args) => {
    calls.push([command, ...args]);
    if (args[0] === 'api' && String(args[1]).includes('/issues?')) {
      return { code: 0, stdout: JSON.stringify(openIssues), stderr: '' };
    }
    if (args[0] === 'issue' && args[1] === 'create') {
      return { code: 0, stdout: 'https://github.com/o/r/issues/42\n', stderr: '' };
    }
    if (args[0] === 'api' && args[1] === 'user') {
      return userFails ? { code: 1, stdout: '', stderr: 'gh: Bad credentials (HTTP 401)' } : { code: 0, stdout: `${login}\n`, stderr: '' };
    }
    if (args[0] === 'api' && /\/assignees\/[^/]+$/.test(String(args[1]))) {
      return assignable ? { code: 0, stdout: '', stderr: '' } : { code: 1, stdout: '{"message":"Not Found"}', stderr: 'gh: Not Found (HTTP 404)' };
    }
    if (args.some(part => String(part).endsWith('/sub_issues'))) {
      const id = Number(String(args.find(part => String(part).startsWith('sub_issue_id='))).split('=')[1]);
      if (parentOf.has(id) && !args.includes('replace_parent=true')) {
        return { code: 1, stdout: '', stderr: 'gh: An error occurred while adding the sub-issue to the parent issue. Sub issue may only have one parent (HTTP 422)' };
      }
      parentOf.set(id, { number: 42, state: 'open' });
      return { code: 0, stdout: '{}', stderr: '' };
    }
    const parentMatch = String(args[1]).match(/\/issues\/(\d+)\/parent$/);
    if (args[0] === 'api' && parentMatch) {
      const parent = parentOf.get(Number(parentMatch[1]) * 10);
      if (!parent) return { code: 1, stdout: '', stderr: 'gh: Not Found (HTTP 404)' };
      return { code: 0, stdout: JSON.stringify({ number: parent.number, state: parent.state, html_url: `https://github.com/o/r/issues/${parent.number}` }), stderr: '' };
    }
    const number = issueNumberOf(args);
    if (number !== null) {
      if (rateLimitOnce.includes(number) && !rateLimited.has(number)) {
        rateLimited.add(number);
        return { code: 1, stdout: '', stderr: 'gh: You have exceeded a secondary rate limit (HTTP 403)' };
      }
      if (failAssign[number]) return { code: 1, stdout: '', stderr: failAssign[number] };
      const current = assignees.get(number) || ['existing-owner'];
      const value = String(args[args.length - 1]).replace('assignees[]=', '');
      const next = silentlyDrop.includes(number) ? current : [...new Set([...current, value])];
      assignees.set(number, next);
      return { code: 0, stdout: JSON.stringify({ number, assignees: next.map(item => ({ login: item })) }), stderr: '' };
    }
    return { code: 0, stdout: '{}', stderr: '' };
  };
  return { run, calls, assignees, parentOf };
};

// ---------------------------------------------------------------------------
// Reproduction of the reported behavior
// ---------------------------------------------------------------------------

test('reproduction: repository mode assigns the combined issue and every sub-issue', async () => {
  // Mirrors konard/vietnam-accomodation-search#20, which combined #12–#19 and
  // left all nine issues without an assignee.
  const openIssues = [12, 13, 14, 15, 16, 17, 18, 19].map(issueEntry);
  const { run, assignees } = makeFakeGh({ openIssues, login: 'konard' });
  const messages = [];
  const result = await resolveRepositoryModeTarget({ url: 'https://github.com/o/r', run, log: async message => messages.push(message), attachOptions: NO_THROTTLE });

  assert.equal(result.error, undefined);
  assert.equal(result.issue.assignment.login, 'konard');
  assert.deepEqual(
    result.issue.assignment.assigned.map(issue => issue.number),
    [42, 12, 13, 14, 15, 16, 17, 18, 19]
  );
  for (const number of [42, 12, 13, 14, 15, 16, 17, 18, 19]) {
    assert.ok(assignees.get(number).includes('konard'), `#${number} must be assigned`);
  }
  assert.ok(messages.includes('   Issues assigned to konard: 9/9'), messages.join('\n'));
});

test('assignment runs after the sub-issues are attached and keeps existing assignees', async () => {
  const { run, calls, assignees } = makeFakeGh({ openIssues: [issueEntry(1)] });
  await resolveRepositoryModeTarget({ url: 'https://github.com/o/r', run, attachOptions: NO_THROTTLE });

  const lastAttach = calls.findLastIndex(call => call.some(part => String(part).includes('/sub_issues')));
  const firstAssign = calls.findIndex(call => issueNumberOf(call) !== null);
  assert.ok(lastAttach > 0 && firstAssign > lastAttach, 'assignment follows the sub-issue attachment');
  // POST /assignees only adds; nobody already assigned is removed.
  assert.deepEqual(assignees.get(1), ['existing-owner', 'solver']);
});

test('dry run and no-work runs never assign anybody', async () => {
  const dry = makeFakeGh({ openIssues: [issueEntry(1)] });
  await resolveRepositoryModeTarget({ url: 'https://github.com/o/r', run: dry.run, dryRun: true });
  assert.equal(dry.calls.filter(call => issueNumberOf(call) !== null).length, 0);

  const empty = makeFakeGh({ openIssues: [] });
  await resolveRepositoryModeTarget({ url: 'https://github.com/o/r', run: empty.run });
  assert.equal(empty.calls.filter(call => call[2] === 'user').length, 0);
});

// ---------------------------------------------------------------------------
// gh argument builders
// ---------------------------------------------------------------------------

test('argument builders target the documented assignee endpoints', () => {
  assert.deepEqual(buildCurrentUserLoginApiArgs(), ['api', 'user', '--jq', '.login']);
  assert.deepEqual(buildAssignableCheckApiArgs({ owner: 'o', repo: 'r', login: 'me' }), ['api', 'repos/o/r/assignees/me']);
  // `assignees[]=` makes gh send a JSON array, which the endpoint requires.
  assert.deepEqual(buildAddAssigneeApiArgs({ owner: 'o', repo: 'r', number: 7, login: 'me' }), ['api', '-X', 'POST', 'repos/o/r/issues/7/assignees', '-f', 'assignees[]=me']);
  assert.throws(() => buildAddAssigneeApiArgs({ owner: 'o', repo: 'r', number: 0, login: 'me' }), /Invalid issue number/);
  assert.throws(() => buildAssignableCheckApiArgs({ owner: 'o', repo: 'r', login: '' }), /requires/);
});

test('responseListsAssignee only trusts the assignees GitHub actually returned', () => {
  assert.equal(responseListsAssignee('{"assignees":[{"login":"Me"}]}', 'me'), true);
  assert.equal(responseListsAssignee('{"assignees":[{"login":"other"}]}', 'me'), false);
  assert.equal(responseListsAssignee('{}', 'me'), false);
  assert.equal(responseListsAssignee('not json', 'me'), false);
  assert.equal(responseListsAssignee('{"assignees":[{"login":"me"}]}', ''), false);
});

// ---------------------------------------------------------------------------
// Best-effort behavior
// ---------------------------------------------------------------------------

test('a user who cannot be assigned is detected once, without a request per issue', async () => {
  const { run, calls } = makeFakeGh({ assignable: false });
  const messages = [];
  const result = await assignIssuesToCurrentUser({ repository: REPOSITORY, issues: [{ number: 1 }, { number: 2 }], run, log: async message => messages.push(message), delayMs: 0 });
  assert.match(result.skippedReason, /solver cannot be assigned to issues in o\/r/);
  assert.equal(result.assigned.length, 0);
  assert.equal(calls.filter(call => issueNumberOf(call) !== null).length, 0);
  assert.ok(messages.some(message => message.includes('Skipping issue assignment')));
});

test('an unknown current user skips assignment without failing the run', async () => {
  const { run } = makeFakeGh({ openIssues: [issueEntry(1)], userFails: true });
  const messages = [];
  const result = await resolveRepositoryModeTarget({ url: 'https://github.com/o/r', run, log: async message => messages.push(message), attachOptions: NO_THROTTLE });
  assert.equal(result.error, undefined);
  assert.equal(result.issueUrl, 'https://github.com/o/r/issues/42');
  assert.match(result.issue.assignment.skippedReason, /could not determine the current GitHub user: gh: Bad credentials/);
  assert.ok(messages.some(message => message.startsWith('   Issues assigned: none (')));
});

test('an assignee GitHub silently drops is reported as a failure, not a success', async () => {
  // The endpoint answers 201 even when it ignores the assignee, e.g. when the
  // issue already has the maximum of 10 assignees.
  const { run } = makeFakeGh({ silentlyDrop: [2] });
  const result = await assignIssuesToCurrentUser({ repository: REPOSITORY, issues: [{ number: 1 }, { number: 2 }, { number: 3 }], run, delayMs: 0 });
  assert.deepEqual(
    result.assigned.map(issue => issue.number),
    [1, 3]
  );
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].issue.number, 2);
  assert.match(result.failed[0].error, /did not add solver/);
});

test('one failing issue does not stop the others from being assigned', async () => {
  const { run } = makeFakeGh({ failAssign: { 1: 'gh: Issue is locked (HTTP 422)' } });
  const messages = [];
  const result = await assignIssuesToCurrentUser({ repository: REPOSITORY, issues: [{ number: 1 }, { number: 2 }], run, log: async message => messages.push(message), delayMs: 0 });
  assert.deepEqual(
    result.assigned.map(issue => issue.number),
    [2]
  );
  assert.ok(messages.some(message => message.includes('Could not assign solver to #1: gh: Issue is locked')));
});

test('assignment requests are spaced out and rate limits are retried with backoff', async () => {
  const { run } = makeFakeGh({ rateLimitOnce: [2] });
  const sleeps = [];
  const result = await assignIssuesToCurrentUser({ repository: REPOSITORY, issues: [{ number: 1 }, { number: 2 }], run, sleep: async ms => sleeps.push(ms) });
  assert.equal(result.assigned.length, 2);
  assert.deepEqual(sleeps, [SUB_ISSUE_ATTACH_DELAY_MS, SUB_ISSUE_ATTACH_BACKOFF_MS[0]]);
});

test('an empty issue list makes no requests at all', async () => {
  const { run, calls } = makeFakeGh();
  const result = await assignIssuesToCurrentUser({ repository: REPOSITORY, issues: [], run });
  assert.deepEqual(result, { login: null, skippedReason: null, assigned: [], failed: [] });
  assert.equal(calls.length, 0);
});

// ---------------------------------------------------------------------------
// Issues left over from an earlier, closed combined issue
// ---------------------------------------------------------------------------

test('reproduction: leftovers of a closed combined issue are moved to the new one', async () => {
  // Mirrors konard/vietnam-accomodation-search#46: #16 still had the closed #20
  // and #39–#43 the closed #44 as parent, so all six attachments failed.
  const openIssues = [16, 39, 40, 41, 42, 43].map(issueEntry);
  const parents = { 160: { number: 20, state: 'closed' } };
  for (const number of [39, 40, 41, 42, 43]) parents[number * 10] = { number: 44, state: 'closed' };
  const { run, parentOf } = makeFakeGh({ openIssues, parents });
  const messages = [];
  const result = await resolveRepositoryModeTarget({ url: 'https://github.com/o/r', run, log: async message => messages.push(message), attachOptions: NO_THROTTLE });

  assert.equal(result.issue.attached.length, 6);
  assert.equal(result.issue.failed.length, 0);
  assert.deepEqual(
    result.issue.moved.map(entry => entry.previousParent),
    ['https://github.com/o/r/issues/20', ...Array(5).fill('https://github.com/o/r/issues/44')]
  );
  for (const number of [16, 39, 40, 41, 42, 43]) assert.equal(parentOf.get(number * 10).number, 42);
  assert.ok(messages.includes('   Sub-issues attached: 6/6 (6 moved from a closed parent)'), messages.join('\n'));
});

test('an issue that belongs to an open parent is left where it is', async () => {
  const { run, calls } = makeFakeGh({ parents: { 10: { number: 7, state: 'open' } } });
  const result = await attachSubIssues({ parentIssue: { owner: 'o', repo: 'r', number: 42 }, issues: [{ number: 1, id: 10 }], run, delayMs: 0 });
  assert.equal(result.attached.length, 0);
  assert.equal(result.moved.length, 0);
  assert.match(result.failed[0].error, /already belongs to the open parent issue https:\/\/github.com\/o\/r\/issues\/7; leaving it there/);
  assert.equal(calls.filter(call => call.includes('replace_parent=true')).length, 0);
});

test('a parent that cannot be inspected is reported instead of being replaced blindly', async () => {
  const { run, calls } = makeFakeGh();
  const failingRun = async (command, args) => {
    if (args.some(part => String(part).endsWith('/sub_issues'))) {
      calls.push([command, ...args]);
      return { code: 1, stdout: '', stderr: 'gh: Sub issue may only have one parent (HTTP 422)' };
    }
    return run(command, args);
  };
  const result = await attachSubIssues({ parentIssue: { owner: 'o', repo: 'r', number: 42 }, issues: [{ number: 1, id: 10 }], run: failingRun, delayMs: 0 });
  assert.match(result.failed[0].error, /already has a parent issue that could not be inspected: gh: Not Found/);
  assert.equal(calls.filter(call => call.includes('replace_parent=true')).length, 0);
});

test('sub-issue helpers build the documented requests', () => {
  const parentIssue = { owner: 'o', repo: 'r', number: 42 };
  assert.ok(!buildAddSubIssueApiArgs({ parentIssue, subIssueId: 5 }).includes('replace_parent=true'));
  assert.deepEqual(buildAddSubIssueApiArgs({ parentIssue, subIssueId: 5, replaceParent: true }).slice(-2), ['-F', 'replace_parent=true']);
  assert.deepEqual(buildGetParentIssueApiArgs({ owner: 'o', repo: 'r', number: 3, apiVersion: 'v1' }), ['api', 'repos/o/r/issues/3/parent', '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: v1']);
  assert.equal(isAlreadyHasParentError(new Error('gh: An error occurred while adding the sub-issue to the parent issue. Sub issue may only have one parent (HTTP 422)')), true);
  assert.equal(isAlreadyHasParentError(new Error('gh: Not Found (HTTP 404)')), false);
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

console.log(`All ${passed} issue #2284 repository-mode assignment and re-parenting tests passed.`);
