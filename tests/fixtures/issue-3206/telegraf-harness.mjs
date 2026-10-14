// @hive-mind-test-skip
/**
 * Preload for tests/telegram-handler-nonblocking-3206.test.mjs (issue #3206).
 *
 * Runs the real src/telegram-bot.mjs against an in-process Telegram stand-in:
 *
 * - `globalThis.use` serves `telegraf` (the fake below) and `@dotenvx/dotenvx`
 *   (a no-op) and imports every other package from node_modules, so nothing is
 *   downloaded.
 * - `globalThis.fetch` refuses every request, so no test reaches the network.
 * - The fake polls the way Telegraf 4 does: one `getUpdates` batch at a time,
 *   `await Promise.all(batch.map(handleUpdate))`, so a handler that does not
 *   return holds back every later update — the behaviour behind issue #3206.
 *   `handlerTimeout` is honoured like Telegraf's `pTimeout`.
 *
 * The parent passes the update batches in HIVE_HARNESS_BATCHES (JSON
 * `[{ atMs, updates: [...] }]`) and receives events over IPC:
 * `{ type: 'api', method, payload, atMs }`, `{ type: 'batch', index, atMs }`,
 * `{ type: 'launched' }`.
 */

import { existsSync } from 'node:fs';

const startedAt = Date.now();
const elapsed = () => Date.now() - startedAt;
const emit = event => {
  if (typeof process.send === 'function') {
    try {
      process.send(event);
    } catch {
      // The parent went away; nothing to report to.
    }
  }
};

globalThis.fetch = async url => {
  throw new Error(`network access is disabled in this test (${url})`);
};

class FakeTelegram {
  constructor() {
    this.nextMessageId = 1000;
  }
  async callApi(method, payload = {}) {
    emit({ type: 'api', method, payload: { chat_id: payload.chat_id, text: typeof payload.text === 'string' ? payload.text.slice(0, 200) : undefined }, atMs: elapsed() });
    if (method === 'sendMessage' || method === 'sendDocument') {
      return { message_id: this.nextMessageId++, chat: { id: payload.chat_id, type: 'supergroup' }, date: Math.floor(Date.now() / 1000), text: payload.text, message_thread_id: payload.message_thread_id };
    }
    if (method === 'getMe') return { id: 1, is_bot: true, username: 'hive_test_bot', first_name: 'Hive' };
    if (method === 'getChatMember') return { status: 'member', user: { id: payload.user_id } };
    if (method === 'getChatAdministrators') return [];
    if (method === 'getWebhookInfo') return { url: '' };
    return true;
  }
  sendMessage(chatId, text, extra = {}) {
    return this.callApi('sendMessage', { chat_id: chatId, text, ...extra });
  }
  editMessageText(chatId, messageId, inlineMessageId, text, extra = {}) {
    return this.callApi('editMessageText', { chat_id: chatId, message_id: messageId, inline_message_id: inlineMessageId, text, ...extra });
  }
  sendDocument(chatId, document, extra = {}) {
    return this.callApi('sendDocument', { chat_id: chatId, document, ...extra });
  }
  deleteWebhook(extra = {}) {
    return this.callApi('deleteWebhook', extra);
  }
  getMe() {
    return this.callApi('getMe', {});
  }
  getWebhookInfo() {
    return this.callApi('getWebhookInfo', {});
  }
  getChatMember(chatId, userId) {
    return this.callApi('getChatMember', { chat_id: chatId, user_id: userId });
  }
  getChatAdministrators(chatId) {
    return this.callApi('getChatAdministrators', { chat_id: chatId });
  }
  setMyCommands(commands, extra = {}) {
    return this.callApi('setMyCommands', { commands, ...extra });
  }
  answerCbQuery(id, text, extra = {}) {
    return this.callApi('answerCallbackQuery', { callback_query_id: id, text, ...extra });
  }
  forwardMessage(chatId, fromChatId, messageId, extra = {}) {
    return this.callApi('forwardMessage', { chat_id: chatId, from_chat_id: fromChatId, message_id: messageId, ...extra });
  }
}

class FakeContext {
  constructor(update, telegram, botInfo) {
    this.update = update;
    this.telegram = telegram;
    this.botInfo = botInfo;
    this.state = {};
  }
  get message() {
    return this.update.message;
  }
  get callbackQuery() {
    return this.update.callback_query;
  }
  get chat() {
    return this.message?.chat ?? this.callbackQuery?.message?.chat;
  }
  get from() {
    return this.message?.from ?? this.callbackQuery?.from;
  }
  get me() {
    return this.botInfo?.username;
  }
  reply(text, extra = {}) {
    const threadId = this.message?.message_thread_id;
    return this.telegram.sendMessage(this.chat.id, text, threadId === undefined ? extra : { message_thread_id: threadId, ...extra });
  }
  replyWithDocument(document, extra = {}) {
    return this.telegram.sendDocument(this.chat.id, document, extra);
  }
  answerCbQuery(text, extra = {}) {
    return this.telegram.answerCbQuery(this.callbackQuery?.id, text, extra);
  }
  editMessageText(text, extra = {}) {
    const msg = this.callbackQuery?.message;
    return this.telegram.editMessageText(msg?.chat?.id, msg?.message_id, undefined, text, extra);
  }
  editMessageReplyMarkup(markup) {
    return this.telegram.callApi('editMessageReplyMarkup', { reply_markup: markup });
  }
}

