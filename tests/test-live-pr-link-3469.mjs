#!/usr/bin/env node

/**
 * Issue #3469: the Telegram status message must show the pull request link as
 * soon as the PR exists, for every command, and the `/fix` completion message
 * must name the PR it created (it named only the issue).
 *
 * @hive-mind-test-suite default
 */

import assert from 'assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getSessionIssueContext, parseIssueUrlContext, reportLivePullRequestLink, scanLogForLivePullRequestUrl } from '../src/session-live-pr-link.lib.mjs';
import { findLabeledSessionPullRequestUrl } from '../src/session-own-pr.lib.mjs';
import { appendPullRequestLine, insertInfoBlockUrlLine } from '../src/work-session-formatting.lib.mjs';
import { fixProgressLogLine, reportFixProgress } from '../src/fix-progress.lib.mjs';
import { trackSession, monitorSessions, resetSessionMonitorForTests } from '../src/session-monitor.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    failed++;
  }
}

function createMockBot() {
  const edits = [];
  return {
    edits,
    telegram: {
      editMessageText: async (chatId, messageId, inlineId, text, extra) => {
        edits.push({ chatId, messageId, text, extra });
        return true;
      },
      sendMessage: async () => {
        throw new Error('status updates must edit the original reply');
      },
    },
  };
}

const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-3469-'));
const writeLog = async (name, lines) => {
  const logPath = path.join(tempDir, name);
  await fs.writeFile(logPath, `${lines.join('\n')}\n`, 'utf8');
  return logPath;
};

await test('parseIssueUrlContext / getSessionIssueContext cover /solve, /fix and /hive', async () => {
  assert.deepEqual(parseIssueUrlContext('see https://github.com/konard/konard.github.io/issues/3#x'), { owner: 'konard', repo: 'konard.github.io', number: 3, type: 'issue', normalized: 'https://github.com/konard/konard.github.io/issues/3' });
  assert.equal(parseIssueUrlContext('https://github.com/o/r/pull/3'), null);
  const solveCtx = { owner: 'o', repo: 'r', number: 1, type: 'issue' };
  assert.equal(getSessionIssueContext({ command: 'solve', urlContext: solveCtx }), solveCtx);
  // /fix starts on a repository URL: its issue comes from the progress markers.
  assert.equal(getSessionIssueContext({ command: 'fix', urlContext: { owner: 'o', repo: 'r' }, fixProgress: { issueUrl: 'https://github.com/o/r/issues/9' } }).number, 9);
  // ...or, after a restart that lost them, from the escaped info block line.
  assert.equal(getSessionIssueContext({ command: 'fix', urlContext: { owner: 'o', repo: 'my_repo' }, infoBlock: 'Repository: https://github.com/o/my\\_repo\nIssue: https://github.com/o/my\\_repo/issues/4' }).repo, 'my_repo');
  assert.equal(getSessionIssueContext({ command: 'hive', urlContext: null }), null);
  assert.equal(getSessionIssueContext({ command: 'solve', urlContext: { owner: 'o', repo: 'r', number: 5, type: 'pull' } }), null);
});

await test('findLabeledSessionPullRequestUrl trusts only the `PR URL:` line of the same repository', async () => {
  const ctx = { owner: 'o', repo: 'r' };
  assert.equal(findLabeledSessionPullRequestUrl('the agent read https://github.com/o/r/pull/1', ctx), null);
  assert.equal(findLabeledSessionPullRequestUrl('📍 PR URL: https://github.com/x/y/pull/2', ctx), null);
  assert.equal(findLabeledSessionPullRequestUrl('[2026] 📍 PR URL:                 https://github.com/O/R/pull/4', ctx), 'https://github.com/O/R/pull/4');
});

