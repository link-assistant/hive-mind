#!/usr/bin/env node

/**
 * Unit tests for interactive-mode.lib.mjs
 *
 * Tests the interactive mode library with proper mocking
 * to avoid actual GitHub API calls.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the module under test
const interactiveModeLib = await import(join(__dirname, '..', 'src', 'interactive-mode.lib.mjs'));
const { createInteractiveHandler, isInteractiveModeSupported, validateInteractiveModeConfig, utils } = interactiveModeLib;

let testsPassed = 0;
let testsFailed = 0;

async function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

/** Create a handler with default test mocks, overridable per-test. */
function makeHandler({ owner = 'test-owner', repo = 'test-repo', prNumber = 123, verbose = false, onComment } = {}) {
  const comments = [];
  const logs = [];
  const mock$ = (...args) => {
    const body = args[0].reduce((acc, str, i) => acc + str + (args[i + 1] || ''), '');
    comments.push(body);
    if (onComment) onComment(body);
    return Promise.resolve();
  };
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };
  const handler = createInteractiveHandler({ owner, repo, prNumber, $: mock$, log: mockLog, verbose });
  return { handler, comments, logs };
}

// ============================================
// UTILITY FUNCTION TESTS
// ============================================

console.log('\n=== Testing Utility Functions ===\n');

await runTest('truncateMiddle with short content', () => {
  const shortContent = 'Line 1\nLine 2\nLine 3';
  const result = utils.truncateMiddle(shortContent, { maxLines: 10 });
  if (result !== shortContent) throw new Error(`Expected content to remain unchanged, got: ${result}`);
});

await runTest('truncateMiddle with long content', () => {
  const lines = Array(100).fill('Line content').join('\n');
  const result = utils.truncateMiddle(lines, { maxLines: 50, keepStart: 20, keepEnd: 20 });
  if (!result.includes('[60 lines truncated]')) throw new Error('Expected truncation indicator');
  if (result.split('\n').length > 50) throw new Error(`Expected max ~43 lines, got ${result.split('\n').length}`);
});

await runTest('truncateMiddle with null/undefined', () => {
  if (utils.truncateMiddle(null) !== '') throw new Error('Expected empty string for null');
  if (utils.truncateMiddle(undefined) !== '') throw new Error('Expected empty string for undefined');
});

await runTest('safeJsonStringify basic object', () => {
  const result = utils.safeJsonStringify({ name: 'test', value: 123 });
  if (!result.includes('"name": "test"')) throw new Error('Expected JSON to contain name property');
});

await runTest('safeJsonStringify circular reference', () => {
  const obj = { name: 'test' };
  obj.self = obj;
  const result = utils.safeJsonStringify(obj);
  if (!result.includes('[Circular]')) throw new Error('Expected [Circular] marker for circular reference');
});

await runTest('createCollapsible basic', () => {
  const result = utils.createCollapsible('Summary', 'Content');
  if (!result.includes('<details>')) throw new Error('Expected <details> tag');
  if (!result.includes('<summary>Summary</summary>')) throw new Error('Expected summary with correct text');
  if (!result.includes('Content')) throw new Error('Expected content');
});

await runTest('createCollapsible open by default', () => {
  const result = utils.createCollapsible('Summary', 'Content', true);
  if (!result.includes('<details open>')) throw new Error('Expected <details open> tag');
});

await runTest('formatDuration seconds only', () => {
  const result = utils.formatDuration(45000);
  if (result !== '45s') throw new Error(`Expected '45s', got '${result}'`);
});

await runTest('formatDuration minutes and seconds', () => {
  const result = utils.formatDuration(127000);
  if (result !== '2m 7s') throw new Error(`Expected '2m 7s', got '${result}'`);
});

await runTest('formatDuration hours, minutes, seconds', () => {
  const result = utils.formatDuration(3661000);
  if (result !== '1h 1m 1s') throw new Error(`Expected '1h 1m 1s', got '${result}'`);
});

await runTest('formatDuration invalid values', () => {
  if (utils.formatDuration(null) !== 'unknown') throw new Error('Expected unknown for null');
  if (utils.formatDuration(-1000) !== 'unknown') throw new Error('Expected unknown for negative');
});

await runTest('formatCost basic', () => {
  const result = utils.formatCost(1.6043);
  if (result !== '$1.60') throw new Error(`Expected '$1.60', got '${result}'`);
});

await runTest('formatCost small value', () => {
  const result = utils.formatCost(0.05);
  if (result !== '$0.05') throw new Error(`Expected '$0.05', got '${result}'`);
});

await runTest('formatCost invalid values', () => {
  if (utils.formatCost(null) !== 'unknown') throw new Error('Expected unknown for null');
  if (utils.formatCost('not a number') !== 'unknown') throw new Error('Expected unknown for string');
  if (utils.formatCost(NaN) !== 'unknown') throw new Error('Expected unknown for NaN');
});

await runTest('escapeMarkdown basic', () => {
  const result = utils.escapeMarkdown('code```block```here');
  if (result !== 'code\\`\\`\\`block\\`\\`\\`here') throw new Error(`Expected escaped backticks, got '${result}'`);
});

