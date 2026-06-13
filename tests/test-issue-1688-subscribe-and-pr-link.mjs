#!/usr/bin/env node
/**
 * Tests for issue #1688:
 * - /subscribe and /unsubscribe (in-memory) work in private and public chats.
 * - The /solve completion message includes both `Issue:` and `Pull request:`
 *   lines when the agent created a PR for an issue-driven /solve.
 * - Subscribers receive the completion message in their private chat with the bot.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1688
 */

import { addSubscriber, removeSubscriber, isSubscribed, getSubscriberCount, notifySubscribers, resetSubscribersForTests } from '../src/telegram-subscribers.lib.mjs';
import { appendPullRequestLine, formatSessionCompletionMessage } from '../src/work-session-formatting.lib.mjs';
import { trackSession, monitorSessions, resetSessionMonitorForTests, getActiveSessionCount, extractPullRequestUrlFromText } from '../src/session-monitor.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

console.log('Testing issue #1688: /subscribe + /unsubscribe + Issue/PR completion lines');
console.log('='.repeat(60));

// -- appendPullRequestLine --
console.log('\n  appendPullRequestLine() helper:');
{
  const infoBlock = 'Requested by: @alice\nIssue: https://github.com/o/r/issues/1';
  const out = appendPullRequestLine(infoBlock, 'https://github.com/o/r/pull/2');
  assert(out.includes('Issue: https://github.com/o/r/issues/1'), 'Issue line preserved');
  assert(out.includes('Pull request: https://github.com/o/r/pull/2'), 'Pull request line appended');
  const issueIdx = out.indexOf('Issue:');
  const prIdx = out.indexOf('Pull request:');
  assert(issueIdx >= 0 && prIdx > issueIdx, 'Pull request line appears after the Issue line');
}
{
  const infoBlock = 'Requested by: @alice\nIssue: https://github.com/o/r/issues/1\n\n🛠 Options: --tool claude';
  const out = appendPullRequestLine(infoBlock, 'https://github.com/o/r/pull/2');
  // The PR line is inserted right after the URL line, before the options block
  const prIdx = out.indexOf('Pull request:');
  const optionsIdx = out.indexOf('🛠 Options:');
  assert(prIdx >= 0 && optionsIdx > prIdx, 'Pull request line is inserted before the options block');
}
{
  const infoBlock = 'Requested by: @alice\nIssue: https://github.com/o/r/issues/1\nPull request: https://github.com/o/r/pull/2';
  const out = appendPullRequestLine(infoBlock, 'https://github.com/o/r/pull/2');
  assert(out === infoBlock, 'appendPullRequestLine is idempotent when PR URL is already present');
}
{
  // No-op for empty input
  assert(appendPullRequestLine('', 'https://x') === '', 'Empty infoBlock stays empty');
  assert(appendPullRequestLine('hello', null) === 'hello', 'Null pullRequestUrl returns infoBlock unchanged');
}

// -- issue #1905: PR URL extraction from completed solve logs --
console.log('\n  extractPullRequestUrlFromText() helper:');
{
  const out = extractPullRequestUrlFromText('📍 URL: https://github.com/o/r/pull/77', { owner: 'o', repo: 'r' });
  assert(out === 'https://github.com/o/r/pull/77', 'Extracts PR URL for matching repository');
}
{
  const out = extractPullRequestUrlFromText('foreign https://github.com/other/r/pull/77', { owner: 'o', repo: 'r' });
  assert(out === null, 'Ignores PR URLs from another owner');
}

// -- formatSessionCompletionMessage with pullRequestUrl --
console.log('\n  Completion message includes both Issue and PR links:');
{
  const infoBlock = 'Requested by: @eg0rmaffin\nIssue: https://github.com/eg0rmaffin/vapor-rice-i3/issues/101';
  const message = formatSessionCompletionMessage({
    sessionName: 'sess-1',
    sessionInfo: {
      startTime: new Date('2026-04-25T12:00:00.000Z'),
      url: 'https://github.com/eg0rmaffin/vapor-rice-i3/issues/101',
    },
    statusResult: {
      status: 'executed',
      exitCode: 0,
      startTime: '2026-04-25T12:00:00.000Z',
      endTime: '2026-04-25T12:05:00.000Z',
    },
    infoBlock,
    pullRequestUrl: 'https://github.com/eg0rmaffin/vapor-rice-i3/pull/108',
  });
  assert(message.includes('Issue: https://github.com/eg0rmaffin/vapor-rice-i3/issues/101'), 'Completion includes Issue line');
  assert(message.includes('Pull request: https://github.com/eg0rmaffin/vapor-rice-i3/pull/108'), 'Completion includes Pull request line');
  assert(message.startsWith('✅ *Work session finished successfully*'), 'Successful completion headline preserved');
}
{
  // No PR URL → no Pull request line
  const infoBlock = 'Requested by: @eg0rmaffin\nIssue: https://github.com/eg0rmaffin/vapor-rice-i3/issues/101';
  const message = formatSessionCompletionMessage({
    sessionName: 'sess-2',
    sessionInfo: { startTime: new Date('2026-04-25T12:00:00.000Z') },
    statusResult: { status: 'executed', exitCode: 0, startTime: '2026-04-25T12:00:00.000Z', endTime: '2026-04-25T12:01:00.000Z' },
    infoBlock,
    pullRequestUrl: null,
  });
  assert(message.includes('Issue: https://github.com/eg0rmaffin/vapor-rice-i3/issues/101'), 'Completion still shows Issue line when no PR');
  assert(!message.includes('Pull request:'), 'Completion does not show Pull request line when no PR is found');
}

