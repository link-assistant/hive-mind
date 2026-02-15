#!/usr/bin/env node
/**
 * Unit tests for /solve_queue Telegram bot command
 *
 * Tests the solve_queue command handler registration, permission checks,
 * and queue status output.
 *
 * Run with: node tests/test-solve-queue-command.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1232
 */

import assert from 'node:assert/strict';
import { registerSolveQueueCommand } from '../src/telegram-solve-queue-command.lib.mjs';
import { SolveQueue, resetSolveQueue } from '../src/telegram-solve-queue.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

// Mock bot that captures command registrations
function createMockBot() {
  const registeredCommands = [];
  return {
    command(pattern, handler) {
      registeredCommands.push({ pattern, handler });
    },
    registeredCommands,
  };
}

// Mock context for simulating Telegram messages
function createMockCtx(overrides = {}) {
  const replies = [];
  return {
    chat: { id: -100123, type: overrides.chatType || 'supergroup' },
    from: { id: 12345, username: 'testuser' },
    message: {
      message_id: 1,
      date: overrides.messageDate || Math.floor(Date.now() / 1000) + 100,
      text: overrides.text || '/solve_queue',
      ...(overrides.message || {}),
    },
    reply: async (text, opts) => {
      replies.push({ text, opts });
      return { chat: { id: -100123 }, message_id: 2 };
    },
    replies,
    ...overrides,
  };
}

// Standard options for registerSolveQueueCommand
function createOptions(overrides = {}) {
  return {
    VERBOSE: false,
    isOldMessage: () => overrides.isOld || false,
    isForwardedOrReply: () => overrides.isForwarded || false,
    isGroupChat: ctx => ctx.chat?.type === 'group' || ctx.chat?.type === 'supergroup',
    isChatAuthorized: () => (overrides.isAuthorized !== undefined ? overrides.isAuthorized : true),
    addBreadcrumb: async () => {},
    getSolveQueue: opts => {
      const queue = new SolveQueue(opts);
      return queue;
    },
    ...overrides,
  };
}

console.log('='.repeat(80));
console.log('Unit Tests: /solve_queue Command (Issue #1232)');
console.log('='.repeat(80));

// ============================================================================
// Registration Tests
// ============================================================================

console.log('\n📋 Registration Tests\n');

test('registerSolveQueueCommand registers a command handler', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  assert.equal(bot.registeredCommands.length, 1, 'Should register exactly one command');
});

test('registerSolveQueueCommand returns handleSolveQueueCommand function', () => {
  const bot = createMockBot();
  const result = registerSolveQueueCommand(bot, createOptions());
  assert.ok(result.handleSolveQueueCommand, 'Should return handleSolveQueueCommand');
  assert.equal(typeof result.handleSolveQueueCommand, 'function', 'handleSolveQueueCommand should be a function');
});

test('Command regex matches solve_queue', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  const pattern = bot.registeredCommands[0].pattern;
  assert.ok(pattern.test('solve_queue'), 'Should match solve_queue');
});

test('Command regex matches solvequeue', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  const pattern = bot.registeredCommands[0].pattern;
  assert.ok(pattern.test('solvequeue'), 'Should match solvequeue');
});

test('Command regex matches solve-queue', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  const pattern = bot.registeredCommands[0].pattern;
  assert.ok(pattern.test('solve-queue'), 'Should match solve-queue');
});

test('Command regex matches SOLVE_QUEUE (case insensitive)', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  const pattern = bot.registeredCommands[0].pattern;
  assert.ok(pattern.test('SOLVE_QUEUE'), 'Should match SOLVE_QUEUE');
});

test('Command regex does not match solve', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  const pattern = bot.registeredCommands[0].pattern;
  assert.ok(!pattern.test('solve'), 'Should not match solve');
});

test('Command regex does not match queue', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  const pattern = bot.registeredCommands[0].pattern;
  assert.ok(!pattern.test('queue'), 'Should not match queue');
});

// ============================================================================
// Permission Tests
// ============================================================================

console.log('\n📋 Permission Tests\n');

