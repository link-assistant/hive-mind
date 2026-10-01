#!/usr/bin/env node
// Issue #2397: replay the failure sequence of konard/vietnam-accomodation-search#76 and
// count the "Solution Draft Failed" comments. Uses only APIs that existed before the fix,
// so it can be run against both the old and the fixed code:
//   git stash -- src/ && node experiments/issue-2397-replay-three-comments.mjs; git stash pop
import { notifyIssueAboutPrePullRequestFailure } from '../src/solve.pre-pr-failure-notifier.lib.mjs';
import { buildLogUploadFailureComment } from '../src/log-upload-failure.lib.mjs';
import { postTrackedComment } from '../src/tool-comments.lib.mjs';

const reason = "CODEX execution failed with The 'gpt-6.1-sol' model is not supported when using Codex with a ChatGPT account.";
const posts = [];
let id = 5914889717;
const $ =
  (options = {}) =>
  () => {
    posts.push(JSON.parse(options.stdin).body);
    return Promise.resolve({ code: 0, stdout: JSON.stringify({ id: id++ }), stderr: '' });
  };
const attachLogToGitHub = async ({ owner, repo, targetNumber, errorMessage }) => {
  await postTrackedComment({ $, owner, repo, targetNumber, body: buildLogUploadFailureComment({ errorMessage, failureReason: 'Credential sanitization failed; publication was blocked.', logSizeBytes: 5242880, logFile: '/home/box/solve.log' }) });
  return false; // upload failed
};
const globalState = { owner: 'konard', repo: 'vietnam-accomodation-search', issueNumber: 75, prNumber: 76 };

await attachLogToGitHub({ owner: globalState.owner, repo: globalState.repo, targetNumber: 76, errorMessage: reason }); // solve.mjs failure path
await notifyIssueAboutPrePullRequestFailure({ code: 1, reason, argv: { tool: 'codex' }, globalState, $, shouldAttachLogs: true, getLogFile: () => '/home/box/solve.log', attachLogToGitHub, sanitizeLogContent: async t => t }); // exit handler

console.log(`Failure comments posted: ${posts.filter(b => b.includes('🚨 Solution Draft Failed')).length}`);
posts.forEach((b, i) => console.log(`#${i + 1}: ${b.split('\n').slice(0, 4).join(' | ').slice(0, 160)}`));
