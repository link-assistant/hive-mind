#!/usr/bin/env node

/**
 * Regression tests for issue #2166 — "no silent Telegram failures".
 *
 * Production evidence (bot log, update 957727704):
 *
 * ```
 * TelegramError: 400: Bad Request: can't parse entities: Can't find end of the
 * entity starting at byte offset 65
 *     at Telegram.callApi (…/telegraf/lib/core/network/client.js:315:19)
 *     at async …/src/telegram-start-stop-command.lib.mjs:666:7
 *   payload: { parse_mode: 'Markdown',
 *              text: '🗑 Removed queued task for https://github.com/Surrogate-TM/save_visiogetbb/pull/18#issuecomment-5370631063 from `codex` queue.' }
 * ```
 *
 * The stack has **no fallback wrapper frames**: `installTelegramFormattingFallback`
 * had been installed on `bot.telegram`, but Telegraf builds a *fresh* `Telegram`
 * client for every update, so `ctx.reply()` bypassed it entirely.
 *
 * These tests pin that behaviour down:
 *  1. Telegraf really does give each context its own `Telegram` client.
 *  2. Patching only `bot.telegram` leaves `ctx.reply()` unprotected (the bug).
 *  3. `installTelegramContextSafety(bot)` protects every per-update context, so
 *     the exact production message is delivered as plain text instead of throwing.
 */

import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';
import { installTelegramFormattingFallback } from '../src/telegram-safe-reply.lib.mjs';
import { installTelegramContextSafety } from '../src/telegram-context-safety.lib.mjs';
import { parseTelegramLegacyMarkdown } from '../src/telegram-markdown-validator.lib.mjs';

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName}`);
    if (details) console.log(`     ${details}`);
    failed++;
  }
}

// The exact text that failed in production.
const FAILING_URL = 'https://github.com/Surrogate-TM/save_visiogetbb/pull/18#issuecomment-5370631063';
const FAILING_TEXT = `🗑 Removed queued task for ${FAILING_URL} from \`codex\` queue.`;

/**
 * A Bot API stand-in that rejects unterminated legacy-Markdown entities exactly
 * like Telegram does, using this repository's faithful TDLib parser port.
 */
function fakeCallApi(sent, method, payload = {}) {
  if (method !== 'sendMessage' && method !== 'editMessageText') return true;
  if (payload.parse_mode === 'Markdown') {
    const parsed = parseTelegramLegacyMarkdown(payload.text);
    if (!parsed.ok) {
      const error = new Error(`400: ${parsed.description}`);
      error.code = 400;
      error.response = { ok: false, error_code: 400, description: parsed.description };
      error.description = parsed.description;
      error.on = { method, payload };
      throw error;
    }
  }
  sent.push({ method, ...payload });
  return { message_id: sent.length, chat: { id: payload.chat_id }, text: payload.text };
}

/**
 * Minimal stand-in for Telegraf that reproduces the one behaviour this issue
 * hinges on: `handleUpdate()` builds a **new** `Telegram` client per update.
 *
 * ```js
 * // telegraf/lib/telegraf.js — handleUpdate()
 * const tg = new telegram_1.default(this.token, this.telegram.options, webhookResponse);
 * const ctx = new TelegrafContext(update, tg, this.botInfo);
 * ```
 *
 * The offline default suite runs against this stub; the same assertions are run
 * against the real `telegraf` package below whenever it can be loaded.
 */
class FakeTelegram {
  constructor(sent) {
    this.sent = sent;
  }

  async callApi(method, payload = {}) {
    return fakeCallApi(this.sent, method, payload);
  }

  async sendMessage(chatId, text, extra = {}) {
    return await this.callApi('sendMessage', { chat_id: chatId, text, ...extra });
  }

  async editMessageText(chatId, messageId, inlineMessageId, text, extra = {}) {
    return await this.callApi('editMessageText', { chat_id: chatId, message_id: messageId, inline_message_id: inlineMessageId, text, ...extra });
  }
}

class FakeTelegraf {
  constructor(sent) {
    this.sent = sent;
    this.telegram = new FakeTelegram(sent);
    this.middlewares = [];
    this.errorHandler = null;
  }

  use(middleware) {
    this.middlewares.push(middleware);
  }

  catch(handler) {
    this.errorHandler = handler;
  }

  async handleUpdate(update) {
    // The crux: a fresh client per update, exactly like Telegraf.
    const telegram = new FakeTelegram(this.sent);
    const ctx = {
      update,
      telegram,
      chat: update.message?.chat,
      message: update.message,
      from: update.message?.from,
      reply: (text, extra = {}) => telegram.sendMessage(update.message.chat.id, text, extra),
    };
    const run = async index => {
      const middleware = this.middlewares[index];
      if (!middleware) return;
      await middleware(ctx, () => run(index + 1));
    };
    try {
      await run(0);
    } catch (error) {
      if (!this.errorHandler) throw error;
      this.errorHandler(error, ctx);
    }
  }
}

let TelegrafClass = null;
try {
  if (typeof globalThis.use === 'undefined') await ensureUseM();
  TelegrafClass = (await globalThis.use('telegraf')).Telegraf;
} catch (error) {
  console.log(`  ℹ️  real telegraf unavailable (${error?.message || error}); running against the documented stub only`);
}

