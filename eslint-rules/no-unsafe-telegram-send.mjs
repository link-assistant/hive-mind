/**
 * ESLint rule: every Telegram message with a `parse_mode` must go through the
 * single safe send funnel (issue #2166).
 *
 * Background — the failure this rule prevents:
 *
 *   Telegram answers a malformed legacy-Markdown message with
 *   `400: Bad Request: can't parse entities: Can't find end of the entity
 *   starting at byte offset N`. A raw `ctx.reply(text, { parse_mode: 'Markdown' })`
 *   turns that into an unhandled rejection, so the user sees *nothing at all* —
 *   the `/stop` confirmation in issue #2166 vanished exactly this way.
 *
 * The project therefore funnels every formatted send through
 * `src/telegram-safe-reply.lib.mjs`, which
 *   1. validates the text with a port of TDLib's `parse_markdown()` *before*
 *      the API call ("check early"),
 *   2. logs every attempt / success / rejection so failures are investigable,
 *   3. falls back to plain text instead of throwing.
 *
 * What is reported:
 *   `<obj>.reply(...)`, `<obj>.sendMessage(...)`, `<obj>.editMessageText(...)`,
 *   `<obj>.editMessageCaption(...)`, `<obj>.replyWithDocument(...)`,
 *   `<obj>.replyWithPhoto(...)` when one of the arguments is an object literal
 *   carrying `parse_mode`, plus the always-formatted helpers
 *   `replyWithMarkdown` / `replyWithMarkdownV2` / `replyWithHTML`.
 *
 * How to satisfy the rule:
 *   - `safeReply(ctx, text, options)` — for handler replies
 *   - `safeEditMessageText(telegram, chatId, messageId, undefined, text, options)`
 *   - `safeSendMessage(telegram, chatId, text, options)` — for bot-initiated sends
 *   both from `src/telegram-safe-reply.lib.mjs`.
 *
 * The safe-send implementation itself is exempt (it is the funnel), as is the
 * per-update installer that re-installs it on every `ctx.telegram`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2166
 */

const SEND_METHODS = new Set(['reply', 'sendMessage', 'editMessageText', 'editMessageCaption', 'replyWithDocument', 'replyWithPhoto', 'replyWithAnimation', 'replyWithVideo']);

const ALWAYS_FORMATTED_METHODS = new Set(['replyWithMarkdown', 'replyWithMarkdownV2', 'replyWithHTML']);

// Files that *are* the funnel (or install it) and therefore must call the raw
// Telegram methods.
const EXEMPT_FILES = new Set(['telegram-safe-reply.lib.mjs', 'telegram-context-safety.lib.mjs', 'telegram-markdown-validator.lib.mjs']);

const basename = filename =>
  String(filename || '')
    .split(/[\\/]/)
    .pop();

const objectHasParseMode = node => {
  if (!node || node.type !== 'ObjectExpression') return false;
  for (const prop of node.properties) {
    if (prop.type === 'SpreadElement') continue;
    const key = prop.key;
    if (!key) continue;
    const name = key.type === 'Identifier' ? key.name : key.type === 'Literal' ? key.value : null;
    if (name === 'parse_mode') return true;
  }
  return false;
};

const argumentsCarryParseMode = args => (args || []).some(objectHasParseMode);

export const _testing = { objectHasParseMode, argumentsCarryParseMode, SEND_METHODS, ALWAYS_FORMATTED_METHODS };

export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Require formatted Telegram sends to go through safeReply/safeSendMessage/safeEditMessageText. See issue #2166.',
      category: 'Possible Errors',
      recommended: true,
    },
    messages: {
      unsafeSend: 'Raw `{{method}}(…, { parse_mode })` bypasses the safe Telegram send funnel: a malformed entity becomes an unhandled 400 and the user sees nothing. Use safeReply/safeSendMessage/safeEditMessageText from src/telegram-safe-reply.lib.mjs (issue #2166).',
      unsafeFormattedHelper: 'Raw `{{method}}()` always sends formatted text and bypasses the safe Telegram send funnel. Use safeReply from src/telegram-safe-reply.lib.mjs (issue #2166).',
    },
    schema: [],
  },

  create(context) {
    const filename = context.filename || context.getFilename();
    if (EXEMPT_FILES.has(basename(filename))) return {};

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression' || callee.property?.type !== 'Identifier') return;
        const method = callee.property.name;

        if (ALWAYS_FORMATTED_METHODS.has(method)) {
          context.report({ node, messageId: 'unsafeFormattedHelper', data: { method } });
          return;
        }
        if (!SEND_METHODS.has(method)) return;
        if (!argumentsCarryParseMode(node.arguments)) return;
        context.report({ node, messageId: 'unsafeSend', data: { method } });
      },
    };
  },
};