await asyncTest('Rejects non-group chat', async () => {
  resetSolveQueue();
  const bot = createMockBot();
  const { handleSolveQueueCommand } = registerSolveQueueCommand(bot, createOptions());
  const ctx = createMockCtx({ chatType: 'private' });
  await handleSolveQueueCommand(ctx);
  assert.equal(ctx.replies.length, 1, 'Should reply once');
  assert.ok(ctx.replies[0].text.includes('only works in group chats'), 'Should mention group chats');
});

await asyncTest('Rejects unauthorized chat', async () => {
  resetSolveQueue();
  const bot = createMockBot();
  const { handleSolveQueueCommand } = registerSolveQueueCommand(bot, createOptions({ isAuthorized: false }));
  const ctx = createMockCtx();
  await handleSolveQueueCommand(ctx);
  assert.equal(ctx.replies.length, 1, 'Should reply once');
  assert.ok(ctx.replies[0].text.includes('not authorized'), 'Should mention authorization');
});

await asyncTest('Ignores old messages', async () => {
  resetSolveQueue();
  const bot = createMockBot();
  const { handleSolveQueueCommand } = registerSolveQueueCommand(bot, createOptions({ isOld: true }));
  const ctx = createMockCtx();
  await handleSolveQueueCommand(ctx);
  assert.equal(ctx.replies.length, 0, 'Should not reply to old messages');
});

await asyncTest('Ignores forwarded messages', async () => {
  resetSolveQueue();
  const bot = createMockBot();
  const { handleSolveQueueCommand } = registerSolveQueueCommand(bot, createOptions({ isForwarded: true }));
  const ctx = createMockCtx();
  await handleSolveQueueCommand(ctx);
  assert.equal(ctx.replies.length, 0, 'Should not reply to forwarded messages');
});

// ============================================================================
// Queue Status Output Tests
// ============================================================================

console.log('\n📋 Queue Status Output Tests\n');

await asyncTest('Shows queue status for empty queue', async () => {
  resetSolveQueue();
  const bot = createMockBot();
  const { handleSolveQueueCommand } = registerSolveQueueCommand(bot, createOptions());
  const ctx = createMockCtx();
  await handleSolveQueueCommand(ctx);
  assert.equal(ctx.replies.length, 1, 'Should reply once');
  assert.ok(ctx.replies[0].text.includes('Solve Queue Status'), 'Should include queue status header');
  // Updated format: per-queue breakdown with processing counts from pgrep (see issue #1267)
  // Processing counts are actual running system processes, not queue internal state
  assert.ok(ctx.replies[0].text.includes('pending: 0'), 'Should show zero pending');
  assert.ok(ctx.replies[0].text.includes('claude'), 'Should include claude queue');
  assert.ok(ctx.replies[0].text.includes('agent'), 'Should include agent queue');
  assert.ok(ctx.replies[0].text.includes('processing:'), 'Should include processing count');
  assert.equal(ctx.replies[0].opts.parse_mode, 'Markdown', 'Should use Markdown parse mode');
});

await asyncTest('Shows processing count in per-queue breakdown', async () => {
  resetSolveQueue();
  const bot = createMockBot();
  const { handleSolveQueueCommand } = registerSolveQueueCommand(bot, createOptions());
  const ctx = createMockCtx();
  await handleSolveQueueCommand(ctx);
  assert.equal(ctx.replies.length, 1, 'Should reply once');
  // Processing count should be shown for each queue (claude, agent)
  // The actual count comes from pgrep detecting running processes
  assert.ok(ctx.replies[0].text.includes('claude') && ctx.replies[0].text.includes('processing:'), 'Should show processing count for claude queue');
  assert.ok(ctx.replies[0].text.includes('agent') && ctx.replies[0].text.includes('processing:'), 'Should show processing count for agent queue');
});

await asyncTest('Shows queue with pending items', async () => {
  resetSolveQueue();
  const queue = new SolveQueue({ verbose: false });
  queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: ['https://github.com/test/repo/issues/1'],
    ctx: createMockCtx(),
    requester: 'testuser',
    infoBlock: 'test info',
    tool: 'claude',
  });

  const bot = createMockBot();
  const { handleSolveQueueCommand } = registerSolveQueueCommand(
    bot,
    createOptions({
      getSolveQueue: () => queue,
    })
  );
  const ctx = createMockCtx();
  await handleSolveQueueCommand(ctx);
  assert.equal(ctx.replies.length, 1, 'Should reply once');
  // Updated format: per-queue breakdown (see issue #1267)
  assert.ok(ctx.replies[0].text.includes('pending: 1'), 'Should show one pending item');
  assert.ok(ctx.replies[0].text.includes('test/repo/issues/1'), 'Should show the queued URL');
  queue.stop();
});