function commandOf(message) {
  const entity = message?.entities?.[0];
  if (!entity || entity.type !== 'bot_command' || entity.offset !== 0) return null;
  return message.text.slice(1, entity.length).split('@')[0];
}

function matches(trigger, value) {
  if (value == null) return false;
  if (Array.isArray(trigger)) return trigger.some(item => matches(item, value));
  if (trigger instanceof RegExp) return trigger.test(value);
  return trigger === value;
}

class FakeTelegraf {
  constructor(token, options = {}) {
    this.token = token;
    this.options = { handlerTimeout: 90_000, ...options };
    this.telegram = new FakeTelegram();
    this.botInfo = { id: 1, is_bot: true, username: 'hive_test_bot' };
    this.middlewares = [];
    this.errorHandler = error => {
      throw error;
    };
  }
  use(...fns) {
    this.middlewares.push(...fns);
    return this;
  }
  command(trigger, ...fns) {
    return this.use((ctx, next) => (matches(trigger, commandOf(ctx.message)) ? this.chain(fns)(ctx, next) : next()));
  }
  hears(trigger, ...fns) {
    return this.use((ctx, next) => (matches(trigger, ctx.message?.text) ? this.chain(fns)(ctx, next) : next()));
  }
  action(trigger, ...fns) {
    return this.use((ctx, next) => (matches(trigger, ctx.callbackQuery?.data) ? this.chain(fns)(ctx, next) : next()));
  }
  on(type, ...fns) {
    const types = Array.isArray(type) ? type : [type];
    return this.use((ctx, next) => (types.some(item => ctx.update[item] || (item === 'text' && typeof ctx.message?.text === 'string')) ? this.chain(fns)(ctx, next) : next()));
  }
  start(...fns) {
    return this.command('start', ...fns);
  }
  help(...fns) {
    return this.command('help', ...fns);
  }
  catch(handler) {
    this.errorHandler = handler;
    return this;
  }
  chain(fns) {
    return (ctx, next) => {
      const run = index => (index === fns.length ? next() : Promise.resolve(fns[index](ctx, () => run(index + 1))));
      return run(0);
    };
  }
  async handleUpdate(update) {
    const ctx = new FakeContext(update, new FakeTelegram(), this.botInfo);
    const work = Promise.resolve(this.chain(this.middlewares)(ctx, async () => {}));
    try {
      if (this.options.handlerTimeout === Infinity) {
        await work;
      } else {
        let timer;
        const timeout = new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error(`Promise timed out after ${this.options.handlerTimeout} milliseconds`)), this.options.handlerTimeout);
        });
        try {
          await Promise.race([work, timeout]);
        } finally {
          clearTimeout(timer);
        }
      }
    } catch (error) {
      await this.errorHandler(error, ctx);
    }
  }
  async launch(options, onLaunch) {
    if (typeof options === 'function') onLaunch = options;
    emit({ type: 'launched', atMs: elapsed() });
    if (typeof onLaunch === 'function') onLaunch();
    const batches = JSON.parse(process.env.HIVE_HARNESS_BATCHES || '[]');
    // A batch becomes available on Telegram's side independently of the bot:
    // after `atMs`, or once `afterFile` exists. The bot only *fetches* it after
    // the previous batch is fully handled, like Telegraf's polling loop.
    const available = batches.map(
      (batch, index) =>
        new Promise(resolve => {
          let timer = null;
          const check = () => {
            clearTimeout(timer);
            if (batch.afterFile && !existsSync(batch.afterFile)) {
              timer = setTimeout(check, 20);
              return;
            }
            emit({ type: 'available', index, atMs: elapsed() });
            resolve();
          };
          timer = setTimeout(check, batch.atMs || 0);
        })
    );
    for (const [index, batch] of batches.entries()) {
      await available[index];
      const now = Math.floor(Date.now() / 1000) + 1;
      const updates = batch.updates.map(update => (update.message ? { ...update, message: { ...update.message, date: now } } : update));
      emit({ type: 'batch', index, atMs: elapsed() });
      await Promise.all(updates.map(update => this.handleUpdate(update)));
    }
    // Keep "polling" until the parent stops the process.
    await new Promise(() => {});
  }
  stop() {}
}

globalThis.use = async name => {
  if (name === 'telegraf') return { Telegraf: FakeTelegraf, default: { Telegraf: FakeTelegraf } };
  if (name === '@dotenvx/dotenvx') return { config() {}, default: { config() {} } };
  const bare = name.replace(/@[^/@]+$/, '');
  return import(bare);
};
