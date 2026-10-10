// Issue #2301 / CodeQL alert 275: does the /queue top-level escape need to escape `\` too?
// Telegram legacy Markdown (TDLib parse_markdown) treats `\` as an escape only before _ * ` [.
// Render tricky inputs through the repository's port of that parser and compare with the input.
import { formatQueueItemLink } from '../../src/telegram-solve-queue.helpers.lib.mjs';
import { parseTelegramLegacyMarkdown } from '../../src/telegram-markdown-validator.lib.mjs';

const inputs = ['https://example.com/a\\_b', 'https://example.com/a\\\\_b', 'https://example.com/x\\', 'https://example.com/\\*y*', 'https://example.com/\\[z', 'C:\\dir\\file_name', 'https://example.com/\\`t`'];
const escapeWithBackslash = s => s.replace(/[\\_*`[]/g, '\\$&');
let ok = true;
for (const input of inputs) {
  for (const [name, rendered] of [
    ['current', formatQueueItemLink(input)],
    ['also-escape-backslash', escapeWithBackslash(input)],
  ]) {
    const parsed = parseTelegramLegacyMarkdown(rendered);
    const shown = parsed.ok ? parsed.text : null;
    const exact = shown === input;
    if (name === 'current' && !exact) ok = false;
    console.log(`${name.padEnd(22)} ${JSON.stringify(input).padEnd(34)} -> ${parsed.ok ? 'valid' : 'REJECTED'} shown=${JSON.stringify(shown)} ${exact ? 'exact' : 'DIFFERS'}`);
  }
}
process.exit(ok ? 0 : 1);
