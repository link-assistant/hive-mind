/**
 * Telegram markdown escaping utilities
 * @module telegram-markdown.lib
 */

/**
 * Escape special characters for Telegram's basic Markdown parser.
 * Only escapes underscore and asterisk to prevent parsing errors.
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for Markdown parse_mode
 */
export function escapeMarkdown(text) {
  if (!text || typeof text !== 'string') {
    return text;
  }
  // Escape underscore and asterisk which are the most common issues in URLs
  // These can cause "Can't find end of entity" errors when Telegram tries to parse them
  return text.replace(/_/g, '\\_').replace(/\*/g, '\\*');
}

/**
 * Escape special characters for Telegram's MarkdownV2 parser.
 * According to Telegram Bot API, these characters must be escaped in MarkdownV2:
 * _ * [ ] ( ) ~ ` > # + - = | { } . ! \
 * @param {string} text - Text to escape
 * @param {Object} options - Configuration options
 * @param {boolean} options.preserveCodeBlocks - If true, preserves inline code blocks (text between backticks) without escaping. Default: false
 * @returns {string} Escaped text safe for MarkdownV2 parse_mode
 */
export function escapeMarkdownV2(text, options = {}) {
  if (!text || typeof text !== 'string') return text;

  const { preserveCodeBlocks = false } = options;

  // If not preserving code blocks, escape everything including backticks
  if (!preserveCodeBlocks) {
    return text.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  }

  // Split text into parts: inline code blocks and regular text
  const parts = [];
  let lastIndex = 0;
  const codeBlockRegex = /`[^`]+`/g;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Add escaped regular text before code block
    if (match.index > lastIndex) {
      const regularText = text.substring(lastIndex, match.index);
      parts.push(regularText.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1'));
    }
    // Add unescaped code block
    parts.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last code block
  if (lastIndex < text.length) {
    const regularText = text.substring(lastIndex);
    parts.push(regularText.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1'));
  }

  return parts.join('');
}

/**
 * Clean non-printable and problematic Unicode characters from text.
 * Removes zero-width characters, control characters, and other invisible/problematic sequences.
 * @param {string} text - Text to clean
 * @returns {string} Cleaned text
 */
export function cleanNonPrintableChars(text) {
  if (!text || typeof text !== 'string') return text;

  return (
    text
      // Remove zero-width characters
      .replace(/[\u200B-\u200D\uFEFF]/g, '')
      // Remove other non-printable control characters (except newline, tab, carriage return)
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B-\u000C\u000E-\u001F\u007F-\u009F]/g, '')
      // Remove soft hyphens
      .replace(/\u00AD/g, '')
      // Normalize whitespace (replace multiple spaces with single space)
      .replace(/[ \t]+/g, ' ')
      // Trim leading/trailing whitespace from each line
      .split('\n')
      .map(line => line.trim())
      .join('\n')
      .trim()
  );
}

/**
 * Make special characters visible for debugging purposes.
 * Replaces special characters with their Unicode escape sequences or names.
 * Useful for showing users where problematic characters are in their input.
 * @param {string} text - Text to make visible
 * @param {Object} options - Configuration options
 * @param {number} options.maxLength - Maximum length of output (default: 200)
 * @returns {string} Text with special characters made visible
 */
export function makeSpecialCharsVisible(text, options = {}) {
  if (!text || typeof text !== 'string') return text;

  const { maxLength = 200 } = options;

  // Map of special characters to their visible representations
  const specialChars = {
    '\u200B': '[ZWSP]', // Zero-width space
    '\u200C': '[ZWNJ]', // Zero-width non-joiner
    '\u200D': '[ZWJ]', // Zero-width joiner
    '\uFEFF': '[BOM]', // Byte order mark / zero-width no-break space
    '\u00AD': '[SHY]', // Soft hyphen
    '\t': '[TAB]',
    '\r': '[CR]',
    '\n': '[LF]',
  };

  let result = '';
  for (let i = 0; i < text.length && result.length < maxLength; i++) {
    const char = text[i];
    const code = char.charCodeAt(0);

    if (specialChars[char]) {
      result += specialChars[char];
    } else if (code < 32 || (code >= 127 && code < 160)) {
      // Control characters
      result += `[U+${code.toString(16).toUpperCase().padStart(4, '0')}]`;
    } else {
      result += char;
    }
  }

  if (text.length > maxLength) {
    result += '... (truncated)';
  }

  return result;
}
