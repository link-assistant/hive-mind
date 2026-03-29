/**
 * Unicode Sanitization Utility
 *
 * Provides functions to sanitize orphaned UTF-16 surrogates from strings.
 * When Claude Code's <persisted-output> truncation splits a surrogate pair,
 * the orphaned high surrogate (e.g. \uD83E without \uDD16) causes
 * JSON.stringify() to produce invalid JSON that the Anthropic API rejects:
 *
 *   API Error: 400 {"type":"error","error":{"type":"invalid_request_error",
 *   "message":"The request body is not valid JSON: no low surrogate in string..."}}
 *
 * This module is used by both the regular Claude output parsing path
 * (claude.lib.mjs) and the interactive mode PR comment path
 * (interactive-mode.lib.mjs) to ensure all text is valid before
 * JSON serialization or external API calls.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1324
 * @see https://www.rfc-editor.org/rfc/rfc8259#section-7
 * @module unicode-sanitization
 */

/**
 * Replace every orphaned UTF-16 surrogate with the Unicode replacement
 * character U+FFFD. A "well-formed" string never contains:
 *   - A high surrogate (U+D800–U+DBFF) not immediately followed by a low surrogate (U+DC00–U+DFFF)
 *   - A low surrogate (U+DC00–U+DFFF) not immediately preceded by a high surrogate
 *
 * @param {string} text - Input string that may contain orphaned surrogates
 * @returns {string} String with every orphaned surrogate replaced by U+FFFD
 */
export const sanitizeUnicode = text => {
  if (!text || typeof text !== 'string') {
    return text || '';
  }
  // Regex explanation:
  //   [\uD800-\uDBFF](?![\uDC00-\uDFFF])  — high surrogate not followed by low surrogate
  //   |
  //   (?<![\uD800-\uDBFF])[\uDC00-\uDFFF] — low surrogate not preceded by high surrogate
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
};

/**
 * Recursively sanitize all string values in an object/array.
 * This is useful for sanitizing parsed JSON objects from Claude CLI output
 * before they are re-serialized or processed.
 *
 * @param {any} value - Value to sanitize (strings are sanitized, objects/arrays are traversed)
 * @returns {any} The value with all string leaves sanitized
 */
export const sanitizeObjectStrings = value => {
  if (typeof value === 'string') {
    return sanitizeUnicode(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeObjectStrings);
  }
  if (typeof value === 'object' && value !== null) {
    const result = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = sanitizeObjectStrings(val);
    }
    return result;
  }
  return value;
};

export default { sanitizeUnicode, sanitizeObjectStrings };
