#!/usr/bin/env node
/**
 * Issue #2397: one failure must produce one failure comment.
 *
 * On konard/vietnam-accomodation-search#76 a Codex run that hit "The 'gpt-6.1-sol'
 * model is not supported when using Codex with a ChatGPT account." (the ChatGPT Pro
 * plan had lapsed) posted three "🚨 Solution Draft Failed" comments in five seconds:
 *
 *   1. solve.mjs failure path → attachLogToGitHub → upload failed → "Log Upload Failed"
 *      failure report posted, but attachLogToGitHub returned false, so no flag was set;
 *   2. exit handler → notifyIssueAboutPrePullRequestFailure → attachLogToGitHub again →
 *      a second "Log Upload Failed" failure report, again returning false;
 *   3. the notifier then posted its own fallback failure comment.
 *
 * The fakes below reproduce that sequence with the real postTrackedComment, so the
 * per-target registry is exercised exactly as in production.
 */

import assert from 'assert';
import { notifyIssueAboutPrePullRequestFailure, resolvePreExitFailureNotificationTarget } from '../src/solve.pre-pr-failure-notifier.lib.mjs';
import { buildLogUploadFailureComment } from '../src/log-upload-failure.lib.mjs';
import { isFailureAlreadyReportedOnTarget, isFailureReportCommentBody, postTrackedComment, resetTrackedToolCommentIds } from '../src/tool-comments.lib.mjs';

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

const CODEX_ERROR = "CODEX execution failed with The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.";

/** A command-stream `$` stand-in that records every `gh api ... comments` POST. */
const createFakeGh = () => {
  const posts = [];
  let nextId = 5914889717;
  const $ =
    (options = {}) =>
    (strings, ...values) => {
      const command = strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), '');
      const body = JSON.parse(options.stdin || '{}').body;
      const id = nextId++;
      posts.push({ command, body, id });
      return Promise.resolve({ code: 0, stdout: JSON.stringify({ id }), stderr: '' });
    };
  return { $, posts };
};

/** attachLogToGitHub as it behaves when the upload fails: posts a failure report, returns false. */
const createFailingAttach =
  ({ calls }) =>
  async ({ $, owner, repo, targetNumber, errorMessage }) => {
    calls.push({ targetNumber, errorMessage });
    const body = buildLogUploadFailureComment({ errorMessage, failureReason: 'Credential sanitization failed; publication was blocked.', logSizeBytes: 5 * 1024 * 1024, logFile: '/home/box/solve-2026-09-30T14-55-22-906Z.log' });
    await postTrackedComment({ $, owner, repo, targetNumber, body });
    return false;
  };

const prRunState = () => ({ owner: 'konard', repo: 'vietnam-accomodation-search', issueNumber: 75, prNumber: 76 });

const notify = ({ $, globalState, attachLogToGitHub, shouldAttachLogs = true }) =>
  notifyIssueAboutPrePullRequestFailure({
    code: 1,
    reason: CODEX_ERROR,
    argv: { tool: 'codex', model: 'gpt-6.1-sol' },
    globalState,
    $,
    shouldAttachLogs,
    getLogFile: () => '/home/box/solve-2026-09-30T14-55-22-906Z.log',
    attachLogToGitHub,
    sanitizeLogContent: async text => text,
  });

await test('replay of vietnam-accomodation-search#76 posts exactly one failure comment', async () => {
  const { $, posts } = createFakeGh();
  const calls = [];
  const attachLogToGitHub = createFailingAttach({ calls });
  const globalState = prRunState();

  // 1. solve.mjs tool-failure path: upload fails, a failure report is posted, false is returned.
  const uploaded = await attachLogToGitHub({ $, owner: 'konard', repo: 'vietnam-accomodation-search', targetNumber: 76, errorMessage: CODEX_ERROR });
  assert.equal(uploaded, false);
  assert.equal(posts.length, 1);

  // 2. safeExit(1, ...) → exit handler → notifier.
  const result = await notify({ $, globalState, attachLogToGitHub });

  assert.equal(posts.length, 1, `expected a single failure comment, got ${posts.length}`);
  assert.equal(calls.length, 1, 'the notifier must not retry the upload when the failure is already reported');
  assert.equal(result.skipped, true);
});

