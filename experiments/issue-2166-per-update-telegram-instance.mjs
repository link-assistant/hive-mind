#!/usr/bin/env node

/**
 * Experiment for issue #2166 — why the plain-text fallback never ran.
 *
 * Run: `node experiments/issue-2166-per-update-telegram-instance.mjs`
 *
 * It loads the *real* telegraf package (same loader the bot uses) and prints:
 *   1. whether `ctx.telegram` is the object `installTelegramFormattingFallback`
 *      was installed on (`bot.telegram`);
 *   2. what happens to the exact message that failed in production when only
 *      `bot.telegram` is patched;
 *   3. what happens once `installTelegramContextSafety(bot)` is used instead.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2166
 */

import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';
import { installTelegramFormattingFallback } from '../src/telegram-safe-reply.lib.mjs';
import { installTelegramContextSafety } from '../src/telegram-context-safety.lib.mjs';
import { parseTelegramLegacyMarkdown } from '../src/telegram-markdown-validator.lib.mjs';

if (typeof globalThis.use === 'undefined') await ensureUseM();
const { Telegraf } = await globalThis.use('telegraf');

const FAILING_TEXT = '🗑 Removed queued task for https://github.com/Surrogate-TM/save_visiogetbb/pull/18#issuecomment-5370631063 from `codex` queue.';

const UPDATE = {
  update_id: 957727704,
  message: { message_id: 10, date: 0, chat: { id: -1002975819706, type: 'supergroup' }, from: { id: 7, is_bot: false, first_name: 'Owner' }, text: '/stop' },
};

function makeBot() {
  const sent = [];
  const bot = new Telegraf('123:FAKE');
  bot.botInfo = { id: 1, is_bot: true, first_name: 'hive', username: 'hive_bot' };
  const TelegramClass = Object.getPrototypeOf(bot.telegram).constructor;
  TelegramClass.prototype.callApi = async function fakeCallApi(method, payload = {}) {
    if (method === 'sendMessage' && payload.parse_mode === 'Markdown') {
      const parsed = parseTelegramLegacyMarkdown(payload.text);
      if (!parsed.ok) {
        const error = new Error(`400: ${parsed.description}`);
        error.response = { error_code: 400, description: parsed.description };
        error.description = parsed.description;
        throw error;
      }
    }
    sent.push({ method, ...payload });
    return { message_id: sent.length };
  };
  return { bot, sent };
}

console.log('--- 1. Does the update context reuse bot.telegram? ---');
{
  const { bot } = makeBot();
  bot.use(ctx => {
    console.log('ctx.telegram === bot.telegram :', ctx.telegram === bot.telegram);
  });
  await bot.handleUpdate(UPDATE);
}

console.log('\n--- 2. Patching bot.telegram only (the production configuration) ---');
{
  const { bot, sent } = makeBot();
  installTelegramFormattingFallback(bot.telegram, { verbose: false });
  bot.use(async ctx => ctx.reply(FAILING_TEXT, { parse_mode: 'Markdown' }));
  bot.catch(error => console.log('bot.catch received:', error.message));
  await bot.handleUpdate(UPDATE);
  console.log('messages delivered to the user:', sent.length);
}

console.log('\n--- 3. With installTelegramContextSafety(bot) ---');
{
  const { bot, sent } = makeBot();
  installTelegramContextSafety(bot, { verbose: false });
  bot.use(async ctx => ctx.reply(FAILING_TEXT, { parse_mode: 'Markdown' }));
  bot.catch(error => console.log('bot.catch received:', error.message));
  await bot.handleUpdate(UPDATE);
  console.log('messages delivered to the user:', sent.length, '| parse_mode:', sent[0]?.parse_mode);
  console.log('text:', sent[0]?.text);
}
