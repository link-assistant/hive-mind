/**
 * Faithful port of TDLib's legacy-Markdown parser used by the Telegram Bot API
 * (`parse_mode: 'Markdown'`), so the bot can tell *before* sending whether
 * Telegram will reject a message with
 * `Bad Request: can't parse entities: Can't find end of the entity starting at byte offset N`.
 *
 * Reference implementation: td/telegram/MessageEntity.cpp — `parse_markdown()`
 * https://github.com/tdlib/td/blob/master/td/telegram/MessageEntity.cpp
 *
 * The two properties that matter for this repository (issue #2166):
 *
 *  1. Only `\_`, `\*`, `` \` `` and `\[` are recognised as escape sequences, and
 *     **only at top level**. Inside an entity (for example the label of a
 *     `[label](url)` link) every byte is copied verbatim, so `\_` there is shown
 *     to the user as a literal backslash + underscore.
 *  2. An unterminated `_`, `*`, `` ` `` or `[` makes the whole message fail with
 *     HTTP 400 and a *byte* offset pointing at the opening character.
 *
 * @module telegram-markdown-validator.lib
 * @see https://github.com/link-assistant/hive-mind/issues/2166
 */

const UNDERSCORE = 0x5f; // _
const ASTERISK = 0x2a; // *
const BACKTICK = 0x60; // `
const OPEN_BRACKET = 0x5b; // [
const CLOSE_BRACKET = 0x5d; // ]
const BACKSLASH = 0x5c; // \
const OPEN_PAREN = 0x28; // (
const CLOSE_PAREN = 0x29; // )
const LF = 0x0a;
const CR = 0x0d;

/** Parse modes this module knows how to validate. */
export const VALIDATABLE_PARSE_MODES = Object.freeze(['Markdown']);

function isUtf8CharacterFirstCodeUnit(byte) {
  return (byte & 0xc0) !== 0x80;
}

function isSpaceByte(byte) {
  return byte === 0x20 || byte === 0x09 || byte === LF || byte === 0x0b || byte === 0x0c || byte === CR;
}

/**
 * Parse `text` exactly like TDLib's `parse_markdown()`.
 *
 * @param {string} text - Message text as it would be sent with `parse_mode: 'Markdown'`.
 * @returns {{ok: true, text: string, entities: Array<{type: string, offset: number, length: number, url?: string}>}
 *          |{ok: false, byteOffset: number, description: string}}
 *   On success, the rendered plain text (escapes removed, markup consumed) plus
 *   the entities Telegram would create. On failure, the byte offset of the
 *   unterminated entity and the exact Bot API error description.
 */