await runTest('escapeMarkdown empty/null', () => {
  if (utils.escapeMarkdown(null) !== '') throw new Error('Expected empty string for null');
  if (utils.escapeMarkdown('') !== '') throw new Error('Expected empty string for empty');
});

await runTest('getToolIcon known tools', () => {
  if (utils.getToolIcon('Bash') !== '💻') throw new Error('Expected 💻 for Bash');
  if (utils.getToolIcon('Read') !== '📖') throw new Error('Expected 📖 for Read');
  if (utils.getToolIcon('Edit') !== '📝') throw new Error('Expected 📝 for Edit');
  if (utils.getToolIcon('TodoWrite') !== '📋') throw new Error('Expected 📋 for TodoWrite');
});

await runTest('getToolIcon unknown tool', () => {
  if (utils.getToolIcon('UnknownTool') !== '🔧') throw new Error('Expected 🔧 for unknown tool');
});

await runTest('createRawJsonSection basic', () => {
  const result = utils.createRawJsonSection({ type: 'test', value: 123 });
  if (!result.includes('<details>')) throw new Error('Expected collapsible section');
  if (!result.includes('📄 Raw JSON')) throw new Error('Expected Raw JSON summary');
  if (!result.includes('```json')) throw new Error('Expected json code block');
});

await runTest('createRawJsonSection wraps single object in array', () => {
  const result = utils.createRawJsonSection({ type: 'test', value: 123 });
  if (!result.includes('[\n')) throw new Error('Expected array wrapper in JSON output');
});

await runTest('createRawJsonSection preserves existing arrays', () => {
  const result = utils.createRawJsonSection([{ type: 'first' }, { type: 'second' }]);
  if (!result.includes('"type": "first"') || !result.includes('"type": "second"')) {
    throw new Error('Expected both array elements in output');
  }
});

// ============================================
// FUNCTION EXPORT TESTS
// ============================================

console.log('\n=== Testing Function Exports ===\n');

await runTest('isInteractiveModeSupported claude', () => {
  if (!isInteractiveModeSupported('claude')) throw new Error('Expected true for claude');
});

await runTest('isInteractiveModeSupported opencode', () => {
  if (isInteractiveModeSupported('opencode')) throw new Error('Expected false for opencode');
});

await runTest('isInteractiveModeSupported other tools', () => {
  if (isInteractiveModeSupported('codex')) throw new Error('Expected false for codex');
  if (isInteractiveModeSupported('unknown')) throw new Error('Expected false for unknown');
});

// ============================================
// ASYNC TESTS
// ============================================

console.log('\n=== Testing Async Functions ===\n');

await runTest('validateInteractiveModeConfig disabled', async () => {
  const logs = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };
  const result = await validateInteractiveModeConfig({ interactiveMode: false, tool: 'claude' }, mockLog);
  if (!result) throw new Error('Expected true when interactive mode is disabled');
});

await runTest('validateInteractiveModeConfig enabled with claude', async () => {
  const logs = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };
  const result = await validateInteractiveModeConfig({ interactiveMode: true, tool: 'claude' }, mockLog);
  if (!result) throw new Error('Expected true when interactive mode is enabled with claude');
  if (!logs.some(l => l.includes('Interactive mode: ENABLED'))) throw new Error('Expected ENABLED log message');
});

await runTest('validateInteractiveModeConfig enabled with opencode', async () => {
  const logs = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };
  const result = await validateInteractiveModeConfig({ interactiveMode: true, tool: 'opencode' }, mockLog);
  if (result) throw new Error('Expected false when interactive mode is enabled with unsupported tool');
  if (!logs.some(l => l.includes('only supported for --tool claude'))) throw new Error('Expected warning log message');
});

// ============================================
// HANDLER TESTS
// ============================================

console.log('\n=== Testing Interactive Handler ===\n');

await runTest('createInteractiveHandler returns expected interface', async () => {
  const { handler } = makeHandler();
  if (typeof handler.processEvent !== 'function') throw new Error('Expected processEvent function');
  if (typeof handler.flush !== 'function') throw new Error('Expected flush function');
  if (typeof handler.getState !== 'function') throw new Error('Expected getState function');
  if (typeof handler._handlers !== 'object') throw new Error('Expected _handlers object');
});

await runTest('handler initial state', async () => {
  const { handler } = makeHandler();
  const state = handler.getState();
  if (state.sessionId !== null) throw new Error('Expected sessionId to be null initially');
  if (state.messageCount !== 0) throw new Error('Expected messageCount to be 0 initially');
  if (state.toolUseCount !== 0) throw new Error('Expected toolUseCount to be 0 initially');
});

await runTest('processEvent handles system.init', async () => {
  const { handler } = makeHandler({ verbose: true });
  await handler.processEvent({ type: 'system', subtype: 'init', session_id: 'test-session-123', cwd: '/tmp/test', tools: ['Read', 'Write', 'Bash'] });
  const state = handler.getState();
  if (state.sessionId !== 'test-session-123') throw new Error('Expected sessionId to be set');
});

