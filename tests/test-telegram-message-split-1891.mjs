#!/usr/bin/env node

/**
 * Unit tests for issue #1891: the universal Telegram message splitter must split
 * by lines without breaking Markdown — especially fenced code blocks.
 *
 * When a split lands inside a code block, the current chunk must close the fence
 * (```) and the next chunk must reopen it, repeating the language if one was
 * specified, so every chunk is independently valid Markdown.
 *
 * Run with: node tests/test-telegram-message-split-1891.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1891
 */

import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { splitTelegramMessageText, parseCodeFence, TELEGRAM_TEXT_LIMIT } from '../src/telegram-safe-reply.lib.mjs';

console.log('='.repeat(60));
console.log('Tests: Issue #1891 - Code-fence-aware message splitting');
console.log('='.repeat(60));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Count unescaped ``` fence markers — a balanced code block has an even count.
function countFences(text) {
  return (text.match(/^\s*(?:```+|~~~+)/gm) || []).length;
}

function eachChunkWithinLimit(chunks, limit) {
  return chunks.every(chunk => chunk.length <= limit);
}

function everyChunkBalanced(chunks) {
  return chunks.every(chunk => countFences(chunk) % 2 === 0);
}

// Reassemble the original logical content by stripping the synthetic close/reopen
// fence lines that the splitter inserts at chunk boundaries.
function reassemble(chunks) {
  return chunks.join('\n');
}

// ---------------------------------------------------------------------------
// parseCodeFence
// ---------------------------------------------------------------------------

console.log('\n📋 parseCodeFence\n');

{
  const fence = parseCodeFence('```js');
  assert(fence !== null, 'recognizes a ```js opening fence');
  assert(fence.marker === '```', 'captures the backtick marker');
  assert(fence.info === 'js', 'captures the language info string');
  assert(fence.indent === '', 'captures empty indent for a flush-left fence');
}

{
  const fence = parseCodeFence('    ```python');
  assert(fence !== null && fence.indent === '    ', 'captures leading indentation of a fence');
  assert(fence !== null && fence.info === 'python', 'captures language for an indented fence');
}

{
  const fence = parseCodeFence('~~~');
  assert(fence !== null && fence.marker === '~~~', 'recognizes a tilde fence with no language');
  assert(fence !== null && fence.info === '', 'tilde fence without language has empty info');
}

assert(parseCodeFence('const x = 1;') === null, 'plain code line is not a fence');
assert(parseCodeFence('not a ``` fence inline') === null, 'inline backticks are not a fence');

// ---------------------------------------------------------------------------
// Short input — no splitting
// ---------------------------------------------------------------------------

console.log('\n📋 No split needed\n');

{
  const text = 'just a short message';
  const chunks = splitTelegramMessageText(text);
  assert(chunks.length === 1, 'short text returns a single chunk');
  assert(chunks[0] === text, 'short text is returned unchanged');
}

{
  const chunks = splitTelegramMessageText('');
  assert(chunks.length === 1 && chunks[0] === '', 'empty string returns a single empty chunk');
}

{
  const text = 'a\nb\nc';
  const chunks = splitTelegramMessageText(text, 100);
  assert(chunks.length === 1 && chunks[0] === text, 'multi-line text under limit is not split');
}

// ---------------------------------------------------------------------------
// Line-based splitting keeps inline entities intact
// ---------------------------------------------------------------------------

console.log('\n📋 Plain line splitting\n');

{
  // 20 lines of *bold* entries; each line is self-contained Markdown.
  const lines = Array.from({ length: 20 }, (_, i) => `*item ${i}* — some text here`);
  const text = lines.join('\n');
  const limit = 80;
  const chunks = splitTelegramMessageText(text, limit);
  assert(chunks.length > 1, 'long text is split into multiple chunks');
  assert(eachChunkWithinLimit(chunks, limit), 'every chunk stays within the limit');
  // No line should be broken mid-entity: each chunk line still has paired asterisks.
  const allLinesBalanced = chunks.every(chunk => chunk.split('\n').every(line => (line.match(/\*/g) || []).length % 2 === 0));
  assert(allLinesBalanced, 'inline bold entities are never split across a chunk boundary');
}

// ---------------------------------------------------------------------------
// Code-fence-aware splitting — the core of issue #1891
// ---------------------------------------------------------------------------

console.log('\n📋 Code fence preservation\n');

{
  // A single big code block that must be split across several chunks.
  const codeLines = Array.from({ length: 60 }, (_, i) => `line_${i} = compute(${i});`);
  const text = ['Here is the code:', '```js', ...codeLines, '```', 'Done.'].join('\n');
  const limit = 200;
  const chunks = splitTelegramMessageText(text, limit);

  assert(chunks.length > 1, 'large code block is split into multiple chunks');
  assert(eachChunkWithinLimit(chunks, limit), 'every code-block chunk stays within the limit');
  assert(everyChunkBalanced(chunks), 'every chunk has balanced code fences');

  // Inner chunks must reopen with the language repeated.
  const reopened = chunks.slice(1).filter(chunk => /^```js/.test(chunk));
  assert(reopened.length >= 1, 'continuation chunks reopen the fence with the language repeated');

  // Inner chunks must close at the end.
  const middle = chunks.slice(0, -1);
  assert(
    middle.every(chunk => /```\s*$/.test(chunk)),
    'each non-final chunk closes its open fence'
  );

  // No code line is lost in reassembly.
  const joined = reassemble(chunks);
  assert(
    codeLines.every(line => joined.includes(line)),
    'no code line is dropped across the split'
  );
}