// -- subscribe / unsubscribe --
console.log('\n  Subscriber store:');
resetSubscribersForTests();
assert(getSubscriberCount() === 0, 'Subscriber store starts empty');
assert(addSubscriber(42, { username: 'alice' }) === true, 'addSubscriber returns true for new user');
assert(isSubscribed(42), 'User is subscribed after addSubscriber');
assert(getSubscriberCount() === 1, 'Subscriber count increments');
assert(addSubscriber(42, { username: 'alice' }) === false, 'Adding same user twice returns false');
assert(getSubscriberCount() === 1, 'Subscriber count does not double-count');
assert(removeSubscriber(42) === true, 'removeSubscriber returns true for existing user');
assert(!isSubscribed(42), 'User no longer subscribed after removeSubscriber');
assert(removeSubscriber(42) === false, 'removeSubscriber returns false for non-subscriber');
assert(getSubscriberCount() === 0, 'Subscriber count returns to 0');
assert(addSubscriber(null) === false, 'addSubscriber rejects null user id');
assert(addSubscriber(undefined) === false, 'addSubscriber rejects undefined user id');

// -- notifySubscribers forwards / falls back / skips --
console.log('\n  notifySubscribers forwarding + fallback + skip-set:');
resetSubscribersForTests();
addSubscriber(100, { username: 'subA' });
addSubscriber(200, { username: 'subB' });
addSubscriber(300, { username: 'requester' });

const forwardCalls = [];
const sendCalls = [];
const fakeBot = {
  telegram: {
    forwardMessage: async (toChat, fromChat, msgId) => {
      forwardCalls.push({ toChat, fromChat, msgId });
      // Pretend user 200 has never opened a private chat with the bot
      if (toChat === 200) throw new Error("Forbidden: bot can't initiate conversation with a user");
      return { message_id: 9999 };
    },
    sendMessage: async (toChat, text, options) => {
      sendCalls.push({ toChat, text, options });
      return { message_id: 8888 };
    },
  },
};

const summary = await notifySubscribers({
  bot: fakeBot,
  fromChatId: 555,
  messageId: 777,
  fallbackText: 'fallback notification',
  fallbackOptions: { parse_mode: 'Markdown' },
  skipUserIds: new Set([300]),
});
assert(summary.forwarded === 1, 'One subscriber received the forwarded message');
assert(summary.sent === 1, 'One subscriber received the fallback sendMessage');
assert(summary.skipped === 1, 'Requester is skipped');
assert(summary.failures.length === 0, 'No failures when fallback succeeded');
assert(
  forwardCalls.some(c => c.toChat === 100),
  'forwardMessage attempted for subscriber 100'
);
assert(
  sendCalls.some(c => c.toChat === 200 && c.text === 'fallback notification'),
  'Fallback sendMessage used for blocked subscriber'
);
assert(!forwardCalls.some(c => c.toChat === 300), 'Skipped requester never received forwardMessage');
assert(!sendCalls.some(c => c.toChat === 300), 'Skipped requester never received sendMessage either');

resetSubscribersForTests();

// -- monitorSessions integrates pullRequestUrl + notifySubscribers --
console.log('\n  monitorSessions appends Pull request line and notifies subscribers:');
resetSessionMonitorForTests();
addSubscriber(900, { username: 'watcher' });

const sessionId = 'sess-3';
trackSession(sessionId, {
  chatId: 11,
  messageId: 22,
  startTime: new Date('2026-04-25T12:00:00.000Z'),
  url: 'https://github.com/o/r/issues/1',
  command: 'solve',
  isolationBackend: 'screen',
  sessionId,
  tool: 'claude',
  infoBlock: 'Requested by: @alice\nIssue: https://github.com/o/r/issues/1',
  urlContext: { owner: 'o', repo: 'r', number: 1, type: 'issue' },
  requesterUserId: 1,
});