await test('scanLogForLivePullRequestUrl reads the log incrementally and finds a line split between ticks', async () => {
  const ctx = { owner: 'o', repo: 'r' };
  const logPath = await writeLog('incremental.log', ['clone', 'x'.repeat(5000)]);
  const first = await scanLogForLivePullRequestUrl(logPath, ctx, { offset: 0 });
  assert.equal(first.url, null);
  const { size } = await fs.stat(logPath);
  assert.equal(first.offset, size);
  await fs.appendFile(logPath, '📍 PR URL: https://github.com/o/r/pu');
  const half = await scanLogForLivePullRequestUrl(logPath, ctx, { offset: first.offset });
  assert.equal(half.url, null);
  await fs.appendFile(logPath, 'll/12\nmore output\n');
  const done = await scanLogForLivePullRequestUrl(logPath, ctx, { offset: half.offset });
  assert.equal(done.url, 'https://github.com/o/r/pull/12', 'the overlap re-reads the split line');
  const bounded = await scanLogForLivePullRequestUrl(logPath, ctx, { offset: 0, chunkBytes: 100, overlapBytes: 0 });
  assert.equal(bounded.offset, 100, 'at most chunkBytes are read per tick');
});

await test('reportLivePullRequestLink adds the PR line to a running /solve reply exactly once', async () => {
  const bot = createMockBot();
  const logPath = await writeLog('solve.log', ['🔀 Creating PR...', '📍 PR URL:                 https://github.com/o/r/pull/7']);
  const sessionInfo = { command: 'solve', chatId: 1, messageId: 2, isolationBackend: 'docker', executionUuid: 'uuid-1', infoBlock: 'Requested by: @a\nIssue: https://github.com/o/r/issues/1\n\n🛠 Options: --tool claude', urlContext: { owner: 'o', repo: 'r', number: 1, type: 'issue' } };
  let persisted = 0;
  const url = await reportLivePullRequestLink({ bot, sessionName: 's1', sessionInfo, statusResult: { logPath }, persist: () => persisted++ });
  assert.equal(url, 'https://github.com/o/r/pull/7');
  assert.equal(bot.edits.length, 1);
  assert.match(bot.edits[0].text, /^⏳ Executing\.\.\./);
  assert.match(bot.edits[0].text, /Issue: https:\/\/github\.com\/o\/r\/issues\/1\nPull request: https:\/\/github\.com\/o\/r\/pull\/7\n\n🛠 Options/);
  assert.equal(sessionInfo.resolvedPullRequestUrl, url, 'the completion message reuses it');
  assert.ok(persisted > 0);
  assert.equal(await reportLivePullRequestLink({ bot, sessionName: 's1', sessionInfo, statusResult: { logPath } }), null);
  assert.equal(bot.edits.length, 1, 'not edited again');
});

await test('reportLivePullRequestLink skips PR sessions, /hive, recoveries and never throws', async () => {
  const bot = createMockBot();
  const logPath = await writeLog('skip.log', ['📍 PR URL: https://github.com/o/r/pull/7']);
  assert.equal(await reportLivePullRequestLink({ bot, sessionName: 's', sessionInfo: { command: 'solve', urlContext: { owner: 'o', repo: 'r', number: 7, type: 'pull' } }, statusResult: { logPath } }), null);
  assert.equal(await reportLivePullRequestLink({ bot, sessionName: 's', sessionInfo: { command: 'hive' }, statusResult: { logPath } }), null);
  assert.equal(await reportLivePullRequestLink({ bot, sessionName: 's', sessionInfo: { command: 'solve', recoveryLifecycle: { phase: 'resuming' }, urlContext: { owner: 'o', repo: 'r', number: 1, type: 'issue' } }, statusResult: { logPath } }), null);
  assert.equal(await reportLivePullRequestLink({ bot, sessionName: 's', sessionInfo: { command: 'solve', urlContext: { owner: 'o', repo: 'r', number: 1, type: 'issue' } }, statusResult: { logPath: path.join(tempDir, 'missing.log') } }), null);
  assert.equal(bot.edits.length, 0);
});

