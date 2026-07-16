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

// A Markdown fenced code block opens/closes with ``` or ~~~ (optionally indented
// and, on the opening fence, followed by a language/info string). We track these
// so a split that lands inside a code block can close the fence on the current
// chunk and reopen it — repeating the language — on the next one (issue #1891).
const CODE_FENCE_RE = /^(\s*)(```+|~~~+)(.*)$/;

/**
 * Parse a single line as a Markdown code-fence delimiter.
 *
 * @param {string} line
 * @returns {{indent: string, marker: string, info: string}|null}
 *   The fence parts, or `null` when the line is not a fence.
 */
export function parseCodeFence(line) {
  const match = CODE_FENCE_RE.exec(line);
  if (!match) return null;
  return { indent: match[1], marker: match[2], info: match[3].trim() };
}

/**
 * Hard-split a single physical line that is itself longer than `limit` into
 * pieces that each fit, preferring a break at a natural separator near the end
 * and falling back to a hard character cut. Used only for pathologically long
 * lines (normal queue/help lines are short).
 *
 * @param {string} line
 * @param {number} limit
 * @returns {string[]}
 */
function splitLongLine(line, limit) {
  const pieces = [];
  let remaining = line;
  while (remaining.length > limit) {
    let splitAt = findTelegramSplitIndex(remaining, limit);
    if (splitAt <= 0 || splitAt > limit) splitAt = limit;
    let piece = remaining.slice(0, splitAt);
    if (!piece.trim()) {
      splitAt = limit;
      piece = remaining.slice(0, splitAt);
    }
    pieces.push(piece);
    remaining = remaining.slice(splitAt);
  }
  if (remaining) pieces.push(remaining);
  return pieces;
}

/**
 * Split a (possibly oversized) Telegram message into chunks that each stay
 * within `limit` characters.
 *
 * Splitting happens on line boundaries so inline Markdown entities (bold,
 * italic, links — none of which may span a newline in Telegram's legacy
 * Markdown) are never cut in half. Fenced code blocks, which *do* span lines,
 * are kept valid across the split: when a break lands inside a code block the
 * current chunk gets a closing fence appended and the next chunk re-opens the
 * fence with the same marker and language (issue #1891).
 *
 * @param {string} text
 * @param {number} [limit=TELEGRAM_TEXT_LIMIT]
 * @returns {string[]} One or more chunks; always at least one element.
 */
export function splitTelegramMessageText(text, limit = TELEGRAM_TEXT_LIMIT) {
  const source = String(text ?? '');
  if (source.length <= limit) return [source];

  // Reserve headroom on each physical line for a possible fence reopen/close
  // pair so re-wrapping a code block never pushes a chunk past the limit.
  const FENCE_HEADROOM = 16;
  const lineLimit = Math.max(1, limit - FENCE_HEADROOM);

  // Expand into physical lines, pre-splitting any line that alone exceeds the
  // budget so the chunker below only ever deals with lines that fit.
  const lines = [];
  for (const raw of source.split('\n')) {
    if (raw.length <= lineLimit) lines.push(raw);
    else lines.push(...splitLongLine(raw, lineLimit));
  }

  const chunks = [];
  let current = '';
  let openFence = null; // { indent, marker, info } while inside a code block

  const closeFenceLine = () => `${openFence.indent}${openFence.marker}`;
  const reopenFenceLine = () => `${openFence.indent}${openFence.marker}${openFence.info}`;

  const flush = () => {
    let chunk = current;
    if (openFence) {
      // Close the still-open code block at the end of this chunk.
      chunk = chunk.length ? `${chunk}\n${closeFenceLine()}` : closeFenceLine();
    }
    chunks.push(chunk);
    // Re-open the fence at the start of the next chunk so the code block (and
    // its language) continues seamlessly.
    current = openFence ? reopenFenceLine() : '';
  };

  for (const line of lines) {
    const separatorLength = current.length ? 1 : 0;
    const closeReserve = openFence ? closeFenceLine().length + 1 : 0;
    const projected = current.length + separatorLength + line.length + closeReserve;

    if (current.length > 0 && projected > limit) {
      flush();
    }

    current = current.length ? `${current}\n${line}` : line;

    const fence = parseCodeFence(line);
    if (fence) {
      // A fence line toggles code-block state: open when outside, close when
      // already inside.
      openFence = openFence ? null : fence;
    }
  }

  // Defensive: close any fence left open by unbalanced input.
  if (openFence && current.length) {
    current = `${current}\n${closeFenceLine()}`;
  }
  if (current.length || chunks.length === 0) chunks.push(current);

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