// ============================================================================
// Hint Text Tests (verify /solve-queue was replaced with /solve_queue)
// ============================================================================

console.log('\n📋 Hint Text Regression Tests\n');

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

await asyncTest('telegram-bot.mjs uses /solve_queue in hint text (not /solve-queue)', async () => {
  const content = await readFile(join(__dirname, '..', 'src', 'telegram-bot.mjs'), 'utf-8');
  // The hint text should use /solve_queue (with underscore)
  assert.ok(content.includes('Use /solve_queue to check the queue status'), 'Should use /solve_queue in hint text');
  // Should NOT use /solve-queue (with hyphen) in user-facing hint text
  assert.ok(!content.includes('Use /solve-queue to check'), 'Should NOT use /solve-queue in hint text');
});

await asyncTest('telegram-bot.mjs includes /solve_queue in help text using backtick code block', async () => {
  const content = await readFile(join(__dirname, '..', 'src', 'telegram-bot.mjs'), 'utf-8');
  assert.ok(content.includes('`/solve_queue`'), 'Help text should include /solve_queue in backtick code block');
  // Should NOT use bold+escaped format which renders backslashes in Telegram
  assert.ok(!content.includes('*/solve\\\\_queue*'), 'Help text should NOT use */solve\\_queue* format (renders backslashes)');
});

await asyncTest('telegram-bot.mjs includes solve_queue in text fallback handlers', async () => {
  const content = await readFile(join(__dirname, '..', 'src', 'telegram-bot.mjs'), 'utf-8');
  assert.ok(content.includes('solve_queue: handleSolveQueueCommand'), 'Text fallback should include solve_queue handler');
});

await asyncTest('telegram-solve-queue.lib.mjs uses /solve_queue in log messages (not /solve-queue)', async () => {
  const content = await readFile(join(__dirname, '..', 'src', 'telegram-solve-queue.lib.mjs'), 'utf-8');
  assert.ok(!content.includes('[VERBOSE] /solve-queue'), 'Should NOT use /solve-queue in VERBOSE log messages');
  assert.ok(content.includes('[VERBOSE] /solve_queue'), 'Should use /solve_queue in VERBOSE log messages');
});

await asyncTest('telegram-solve-queue.lib.mjs uses [solve_queue] log tag (not [solve-queue])', async () => {
  const content = await readFile(join(__dirname, '..', 'src', 'telegram-solve-queue.lib.mjs'), 'utf-8');
  assert.ok(!content.includes('[solve-queue]'), 'Should NOT use [solve-queue] log tag');
  assert.ok(content.includes('[solve_queue]'), 'Should use [solve_queue] log tag');
});

await asyncTest('telegram-bot.mjs includes /accept_invites in help text using backtick code block', async () => {
  const content = await readFile(join(__dirname, '..', 'src', 'telegram-bot.mjs'), 'utf-8');
  assert.ok(content.includes('`/accept_invites`'), 'Help text should include /accept_invites in backtick code block');
  // Should NOT use bold+escaped format which renders backslashes in Telegram
  assert.ok(!content.includes('*/accept\\\\_invites*'), 'Help text should NOT use */accept\\_invites* format (renders backslashes)');
});

await asyncTest('telegram-accept-invitations.lib.mjs uses /accept_invites in log messages (not /accept-invites)', async () => {
  const content = await readFile(join(__dirname, '..', 'src', 'telegram-accept-invitations.lib.mjs'), 'utf-8');
  assert.ok(!content.includes('/accept-invites'), 'Should NOT use /accept-invites in log messages');
  assert.ok(content.includes('/accept_invites'), 'Should use /accept_invites in log messages');
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(80));
console.log(`Test Results for /solve_queue command:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log(`  Total: ${testsPassed + testsFailed}`);
console.log('='.repeat(80));

process.exit(testsFailed > 0 ? 1 : 0);