const editCalls = [];
const forwardCalls2 = [];
const monitorBot = {
  telegram: {
    editMessageText: async (chatId, messageId, _inline, text, options) => {
      editCalls.push({ chatId, messageId, text, options });
      return true;
    },
    sendMessage: async () => {
      throw new Error('Should edit the original message, not send a new one');
    },
    forwardMessage: async (toChat, fromChat, msgId) => {
      forwardCalls2.push({ toChat, fromChat, msgId });
      return { message_id: 555 };
    },
  },
};

const statusProvider = async () => ({
  exists: true,
  status: 'executed',
  exitCode: 0,
  startTime: '2026-04-25T12:00:00.000Z',
  endTime: '2026-04-25T12:05:00.000Z',
});
const lookupLinkedPullRequest = async ctx => {
  assert(ctx.owner === 'o' && ctx.repo === 'r' && ctx.number === 1, 'lookupLinkedPullRequest receives parsed URL context');
  return 'https://github.com/o/r/pull/2';
};

await monitorSessions(monitorBot, false, { statusProvider, lookupLinkedPullRequest });

assert(editCalls.length === 1, 'monitorSessions edits the original message exactly once');
assert(editCalls[0].text.includes('Issue: https://github.com/o/r/issues/1'), 'Edited message preserves Issue line');
assert(editCalls[0].text.includes('Pull request: https://github.com/o/r/pull/2'), 'Edited message includes Pull request line from lookup');
assert(forwardCalls2.length === 1, 'monitorSessions forwards to one subscriber');
assert(forwardCalls2[0].toChat === 900, 'Forward target is subscribed user');
assert(forwardCalls2[0].fromChatId === undefined || forwardCalls2[0].fromChat === 11, 'Forward source chat matches edited message chat');
assert(forwardCalls2[0].msgId === 22, 'Forward source message id matches edited message id');
assert(getActiveSessionCount() === 0, 'Session is removed from in-memory tracking after notification');

resetSubscribersForTests();
resetSessionMonitorForTests();

// -- issue #1905: monitorSessions falls back to the completed solve log --
console.log('\n  monitorSessions recovers Pull request line from completed solve log:');
resetSubscribersForTests();
resetSessionMonitorForTests();

const issue1905TempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-mind-issue-1905-'));
try {
  const issue1905LogPath = path.join(issue1905TempDir, 'session.log');
  await fs.writeFile(issue1905LogPath, ['Some solve output before verification', '🎉 SUCCESS: A solution draft has been prepared as a pull request', '📍 URL: https://github.com/o/r/pull/77', 'More solve output after verification'].join('\n'), 'utf8');

  const codexSessionId = 'sess-1905';
  trackSession(codexSessionId, {
    chatId: 33,
    messageId: 44,
    startTime: new Date('2026-06-10T12:00:00.000Z'),
    url: 'https://github.com/o/r/issues/1',
    command: 'solve',
    isolationBackend: 'screen',
    sessionId: codexSessionId,
    tool: 'codex',
    infoBlock: 'Requested by: @alice\nIssue: https://github.com/o/r/issues/1',
    urlContext: { owner: 'o', repo: 'r', number: 1, type: 'issue' },
    requesterUserId: 1,
  });

  const issue1905EditCalls = [];
  const issue1905Bot = {
    telegram: {
      editMessageText: async (chatId, messageId, _inline, text, options) => {
        issue1905EditCalls.push({ chatId, messageId, text, options });
        return true;
      },
      sendMessage: async () => {
        throw new Error('Should edit the original message, not send a new one');
      },
    },
  };

  const missingLinkedPrLookup = async () => null;
  const completedCodexStatus = async () => ({
    exists: true,
    status: 'executed',
    exitCode: 0,
    startTime: '2026-06-10T12:00:00.000Z',
    endTime: '2026-06-10T12:07:00.000Z',
    logPath: issue1905LogPath,
  });

  await monitorSessions(issue1905Bot, false, {
    statusProvider: completedCodexStatus,
    lookupLinkedPullRequest: missingLinkedPrLookup,
  });

  assert(issue1905EditCalls.length === 1, 'monitorSessions edits the original codex message exactly once');
  assert(issue1905EditCalls[0].text.includes('Issue: https://github.com/o/r/issues/1'), 'Edited codex message preserves Issue line');
  assert(issue1905EditCalls[0].text.includes('Pull request: https://github.com/o/r/pull/77'), 'Edited codex message includes Pull request line from solve log');
  assert(getActiveSessionCount() === 0, 'Codex session is removed after log-based PR link notification');
} finally {
  await fs.rm(issue1905TempDir, { recursive: true, force: true });
  resetSubscribersForTests();
  resetSessionMonitorForTests();
}

printSummary();

if (getFailCount() > 0) {
  process.exit(1);
}