await runTest('processEvent handles assistant text', async () => {
  const { handler } = makeHandler();
  await new Promise(r => setTimeout(r, 100));
  await handler.processEvent({
    type: 'assistant',
    message: {
      model: 'claude-sonnet-4-5-20250929',
      content: [{ type: 'text', text: 'This is a test response from Claude.' }],
      usage: { input_tokens: 100, output_tokens: 50 },
    },
  });
  const state = handler.getState();
  if (state.messageCount !== 1) throw new Error('Expected messageCount to be 1');
});

await runTest('processEvent handles tool_use', async () => {
  const { handler } = makeHandler();
  await handler.processEvent({
    type: 'assistant',
    message: {
      model: 'claude-sonnet-4-5-20250929',
      content: [{ type: 'tool_use', id: 'tool-123', name: 'Bash', input: { command: 'ls -la' } }],
    },
  });
  const state = handler.getState();
  if (state.toolUseCount !== 1) throw new Error('Expected toolUseCount to be 1');
});

await runTest('processEvent handles result', async () => {
  const { handler } = makeHandler();
  await handler.processEvent({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 120000,
    num_turns: 10,
    total_cost_usd: 0.5,
    session_id: 'test-session',
  });
  // Just verifies no errors are thrown
});

await runTest('processEvent handles unrecognized events', async () => {
  const { handler } = makeHandler();
  await handler.processEvent({ type: 'custom_type', subtype: 'unknown', data: { foo: 'bar' } });
});

await runTest('processEvent handles null/invalid input', async () => {
  const { handler } = makeHandler();
  await handler.processEvent(null);
  await handler.processEvent(undefined);
  await handler.processEvent({});
  await handler.processEvent('not an object');
});

await runTest('handler does not post without PR info', async () => {
  const { handler, comments } = makeHandler({ owner: '', prNumber: null, verbose: true });
  await handler.processEvent({ type: 'system', subtype: 'init', session_id: 'test-123', cwd: '/tmp', tools: [] });
  if (comments.length > 0) throw new Error('Expected no comments when PR info is missing');
});

// ============================================
// COMMENT ID EXTRACTION TESTS (Issue #844 fix validation)
// ============================================

console.log('\n=== Testing Comment ID Extraction ===\n');

await runTest('comment ID extraction from gh output URL', () => {
  const testCases = [
    ['https://github.com/owner/repo/pull/123#issuecomment-1234567890\n', '1234567890'],
    ['https://github.com/owner/repo/pull/123#issuecomment-9876543210', '9876543210'],
    ['https://github.com/some-owner/some-repo/issues/456#issuecomment-111222333\n', '111222333'],
  ];
  for (const [output, expected] of testCases) {
    const match = output.match(/issuecomment-(\d+)/);
    if (!match) throw new Error(`Expected match for output: ${output}`);
    if (match[1] !== expected) throw new Error(`Expected ID ${expected}, got ${match[1]}`);
  }
});

await runTest('comment ID extraction handles empty/invalid output', () => {
  for (const output of ['', null, undefined, 'no comment id here', 'https://github.com/']) {
    const match = (output?.toString() || '').match(/issuecomment-(\d+)/);
    if (match) throw new Error(`Expected no match for output: ${output}`);
  }
});

await runTest('comment ID extraction with Buffer-like objects', () => {
  const bufferLike = { toString: () => 'https://github.com/owner/repo/pull/1#issuecomment-555666777\n' };
  const match = (bufferLike?.toString() || '').match(/issuecomment-(\d+)/);
  if (!match || match[1] !== '555666777') throw new Error(`Buffer-like toString extraction failed: ${match}`);
});

// ============================================
// UNICODE SANITIZATION TESTS (Issue #1324)
// ============================================
//
// These tests verify that sanitizeUnicode() and the functions that use it
// (truncateMiddle, safeJsonStringify) correctly handle orphaned UTF-16
// surrogate characters. The Anthropic API rejects JSON that contains
// unpaired surrogates (RFC 8259 §7), so this protection is critical.
//
// Background: emojis outside the BMP (e.g. 🤖 U+1F916) are encoded in
// JavaScript strings as UTF-16 surrogate pairs (\uD83E\uDD16). When content
// is truncated at a code-unit boundary that falls between the two halves,
// the orphaned high surrogate (\uD83E) causes a 400 API error.

console.log('\n=== Testing Unicode Sanitization (Issue #1324) ===\n');

await runTest('sanitizeUnicode: clean string passes through unchanged', () => {
  const clean = 'Hello, world!\nLine 2\nLine 3';
  const result = utils.sanitizeUnicode(clean);
  if (result !== clean) throw new Error(`Expected clean string to be unchanged, got: ${JSON.stringify(result)}`);
});

await runTest('sanitizeUnicode: full emoji surrogate pair is preserved', () => {
  // 🤖 (U+1F916) = \uD83E\uDD16 — a valid surrogate pair, must NOT be replaced
  const withEmoji = 'Bot \uD83E\uDD16 deployed successfully';
  const result = utils.sanitizeUnicode(withEmoji);
  if (result !== withEmoji) throw new Error(`Expected full surrogate pair to be preserved, got: ${JSON.stringify(result)}`);
});

