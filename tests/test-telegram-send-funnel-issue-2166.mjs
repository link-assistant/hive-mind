#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Issue #2166: every Telegram send must go through one funnel that validates
 * before sending, logs the attempt, and falls back to plain text.
 *
 * Covers the two halves of the guarantee:
 *  - runtime: safeSendMessage / caption helpers validate + fall back;
 *  - static: the `no-unsafe-telegram-send` ESLint rule makes a raw
 *    `parse_mode` send a build error so the funnel cannot be bypassed.
 */

import assert from 'assert/strict';
import { Linter } from 'eslint';
import noUnsafeTelegramSend from '../eslint-rules/no-unsafe-telegram-send.mjs';
import { buildSafeCaptionOptions, safeReplyWithDocument, safeSendDocument, safeSendMessage, TELEGRAM_CAPTION_LIMIT } from '../src/telegram-safe-reply.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack}`);
    failed++;
  }
}

function badRequest(description) {
  const error = new Error(description);
  error.response = { error_code: 400, description };
  return error;
}

// --------------------------------------------------------------------------
// safeSendMessage
// --------------------------------------------------------------------------

await test('safeSendMessage defaults to Markdown and forwards the chat id', async () => {
  const calls = [];
  const telegram = {
    sendMessage: async (chatId, text, options) => {
      calls.push({ chatId, text, options });
      return { message_id: 1 };
    },
  };
  await safeSendMessage(telegram, 42, 'hello');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].chatId, 42);
  assert.equal(calls[0].text, 'hello');
  assert.equal(calls[0].options.parse_mode, 'Markdown');
});

await test('safeSendMessage retries as plain text when Telegram rejects the entities', async () => {
  const calls = [];
  const telegram = {
    sendMessage: async (chatId, text, options) => {
      calls.push({ text, options });
      if (options?.parse_mode) throw badRequest("Bad Request: can't parse entities: Can't find end of the entity starting at byte offset 5");
      return { message_id: 2 };
    },
  };
  const result = await safeSendMessage(telegram, 7, 'plain text always survives');
  assert.equal(result.message_id, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.parse_mode, undefined);
});

// --------------------------------------------------------------------------
// captions
// --------------------------------------------------------------------------

await test('buildSafeCaptionOptions keeps a valid formatted caption untouched', () => {
  const options = buildSafeCaptionOptions({ caption: 'Log for `abc`', parse_mode: 'Markdown' });
  assert.equal(options.caption, 'Log for `abc`');
  assert.equal(options.parse_mode, 'Markdown');
});

await test('buildSafeCaptionOptions drops parse_mode for a caption Telegram would reject', () => {
  // An unbalanced backtick is exactly what makes the upload fail with an opaque
  // 400. Without a parse_mode the same byte is just a literal character, so the
  // document still reaches the chat instead of vanishing.
  const options = buildSafeCaptionOptions({ caption: 'Log for `abc', parse_mode: 'Markdown' });
  assert.equal(options.parse_mode, undefined);
  assert.equal(options.caption, 'Log for `abc');
});

await test('buildSafeCaptionOptions unwraps paired markup when it degrades to plain text', () => {
  const options = buildSafeCaptionOptions({ caption: '*done* but `unclosed', parse_mode: 'Markdown' });
  assert.equal(options.parse_mode, undefined);
  assert.equal(options.caption, 'done but `unclosed');
});

await test('buildSafeCaptionOptions truncates captions above the 1024 char limit', () => {
  const options = buildSafeCaptionOptions({ caption: 'x'.repeat(TELEGRAM_CAPTION_LIMIT + 50) });
  assert.equal(options.caption.length, TELEGRAM_CAPTION_LIMIT);
  assert.equal(options.caption.endsWith('…'), true);
});

await test('buildSafeCaptionOptions passes non-caption options through unchanged', () => {
  const options = buildSafeCaptionOptions({ message_thread_id: 9 });
  assert.equal(options.message_thread_id, 9);
  assert.equal('caption' in options, false);
});