{
  // Fence without a language must not invent one on reopen.
  const codeLines = Array.from({ length: 40 }, (_, i) => `value ${i}`);
  const text = ['```', ...codeLines, '```'].join('\n');
  const limit = 120;
  const chunks = splitTelegramMessageText(text, limit);
  assert(chunks.length > 1, 'languageless code block splits into multiple chunks');
  assert(everyChunkBalanced(chunks), 'languageless code block stays balanced per chunk');
  const reopenedWithLang = chunks.slice(1).some(chunk => /^```\w/.test(chunk));
  assert(!reopenedWithLang, 'languageless fence is not reopened with a fabricated language');
}

{
  // Tilde fences must be preserved as tildes, not converted to backticks.
  const codeLines = Array.from({ length: 40 }, (_, i) => `row ${i}`);
  const text = ['~~~python', ...codeLines, '~~~'].join('\n');
  const limit = 120;
  const chunks = splitTelegramMessageText(text, limit);
  assert(chunks.length > 1, 'tilde-fenced block splits into multiple chunks');
  const reopenedTilde = chunks.slice(1).some(chunk => chunk.startsWith('~~~python'));
  assert(reopenedTilde, 'tilde fence reopens as ~~~ with its language');
  const usesBacktick = chunks.some(chunk => chunk.includes('```'));
  assert(!usesBacktick, 'tilde fence is never rewritten to backticks');
}

{
  // Indented fence: indentation must be preserved on close and reopen.
  const codeLines = Array.from({ length: 40 }, (_, i) => `    nested ${i}`);
  const text = ['    ```bash', ...codeLines, '    ```'].join('\n');
  const limit = 140;
  const chunks = splitTelegramMessageText(text, limit);
  assert(chunks.length > 1, 'indented code block splits into multiple chunks');
  const reopenedIndented = chunks.slice(1).some(chunk => /^ {4}```bash/.test(chunk));
  assert(reopenedIndented, 'indented fence reopens with its original indentation and language');
}

// ---------------------------------------------------------------------------
// Mixed content — prose, code, prose
// ---------------------------------------------------------------------------

console.log('\n📋 Mixed prose + code\n');

{
  const prose1 = Array.from({ length: 10 }, (_, i) => `Paragraph A line ${i}.`);
  const code = Array.from({ length: 30 }, (_, i) => `code_${i}();`);
  const prose2 = Array.from({ length: 10 }, (_, i) => `Paragraph B line ${i}.`);
  const text = [...prose1, '```ts', ...code, '```', ...prose2].join('\n');
  const limit = 180;
  const chunks = splitTelegramMessageText(text, limit);

  assert(chunks.length > 1, 'mixed content splits into multiple chunks');
  assert(eachChunkWithinLimit(chunks, limit), 'mixed content chunks stay within the limit');
  assert(everyChunkBalanced(chunks), 'mixed content keeps fences balanced per chunk');

  const joined = reassemble(chunks);
  assert(
    code.every(line => joined.includes(line)),
    'no code line lost in mixed content'
  );
  assert(prose1.every(line => joined.includes(line)) && prose2.every(line => joined.includes(line)), 'no prose line lost in mixed content');
}

// ---------------------------------------------------------------------------
// Pathological single line longer than the limit
// ---------------------------------------------------------------------------

console.log('\n📋 Over-long single line\n');

{
  const longLine = 'x'.repeat(500);
  const limit = 100;
  const chunks = splitTelegramMessageText(longLine, limit);
  assert(chunks.length > 1, 'a single over-long line is hard-split');
  assert(eachChunkWithinLimit(chunks, limit), 'hard-split pieces each stay within the limit');
  assert(chunks.join('').replace(/\n/g, '').includes('x'.repeat(100)), 'hard-split preserves the content');
}

{
  // Over-long line *inside* a code block: pieces must still be fence-balanced.
  const longCode = 'a'.repeat(400);
  const text = ['```js', longCode, '```'].join('\n');
  const limit = 100;
  const chunks = splitTelegramMessageText(text, limit);
  assert(eachChunkWithinLimit(chunks, limit), 'over-long code line is split within the limit');
  assert(everyChunkBalanced(chunks), 'over-long code line keeps each chunk fence-balanced');
}

// ---------------------------------------------------------------------------
// Default limit sanity
// ---------------------------------------------------------------------------

console.log('\n📋 Default limit\n');

{
  const text = 'line\n'.repeat(2000); // ~10000 chars
  const chunks = splitTelegramMessageText(text);
  assert(eachChunkWithinLimit(chunks, TELEGRAM_TEXT_LIMIT), 'default limit splits a very long message within 4096 chars');
  assert(chunks.length >= 2, 'a >4096 char message is split into at least two chunks at the default limit');
}

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
