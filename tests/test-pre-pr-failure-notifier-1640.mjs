#!/usr/bin/env node

import assert from 'assert';
import { buildExistingPullRequestFailureComment, buildPrePullRequestFailureActionSection, buildPrePullRequestFailureComment, notifyIssueAboutPrePullRequestFailure, resolvePreExitFailureNotificationTarget, shouldNotifyIssueAboutPrePullRequestFailure } from '../src/solve.pre-pr-failure-notifier.lib.mjs';
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

await test('builds fork-divergence guidance with only the reusable force-with-lease option', async () => {
  const section = buildPrePullRequestFailureActionSection('Repository setup halted - fork divergence requires user decision');

  assert.match(section, /--allow-fork-divergence-resolution-using-force-push-with-lease/);
  assert.match(section, /force-with-lease/);
  assert.doesNotMatch(section, /```bash/);
  assert.doesNotMatch(section, /solve https:\/\/github.com/);
});

await test('targets an existing pull request for nonzero pre-exit failures', async () => {
  const target = resolvePreExitFailureNotificationTarget({
    code: 1,
    globalState: {
      owner: 'ProverCoderAI',
      repo: 'docker-git',
      issueNumber: 274,
      createdPR: { number: 280 },
    },
  });

  assert.deepEqual(target, {
    targetType: 'pr',
    targetNumber: 280,
    owner: 'ProverCoderAI',
    repo: 'docker-git',
    issueNumber: 274,
    prNumber: 280,
  });
});

await test('builds an existing-PR failure comment with fork-divergence option guidance', async () => {
  const body = buildExistingPullRequestFailureComment({
    reason: 'Repository setup halted - fork divergence requires user decision',
    owner: 'ProverCoderAI',
    repo: 'docker-git',
    prNumber: 280,
    issueNumber: 274,
    argv: { tool: 'claude', model: 'opus' },
    rawCommand: 'solve https://github.com/ProverCoderAI/docker-git/pull/280 --tool claude',
  });

  assert.match(body, new RegExp(SOLUTION_DRAFT_FAILED_MARKER));
  assert.match(body, /existing pull request/);
  assert.match(body, /Pull request\*\*: #280/);
  assert.match(body, /Linked issue\*\*: #274/);
  assert.match(body, /--allow-fork-divergence-resolution-using-force-push-with-lease/);
  assert.doesNotMatch(body, /```bash/);
  assert.doesNotMatch(body, /solve https:\/\/github.com\/ProverCoderAI\/docker-git\/pull\/280/);
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
  assert.match(calls[0].failureActionSection, /--allow-fork-divergence-resolution-using-force-push-with-lease/);
  assert.doesNotMatch(calls[0].failureActionSection, /solve https:\/\/github.com/);
  assert.equal(globalState.prePullRequestFailureNotificationPosted, true);
});

await test('uploads logs to the pull request with fork-divergence option guidance', async () => {
  const globalState = {
    owner: 'ProverCoderAI',
    repo: 'docker-git',
    issueNumber: 274,
    createdPR: { number: 280 },
  };
  const calls = [];
  const result = await notifyIssueAboutPrePullRequestFailure({
    code: 1,
    reason: 'Repository setup halted - fork divergence requires user decision',
    argv: { tool: 'claude', model: 'opus', verbose: true },
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
  assert.equal(calls[0].targetType, 'pr');
  assert.equal(calls[0].targetNumber, 280);
  assert.match(calls[0].errorMessage, /continuing pull request #280/);
  assert.match(calls[0].failureActionSection, /--allow-fork-divergence-resolution-using-force-push-with-lease/);
  assert.doesNotMatch(calls[0].failureActionSection, /solve https:\/\/github.com/);
  assert.equal(globalState.pullRequestFailureNotificationPosted, true);
});

await test('falls back to a plain pull request comment when log upload throws', async () => {
  const globalState = {
    owner: 'ProverCoderAI',
    repo: 'docker-git',
    issueNumber: 274,
    createdPR: { number: 280 },
  };
  const postedBodies = [];
  const result = await notifyIssueAboutPrePullRequestFailure({
    code: 1,
    reason: 'Repository setup halted - fork divergence requires user decision',
    argv: { tool: 'claude' },
    globalState,
    shouldAttachLogs: true,
    getLogFile: () => '/tmp/solve.log',
    sanitizeLogContent: async value => value,
    log: async () => {},
    attachLogToGitHub: async () => {
      throw new Error('upload failed');
    },
    postComment: async ({ body, targetNumber }) => {
      postedBodies.push({ body, targetNumber });
      return { ok: true, commentId: '789' };
    },
  });

  assert.deepEqual(result, { notified: true, method: 'comment', commentId: '789' });
  assert.equal(postedBodies.length, 1);
  assert.equal(postedBodies[0].targetNumber, 280);
  assert.match(postedBodies[0].body, /Log attachment was attempted but failed/);
  assert.match(postedBodies[0].body, /--allow-fork-divergence-resolution-using-force-push-with-lease/);
  assert.equal(globalState.pullRequestFailureNotificationPosted, true);
});

await test('falls back to a plain pull request comment when an existing PR fails before logs are attached', async () => {
  const globalState = {
    owner: 'ProverCoderAI',
    repo: 'docker-git',
    issueNumber: 274,
    createdPR: { number: 280 },
  };
  const postedBodies = [];
  const result = await notifyIssueAboutPrePullRequestFailure({
    code: 1,
    reason: 'Repository setup halted - fork divergence requires user decision',
    argv: { tool: 'claude' },
    globalState,
    shouldAttachLogs: false,
    rawCommand: 'solve https://github.com/ProverCoderAI/docker-git/pull/280',
    log: async () => {},
    postComment: async ({ body, targetNumber }) => {
      postedBodies.push({ body, targetNumber });
      return { ok: true, commentId: '456' };
    },
  });

  assert.deepEqual(result, { notified: true, method: 'comment', commentId: '456' });
  assert.equal(postedBodies.length, 1);
  assert.equal(postedBodies[0].targetNumber, 280);
  assert.match(postedBodies[0].body, /existing pull request/);
  assert.match(postedBodies[0].body, /--allow-fork-divergence-resolution-using-force-push-with-lease/);
  assert.equal(globalState.pullRequestFailureNotificationPosted, true);
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
