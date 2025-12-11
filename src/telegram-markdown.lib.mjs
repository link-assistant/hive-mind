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
 * Preserves inline code blocks (text between backticks) without escaping.
 * According to Telegram Bot API, these characters must be escaped in MarkdownV2:
 * _ * [ ] ( ) ~ ` > # + - = | { } . ! \
 * @param {string} text - Text to escape
 * @returns {string} Escaped text safe for MarkdownV2 parse_mode
 */
export function escapeMarkdownV2(text) {
  if (!text || typeof text !== 'string') return text;

  // Split text into parts: inline code blocks and regular text
  const parts = [];
  let lastIndex = 0;
  const codeBlockRegex = /`[^`]+`/g;
  let match;

  while ((match = codeBlockRegex.exec(text)) !== null) {
    // Add escaped regular text before code block
    if (match.index > lastIndex) {
      const regularText = text.substring(lastIndex, match.index);
      parts.push(regularText.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1'));
    }
    // Add unescaped code block
    parts.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  // Add remaining text after last code block
  if (lastIndex < text.length) {
    const regularText = text.substring(lastIndex);
    parts.push(regularText.replace(/([_*[\]()~`>#+\-=|{}.!])/g, '\\$1'));
  }

  return parts.join('');
}