await runTest('sanitizeUnicode: orphaned high surrogate is replaced with U+FFFD', () => {
  // Simulate the exact bug from issue #1324: \uD83E without its low surrogate \uDD16
  const orphanedHigh = 'text\uD83Emore';
  const result = utils.sanitizeUnicode(orphanedHigh);
  if (!result.includes('\uFFFD')) throw new Error(`Expected U+FFFD replacement character, got: ${JSON.stringify(result)}`);
  if (result.includes('\uD83E')) throw new Error(`Expected orphaned high surrogate to be removed, got: ${JSON.stringify(result)}`);
});

await runTest('sanitizeUnicode: orphaned low surrogate is replaced with U+FFFD', () => {
  const orphanedLow = 'text\uDD16more';
  const result = utils.sanitizeUnicode(orphanedLow);
  if (!result.includes('\uFFFD')) throw new Error(`Expected U+FFFD replacement character, got: ${JSON.stringify(result)}`);
  if (result.includes('\uDD16')) throw new Error(`Expected orphaned low surrogate to be removed, got: ${JSON.stringify(result)}`);
});

await runTest('sanitizeUnicode: reproduces and fixes exact bug from issue #1324', () => {
  // This is the actual content from the log file that caused the 400 API error:
  // The emoji 🤖 was truncated, leaving only the high surrogate \uD83E
  const buggyContent = 'All changes have been merged to the main branch.\n\n---\n\uD83E\n...';
  const sanitized = utils.sanitizeUnicode(buggyContent);

  // After sanitization, JSON.stringify must produce output the Anthropic API accepts
  const jsonString = JSON.stringify({ content: sanitized });

  // Verify no orphaned high surrogate (\uD83E not followed by \uDC00-\uDFFF)
  if (jsonString.includes('\\ud83e') && !jsonString.includes('\\ud83e\\u')) {
    throw new Error(`JSON still contains orphaned surrogate: ${jsonString.substring(0, 200)}`);
  }
  if (sanitized.includes('\uD83E')) throw new Error('Sanitized content still contains the orphaned high surrogate');
});

await runTest('sanitizeUnicode: multiple orphaned surrogates in one string', () => {
  const text = 'a\uD83Eb\uD83Fc';
  const result = utils.sanitizeUnicode(text);
  if (result.includes('\uD83E') || result.includes('\uD83F')) {
    throw new Error(`Expected all orphaned surrogates replaced, got: ${JSON.stringify(result)}`);
  }
  const replacements = [...result].filter(c => c === '\uFFFD').length;
  if (replacements !== 2) throw new Error(`Expected 2 replacement characters, got ${replacements} in: ${JSON.stringify(result)}`);
});

await runTest('sanitizeUnicode: null/undefined/empty returns empty string', () => {
  if (utils.sanitizeUnicode(null) !== '') throw new Error('Expected empty string for null');
  if (utils.sanitizeUnicode(undefined) !== '') throw new Error('Expected empty string for undefined');
  if (utils.sanitizeUnicode('') !== '') throw new Error('Expected empty string for empty input');
});

await runTest('truncateMiddle: sanitizes content even when no truncation needed', () => {
  const result = utils.truncateMiddle('Line with orphan: \uD83E end', { maxLines: 100 });
  if (result.includes('\uD83E')) throw new Error('Expected orphaned surrogate to be sanitized even in short content');
  if (!result.includes('\uFFFD')) throw new Error('Expected replacement character in sanitized short content');
});

await runTest('truncateMiddle: sanitizes content after truncation', () => {
  const lines = Array.from({ length: 100 }, (_, i) => (i === 19 ? 'Last kept line ending with orphan: \uD83E' : `Line ${i}: some content here`));
  const result = utils.truncateMiddle(lines.join('\n'), { maxLines: 50, keepStart: 20, keepEnd: 20 });
  if (result.includes('\uD83E')) throw new Error('Expected orphaned surrogate to be removed after truncation');
});

await runTest('safeJsonStringify: sanitizes string values before serialization', () => {
  const obj = { message: 'content with orphan: \uD83E end', nested: { text: 'another \uD83F orphan' } };
  const json = utils.safeJsonStringify(obj);
  if (json.includes('\\ud83e') || json.includes('\\ud83f')) {
    throw new Error(`safeJsonStringify JSON still contains orphaned surrogate: ${json}`);
  }
  const parsed = JSON.parse(json);
  if (!parsed.message.includes('\uFFFD')) throw new Error('Expected replacement character in parsed message');
});

await runTest('safeJsonStringify: normal strings are not corrupted', () => {
  const obj = { name: 'Alice', emoji: '🤖', value: 42 };
  const parsed = JSON.parse(utils.safeJsonStringify(obj));
  if (parsed.name !== 'Alice') throw new Error('Expected name to be preserved');
  if (parsed.value !== 42) throw new Error('Expected value to be preserved');
  if (parsed.emoji !== '🤖') throw new Error(`Expected emoji to be preserved, got: ${parsed.emoji}`);
});

