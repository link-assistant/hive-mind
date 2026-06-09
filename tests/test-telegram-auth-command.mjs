#!/usr/bin/env node

/**
 * Tests for experimental Telegram /auth command support.
 *
 * The command is private-DM only and is available only to owners of chats
 * listed in TELEGRAM_ALLOWED_CHATS. Unlike /tokens, an empty allowlist disables
 * /auth entirely.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1858
 */

import assert from 'assert/strict';
import { AUTH_PROVIDERS, buildAuthCommand, extractAuthStartDetails, formatAuthLoginMessage, formatAuthStatusMessage, isAuthOperator, parseAuthRequest, redactAuthOutput, registerAuthCommand, resolveAllowedAuthChatIds } from '../src/telegram-auth-command.lib.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL ${name}`);
    console.log(`  ${error.message}`);
    failed++;
  }
}

function makeMockBot() {
  const handlers = new Map();
  return {
    handlers,
    command(command, handler) {
      handlers.set(command, handler);
    },
  };
}

function makeCtx({ chatType = 'private', chatId = 111, userId = 42, text = '/auth --status gh', memberStatus = 'creator' } = {}) {
  const replies = [];
  return {
    chat: { id: chatId, type: chatType },
    from: { id: userId, username: 'operator' },
    message: { message_id: 7, text },
    telegram: {
      async getChatMember(requestChatId, requestUserId) {
        if (String(requestChatId) === '-1001' && requestUserId === userId) {
          return { status: memberStatus, user: { id: userId } };
        }
        throw new Error('not found');
      },
    },
    async reply(text, options = {}) {
      replies.push({ text, options });
      return { chat: { id: chatId }, message_id: replies.length + 100 };
    },
    replies,
  };
}

console.log('Running telegram /auth command tests...\n');

test('providers are gh, claude, codex', () => {
  assert.deepEqual([...AUTH_PROVIDERS], ['gh', 'claude', 'codex']);
});

test('parseAuthRequest accepts --status provider', () => {
  assert.deepEqual(parseAuthRequest('/auth --status gh'), { action: 'status', provider: 'gh', error: null });
});

test('parseAuthRequest accepts --login provider and bot mention', () => {
  assert.deepEqual(parseAuthRequest('/auth@SwarmMindBot --login codex'), { action: 'login', provider: 'codex', error: null });
});

test('parseAuthRequest rejects missing provider', () => {
  const parsed = parseAuthRequest('/auth --status');
  assert.equal(parsed.action, null);
  assert.match(parsed.error, /Usage:/);
});

test('parseAuthRequest rejects unsupported provider', () => {
  const parsed = parseAuthRequest('/auth --login gitlab');
  assert.equal(parsed.provider, null);
  assert.match(parsed.error, /Unsupported auth provider/);
});

test('parseAuthRequest rejects conflicting actions', () => {
  const parsed = parseAuthRequest('/auth --status gh --login codex');
  assert.equal(parsed.action, null);
  assert.match(parsed.error, /Use exactly one/);
});

test('buildAuthCommand returns non-mutating status commands', () => {
  assert.deepEqual(buildAuthCommand('status', 'gh'), { command: 'gh', args: ['auth', 'status', '--hostname', 'github.com'] });
  assert.deepEqual(buildAuthCommand('status', 'claude'), { command: 'claude', args: ['auth', 'status'] });
  assert.deepEqual(buildAuthCommand('status', 'codex'), { command: 'codex', args: ['login', 'status'] });
});