await test('notifier does not add its fallback on top of a failed upload that already reported the failure', async () => {
  const { $, posts } = createFakeGh();
  const calls = [];
  const globalState = prRunState();

  const result = await notify({ $, globalState, attachLogToGitHub: createFailingAttach({ calls }) });

  assert.equal(calls.length, 1);
  assert.equal(posts.length, 1, `expected a single failure comment, got ${posts.length}`);
  assert.match(posts[0].body, /The solver stopped while continuing pull request #76/);
  assert.match(posts[0].body, /not supported when using Codex with a ChatGPT account/);
  assert.deepEqual(result, { notified: true, method: 'log-upload-failure-report' });
  assert.equal(globalState.pullRequestFailureNotificationPosted, true);
  assert.equal(globalState.preExitFailureNotificationPosted, true);
});

await test('notifier still posts its fallback when the failed upload could not post anything', async () => {
  const { $, posts } = createFakeGh();
  const globalState = prRunState();

  const result = await notify({ $, globalState, attachLogToGitHub: async () => false });

  assert.equal(posts.length, 1);
  assert.equal(result.method, 'comment');
  assert.match(posts[0].body, /Solution Draft Failed/);
  assert.match(posts[0].body, /not supported when using Codex with a ChatGPT account/);
});

await test('notifier still posts its fallback when attachLogToGitHub throws before posting', async () => {
  const { $, posts } = createFakeGh();
  const result = await notify({
    $,
    globalState: prRunState(),
    attachLogToGitHub: async () => {
      throw new Error('boom');
    },
  });

  assert.equal(posts.length, 1);
  assert.equal(result.method, 'comment');
});

await test('a non-failure comment on the PR does not suppress the failure notification', async () => {
  const { $, posts } = createFakeGh();
  await postTrackedComment({ $, owner: 'konard', repo: 'vietnam-accomodation-search', targetNumber: 76, body: '## 🤖 AI Work Session Started\n\nStarting automated work session' });

  const result = await notify({ $, globalState: prRunState(), shouldAttachLogs: false });

  assert.equal(posts.length, 2);
  assert.equal(result.method, 'comment');
});

await test('a failure report followed by later tool comments does not suppress a new failure', async () => {
  const { $, posts } = createFakeGh();
  const owner = 'konard';
  const repo = 'vietnam-accomodation-search';
  await postTrackedComment({ $, owner, repo, targetNumber: 76, body: `## 🚨 Solution Draft Failed\n\n${CODEX_ERROR}` });
  assert.equal(isFailureAlreadyReportedOnTarget({ owner, repo, targetNumber: 76 }), true);
  await postTrackedComment({ $, owner, repo, targetNumber: 76, body: '## 🔄 Auto-restart triggered' });
  assert.equal(isFailureAlreadyReportedOnTarget({ owner, repo, targetNumber: 76 }), false);

  const result = await notify({ $, globalState: prRunState(), shouldAttachLogs: false });
  assert.equal(result.method, 'comment');
  assert.equal(posts.length, 3);
});

await test('registry is per target and case-insensitive on owner/repo', async () => {
  const { $ } = createFakeGh();
  await postTrackedComment({ $, owner: 'Konard', repo: 'Vietnam-Accomodation-Search', targetNumber: 76, body: '## 🚨 Solution Draft Failed' });
  assert.equal(isFailureAlreadyReportedOnTarget({ owner: 'konard', repo: 'vietnam-accomodation-search', targetNumber: 76 }), true);
  assert.equal(isFailureAlreadyReportedOnTarget({ owner: 'konard', repo: 'vietnam-accomodation-search', targetNumber: 75 }), false);
  assert.equal(resolvePreExitFailureNotificationTarget({ code: 1, globalState: prRunState() }), null);
  resetTrackedToolCommentIds();
  assert.equal(isFailureAlreadyReportedOnTarget({ owner: 'konard', repo: 'vietnam-accomodation-search', targetNumber: 76 }), false);
});

await test('isFailureReportCommentBody recognises every failure-report template', async () => {
  assert.equal(isFailureReportCommentBody(buildLogUploadFailureComment({ errorMessage: CODEX_ERROR, logSizeBytes: 1, logFile: '/tmp/x.log' })), true);
  assert.equal(isFailureReportCommentBody(buildLogUploadFailureComment({ logSizeBytes: 1, logFile: '/tmp/x.log' })), false);
  assert.equal(isFailureReportCommentBody('## 🤖 Solution Draft Log'), false);
  assert.equal(isFailureReportCommentBody(null), false);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
