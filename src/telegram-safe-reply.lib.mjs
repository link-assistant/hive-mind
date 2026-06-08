import { normalizeLocale, t } from './i18n.lib.mjs';

const FORMATTING_FALLBACK_INSTALLED = Symbol.for('hiveMind.telegramFormattingFallbackInstalled');
const DEFAULT_FORMATTING_FALLBACK_WARNING = '⚠️ Formatting error detected. Showing plain text fallback.';
export const TELEGRAM_TEXT_LIMIT = 4096;
const FORMATTING_FALLBACK_WARNINGS = {
  en: DEFAULT_FORMATTING_FALLBACK_WARNING,
  ru: '⚠️ Обнаружена ошибка форматирования. Показываю обычный текст.',
  zh: '⚠️ 检测到格式错误。正在显示纯文本备用内容。',
  hi: '⚠️ फ़ॉर्मैटिंग त्रुटि मिली। सादा पाठ fallback दिखाया जा रहा है।',
};

function splitOptions(options = {}) {
  const { fallbackLocale, locale, verbose, ...telegramOptions } = options || {};
  return {
    telegramOptions,
    fallbackLocale: fallbackLocale || locale || null,
    verbose: Boolean(verbose),
  };
}

function getTelegramErrorMessage(error) {
  return error?.description || error?.message || String(error || '');
}

export function isTelegramFormattingError(error) {
  const message = getTelegramErrorMessage(error);
  return /can't parse entities/i.test(message) || /can't find end of/i.test(message) || /entity.*parse/i.test(message) || /parse.*entity/i.test(message) || /character .* is reserved/i.test(message) || /unsupported start tag/i.test(message);
}

export function isTelegramMessageTooLongError(error) {
  const message = getTelegramErrorMessage(error);
  return /message is too long/i.test(message) || /message text is too long/i.test(message) || /text is too long/i.test(message) || /message_too_long/i.test(message) || (/bad request/i.test(message) && /too long/i.test(message) && /(message|text|caption)/i.test(message));
}

