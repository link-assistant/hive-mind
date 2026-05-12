#!/usr/bin/env node

import assert from 'assert';
import { buildPrePullRequestFailureActionSection, buildPrePullRequestFailureComment, notifyIssueAboutPrePullRequestFailure, shouldNotifyIssueAboutPrePullRequestFailure } from '../src/solve.pre-pr-failure-notifier.lib.mjs';
import { resetTrackedToolCommentIds, SOLUTION_DRAFT_FAILED_MARKER } from '../src/tool-comments.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    resetTrackedToolCommentIds();
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`❌ ${name}: ${error.message}`);
    failed++;
  }
}

await test('notifies only nonzero exits with known issue and no PR', async () => {
  assert.equal(shouldNotifyIssueAboutPrePullRequestFailure({ code: 1, globalState: { owner: 'o', repo: 'r', issueNumber: 1 } }), true);
  assert.equal(shouldNotifyIssueAboutPrePullRequestFailure({ code: 0, globalState: { owner: 'o', repo: 'r', issueNumber: 1 } }), false);
  assert.equal(shouldNotifyIssueAboutPrePullRequestFailure({ code: 1, globalState: { owner: 'o', repo: 'r' } }), false);
  assert.equal(shouldNotifyIssueAboutPrePullRequestFailure({ code: 1, globalState: { owner: 'o', repo: 'r', issueNumber: 1, createdPR: { number: 2 } } }), false);
});

await test('builds a pre-PR failure comment with the tracked failure marker', async () => {
  const body = buildPrePullRequestFailureComment({
    reason: 'Repository setup halted - fork divergence requires user decision',
    owner: 'xierongchuan',
    repo: 'TaskMateServer',
    issueNumber: 34,
    argv: { tool: 'codex', model: 'gpt-5.4' },
    rawCommand: 'solve https://github.com/xierongchuan/TaskMateServer/issues/34 --tool codex',
  });

  assert.match(body, new RegExp(SOLUTION_DRAFT_FAILED_MARKER));
  assert.match(body, /stopped before creating a pull request/);
  assert.match(body, /fork divergence requires user decision/);
  assert.match(body, /xierongchuan\/TaskMateServer/);
  assert.match(body, /gpt-5\.4/);
  assert.match(body, /ask a Hive Mind administrator/);
  assert.match(body, /Administrator-only CLI details/);
  assert.doesNotMatch(body, /```bash/);
  assert.doesNotMatch(body, /solve https:\/\/github.com\/xierongchuan\/TaskMateServer\/issues\/34/);
});

await test('builds fork-specific user guidance without administrator commands', async () => {
  const section = buildPrePullRequestFailureActionSection('Auto-recovery failed - could not delete problematic repository');

  assert.match(section, /affected fork or repository/);
  assert.match(section, /repository deletion permission/);
  assert.match(section, /Hive Mind does not rely on that permission by default/);
  assert.doesNotMatch(section, /gh auth refresh/);
  assert.doesNotMatch(section, /gh repo delete/);
});

await test('uploads logs to the issue when attach-logs is enabled', async () => {
  const globalState = { owner: 'owner', repo: 'repo', issueNumber: 42 };
  const calls = [];
  const result = await notifyIssueAboutPrePullRequestFailure({
    code: 1,
    reason: 'Repository setup halted - fork divergence requires user decision',
    argv: { tool: 'codex', model: 'gpt-5.4', verbose: true },
    globalState,
    shouldAttachLogs: true,
    getLogFile: () => '/tmp/solve.log',
    sanitizeLogContent: async value => value,
    log: async () => {},
    attachLogToGitHub: async options => {
      calls.push(options);
      return true;
    },
    postComment: async () => {
      throw new Error('fallback comment should not be posted after successful log upload');
    },
  });

  assert.deepEqual(result, { notified: true, method: 'log-upload' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].targetType, 'issue');
  assert.equal(calls[0].targetNumber, 42);
  assert.match(calls[0].errorMessage, /before creating a pull request/);
  assert.equal(globalState.prePullRequestFailureNotificationPosted, true);
});

await test('falls back to a plain issue comment when log upload is unavailable', async () => {
  const globalState = { owner: 'owner', repo: 'repo', issueNumber: 42 };
  const postedBodies = [];
  const result = await notifyIssueAboutPrePullRequestFailure({
    code: 1,
    reason: 'No PR available',
    argv: { tool: 'claude' },
    globalState,
    shouldAttachLogs: false,
    rawCommand: 'solve https://github.com/owner/repo/issues/42',
    log: async () => {},
    postComment: async ({ body, targetNumber }) => {
      postedBodies.push({ body, targetNumber });
      return { ok: true, commentId: '123' };
    },
  });

  assert.deepEqual(result, { notified: true, method: 'comment', commentId: '123' });
  assert.equal(postedBodies.length, 1);
  assert.equal(postedBodies[0].targetNumber, 42);
  assert.match(postedBodies[0].body, /No PR available/);
  assert.equal(globalState.prePullRequestFailureNotificationPosted, true);
});

console.log(`\nPre-PR failure notifier tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
