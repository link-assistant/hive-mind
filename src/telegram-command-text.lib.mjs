/**
 * Unicode-aware helpers for the command prefix Telegram places at the start of
 * a text message.
 *
 * Telegram exposes command offsets in UTF-16 code units, while copied command
 * text can contain whitespace or invisible format characters that look like a
 * normal separator. Keep one boundary grammar for entity fallback, alias
 * selection, and argument parsing so those paths cannot disagree.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2251
 * @see https://core.telegram.org/bots/api#messageentity
 */

const TELEGRAM_COMMAND_PREFIX = /^\/(\w+)(?:@([^\p{White_Space}\p{Cf}]+))?(?=[\p{White_Space}\p{Cf}]|$)[\p{White_Space}\p{Cf}]*/u;

/**
 * @param {string} text
 * @returns {{command: string, botMention: string|null, length: number}|null}
 */
export function parseTelegramCommandPrefix(text) {
  if (!text || typeof text !== 'string') return null;

  const match = text.match(TELEGRAM_COMMAND_PREFIX);
  if (!match) return null;

  return {
    command: match[1].toLowerCase(),
    botMention: match[2] || null,
    length: match[0].length,
  };
}

/**
 * Return the un-tokenized first-line argument tail while applying the same
 * command-boundary policy as command detection.
 *
 * @param {string} text
 * @returns {string}
 */
export function getTelegramCommandArgumentsText(text) {
  if (typeof text !== 'string') return '';

  const firstLine = text.split('\n')[0].trim();
  const prefix = parseTelegramCommandPrefix(firstLine);
  return prefix ? firstLine.slice(prefix.length) : firstLine;
}

/**
 * True for every code point in Unicode's White_Space property. Format
 * characters are deliberately excluded here: URL recovery removes those from
 * inside a URL, whereas splitting on one would turn a repairable URL into two
 * arguments.
 *
 * @param {string} character
 * @returns {boolean}
 */
export function isTelegramCommandArgumentSeparator(character) {
  return /^\p{White_Space}$/u.test(character);
}
