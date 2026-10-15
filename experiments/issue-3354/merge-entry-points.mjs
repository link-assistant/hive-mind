#!/usr/bin/env node
/* global process, console */
/**
 * Runs a real merge entry point against the fake `gh` on PATH (issue #3357):
 * `merge <owner> <repo> <pr>` (the /merge and solve path, mergePullRequest) or
 * `queue <owner> <repo> <pr>` (the Telegram merge queue with the real
 * mergePullRequest). Prints one JSON line.
 */
import { mergePullRequest } from '../../src/github-merge.lib.mjs';
import { MergeQueueProcessor, MergeStatus } from '../../src/telegram-merge-queue.lib.mjs';

const [mode, owner, repo, number] = process.argv.slice(2);
const prNumber = Number(number);
const quiet = { log: console.log, warn: console.warn };
const output = [];
console.log = (...args) => output.push(args.join(' '));
console.warn = (...args) => output.push(args.join(' '));
let report;
if (mode === 'merge') {
  report = { result: await mergePullRequest(owner, repo, prNumber, {}) };
} else {
  const processor = new MergeQueueProcessor({ owner, repo, checkPRMergeable: async () => ({ mergeable: true }), checkPRCIStatus: async () => ({ status: 'success' }), getMergeCommitSha: async () => ({ sha: 'b'.repeat(40) }) });
  processor.sleep = async () => {};
  processor.status = MergeStatus.COMPLETED;
  const item = { pr: { number: prNumber, title: 'Demo', url: `https://github.com/${owner}/${repo}/pull/${prNumber}` }, issue: null, getDescription: () => `PR #${prNumber}`, getStatusEmoji: () => '✅' };
  processor.items = [item];
  await processor.processItem(item);
  report = { status: item.status, error: item.error, issueClosing: item.issueClosing, finalMessage: processor.formatFinalMessage() };
}
Object.assign(console, quiet);
console.log(JSON.stringify({ ...report, output }));
