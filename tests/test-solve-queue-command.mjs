#!/usr/bin/env node
/**
 * Unit tests for /queue Telegram bot command
 *
 * Tests the queue command handler registration, permission checks,
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
      text: overrides.text || '/queue',
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
      // Inject deterministic process/session stubs so the rendered status does
      // not depend on what happens to be running on the test host (a real
      // `claude` process would otherwise make a queue section appear). Tests
      // that need running sessions pass `runningSessionItems`.
      const runningSessionItems = overrides.runningSessionItems || [];
      const queue = new SolveQueue({
        getRunningProcesses: async tool => ({ count: overrides.runningByTool?.[tool] ?? overrides.runningProcesses ?? 0, processes: [] }),
        getRunningIsolatedSessions: async () => ({
          count: runningSessionItems.length,
          byTool: runningSessionItems.reduce((byTool, item) => {
            byTool[item.tool || 'claude'] = (byTool[item.tool || 'claude'] || 0) + 1;
            return byTool;
          }, {}),
        }),
        getRunningSessionItems: async () => runningSessionItems,
        ...opts,
      });
      return queue;
    },
    ...overrides,
  };
}

console.log('='.repeat(80));
console.log('Unit Tests: /queue Command');
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

test('Command regex does not match legacy solve_queue command', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  const pattern = bot.registeredCommands[0].pattern;
  assert.ok(!pattern.test('solve_queue'), 'Should not match legacy solve_queue');
});

test('Command regex does not match legacy solvequeue command', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  const pattern = bot.registeredCommands[0].pattern;
  assert.ok(!pattern.test('solvequeue'), 'Should not match legacy solvequeue');
});

test('Command regex does not match legacy solve-queue command', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  const pattern = bot.registeredCommands[0].pattern;
  assert.ok(!pattern.test('solve-queue'), 'Should not match legacy solve-queue');
});

test('Command regex does not match legacy SOLVE_QUEUE command', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  const pattern = bot.registeredCommands[0].pattern;
  assert.ok(!pattern.test('SOLVE_QUEUE'), 'Should not match legacy SOLVE_QUEUE');
});

test('Command regex does not match solve', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  const pattern = bot.registeredCommands[0].pattern;
  assert.ok(!pattern.test('solve'), 'Should not match solve');
});

test('Command regex matches queue (alias added in issue #1837)', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  const pattern = bot.registeredCommands[0].pattern;
  assert.ok(pattern.test('queue'), 'Should match the /queue alias');
});

test('Command regex matches QUEUE (case insensitive alias)', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  const pattern = bot.registeredCommands[0].pattern;
  assert.ok(pattern.test('QUEUE'), 'Should match the /QUEUE alias case-insensitively');
});

test('Command regex does not match unrelated commands like queued', () => {
  const bot = createMockBot();
  registerSolveQueueCommand(bot, createOptions());
  const pattern = bot.registeredCommands[0].pattern;
  assert.ok(!pattern.test('queued'), 'Should not match queued');
  assert.ok(!pattern.test('myqueue'), 'Should not match myqueue');
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

await asyncTest('Shows queue status for empty queue (hides empty queues, issue #1891)', async () => {
  resetSolveQueue();
  const bot = createMockBot();
  // No queued items and no running processes => no per-tool sections at all.
  const { handleSolveQueueCommand } = registerSolveQueueCommand(bot, createOptions());
  const ctx = createMockCtx();
  await handleSolveQueueCommand(ctx);
  assert.equal(ctx.replies.length, 1, 'Should reply once');
  assert.ok(ctx.replies[0].text.includes('Solve Queue Status'), 'Should include queue status header');
  // Issue #1891: empty queues are no longer printed, so neither the per-tool
  // sections nor their old summary-count lines should appear when the queue is
  // completely empty.
  assert.ok(!ctx.replies[0].text.includes('pending: 0'), 'Should not show empty "pending: 0" sections');
  assert.ok(!ctx.replies[0].text.includes('*agent*'), 'Should hide the empty agent queue');
  assert.equal(ctx.replies[0].opts.parse_mode, 'Markdown', 'Should use Markdown parse mode');
});

await asyncTest('Shows processing list only for queues with running work (issue #1891)', async () => {
  resetSolveQueue();
  const bot = createMockBot();
  // One running claude process, nothing for agent => claude section shows, agent hidden.
  const { handleSolveQueueCommand } = registerSolveQueueCommand(
    bot,
    createOptions({
      runningByTool: { claude: 1 },
      runningSessionItems: [{ sessionName: 's1', url: 'https://github.com/test/repo/issues/2', tool: 'claude', startTime: new Date(Date.now() - 5000).toISOString() }],
    })
  );
  const ctx = createMockCtx();
  await handleSolveQueueCommand(ctx);
  assert.equal(ctx.replies.length, 1, 'Should reply once');
  assert.ok(ctx.replies[0].text.includes('claude') && ctx.replies[0].text.includes('*Processing* (1):'), 'Should show a processing list for the busy claude queue');
  assert.ok(!ctx.replies[0].text.includes('processing: 1'), 'Should not duplicate processing count in the tool header');
  assert.ok(!ctx.replies[0].text.includes('*agent*'), 'Should hide the idle agent queue (issue #1891)');
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
  assert.ok(ctx.replies[0].text.includes('*Pending* (1):'), 'Should show one pending item');
  assert.ok(!ctx.replies[0].text.includes('pending: 1'), 'Should not duplicate pending count in the tool header');
  assert.ok(ctx.replies[0].text.includes('test/repo/issues/1'), 'Should show the queued URL');
  queue.stop();
});

// ============================================================================
// Hint Text Tests (verify short aliases are recommended)
// ============================================================================

console.log('\n📋 Hint Text Regression Tests\n');

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initI18n, t } from '../src/i18n.lib.mjs';
import { buildTelegramHelpMessage } from '../src/telegram-ui-messages.lib.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
await initI18n('en');
const legacySolveCommandPrefix = ['/solve', '_'].join('');
const escapedLegacySolveCommandPrefix = ['/solve', '\\_'].join('');

function buildEnglishHelpMessage() {
  return buildTelegramHelpMessage({
    locale: 'en',
    chatId: -100123,
    chatType: 'supergroup',
    chatTitle: 'Test Chat',
    modelDescription: 'model selection',
  });
}

await asyncTest('locale files recommend short commands and no legacy solve-prefixed commands', async () => {
  const content = await readFile(join(__dirname, '..', 'src', 'locales', 'en.lino'), 'utf-8');
  assert.ok(content.includes('Use /queue to check the queue status'), 'Should use /queue in hint text');

  for (const locale of ['en', 'ru', 'zh', 'hi']) {
    const localeContent = await readFile(join(__dirname, '..', 'src', 'locales', `${locale}.lino`), 'utf-8');
    assert.ok(!localeContent.includes(legacySolveCommandPrefix), `${locale}.lino should not contain user-facing legacy solve-prefixed commands`);
    assert.ok(!localeContent.includes(escapedLegacySolveCommandPrefix), `${locale}.lino should not contain escaped user-facing legacy solve-prefixed commands`);
  }
});

await asyncTest('help message includes /queue using backtick code block', async () => {
  const content = buildEnglishHelpMessage();
  assert.ok(content.includes('`/queue`'), 'Help text should include /queue in backtick code block');
  assert.ok(!content.includes(legacySolveCommandPrefix), 'Help text should not include legacy solve-prefixed queue command');
  assert.ok(!content.includes(escapedLegacySolveCommandPrefix), 'Help text should not include escaped legacy solve-prefixed commands');
});

await asyncTest('telegram-bot.mjs fallback routes only the /queue command', async () => {
  const content = await readFile(join(__dirname, '..', 'src', 'telegram-bot.mjs'), 'utf-8');
  assert.ok(content.includes('queue: handleSolveQueueCommand'), 'Text fallback should include the /queue alias handler');
  assert.ok(!content.includes('solve_queue: handleSolveQueueCommand'), 'Text fallback should not include legacy solve_queue handler');
  assert.ok(!content.includes('solvequeue: handleSolveQueueCommand'), 'Text fallback should not include legacy solvequeue handler');
});

await asyncTest('duplicate URL messages recommend /queue and /stop', async () => {
  const active = t(
    'telegram.url_status_active',
    {
      statusText: 'being processed',
      url: 'https://github.com/owner/repo/issues/1',
      status: 'started',
    },
    { locale: 'en' }
  );
  assert.ok(active.includes('Use /queue to check the queue status'), 'Duplicate queued URL message should recommend /queue');
  assert.ok(!active.includes(legacySolveCommandPrefix), 'Duplicate queued URL message should not recommend legacy solve-prefixed queue command');

  const running = t(
    'telegram.url_session_running',
    {
      url: 'https://github.com/owner/repo/issues/1',
      session: 'session-1',
    },
    { locale: 'en' }
  );
  assert.ok(running.includes('use /stop to cancel it'), 'Duplicate running session message should recommend /stop');
  assert.ok(!running.includes(escapedLegacySolveCommandPrefix), 'Duplicate running session message should not recommend escaped legacy solve-prefixed stop command');
});

await asyncTest('telegram-solve-queue.lib.mjs uses /queue in verbose command logs', async () => {
  const content = await readFile(join(__dirname, '..', 'src', 'telegram-solve-queue.lib.mjs'), 'utf-8');
  assert.ok(!content.includes(`[VERBOSE] ${legacySolveCommandPrefix}`), 'Should not use legacy solve-prefixed command names in VERBOSE log messages');
  assert.ok(content.includes('[VERBOSE] /queue'), 'Should use /queue in VERBOSE log messages');
});

await asyncTest('telegram-solve-queue.lib.mjs uses [solve_queue] log tag (not [solve-queue])', async () => {
  const content = await readFile(join(__dirname, '..', 'src', 'telegram-solve-queue.lib.mjs'), 'utf-8');
  assert.ok(!content.includes('[solve-queue]'), 'Should NOT use [solve-queue] log tag');
  assert.ok(content.includes('[solve_queue]'), 'Should use [solve_queue] log tag');
});

await asyncTest('help message includes /accept_invites using backtick code block', async () => {
  const content = buildEnglishHelpMessage();
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
console.log(`Test Results for /queue command:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log(`  Total: ${testsPassed + testsFailed}`);
console.log('='.repeat(80));

process.exit(testsFailed > 0 ? 1 : 0);