// ============================================
// REAL-WORLD UNICODE & LOG DATA TESTS (Issue #1324)
// ============================================
//
// These tests use real-world patterns extracted from actual Claude execution
// logs found in merged pull requests. They ensure the sanitization functions
// correctly handle the same kind of content that hive-mind processes in
// production without breaking anything that previously worked.

console.log('\n=== Testing Real-World Log Data Patterns (Issue #1324) ===\n');

// --- sanitizeUnicode: real-world patterns ---

await runTest('sanitizeUnicode: preserves emoji-rich GitHub PR comment (real log pattern)', () => {
  // This is the exact pattern found in PR comments posted by hive-mind
  const realContent = '## 🤖 Solution Draft Log\nThis log file contains the complete execution trace of the AI solution draft process.\n\n💰 **Cost estimation:**\n- Public pricing estimate: $3.003222\n- Calculated by Anthropic: $2.339325 USD\n📎 **Log file uploaded as Gist** (647KB)\n🔗 [View complete solution draft log](https://example.com)';
  const result = utils.sanitizeUnicode(realContent);
  if (result !== realContent) throw new Error('Expected emoji-rich content to pass through unchanged');
});

await runTest('sanitizeUnicode: preserves real hive-mind status messages with emojis', () => {
  const statusMessages = ['🔧 Raw command executed: claude --version', '💾 Disk space check: 66991MB available (2048MB required) ✅', '🧠 Memory check: 11394MB available ✅', '📋 URL validation: https://github.com/owner/repo/issues/1', '✅ Auto-fork: No write access detected, enabling fork mode', '📝 Issue mode: Working with issue #23', '🔗 Setting upstream: owner/repo', '✅ Branch checked out: issue-23-abc123', '## ✅ Ready to merge\n\nThis pull request is now ready:\n- All CI checks passed\n- No merge conflicts'];
  for (const msg of statusMessages) {
    const result = utils.sanitizeUnicode(msg);
    if (result !== msg) throw new Error(`Status message was modified: ${JSON.stringify(msg).substring(0, 80)}`);
  }
});

await runTest('sanitizeUnicode: preserves Cyrillic and mixed scripts (real log pattern)', () => {
  // The original issue logs contained Cyrillic text from a Russian-language issue
  const cyrillic = '✅ Полная реализация AKSI Backend\n\n### 📋 Issue Reference\n- ✅ AKSI Bot proof file';
  const result = utils.sanitizeUnicode(cyrillic);
  if (result !== cyrillic) throw new Error('Cyrillic+emoji content was modified');
});

await runTest('sanitizeUnicode: fixes the exact persisted-output truncation from issue #1324', () => {
  // This is the actual persisted-output content that caused the API 400 error.
  // The emoji 🤖 (U+1F916 = \uD83E\uDD16) was split by truncation, leaving only \uD83E.
  const persistedOutput = '<persisted-output>\nOutput too large (44.8KB). Full output saved to: /home/hive/.claude/projects/tool-results/toolu_abc.txt\n\nPreview (first 2KB):\n[{"url":"https://api.github.com/repos/owner/repo/issues/comments/123"}]\n...\nAll changes have been merged to the main branch.\n\n---\n\uD83E\n...\n</persisted-output>';
  const sanitized = utils.sanitizeUnicode(persistedOutput);

  // The orphaned \uD83E must be replaced with \uFFFD
  if (sanitized.includes('\uD83E')) throw new Error('Orphaned high surrogate not removed');
  if (!sanitized.includes('\uFFFD')) throw new Error('Expected U+FFFD replacement');

  // Everything else must be preserved
  if (!sanitized.includes('<persisted-output>')) throw new Error('persisted-output tag lost');
  if (!sanitized.includes('Output too large')) throw new Error('Output message lost');
  if (!sanitized.includes('</persisted-output>')) throw new Error('closing tag lost');

  // Must be safe for JSON serialization
  const json = JSON.stringify({ content: sanitized });
  JSON.parse(json); // Must not throw
});

await runTest('sanitizeUnicode: handles multiple emoji at end of truncation boundary', () => {
  // Simulate truncation that cuts through a sequence of emojis
  const text = 'End: \uD83D\uDE00\uD83D\uDE01\uD83D'; // 😀😁 then orphaned high
  const result = utils.sanitizeUnicode(text);
  if (result !== 'End: \uD83D\uDE00\uD83D\uDE01\uFFFD') throw new Error('Wrong sanitization of trailing orphan after valid pairs');
});

await runTest('sanitizeUnicode: handles orphaned low surrogate at start of string', () => {
  const text = '\uDC00Hello world';
  const result = utils.sanitizeUnicode(text);
  if (result !== '\uFFFDHello world') throw new Error('Orphaned low at start not replaced');
});

await runTest('sanitizeUnicode: handles orphaned high surrogate at end of string', () => {
  const text = 'Hello world\uD800';
  const result = utils.sanitizeUnicode(text);
  if (result !== 'Hello world\uFFFD') throw new Error('Orphaned high at end not replaced');
});

