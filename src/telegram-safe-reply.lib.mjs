import { normalizeLocale, t } from './i18n.lib.mjs';

const FORMATTING_FALLBACK_INSTALLED = Symbol.for('hiveMind.telegramFormattingFallbackInstalled');
const DEFAULT_FORMATTING_FALLBACK_WARNING = '⚠️ Formatting error detected. Showing plain text fallback.';
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

export function isTelegramFormattingError(error) {
  const message = error?.description || error?.message || String(error || '');
  return /can't parse entities/i.test(message) || /can't find end of/i.test(message) || /entity.*parse/i.test(message) || (/bad request/i.test(message) && /400|parse|entity/i.test(message));
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
  const message = error?.description || error?.message || String(error || '');
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

// Issue #1460/#1497/#1788: try Markdown first, fall back to localized plain text on parsing errors.
export async function safeReply(ctx, text, options = {}) {
  const { telegramOptions, fallbackLocale, verbose } = splitOptions(options);
  const firstOptions = { parse_mode: 'Markdown', ...telegramOptions };
  try {
    return await ctx.reply(text, firstOptions);
  } catch (error) {
    if (!isTelegramFormattingError(error)) throw error;
    const fallbackText = buildTelegramFormattingFallbackText(text, { fallbackLocale });
    logFormattingFailure('safeReply', error, text, verbose, fallbackText);
    return await ctx.reply(fallbackText, { ...telegramOptions, parse_mode: undefined });
  }
}

export async function safeEditMessageText(telegram, chatId, messageId, inlineMessageId, text, options = {}) {
  const { telegramOptions, fallbackLocale, verbose } = splitOptions(options);
  const firstOptions = { parse_mode: 'Markdown', ...telegramOptions };
  try {
    return await telegram.editMessageText(chatId, messageId, inlineMessageId, text, firstOptions);
  } catch (error) {
    if (!isTelegramFormattingError(error)) throw error;
    const fallbackText = buildTelegramFormattingFallbackText(text, { fallbackLocale });
    logFormattingFailure('safeEditMessageText', error, text, verbose, fallbackText);
    return await telegram.editMessageText(chatId, messageId, inlineMessageId, fallbackText, { ...telegramOptions, parse_mode: undefined });
  }
}

function wrapTelegramMethod(telegram, methodName, textIndex, optionsIndex, defaults = {}) {
  const original = telegram?.[methodName];
  if (typeof original !== 'function') return;

  telegram[methodName] = async function wrappedTelegramMessageMethod(...args) {
    const text = args[textIndex];
    const originalOptions = args[optionsIndex] || {};
    const { telegramOptions, fallbackLocale, verbose } = splitOptions(originalOptions);
    args[optionsIndex] = telegramOptions;

    try {
      return await original.apply(this, args);
    } catch (error) {
      if (!isTelegramFormattingError(error) || typeof text !== 'string') throw error;
      const fallbackText = buildTelegramFormattingFallbackText(text, { fallbackLocale: fallbackLocale || defaults.fallbackLocale });
      logFormattingFailure(methodName, error, text, verbose || defaults.verbose, fallbackText);
      const retryArgs = [...args];
      retryArgs[textIndex] = fallbackText;
      retryArgs[optionsIndex] = { ...telegramOptions, parse_mode: undefined };
      return await original.apply(this, retryArgs);
    }
  };
}

export function installTelegramFormattingFallback(telegram, options = {}) {
  if (!telegram || telegram[FORMATTING_FALLBACK_INSTALLED]) return telegram;

  const defaults = {
    fallbackLocale: options.fallbackLocale || options.locale || null,
    verbose: Boolean(options.verbose),
  };

  wrapTelegramMethod(telegram, 'sendMessage', 1, 2, defaults);
  wrapTelegramMethod(telegram, 'editMessageText', 3, 4, defaults);
  telegram[FORMATTING_FALLBACK_INSTALLED] = true;
  return telegram;
}