function createRealTelegraf() {
  const sent = [];
  const bot = new TelegrafClass('123:FAKE');
  bot.botInfo = { id: 1, is_bot: true, first_name: 'hive', username: 'hive_bot' };
  // Telegraf clones `this.telegram.options` into every per-update client, so
  // patching `callApi` on the prototype models "the real network" for all of them.
  const TelegramClass = Object.getPrototypeOf(bot.telegram).constructor;
  TelegramClass.prototype.callApi = async function patchedCallApi(method, payload = {}) {
    return fakeCallApi(sent, method, payload);
  };
  return { bot, sent };
}

function createFakeTelegraf() {
  const sent = [];
  return { bot: new FakeTelegraf(sent), sent };
}

const UPDATE = {
  update_id: 1,
  message: { message_id: 10, date: 0, chat: { id: -100123, type: 'supergroup' }, from: { id: 7, is_bot: false, first_name: 'Owner' }, text: '/stop' },
};

console.log('\n=== Test 1: Telegraf gives every update its own Telegram client ===\n');
{
  const { bot } = createFakeTelegraf();
  let sameInstance = null;
  bot.use(ctx => {
    sameInstance = ctx.telegram === bot.telegram;
  });
  await bot.handleUpdate(UPDATE);
  assert(sameInstance === false, 'ctx.telegram is a different object than bot.telegram', `sameInstance=${sameInstance}`);
}

console.log('\n=== Test 2: patching only bot.telegram reproduces the production failure ===\n');
{
  const { bot, sent } = createFakeTelegraf();
  installTelegramFormattingFallback(bot.telegram, { verbose: false });

  let thrown = null;
  bot.use(async ctx => {
    // Exactly what src/telegram-start-stop-command.lib.mjs:666 used to do.
    await ctx.reply(FAILING_TEXT, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
  });
  bot.catch(error => {
    thrown = error;
  });
  await bot.handleUpdate(UPDATE);

  assert(thrown !== null, 'ctx.reply() escapes the bot.telegram fallback and throws (the bug)');
  assert(/Can't find end of the entity starting at byte offset 65/.test(String(thrown?.message || '')), 'error matches the production message, byte offset 65', String(thrown?.message));
  assert(sent.length === 0, 'nothing at all reaches the user — a silent failure', `sent=${sent.length}`);
}

console.log('\n=== Test 3: installTelegramContextSafety protects every per-update context ===\n');
{
  const { bot, sent } = createFakeTelegraf();
  installTelegramContextSafety(bot, { verbose: false });

  let thrown = null;
  bot.use(async ctx => {
    await ctx.reply(FAILING_TEXT, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
  });
  bot.catch(error => {
    thrown = error;
  });
  await bot.handleUpdate(UPDATE);

  assert(thrown === null, 'ctx.reply() no longer throws', String(thrown?.message || ''));
  assert(sent.length === 1, 'exactly one message reaches the user', `sent=${sent.length}`);
  assert(sent[0]?.parse_mode === undefined, 'it is delivered as plain text', `parse_mode=${sent[0]?.parse_mode}`);
  assert(String(sent[0]?.text || '').includes(FAILING_URL), 'the URL is preserved verbatim in the fallback', sent[0]?.text);
  assert(String(sent[0]?.text || '').includes('Removed queued task'), 'the confirmation is preserved', sent[0]?.text);
  assert(sent[0]?.reply_to_message_id === 10, 'reply threading is preserved', `reply_to_message_id=${sent[0]?.reply_to_message_id}`);
}

console.log('\n=== Test 4: pre-send validation avoids the doomed API round trip ===\n');
{
  const { bot, sent } = createFakeTelegraf();
  installTelegramContextSafety(bot, { verbose: false });

  const attempted = [];
  bot.use(async (ctx, next) => {
    const originalCallApi = ctx.telegram.callApi.bind(ctx.telegram);
    ctx.telegram.callApi = async (method, payload = {}) => {
      attempted.push({ method, parse_mode: payload.parse_mode });
      return await originalCallApi(method, payload);
    };
    return next();
  });
  bot.use(async ctx => {
    await ctx.reply(FAILING_TEXT, { parse_mode: 'Markdown' });
  });
  await bot.handleUpdate(UPDATE);

  assert(attempted.length === 1, 'only one Bot API call is made (no doomed Markdown attempt)', JSON.stringify(attempted));
  assert(attempted[0]?.parse_mode === undefined, 'that call is the plain-text one', JSON.stringify(attempted));
  assert(sent.length === 1, 'the user still receives the message', `sent=${sent.length}`);
}

console.log('\n=== Test 5: the same holds for the real telegraf package ===\n');
if (!TelegrafClass) {
  console.log('  ⏭  skipped: telegraf could not be loaded (offline)');
} else {
  const { bot: unprotected } = createRealTelegraf();
  let sameInstance = null;
  unprotected.use(ctx => {
    sameInstance = ctx.telegram === unprotected.telegram;
  });
  await unprotected.handleUpdate(UPDATE);
  assert(sameInstance === false, 'real telegraf: ctx.telegram !== bot.telegram', `sameInstance=${sameInstance}`);

  const { bot, sent } = createRealTelegraf();
  installTelegramContextSafety(bot, { verbose: false });
  let thrown = null;
  bot.use(async ctx => {
    await ctx.reply(FAILING_TEXT, { parse_mode: 'Markdown', reply_to_message_id: ctx.message.message_id });
  });
  bot.catch(error => {
    thrown = error;
  });
  await bot.handleUpdate(UPDATE);
  assert(thrown === null, 'real telegraf: ctx.reply() no longer throws', String(thrown?.message || ''));
  assert(sent.length === 1 && sent[0].parse_mode === undefined, 'real telegraf: message delivered as plain text', JSON.stringify(sent));
}

console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`);
process.exit(failed === 0 ? 0 : 1);