await runTest('sanitizeUnicode: preserves all BMP characters including CJK and Arabic', () => {
  const text = '中文测试 عربي テスト한국어 emoji: 🎉 ñ é ü ß';
  const result = utils.sanitizeUnicode(text);
  if (result !== text) throw new Error('BMP characters were modified');
});

await runTest('sanitizeUnicode: preserves multiple valid surrogate pairs in sequence', () => {
  // 🤖🎉🔧💻📖 = five valid surrogate pairs in a row
  const emoji5 = '🤖🎉🔧💻📖';
  const result = utils.sanitizeUnicode(emoji5);
  if (result !== emoji5) throw new Error('Sequential valid surrogate pairs were modified');
});

await runTest('sanitizeUnicode: handles reversed surrogate pair (low before high)', () => {
  // \uDC00\uD800 — low then high is BOTH orphaned (not a valid pair)
  const reversed = 'x\uDC00\uD800y';
  const result = utils.sanitizeUnicode(reversed);
  if (result !== 'x\uFFFD\uFFFDy') throw new Error('Reversed pair not correctly handled');
});

await runTest('sanitizeUnicode: stress test with 1000 emojis', () => {
  const emoji = '🤖';
  const bigString = emoji.repeat(1000);
  const result = utils.sanitizeUnicode(bigString);
  if (result !== bigString) throw new Error('Large string of valid emojis was modified');
  if (result.length !== bigString.length) throw new Error('Length changed');
});

// --- truncateMiddle: real-world patterns ---

await runTest('truncateMiddle: preserves short emoji-rich content (real log format)', () => {
  const content = '🔧 Raw command: ls -la\n✅ Passed\n📋 Results:\n- Item 1\n- Item 2';
  const result = utils.truncateMiddle(content, { maxLines: 100 });
  if (result !== content) throw new Error('Short emoji content was modified');
});

await runTest('truncateMiddle: truncates large output with emoji safely', () => {
  // Simulate a large tool result that contains emojis and gets truncated
  const lines = [];
  for (let i = 0; i < 100; i++) {
    if (i === 0) lines.push('## 🤖 Output Start');
    else if (i === 99) lines.push('## ✅ Output End');
    else lines.push(`Line ${i}: {"url":"https://api.github.com/repos/owner/repo/issues/${i}"}`);
  }
  const result = utils.truncateMiddle(lines.join('\n'), { maxLines: 50, keepStart: 20, keepEnd: 20 });
  if (!result.includes('🤖 Output Start')) throw new Error('Start emoji lost');
  if (!result.includes('✅ Output End')) throw new Error('End emoji lost');
  if (!result.includes('[60 lines truncated]')) throw new Error('Truncation indicator missing');
  // Must be safe for JSON
  JSON.parse(JSON.stringify({ content: result }));
});

await runTest('truncateMiddle: handles truncation point exactly at emoji boundary', () => {
  // Create content where line 20 (keepStart boundary) ends with an emoji
  const lines = Array.from({ length: 60 }, (_, i) => {
    if (i === 19) return 'Last kept: 🤖🎉🔧';
    return `Line ${i}`;
  });
  const result = utils.truncateMiddle(lines.join('\n'), { maxLines: 50, keepStart: 20, keepEnd: 20 });
  if (!result.includes('🤖🎉🔧')) throw new Error('Emojis at boundary lost');
  JSON.parse(JSON.stringify({ content: result })); // Must not throw
});

// --- safeJsonStringify: real-world patterns ---

await runTest('safeJsonStringify: handles real Claude assistant event with emojis', () => {
  const event = {
    type: 'assistant',
    message: {
      model: 'claude-opus-4-5-20251101',
      content: [{ type: 'text', text: '## 🤖 Analysis Complete\n\n✅ All tests passed\n💰 Cost: $1.50\n📎 Attached files: 3' }],
      usage: { input_tokens: 1000, output_tokens: 500 },
    },
    session_id: 'test-session-123',
  };
  const json = utils.safeJsonStringify(event);
  const parsed = JSON.parse(json);
  if (!parsed.message.content[0].text.includes('🤖')) throw new Error('Emoji lost in serialization');
  if (!parsed.message.content[0].text.includes('✅')) throw new Error('Check emoji lost');
});

await runTest('safeJsonStringify: handles real tool_result event with persisted-output', () => {
  const event = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          tool_use_id: 'toolu_01UjJKsUew28fdRqYJBu3PtK',
          type: 'tool_result',
          content: '<persisted-output>\nOutput too large (44.8KB).\nPreview:\n[{"url":"https://api.github.com"}]\n---\n\uD83E\n</persisted-output>',
          is_error: false,
        },
      ],
    },
  };
  const json = utils.safeJsonStringify(event);
  // Must not throw when parsing
  const parsed = JSON.parse(json);
  // The orphaned surrogate must be replaced
  if (parsed.message.content[0].content.includes('\uD83E')) throw new Error('Orphaned surrogate survived serialization');
  if (!parsed.message.content[0].content.includes('\uFFFD')) throw new Error('Expected replacement char');
});

