#!/usr/bin/env node

/**
 * Reproduction for telegraf/telegraf: instrumentation applied to `bot.telegram`
 * is invisible to handlers, because `Telegraf#handleUpdate` builds a brand new
 * `Telegram` instance for every update (lib/telegraf.js:228 in 4.16.3):
 *
 *   const tg = new Telegram(this.token, this.telegram.options, webhookResponse)
 *   const ctx = new TelegrafContext(update, tg, this.botInfo)
 *
 * Anything monkeypatched onto `bot.telegram` — logging, retry, rate limiting, a
 * formatting fallback — is therefore silently absent inside `ctx`, and
 * `ctx.reply` (which delegates to `ctx.telegram.sendMessage`) bypasses it.
 *
 * No network access and no bot token are needed: `handleUpdate` is called
 * directly and the middleware never performs a real API call.
 *
 * Run: node experiments/telegraf-per-update-telegram-instance.mjs
 */

import { ensureUseM } from '../src/use-m-bootstrap.lib.mjs';

const use = await ensureUseM();
const { Telegraf } = await use('telegraf@4.16.3');

const bot = new Telegraf('123456:FAKE_TOKEN_FOR_OFFLINE_REPRODUCTION');
bot.botInfo = { id: 123456, is_bot: true, first_name: 'Repro', username: 'repro_bot' };

// The instrumentation a user would reasonably apply once, at startup.
let instrumentedCalls = 0;
const originalSendMessage = bot.telegram.sendMessage.bind(bot.telegram);
bot.telegram.sendMessage = async (...args) => {
  instrumentedCalls += 1;
  return await originalSendMessage(...args);
};

let sameInstance = null;
let patchVisible = null;

bot.on('message', async ctx => {
  sameInstance = ctx.telegram === bot.telegram;
  patchVisible = ctx.telegram.sendMessage !== Object.getPrototypeOf(ctx.telegram).sendMessage;
});

await bot.handleUpdate({
  update_id: 1,
  message: { message_id: 1, date: 0, chat: { id: 1, type: 'private' }, from: { id: 1, is_bot: false, first_name: 'U' }, text: 'hi' },
});

console.log(`ctx.telegram === bot.telegram : ${sameInstance}`);
console.log(`patch visible on ctx.telegram : ${patchVisible}`);
console.log(`instrumented sendMessage calls: ${instrumentedCalls}`);

if (sameInstance === false && patchVisible === false) {
  console.log('\nReproduced: the handler talks to an uninstrumented Telegram instance.');
  process.exit(0);
}
console.log('\nNot reproduced (behaviour may have changed in this telegraf version).');
process.exit(1);
