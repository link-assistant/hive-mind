## Describe the bug

`Telegraf#handleUpdate` builds a **new** `Telegram` instance for every update, so `ctx.telegram !== bot.telegram`:

```js
// lib/telegraf.js (4.16.3, L228)
const tg = new Telegram(this.token, this.telegram.options, webhookResponse);
const TelegrafContext = this.options.contextType;
const ctx = new TelegrafContext(update, tg, this.botInfo);
```

Any instrumentation applied once at startup to `bot.telegram` — logging, retry, rate limiting, a formatting/`parse_mode` fallback — is therefore **silently absent inside handlers**, including in `ctx.reply`, which delegates to `ctx.telegram.sendMessage`. Nothing warns about it: the patched method simply never runs, and the failure mode is "my wrapper works in tests that call `bot.telegram.sendMessage` directly, and does nothing in production".

We hit this in a bot where a plain-text fallback for `400: Bad Request: can't parse entities` was installed on `bot.telegram`. Every real message goes out through `ctx`, so the fallback never fired and users saw nothing at all when a message contained an unescaped `_` (e.g. a GitHub URL such as `https://github.com/Owner/save_visiogetbb/pull/18`).

## Reproduction

No token and no network needed — `handleUpdate` is called directly and the middleware performs no API call.

```js
import { Telegraf } from 'telegraf'; // 4.16.3

const bot = new Telegraf('123456:FAKE_TOKEN_FOR_OFFLINE_REPRODUCTION');
bot.botInfo = { id: 123456, is_bot: true, first_name: 'Repro', username: 'repro_bot' };

// Instrumentation a user would reasonably apply once, at startup.
let instrumentedCalls = 0;
const original = bot.telegram.sendMessage.bind(bot.telegram);
bot.telegram.sendMessage = async (...args) => {
  instrumentedCalls += 1;
  return await original(...args);
};

bot.on('message', async ctx => {
  console.log('ctx.telegram === bot.telegram :', ctx.telegram === bot.telegram);
  console.log('patch visible on ctx.telegram :', ctx.telegram.sendMessage !== Object.getPrototypeOf(ctx.telegram).sendMessage);
});

await bot.handleUpdate({
  update_id: 1,
  message: { message_id: 1, date: 0, chat: { id: 1, type: 'private' }, from: { id: 1, is_bot: false, first_name: 'U' }, text: 'hi' },
});
console.log('instrumented sendMessage calls:', instrumentedCalls);
```

Output on telegraf 4.16.3 / Node 20.20.2:

```
ctx.telegram === bot.telegram : false
patch visible on ctx.telegram : false
instrumented sendMessage calls: 0
```

Expected (for someone who instrumented `bot.telegram`): the patch is visible, or at least the situation is documented.

## Workaround

Re-install the instrumentation on every per-update context, as the first middleware:

```js
bot.use(async (ctx, next) => {
  if (ctx.telegram && !ctx.telegram.__instrumented) {
    installMyWrapper(ctx.telegram); // patches sendMessage / editMessageText / …
    ctx.telegram.__instrumented = true;
  }
  return await next();
});
```

This works (it is what we ship), but it has to be discovered the hard way, it re-patches on every update, and it only covers what the middleware runs before — anything Telegraf itself does with `tg` outside the middleware chain is still unwrapped.

## Suggestions for a fix

1. **Reuse `this.telegram` unless a `webhookResponse` is present.** A fresh instance is only needed to carry `webhookResponse` for webhook-reply mode; in polling mode (and in webhook mode with `webhookReply: false`) the per-update instance carries no per-update state:
   ```js
   const tg = webhookResponse ? new Telegram(this.token, this.telegram.options, webhookResponse) : this.telegram;
   ```
   This also removes an allocation per update. (Related, closed without discussion: #1358.)
2. **If a fresh instance must stay**, derive it from `this.telegram` so user-applied wrappers survive — e.g. `Object.create(this.telegram)` with `webhookResponse` set as an own property, so prototype-chain lookups still find patched methods.
3. **At minimum, document it**, and/or expose a hook (`options.onTelegramCreated?: (tg: Telegram) => Telegram`) so instrumentation has a supported attachment point instead of a `bot.use` monkeypatch.

Options 1 and 2 are backwards compatible for the documented API surface; option 2 additionally preserves per-instance `webhookReply` overrides.

## Context

- telegraf: 4.16.3
- Node.js: v20.20.2
- Platform: Linux
- Downstream analysis and the shipped workaround: https://github.com/link-assistant/hive-mind/issues/2166