await runTest('safeJsonStringify: handles real result event structure', () => {
  const event = {
    type: 'result',
    subtype: 'success',
    is_error: true,
    duration_ms: 18602,
    num_turns: 6,
    result: 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"The request body is not valid JSON: no low surrogate in string"}}',
    session_id: 'd12b2d61-7ab1-48dc-9677-3a1261066898',
    total_cost_usd: 0.11730099999999997,
    usage: { input_tokens: 2, output_tokens: 510 },
  };
  const json = utils.safeJsonStringify(event);
  const parsed = JSON.parse(json);
  if (!parsed.result.includes('no low surrogate')) throw new Error('Error message content lost');
});

await runTest('safeJsonStringify: handles deeply nested objects with emojis', () => {
  const deep = { a: { b: { c: { d: { e: { f: { text: '🤖 deep emoji' } } } } } } };
  const json = utils.safeJsonStringify(deep);
  const parsed = JSON.parse(json);
  if (!parsed.a.b.c.d.e.f.text.includes('🤖')) throw new Error('Deep emoji lost');
});

await runTest('safeJsonStringify: handles arrays with mixed content types', () => {
  const data = {
    items: ['text with emoji 🎉', 42, null, true, { nested: 'value with orphan \uD800' }, 'another \uDBFF orphan'],
  };
  const json = utils.safeJsonStringify(data);
  const parsed = JSON.parse(json);
  if (parsed.items[0] !== 'text with emoji 🎉') throw new Error('Valid emoji in array lost');
  if (parsed.items[1] !== 42) throw new Error('Number in array changed');
  if (parsed.items[2] !== null) throw new Error('Null in array changed');
  if (parsed.items[4].nested.includes('\uD800')) throw new Error('Orphan in nested object survived');
  if (parsed.items[5].includes('\uDBFF')) throw new Error('Orphan in array string survived');
});

// --- Handler pipeline tests with real event structures ---

console.log('\n=== Testing Handler Pipeline with Real Events (Issue #1324) ===\n');

await runTest('handler processes assistant text with emojis without error', async () => {
  const { handler, comments } = makeHandler();
  await new Promise(r => setTimeout(r, 100));
  await handler.processEvent({
    type: 'assistant',
    message: {
      model: 'claude-opus-4-5-20251101',
      content: [{ type: 'text', text: '## 🤖 Starting analysis\n\n✅ Repository cloned\n📋 Issues found: 3\n💰 Estimated cost: $2.50\n🔗 PR: https://github.com/owner/repo/pull/1' }],
      usage: { input_tokens: 500, output_tokens: 200 },
    },
    session_id: 'test-pipeline-1',
  });
  // Handler should not throw and should produce a comment
  if (comments.length === 0) throw new Error('Expected at least one comment from emoji-rich text');
  // Verify the comment can be safely JSON-serialized (as GitHub API would)
  JSON.parse(JSON.stringify({ body: comments[0] }));
});

await runTest('handler processes tool_use with emoji-containing command', async () => {
  const { handler } = makeHandler();
  await handler.processEvent({
    type: 'assistant',
    message: {
      model: 'claude-sonnet-4-5-20250929',
      content: [{ type: 'tool_use', id: 'toolu_emoji_1', name: 'Bash', input: { command: 'echo "🤖 Hello"' } }],
    },
    session_id: 'test-pipeline-2',
  });
  // Should not throw
});

await runTest('handler processes tool_result with orphaned surrogate (exact issue #1324 scenario)', async () => {
  const { handler, comments } = makeHandler();
  // First send a tool_use so there's context for the result
  await handler.processEvent({
    type: 'assistant',
    message: {
      model: 'claude-opus-4-5-20251101',
      content: [{ type: 'tool_use', id: 'toolu_surrogate_test', name: 'Bash', input: { command: 'gh api repos/owner/repo/issues/23/comments' } }],
    },
    session_id: 'test-pipeline-3',
  });
  // Now send a tool_result containing the orphaned surrogate (the exact bug)
  await handler.processEvent({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          tool_use_id: 'toolu_surrogate_test',
          type: 'tool_result',
          content: '## ✅ Implementation Complete\n\nAll changes merged.\n\n---\n\uD83E\n...',
          is_error: false,
        },
      ],
    },
    session_id: 'test-pipeline-3',
  });
  // All comments produced must be valid for JSON serialization
  for (const comment of comments) {
    const json = JSON.stringify({ body: comment });
    JSON.parse(json); // Must not throw
    if (json.includes('\\ud83e') && !json.includes('\\ud83e\\u')) {
      throw new Error('Comment contains orphaned surrogate that would cause API 400');
    }
  }
});

await runTest('handler processes result event with error message', async () => {
  const { handler, comments } = makeHandler();
  await handler.processEvent({
    type: 'result',
    subtype: 'success',
    is_error: true,
    duration_ms: 18602,
    num_turns: 6,
    result: 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"no low surrogate in string"}}',
    total_cost_usd: 0.117,
    session_id: 'test-result-1',
  });
  // Verify comment was produced and is JSON-safe
  for (const comment of comments) {
    JSON.parse(JSON.stringify({ body: comment }));
  }
});

