// Issue #1460/#1497: safeReply - try Markdown first, fall back to plain text on parsing errors.
export async function safeReply(ctx, text, options = {}) {
  try {
    return await ctx.reply(text, { parse_mode: 'Markdown', ...options });
  } catch (error) {
    const message = error?.message || '';
    const isParsingError = message.includes("can't parse entities") || message.includes("Can't parse entities") || message.includes("can't find end of") || (message.includes('Bad Request') && message.includes('400'));
    if (!isParsingError) throw error;
    console.error(`[telegram-bot] safeReply: Markdown parsing failed: ${message}`);
    console.error(`[telegram-bot] safeReply: Failing message (${Buffer.byteLength(text, 'utf-8')} bytes): ${text}`);
    const plainText = text
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
      .replace(/\\_/g, '_')
      .replace(/\\\*/g, '*')
      .replace(/\*([^*]+)\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1');
    return await ctx.reply(plainText, { ...options, parse_mode: undefined });
  }
}