export function parseTelegramLegacyMarkdown(text) {
  const source = Buffer.from(String(text ?? ''), 'utf-8');
  const size = source.length;
  // TDLib relies on std::string's NUL terminator when it peeks past the end.
  const at = index => (index >= 0 && index < size ? source[index] : 0);

  const out = Buffer.alloc(size);
  let resultSize = 0;
  let utf16Offset = 0;
  const entities = [];

  for (let i = 0; i < size; i++) {
    const c = source[i];
    if (c === BACKSLASH && (at(i + 1) === UNDERSCORE || at(i + 1) === ASTERISK || at(i + 1) === BACKTICK || at(i + 1) === OPEN_BRACKET)) {
      i++;
      out[resultSize++] = source[i];
      utf16Offset++;
      continue;
    }
    if (c !== UNDERSCORE && c !== ASTERISK && c !== BACKTICK && c !== OPEN_BRACKET) {
      if (isUtf8CharacterFirstCodeUnit(c)) utf16Offset += 1 + (c >= 0xf0 ? 1 : 0);
      out[resultSize++] = source[i];
      continue;
    }

    // We are at the beginning of an entity.
    const beginPos = i;
    let endCharacter = c;
    let isPre = false;
    if (c === OPEN_BRACKET) endCharacter = CLOSE_BRACKET;

    i++;

    let language = '';
    if (c === BACKTICK && at(i) === BACKTICK && at(i + 1) === BACKTICK) {
      i += 2;
      isPre = true;
      let languageEnd = i;
      while (!isSpaceByte(at(languageEnd)) && at(languageEnd) !== BACKTICK) languageEnd++;
      if (i !== languageEnd && languageEnd < size && at(languageEnd) !== BACKTICK) {
        language = source.slice(i, languageEnd).toString('utf-8');
        i = languageEnd;
      }
      // Skip one newline at the beginning of the text.
      if (at(i) === LF || at(i) === CR) {
        if ((at(i + 1) === LF || at(i + 1) === CR) && at(i) !== at(i + 1)) i += 2;
        else i++;
      }
    }

    const entityOffset = utf16Offset;
    while (i < size && (source[i] !== endCharacter || (isPre && !(at(i + 1) === BACKTICK && at(i + 2) === BACKTICK)))) {
      const cur = source[i];
      if (isUtf8CharacterFirstCodeUnit(cur)) utf16Offset += 1 + (cur >= 0xf0 ? 1 : 0);
      out[resultSize++] = source[i++];
    }
    if (i === size) {
      return {
        ok: false,
        byteOffset: beginPos,
        description: `Bad Request: can't parse entities: Can't find end of the entity starting at byte offset ${beginPos}`,
      };
    }

    if (entityOffset !== utf16Offset) {
      const entityLength = utf16Offset - entityOffset;
      if (c === UNDERSCORE) entities.push({ type: 'italic', offset: entityOffset, length: entityLength });
      else if (c === ASTERISK) entities.push({ type: 'bold', offset: entityOffset, length: entityLength });
      else if (c === OPEN_BRACKET) {
        let url;
        if (at(i + 1) !== OPEN_PAREN) {
          url = source.slice(beginPos + 1, i).toString('utf-8');
        } else {
          i += 2;
          const urlStart = i;
          while (i < size && source[i] !== CLOSE_PAREN) i++;
          url = source.slice(urlStart, i).toString('utf-8');
        }
        if (url) entities.push({ type: 'text_link', offset: entityOffset, length: entityLength, url });
      } else if (c === BACKTICK) {
        if (isPre) entities.push({ type: 'pre', offset: entityOffset, length: entityLength, ...(language ? { language } : {}) });
        else entities.push({ type: 'code', offset: entityOffset, length: entityLength });
      }
    }
    if (isPre) i += 2;
  }

  return { ok: true, text: out.slice(0, resultSize).toString('utf-8'), entities };
}

/**
 * Render a small window of `text` around a byte offset, for logs.
 *
 * @param {string} text
 * @param {number} byteOffset
 * @param {number} [radius=32]
 * @returns {string}
 */
export function describeByteOffsetContext(text, byteOffset, radius = 32) {
  const buffer = Buffer.from(String(text ?? ''), 'utf-8');
  const start = Math.max(0, byteOffset - radius);
  const end = Math.min(buffer.length, byteOffset + radius);
  return JSON.stringify(buffer.slice(start, end).toString('utf-8'));
}

/**
 * Check whether Telegram would accept `text` under `parseMode`.
 *
 * Parse modes other than legacy `Markdown` (and plain text) are reported as
 * valid — this module deliberately only models the parser the bot uses.
 *
 * @param {string} text
 * @param {string|undefined|null} parseMode
 * @returns {{valid: boolean, description?: string, byteOffset?: number, context?: string}}
 */
export function validateTelegramText(text, parseMode) {
  if (!parseMode || String(parseMode) !== 'Markdown') return { valid: true };
  if (typeof text !== 'string' || text.length === 0) return { valid: true };
  const parsed = parseTelegramLegacyMarkdown(text);
  if (parsed.ok) return { valid: true };
  return {
    valid: false,
    description: parsed.description,
    byteOffset: parsed.byteOffset,
    context: describeByteOffsetContext(text, parsed.byteOffset),
  };
}

/**
 * Convenience predicate used by tests and by pre-send checks.
 *
 * @param {string} text
 * @param {string} [parseMode='Markdown']
 * @returns {boolean}
 */
export function isValidTelegramMarkdown(text, parseMode = 'Markdown') {
  return validateTelegramText(text, parseMode).valid;
}