await runTest('handler processes system.init with real structure', async () => {
  const { handler } = makeHandler({ verbose: true });
  await handler.processEvent({
    type: 'system',
    subtype: 'init',
    session_id: 'real-session-abc',
    cwd: '/tmp/gh-issue-solver-1771359431013',
    tools: ['Task', 'Bash', 'Glob', 'Grep', 'Read', 'Edit', 'Write', 'WebFetch', 'TodoWrite'],
    model: 'claude-opus-4-5-20251101',
    permissionMode: 'bypassPermissions',
    claude_code_version: '2.1.41',
  });
  const state = handler.getState();
  if (state.sessionId !== 'real-session-abc') throw new Error('Session ID not set');
});

// --- Edge case: end-to-end JSON round-trip safety ---

console.log('\n=== Testing JSON Round-Trip Safety ===\n');

await runTest('JSON round-trip: all surrogate ranges are handled', () => {
  // Test every high surrogate range boundary
  const boundaries = ['\uD800', '\uD801', '\uDBFE', '\uDBFF', '\uDC00', '\uDC01', '\uDFFE', '\uDFFF'];
  for (const ch of boundaries) {
    const input = `test${ch}end`;
    const sanitized = utils.sanitizeUnicode(input);
    const json = JSON.stringify({ v: sanitized });
    JSON.parse(json); // Must not throw
    if (sanitized.includes(ch)) throw new Error(`Surrogate ${ch.charCodeAt(0).toString(16)} not replaced`);
  }
});

await runTest('JSON round-trip: sanitizeUnicode + JSON.stringify + JSON.parse is idempotent for clean strings', () => {
  const clean = 'Normal ASCII text with numbers 12345 and symbols !@#$%^&*()';
  const result = JSON.parse(JSON.stringify({ v: utils.sanitizeUnicode(clean) })).v;
  if (result !== clean) throw new Error('Clean string modified by round-trip');
});

await runTest('JSON round-trip: sanitizeUnicode + JSON.stringify + JSON.parse preserves all valid emoji', () => {
  // Comprehensive emoji test — emojis from different Unicode blocks
  const emojis = '😀😃😄😁😆🤖🎉✅❌💰📎🔗📋💻📖📝🔧⚙️🚀🎯🔒🔑💡🔍📦🗂️';
  const result = JSON.parse(JSON.stringify({ v: utils.sanitizeUnicode(emojis) })).v;
  if (result !== emojis) throw new Error(`Emojis modified: expected length ${emojis.length}, got ${result.length}`);
});

await runTest('JSON round-trip: safeJsonStringify output is always parseable', () => {
  // Test with pathological inputs that contain surrogates mixed with normal content
  const cases = [
    { text: 'clean' },
    { text: '\uD83E\uDD16' }, // valid pair (🤖)
    { text: '\uD83E' }, // orphaned high
    { text: '\uDD16' }, // orphaned low
    { text: '\uD83E\uD83E\uDD16' }, // orphaned high + valid pair
    { text: '\uD83E\uDD16\uDD16' }, // valid pair + orphaned low
    { text: 'a\uD800b\uDC00c\uD800\uDC00d' }, // mixed: orphan, orphan, valid pair
    { text: '\uD800\uD800\uDC00' }, // orphan + valid pair
  ];
  for (const testCase of cases) {
    const json = utils.safeJsonStringify(testCase);
    try {
      JSON.parse(json);
    } catch (e) {
      throw new Error(`safeJsonStringify produced unparseable JSON for input: ${JSON.stringify(testCase)}: ${e.message}`);
    }
  }
});

// ============================================
// CONFIG CONSTANT TESTS
// ============================================

console.log('\n=== Testing Configuration Constants ===\n');

await runTest('CONFIG constants are defined', () => {
  if (typeof utils.CONFIG.MIN_COMMENT_INTERVAL !== 'number') throw new Error('Expected MIN_COMMENT_INTERVAL to be a number');
  if (typeof utils.CONFIG.MAX_LINES_BEFORE_TRUNCATION !== 'number') throw new Error('Expected MAX_LINES_BEFORE_TRUNCATION to be a number');
  if (typeof utils.CONFIG.LINES_TO_KEEP_START !== 'number') throw new Error('Expected LINES_TO_KEEP_START to be a number');
  if (typeof utils.CONFIG.LINES_TO_KEEP_END !== 'number') throw new Error('Expected LINES_TO_KEEP_END to be a number');
});

await runTest('CONFIG constants have reasonable values', () => {
  if (utils.CONFIG.MIN_COMMENT_INTERVAL < 1000) throw new Error('MIN_COMMENT_INTERVAL should be at least 1000ms');
  if (utils.CONFIG.MAX_LINES_BEFORE_TRUNCATION < 10) throw new Error('MAX_LINES_BEFORE_TRUNCATION should be at least 10');
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Test Results for interactive-mode.lib.mjs:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

process.exit(testsFailed > 0 ? 1 : 0);