await test('/fix: the issue line goes after Repository and the PR line follows it, without duplicating the issue', async () => {
  const bot = createMockBot();
  const issueUrl = 'https://github.com/konard/konard.github.io/issues/3';
  const logPath = await writeLog('fix.log', [fixProgressLogLine({ phase: 'solving', issueUrl, branch: 'main', ciOutcome: 'idle' })]);
  const sessionInfo = { command: 'fix', chatId: 1, messageId: 2, isolationBackend: 'docker', infoBlock: 'Requested by: @a\nRepository: https://github.com/konard/konard.github.io\n\n🛠 Options: --ci-cd', urlContext: { owner: 'konard', repo: 'konard.github.io', normalized: 'https://github.com/konard/konard.github.io' } };
  await reportFixProgress({ bot, sessionName: 'f1', sessionInfo, statusResult: { logPath } });
  assert.match(sessionInfo.infoBlock, /Repository: https:\/\/github\.com\/konard\/konard\.github\.io\nIssue: https:\/\/github\.com\/konard\/konard\.github\.io\/issues\/3\n\n🛠 Options/);
  await fs.appendFile(logPath, '📍 PR URL:                 https://github.com/konard/konard.github.io/pull/4\n');
  assert.equal(await reportLivePullRequestLink({ bot, sessionName: 'f1', sessionInfo, statusResult: { logPath } }), 'https://github.com/konard/konard.github.io/pull/4');
  const text = bot.edits.at(-1).text;
  assert.match(text, /Issue: https:\/\/github\.com\/konard\/konard\.github\.io\/issues\/3\nPull request: https:\/\/github\.com\/konard\/konard\.github\.io\/pull\/4/);
  assert.match(text, /^⏳ Executing\.\.\.\n\n/, 'the /fix status header is kept, without a CI/CD outcome line (issue #3505)');
  assert.doesNotMatch(text, /CI\/CD/);
  assert.equal(text.split(issueUrl).length - 1, 1, 'the issue is linked once');
});

await test('insertInfoBlockUrlLine / appendPullRequestLine keep links together above the options', async () => {
  assert.equal(insertInfoBlockUrlLine('Requested by: @a\nRepository: R\n\n🛠 Options: x', 'Issue: I'), 'Requested by: @a\nRepository: R\nIssue: I\n\n🛠 Options: x');
  assert.equal(insertInfoBlockUrlLine('', 'Issue: I'), 'Issue: I');
  assert.equal(appendPullRequestLine('Requested by: @a\nRepository: R\n\n🛠 Options: x', 'https://github.com/o/r/pull/1'), 'Requested by: @a\nRepository: R\nPull request: https://github.com/o/r/pull/1\n\n🛠 Options: x');
});

// The exact case from the issue's screenshot: `/fix --ci-cd <repository>`
// finished successfully, the log had solve's `PR URL:` line, but the reply
// showed only `Issue: .../issues/3`.
await test('monitorSessions: a finished /fix session names its pull request (screenshot case)', async () => {
  resetSessionMonitorForTests();
  const issueUrl = 'https://github.com/konard/konard.github.io/issues/3';
  const logPath = await writeLog('fix-complete.log', [fixProgressLogLine({ phase: 'issue-created', issueUrl, branch: 'main' }), fixProgressLogLine({ phase: 'solving', issueUrl, branch: 'main', ciOutcome: 'idle' }), '📍 PR URL:                 https://github.com/konard/konard.github.io/pull/4', '✅ done']);
  trackSession('fix-3469', {
    chatId: 5,
    messageId: 6,
    startTime: new Date('2026-10-16T09:00:00.000Z'),
    url: 'https://github.com/konard/konard.github.io',
    command: 'fix',
    isolationBackend: 'screen',
    sessionId: 'fix-3469',
    tool: 'claude',
    infoBlock: 'Requested by: @drakonard\nRepository: https://github.com/konard/konard.github.io\n\n🛠 Options: --ci-cd',
    urlContext: { owner: 'konard', repo: 'konard.github.io', normalized: 'https://github.com/konard/konard.github.io' },
    fixProgress: { phase: 'solving', issueUrl, done: true },
    logPath,
  });
  const bot = createMockBot();
  const lookups = [];
  await monitorSessions(bot, false, {
    statusProvider: async () => ({ exists: true, status: 'executed', exitCode: 0, startTime: '2026-10-16T09:00:00.000Z', endTime: '2026-10-16T09:16:50.000Z', logPath }),
    lookupLinkedPullRequest: async ctx => {
      lookups.push(ctx);
      return null;
    },
  });
  assert.equal(lookups.length, 1, 'the PR is looked up for the issue /fix created');
  assert.equal(lookups[0].number, 3);
  const completion = bot.edits.find(edit => /Work session finished successfully/.test(edit.text));
  assert.ok(completion, `completion message sent: ${JSON.stringify(bot.edits.map(edit => edit.text.slice(0, 40)))}`);
  assert.match(completion.text, /Pull request: https:\/\/github\.com\/konard\/konard\.github\.io\/pull\/4/);
  resetSessionMonitorForTests();
});

await fs.rm(tempDir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