await test('buildSafeCaptionOptions does not leak internal options to the Bot API', () => {
  const options = buildSafeCaptionOptions({ caption: 'ok', verbose: true, fallbackLocale: 'en' });
  assert.equal('verbose' in options, false);
  assert.equal('fallbackLocale' in options, false);
});

await test('safeReplyWithDocument falls back to a plain caption on a 400', async () => {
  const calls = [];
  const ctx = {
    chat: { id: 5 },
    replyWithDocument: async (document, options) => {
      calls.push(options);
      if (options?.parse_mode) throw badRequest("Bad Request: can't parse entities: Unsupported start tag");
      return { message_id: 3 };
    },
  };
  const result = await safeReplyWithDocument(ctx, { source: Buffer.from('log') }, { caption: '*bold* caption', parse_mode: 'Markdown' });
  assert.equal(result.message_id, 3);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].parse_mode, undefined);
});

await test('safeSendDocument rethrows non-Bad-Request failures instead of double sending', async () => {
  let attempts = 0;
  const telegram = {
    sendDocument: async () => {
      attempts += 1;
      throw new Error('socket hang up');
    },
  };
  await assert.rejects(() => safeSendDocument(telegram, 1, { source: Buffer.from('x') }, { caption: 'c', parse_mode: 'Markdown' }), /socket hang up/);
  assert.equal(attempts, 1);
});

// --------------------------------------------------------------------------
// static guarantee: the ESLint rule
// --------------------------------------------------------------------------

const linter = new Linter();
const lintConfig = {
  plugins: { 'telegram-safety': { rules: { 'no-unsafe-telegram-send': noUnsafeTelegramSend } } },
  languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  rules: { 'telegram-safety/no-unsafe-telegram-send': 'error' },
};
const lint = (code, filename = 'src/telegram-example.lib.mjs') => linter.verify(code, lintConfig, filename);

await test('rule flags ctx.reply with a parse_mode', () => {
  const messages = lint("await ctx.reply('hi', { parse_mode: 'Markdown' });");
  assert.equal(messages.length, 1);
  assert.match(messages[0].message, /safe Telegram send funnel/);
});

await test('rule flags telegram.sendMessage and editMessageText with a parse_mode', () => {
  assert.equal(lint("await bot.telegram.sendMessage(id, text, { parse_mode: 'MarkdownV2' });").length, 1);
  assert.equal(lint("await ctx.telegram.editMessageText(c, m, undefined, t, { parse_mode: 'Markdown' });").length, 1);
});

await test('rule flags helpers that are always formatted, even without a parse_mode', () => {
  assert.equal(lint("await ctx.replyWithMarkdown('hi');").length, 1);
  assert.equal(lint("await ctx.replyWithHTML('<b>hi</b>');").length, 1);
});

await test('rule flags a parse_mode carried in a spread-built options object', () => {
  assert.equal(lint("await ctx.reply(text, { ...base, parse_mode: 'Markdown' });").length, 1);
});

await test('rule allows plain-text sends and the safe helpers', () => {
  assert.deepEqual(lint("await ctx.reply('plain text');"), []);
  assert.deepEqual(lint("await safeReply(ctx, text, { parse_mode: 'Markdown' });"), []);
  assert.deepEqual(lint("await safeSendMessage(telegram, id, text, { parse_mode: 'Markdown' });"), []);
});

await test('rule exempts the funnel implementation itself', () => {
  assert.deepEqual(lint("await telegram.sendMessage(id, text, { parse_mode: 'Markdown' });", 'src/telegram-safe-reply.lib.mjs'), []);
});

await test('rule flags media captions that are parsed as entities', () => {
  assert.equal(lint("await ctx.replyWithDocument(doc, { caption, parse_mode: 'Markdown' });").length, 1);
});

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