test('buildAuthCommand returns login starters', () => {
  assert.deepEqual(buildAuthCommand('login', 'gh'), { command: 'gh', args: ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'] });
  assert.deepEqual(buildAuthCommand('login', 'claude'), { command: 'claude', args: ['auth', 'login', '--claudeai'] });
  assert.deepEqual(buildAuthCommand('login', 'codex'), { command: 'codex', args: ['login', '--device-auth'] });
});

test('redactAuthOutput masks common token shapes', () => {
  const redacted = redactAuthOutput('Token: gho_abcdefghijklmnopqrstuvwxyz0123456789 and sk-proj-abcdefghijklmnopqrstuvwxyz');
  assert(!redacted.includes('gho_abcdefghijklmnopqrstuvwxyz0123456789'));
  assert(!redacted.includes('sk-proj-abcdefghijklmnopqrstuvwxyz'));
  assert.match(redacted, /\[REDACTED_TOKEN\]/);
});

test('extractAuthStartDetails captures URLs and device codes', () => {
  const details = extractAuthStartDetails('First copy your one-time code: 1234-ABCD\nOpen https://github.com/login/device in your browser.');
  assert.deepEqual(details.urls, ['https://github.com/login/device']);
  assert.equal(details.code, '1234-ABCD');
});

test('formatAuthStatusMessage includes provider and sanitized output', () => {
  const message = formatAuthStatusMessage('gh', { code: 0, stdout: 'Logged in\nToken: ghp_secretsecretsecretsecretsecretsecret', stderr: '' });
  assert.match(message, /gh auth status/);
  assert.match(message, /\[REDACTED_TOKEN\]/);
  assert(!message.includes('ghp_secret'));
});

test('formatAuthLoginMessage includes captured URL and cancellation note', () => {
  const message = formatAuthLoginMessage('codex', {
    code: null,
    stdout: 'Open https://auth.openai.com/device\nCode: WXYZ-1234',
    stderr: '',
    cancelled: true,
  });
  assert.match(message, /codex auth login started/);
  assert.match(message, /https:\/\/auth\.openai\.com\/device/);
  assert.match(message, /WXYZ-1234/);
  assert.match(message, /cancelled locally/);
});

test('resolveAllowedAuthChatIds requires a non-empty allowlist', () => {
  assert.deepEqual(resolveAllowedAuthChatIds(null), []);
  assert.deepEqual(resolveAllowedAuthChatIds(['-1001', 123]), ['-1001', '123']);
});

await asyncTest('isAuthOperator returns false when allowlist is empty', async () => {
  const ctx = makeCtx();
  assert.equal(await isAuthOperator({ telegram: ctx.telegram, userId: ctx.from.id, allowedChatIds: [] }), false);
});

await asyncTest('isAuthOperator accepts creator of an allowed chat', async () => {
  const ctx = makeCtx({ memberStatus: 'creator' });
  assert.equal(await isAuthOperator({ telegram: ctx.telegram, userId: ctx.from.id, allowedChatIds: ['-1001'] }), true);
});

await asyncTest('isAuthOperator rejects non-creator admin', async () => {
  const ctx = makeCtx({ memberStatus: 'administrator' });
  assert.equal(await isAuthOperator({ telegram: ctx.telegram, userId: ctx.from.id, allowedChatIds: ['-1001'] }), false);
});

await asyncTest('registerAuthCommand rejects group chats', async () => {
  const bot = makeMockBot();
  const { handleAuthCommand } = registerAuthCommand(bot, { allowedChats: ['-1001'], runCommand: async () => ({ code: 0, stdout: '', stderr: '' }) });
  const ctx = makeCtx({ chatType: 'supergroup', chatId: -1001 });
  await handleAuthCommand(ctx);
  assert.equal(ctx.replies.length, 1);
  assert.match(ctx.replies[0].text, /private messages/);
});

await asyncTest('registerAuthCommand disables private /auth without allowed chats', async () => {
  const bot = makeMockBot();
  const { handleAuthCommand } = registerAuthCommand(bot, { allowedChats: [], runCommand: async () => ({ code: 0, stdout: '', stderr: '' }) });
  const ctx = makeCtx();
  await handleAuthCommand(ctx);
  assert.equal(ctx.replies.length, 1);
  assert.match(ctx.replies[0].text, /disabled/);
});

await asyncTest('registerAuthCommand runs provider status for authorized owner', async () => {
  const calls = [];
  const bot = makeMockBot();
  const { handleAuthCommand } = registerAuthCommand(bot, {
    allowedChats: ['-1001'],
    runCommand: async (command, args) => {
      calls.push({ command, args });
      return { code: 0, stdout: 'Logged in using ChatGPT', stderr: '' };
    },
  });
  const ctx = makeCtx({ text: '/auth --status codex' });
  await handleAuthCommand(ctx);
  assert.deepEqual(calls, [{ command: 'codex', args: ['login', 'status'] }]);
  assert.equal(ctx.replies.length, 1);
  assert.match(ctx.replies[0].text, /codex auth status/);
});

await asyncTest('registerAuthCommand starts login with cancellation capture', async () => {
  const calls = [];
  const bot = makeMockBot();
  const { handleAuthCommand } = registerAuthCommand(bot, {
    allowedChats: ['-1001'],
    runCommand: async (command, args, options) => {
      calls.push({ command, args, mode: options.mode });
      return { code: null, stdout: 'Code: ABCD-1234\nhttps://github.com/login/device', stderr: '', cancelled: true };
    },
  });
  const ctx = makeCtx({ text: '/auth --login gh' });
  await handleAuthCommand(ctx);
  assert.equal(calls[0].mode, 'login');
  assert.match(ctx.replies[0].text, /ABCD-1234/);
});

console.log(`\nTotal: ${passed + failed}`);
console.log(`Passed: ${passed}`);
console.log(`Failed: ${failed}`);

process.exit(failed > 0 ? 1 : 0);
