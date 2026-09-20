#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2267. A successful Codex run quoted an older
 * Claude failure in its transcript. The completion monitor treated that quoted
 * marker as the current run's failure, then sent the oversized false alert to
 * the Telegram forum's general topic.
 */

import assert from 'node:assert/strict';
import { buildExecuteAndUpdateMessage } from '../src/telegram-command-execution.lib.mjs';
import { buildSessionNotificationOptions, buildSubscriptionBlockedExtraSection } from '../src/session-monitor.lib.mjs';
import { parseSubscriptionBlockFromLog, formatSubscriptionBlockedSection } from '../src/subscription-block-telegram.lib.mjs';
import { detectSubscriptionError, formatSubscriptionErrorReport } from '../src/subscription-error.lib.mjs';
import { safeEditMessageText } from '../src/telegram-safe-reply.lib.mjs';
import { createQueueExecuteCallback } from '../src/telegram-solve-queue.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed += 1;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack}`);
    failed += 1;
  }
}

const CLAUDE_MESSAGE = 'Your organization has disabled Claude subscription access for Claude Code · Use an Anthropic API key instead, or ask your admin to enable access';
const CLAUDE_INFO = detectSubscriptionError({
  message: CLAUDE_MESSAGE,
  tool: 'claude',
  errorCode: 'oauth_org_not_allowed',
  apiErrorStatus: 403,
});
const CLAUDE_REPORT = formatSubscriptionErrorReport(CLAUDE_INFO, {
  tool: 'claude',
  committed: true,
  sessionId: 'claude-session',
});

await test('a Codex result cannot be classified from a quoted Claude-only message', () => {
  assert.equal(detectSubscriptionError({ message: CLAUDE_MESSAGE, tool: 'codex' }), null);
  assert.equal(detectSubscriptionError({ message: CLAUDE_MESSAGE, tool: 'codex', errorCode: 'oauth_org_not_allowed' }), null);
});

await test('a marker embedded in a transcript/JSON line is not a current-run report', () => {
  const nested = `[2026-09-19T12:00:00Z] [STDOUT] {"quoted":"[2026-09-16T10:00:00Z] [ERROR] 🚫 SUBSCRIPTION/ACCESS BLOCKED — CLAUDE: old failure"}`;
  assert.equal(parseSubscriptionBlockFromLog(nested), null);
});

await test('a canonical timestamp-prefixed report remains parseable', () => {
  const captured = CLAUDE_REPORT.filter(Boolean)
    .map(line => `[2026-09-16T10:00:00Z] [ERROR] ${line}`)
    .join('\n');
  const parsed = parseSubscriptionBlockFromLog(captured);
  assert.ok(parsed);
  assert.equal(parsed.tool, 'CLAUDE');
  assert.match(parsed.message, /disabled Claude subscription access/);
  assert.match(parsed.code, /oauth_org_not_allowed/);
  assert.equal(parsed.committed, true);
  assert.ok(parsed.guidance.length > 0);
});

await test('successful sessions never replay a stale subscription report', async () => {
  const section = await buildSubscriptionBlockedExtraSection('/session.log', {
    readFile: async () => CLAUDE_REPORT.join('\n'),
    outcome: { failed: false, succeeded: true },
    expectedTool: 'codex',
  });
  assert.equal(section, '');
});

await test('failed sessions only replay a report for their own tool', async () => {
  const wrongTool = await buildSubscriptionBlockedExtraSection('/session.log', {
    readFile: async () => CLAUDE_REPORT.join('\n'),
    outcome: { failed: true },
    expectedTool: 'codex',
  });
  assert.equal(wrongTool, '');

  const matchingTool = await buildSubscriptionBlockedExtraSection('/session.log', {
    readFile: async () => CLAUDE_REPORT.join('\n'),
    outcome: { failed: true },
    expectedTool: 'claude',
  });
  assert.match(matchingTool, /CLAUDE/);
});

await test('the operator-facing report describes unavailable access, not a blocked account', () => {
  const report = CLAUDE_REPORT.join('\n');
  const section = formatSubscriptionBlockedSection(parseSubscriptionBlockFromLog(report));
  assert.doesNotMatch(report, /account-level block|access blocked/i);
  assert.doesNotMatch(section, /access blocked/i);
  assert.match(`${report}\n${section}`, /inactive|unavailable/i);
});

await test('overflow after an edit stays in the originating Telegram topic', async () => {
  const edits = [];
  const followUps = [];
  const telegram = {
    editMessageText: async (_chatId, _messageId, _inlineId, _text, options) => {
      edits.push(options);
      return { message_id: 22 };
    },
    sendMessage: async (_chatId, _text, options) => {
      followUps.push(options);
      return { message_id: 23 };
    },
  };

  await safeEditMessageText(telegram, -1001, 22, undefined, `first\n${'x'.repeat(5000)}`, { message_thread_id: 857 });

  assert.equal(edits.length, 1);
  assert.equal(edits[0].message_thread_id, undefined, 'editMessageText does not accept a topic parameter');
  assert.ok(followUps.length > 0);
  assert.ok(followUps.every(options => options.message_thread_id === 857));
});

await test('completion notifications rebuild Telegram options from persisted topic metadata', () => {
  assert.deepEqual(buildSessionNotificationOptions({ messageThreadId: 857 }, true), { verbose: true, message_thread_id: 857 });
  assert.deepEqual(buildSessionNotificationOptions({}, false), { verbose: false });
});

await test('direct command sessions retain their originating Telegram topic', async () => {
  const tracked = [];
  const edits = [];
  const execute = buildExecuteAndUpdateMessage({
    resolveIsolation: async () => null,
    ISOLATION_BACKEND: null,
    isolationRunner: null,
    VERBOSE: false,
    executeStartScreen: async () => ({ success: true, output: 'session: issue-2267' }),
    trackSession: (_name, info) => tracked.push(info),
    untrackSession: () => {},
    AUTO_WATCH_MESSAGE: false,
    startAutoTerminalWatchForSession: async () => {},
    bot: {},
    formatExecutingWorkSessionMessage: () => 'executing',
    formatStartingWorkSessionMessage: () => 'starting',
  });
  const ctx = {
    chat: { id: -1001 },
    message: { message_thread_id: 857 },
    from: { id: 9 },
    telegram: {
      editMessageText: async (_chatId, _messageId, _inlineId, _text, options) => {
        edits.push(options);
        return { message_id: 22 };
      },
      sendMessage: async () => ({ message_id: 23 }),
    },
  };
  const startingMessage = { chat: { id: -1001 }, message_id: 22, message_thread_id: 857 };

  await execute(ctx, startingMessage, 'solve', ['https://github.com/o/r/issues/1'], 'info', null, 'codex');

  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].messageThreadId, 857);
  assert.ok(edits.length > 0);
  assert.ok(edits.every(options => options.message_thread_id === undefined));
});

await test('queued command sessions retain their originating Telegram topic', async () => {
  const tracked = [];
  const execute = createQueueExecuteCallback(
    async () => ({ success: true, output: 'session: queued-issue-2267' }),
    (_name, info) => tracked.push(info)
  );

  await execute({
    args: ['https://github.com/o/r/issues/1'],
    url: 'https://github.com/o/r/issues/1',
    tool: 'codex',
    ctx: { chat: { id: -1001 }, message: { message_thread_id: 857 } },
    messageInfo: { messageId: 22, messageThreadId: 857 },
  });

  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].messageThreadId, 857);
});

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