export function stripTelegramMarkdown(text) {
  return String(text ?? '')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/```([\s\S]*?)```/g, '$1')
    .replace(/\\_/g, '_')
    .replace(/\\\*/g, '*')
    .replace(/\\`/g, '`')
    .replace(/\\\[/g, '[')
    .replace(/\*([^*\n]+)\*/g, '$1')
    .replace(/_([^_\n]+)_/g, '$1')
    .replace(/`([^`]+)`/g, '$1');
}

function findTelegramSplitIndex(text, limit) {
  const minUsefulSplit = Math.floor(limit * 0.45);
  const separators = ['\n\n', '\n', '. ', '; ', ', ', ' '];

  for (const separator of separators) {
    const searchEnd = Math.max(0, limit - separator.length);
    const index = text.lastIndexOf(separator, searchEnd);
    if (index >= minUsefulSplit) {
      return index + separator.length;
    }
  }

  return limit;
}

export function splitTelegramMessageText(text, limit = TELEGRAM_TEXT_LIMIT) {
  const source = String(text ?? '');
  if (source.length <= limit) return [source];

  const chunks = [];
  let remaining = source;

  while (remaining.length > limit) {
    let splitAt = findTelegramSplitIndex(remaining, limit);
    let chunk = remaining.slice(0, splitAt).trimEnd();

    if (!chunk) {
      splitAt = limit;
      chunk = remaining.slice(0, splitAt);
    }

    chunks.push(chunk);
    remaining = remaining.slice(splitAt).trimStart();
  }

  if (remaining) chunks.push(remaining);
  return chunks;
}

function getFormattingFallbackWarning(locale) {
  const key = 'telegram.formatting_fallback_warning';
  const normalizedLocale = normalizeLocale(locale);
  const warning = t(key, {}, locale ? { locale } : {});
  if (warning !== key && (normalizedLocale === 'en' || warning !== DEFAULT_FORMATTING_FALLBACK_WARNING)) return warning;
  return FORMATTING_FALLBACK_WARNINGS[normalizedLocale] || DEFAULT_FORMATTING_FALLBACK_WARNING;
}

export function buildTelegramFormattingFallbackText(text, options = {}) {
  const locale = options?.fallbackLocale || options?.locale || null;
  return `${getFormattingFallbackWarning(locale)}\n\n${stripTelegramMarkdown(text)}`;
}

function logFormattingFailure(scope, error, text, verbose = false, fallbackText = null) {
  const message = getTelegramErrorMessage(error);
  console.error(`[telegram-bot] ${scope}: formatted Telegram message failed: ${message}`);
  if (verbose) {
    const originalBytes = Buffer.byteLength(String(text ?? ''), 'utf-8');
    console.error(`[telegram-bot] ${scope}: Failing message (${originalBytes} bytes): ${text}`);
    // Issue #1801: when the parser rejects an entity, surface the byte offset
    //   from the error along with a small window of the message around it to
    //   make pinpointing the offending character trivial on the next iteration.
    const offsetMatch = /byte offset (\d+)/i.exec(message);
    if (offsetMatch) {
      const offset = Number(offsetMatch[1]);
      const buf = Buffer.from(String(text ?? ''), 'utf-8');
      const start = Math.max(0, offset - 32);
      const end = Math.min(buf.length, offset + 32);
      // Decode the window; replacement character is used for bytes that fall
      // mid-codepoint so we still print *something* useful.
      const window = buf.slice(start, end).toString('utf-8');
      console.error(`[telegram-bot] ${scope}: Byte offset ${offset} context [${start}..${end}]: ${JSON.stringify(window)}`);
    }
    if (fallbackText !== null) {
      const fallbackBytes = Buffer.byteLength(String(fallbackText ?? ''), 'utf-8');
      console.error(`[telegram-bot] ${scope}: Fallback message (${fallbackBytes} bytes): ${fallbackText}`);
    }
  }
}

function logMessageTooLongFailure(scope, error, text, verbose = false, fallbackText = null) {
  const message = getTelegramErrorMessage(error);
  console.error(`[telegram-bot] ${scope}: Telegram message exceeded ${TELEGRAM_TEXT_LIMIT} character limit: ${message}`);
  if (verbose) {
    const original = String(text ?? '');
    console.error(`[telegram-bot] ${scope}: Oversized message (${original.length} chars, ${Buffer.byteLength(original, 'utf-8')} bytes): ${original}`);
    if (fallbackText !== null) {
      const fallback = String(fallbackText ?? '');
      console.error(`[telegram-bot] ${scope}: Plain text fallback (${fallback.length} chars, ${Buffer.byteLength(fallback, 'utf-8')} bytes): ${fallback}`);
    }
  }
}

function logChunking(scope, text, chunks, verbose = false) {
  if (chunks.length <= 1) return;
  const source = String(text ?? '');
  console.warn(`[telegram-bot] ${scope}: Telegram text is ${source.length} chars (${Buffer.byteLength(source, 'utf-8')} bytes), splitting into ${chunks.length} messages (limit ${TELEGRAM_TEXT_LIMIT}).`);
  if (verbose) {
    chunks.forEach((chunk, index) => {
      console.error(`[telegram-bot] ${scope}: Chunk ${index + 1}/${chunks.length} (${chunk.length} chars, ${Buffer.byteLength(chunk, 'utf-8')} bytes): ${chunk}`);
    });
  }
}

function getPlainTextOptions(telegramOptions) {
  return { ...telegramOptions, parse_mode: undefined, entities: undefined };
}

async function sendPlainTextChunks({ text, telegramOptions, scope, verbose, sendChunk }) {
  const plainOptions = getPlainTextOptions(telegramOptions);
  const chunks = splitTelegramMessageText(text);
  logChunking(`${scope}:plainText`, text, chunks, verbose);

  let firstResult;
  for (const chunk of chunks) {
    const result = await sendChunk(chunk, plainOptions);
    if (firstResult === undefined) firstResult = result;
  }
  return firstResult;
}

async function sendTelegramTextChunks({ text, telegramOptions, fallbackLocale, verbose, scope, sendChunk }) {
  const chunks = splitTelegramMessageText(text);
  logChunking(scope, text, chunks, verbose);

  let firstResult;
  for (const chunk of chunks) {
    try {
      const result = await sendChunk(chunk, telegramOptions);
      if (firstResult === undefined) firstResult = result;
    } catch (error) {
      let fallbackText;
      if (isTelegramFormattingError(error)) {
        fallbackText = buildTelegramFormattingFallbackText(chunk, { fallbackLocale });
        logFormattingFailure(scope, error, chunk, verbose, fallbackText);
      } else if (isTelegramMessageTooLongError(error)) {
        fallbackText = stripTelegramMarkdown(chunk);
        logMessageTooLongFailure(scope, error, chunk, verbose, fallbackText);
      } else {
        throw error;
      }

      const result = await sendPlainTextChunks({
        text: fallbackText,
        telegramOptions,
        scope,
        verbose,
        sendChunk,
      });
      if (firstResult === undefined) firstResult = result;
    }
  }

  return firstResult;
}

async function sendRemainingEditChunks({ chunks, telegramOptions, fallbackLocale, verbose, scope, sendFollowUpChunk }) {
  if (chunks.length === 0) return undefined;
  if (!sendFollowUpChunk) {
    console.error(`[telegram-bot] ${scope}: cannot send ${chunks.length} remaining chunk(s) after edit because chat_id is unavailable.`);
    return undefined;
  }

  return await sendTelegramTextChunks({
    text: chunks.join('\n'),
    telegramOptions,
    fallbackLocale,
    verbose,
    scope: `${scope}:followUp`,
    sendChunk: sendFollowUpChunk,
  });
}

async function sendPlainRemainingEditChunks({ chunks, telegramOptions, verbose, scope, sendFollowUpChunk }) {
  if (chunks.length === 0) return undefined;
  if (!sendFollowUpChunk) {
    console.error(`[telegram-bot] ${scope}: cannot send ${chunks.length} plain-text fallback chunk(s) after edit because chat_id is unavailable.`);
    return undefined;
  }

  return await sendPlainTextChunks({
    text: chunks.join('\n'),
    telegramOptions,
    scope: `${scope}:followUp`,
    verbose,
    sendChunk: sendFollowUpChunk,
  });
}

async function editTelegramTextChunks({ text, telegramOptions, fallbackLocale, verbose, scope, editChunk, sendFollowUpChunk }) {
  const chunks = splitTelegramMessageText(text);
  logChunking(scope, text, chunks, verbose);

  const [firstChunk, ...remainingChunks] = chunks;
  try {
    const result = await editChunk(firstChunk, telegramOptions);
    await sendRemainingEditChunks({
      chunks: remainingChunks,
      telegramOptions,
      fallbackLocale,
      verbose,
      scope,
      sendFollowUpChunk,
    });
    return result;
  } catch (error) {
    let fallbackText;
    if (isTelegramFormattingError(error)) {
      fallbackText = buildTelegramFormattingFallbackText(firstChunk, { fallbackLocale });
      logFormattingFailure(scope, error, firstChunk, verbose, fallbackText);
    } else if (isTelegramMessageTooLongError(error)) {
      fallbackText = stripTelegramMarkdown(firstChunk);
      logMessageTooLongFailure(scope, error, firstChunk, verbose, fallbackText);
    } else {
      throw error;
    }

    const plainOptions = getPlainTextOptions(telegramOptions);
    const fallbackChunks = splitTelegramMessageText(fallbackText);
    logChunking(`${scope}:plainText`, fallbackText, fallbackChunks, verbose);
    const [firstFallbackChunk, ...remainingFallbackChunks] = fallbackChunks;
    const result = await editChunk(firstFallbackChunk, plainOptions);
    await sendPlainRemainingEditChunks({
      chunks: [...remainingFallbackChunks, ...remainingChunks.map(stripTelegramMarkdown)],
      telegramOptions,
      verbose,
      scope,
      sendFollowUpChunk,
    });
    return result;
  }
}

// Issue #1460/#1497/#1788: try Markdown first, fall back to localized plain text on parsing errors.
export async function safeReply(ctx, text, options = {}) {
  const { telegramOptions, fallbackLocale, verbose } = splitOptions(options);
  const firstOptions = { parse_mode: 'Markdown', ...telegramOptions };
  return await sendTelegramTextChunks({
    text,
    telegramOptions: firstOptions,
    fallbackLocale,
    verbose,
    scope: 'safeReply',
    sendChunk: (chunk, chunkOptions) => ctx.reply(chunk, chunkOptions),
  });
}

export async function safeEditMessageText(telegram, chatId, messageId, inlineMessageId, text, options = {}) {
  const { telegramOptions, fallbackLocale, verbose } = splitOptions(options);
  const firstOptions = { parse_mode: 'Markdown', ...telegramOptions };
  return await editTelegramTextChunks({
    text,
    telegramOptions: firstOptions,
    fallbackLocale,
    verbose,
    scope: 'safeEditMessageText',
    editChunk: (chunk, chunkOptions) => telegram.editMessageText(chatId, messageId, inlineMessageId, chunk, chunkOptions),
    sendFollowUpChunk: chatId !== undefined && chatId !== null && typeof telegram.sendMessage === 'function' ? (chunk, chunkOptions) => telegram.sendMessage(chatId, chunk, chunkOptions) : null,
  });
}

function wrapTelegramSendMessage(telegram, defaults = {}) {
  const original = telegram?.sendMessage;
  if (typeof original !== 'function') return;

  telegram.sendMessage = async function wrappedTelegramSendMessage(...args) {
    const text = args[1];
    const originalOptions = args[2] || {};
    const { telegramOptions, fallbackLocale, verbose } = splitOptions(originalOptions);
    args[2] = telegramOptions;

    if (typeof text !== 'string') return await original.apply(this, args);

    return await sendTelegramTextChunks({
      text,
      telegramOptions,
      fallbackLocale: fallbackLocale || defaults.fallbackLocale,
      verbose: verbose || defaults.verbose,
      scope: 'sendMessage',
      sendChunk: (chunk, chunkOptions) => {
        const chunkArgs = [...args];
        chunkArgs[1] = chunk;
        chunkArgs[2] = chunkOptions;
        return original.apply(this, chunkArgs);
      },
    });
  };
}

function wrapTelegramEditMessageText(telegram, defaults = {}) {
  const original = telegram?.editMessageText;
  if (typeof original !== 'function') return;

  telegram.editMessageText = async function wrappedTelegramEditMessageText(...args) {
    const text = args[3];
    const originalOptions = args[4] || {};
    const { telegramOptions, fallbackLocale, verbose } = splitOptions(originalOptions);
    args[4] = telegramOptions;

    if (typeof text !== 'string') return await original.apply(this, args);

    return await editTelegramTextChunks({
      text,
      telegramOptions,
      fallbackLocale: fallbackLocale || defaults.fallbackLocale,
      verbose: verbose || defaults.verbose,
      scope: 'editMessageText',
      editChunk: (chunk, chunkOptions) => {
        const chunkArgs = [...args];
        chunkArgs[3] = chunk;
        chunkArgs[4] = chunkOptions;
        return original.apply(this, chunkArgs);
      },
      sendFollowUpChunk: args[0] !== undefined && args[0] !== null && typeof this.sendMessage === 'function' ? (chunk, chunkOptions) => this.sendMessage(args[0], chunk, chunkOptions) : null,
    });
  };
}

export function installTelegramFormattingFallback(telegram, options = {}) {
  if (!telegram || telegram[FORMATTING_FALLBACK_INSTALLED]) return telegram;

  const defaults = {
    fallbackLocale: options.fallbackLocale || options.locale || null,
    verbose: Boolean(options.verbose),
  };

  wrapTelegramSendMessage(telegram, defaults);
  wrapTelegramEditMessageText(telegram, defaults);
  telegram[FORMATTING_FALLBACK_INSTALLED] = true;
  return telegram;
}
