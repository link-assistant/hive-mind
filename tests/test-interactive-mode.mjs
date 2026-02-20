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

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

async function runAsyncTest(name, testFn) {
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

// ============================================
// UTILITY FUNCTION TESTS
// ============================================

console.log('\n=== Testing Utility Functions ===\n');

// Test truncateMiddle
runTest('truncateMiddle with short content', () => {
  const shortContent = 'Line 1\nLine 2\nLine 3';
  const result = utils.truncateMiddle(shortContent, { maxLines: 10 });
  if (result !== shortContent) {
    throw new Error(`Expected content to remain unchanged, got: ${result}`);
  }
});

runTest('truncateMiddle with long content', () => {
  const lines = Array(100).fill('Line content').join('\n');
  const result = utils.truncateMiddle(lines, { maxLines: 50, keepStart: 20, keepEnd: 20 });
  if (!result.includes('[60 lines truncated]')) {
    throw new Error('Expected truncation indicator');
  }
  const resultLines = result.split('\n');
  // Should be around 42 lines (20 + 1 empty + 1 truncation msg + 1 empty + 20 = 43)
  if (resultLines.length > 50) {
    throw new Error(`Expected max ~43 lines, got ${resultLines.length}`);
  }
});

runTest('truncateMiddle with null/undefined', () => {
  if (utils.truncateMiddle(null) !== '') {
    throw new Error('Expected empty string for null');
  }
  if (utils.truncateMiddle(undefined) !== '') {
    throw new Error('Expected empty string for undefined');
  }
});

// Test safeJsonStringify
runTest('safeJsonStringify basic object', () => {
  const obj = { name: 'test', value: 123 };
  const result = utils.safeJsonStringify(obj);
  if (!result.includes('"name": "test"')) {
    throw new Error('Expected JSON to contain name property');
  }
});

runTest('safeJsonStringify circular reference', () => {
  const obj = { name: 'test' };
  obj.self = obj; // Create circular reference
  const result = utils.safeJsonStringify(obj);
  if (!result.includes('[Circular]')) {
    throw new Error('Expected [Circular] marker for circular reference');
  }
});

// Test createCollapsible
runTest('createCollapsible basic', () => {
  const result = utils.createCollapsible('Summary', 'Content');
  if (!result.includes('<details>')) {
    throw new Error('Expected <details> tag');
  }
  if (!result.includes('<summary>Summary</summary>')) {
    throw new Error('Expected summary with correct text');
  }
  if (!result.includes('Content')) {
    throw new Error('Expected content');
  }
});

runTest('createCollapsible open by default', () => {
  const result = utils.createCollapsible('Summary', 'Content', true);
  if (!result.includes('<details open>')) {
    throw new Error('Expected <details open> tag');
  }
});

// Test formatDuration
runTest('formatDuration seconds only', () => {
  const result = utils.formatDuration(45000);
  if (result !== '45s') {
    throw new Error(`Expected '45s', got '${result}'`);
  }
});

runTest('formatDuration minutes and seconds', () => {
  const result = utils.formatDuration(127000); // 2m 7s
  if (result !== '2m 7s') {
    throw new Error(`Expected '2m 7s', got '${result}'`);
  }
});

runTest('formatDuration hours, minutes, seconds', () => {
  const result = utils.formatDuration(3661000); // 1h 1m 1s
  if (result !== '1h 1m 1s') {
    throw new Error(`Expected '1h 1m 1s', got '${result}'`);
  }
});

runTest('formatDuration invalid values', () => {
  if (utils.formatDuration(null) !== 'unknown') {
    throw new Error('Expected unknown for null');
  }
  if (utils.formatDuration(-1000) !== 'unknown') {
    throw new Error('Expected unknown for negative');
  }
});

// Test formatCost
runTest('formatCost basic', () => {
  const result = utils.formatCost(1.6043);
  if (result !== '$1.60') {
    throw new Error(`Expected '$1.60', got '${result}'`);
  }
});

runTest('formatCost small value', () => {
  const result = utils.formatCost(0.05);
  if (result !== '$0.05') {
    throw new Error(`Expected '$0.05', got '${result}'`);
  }
});

runTest('formatCost invalid values', () => {
  if (utils.formatCost(null) !== 'unknown') {
    throw new Error('Expected unknown for null');
  }
  if (utils.formatCost('not a number') !== 'unknown') {
    throw new Error('Expected unknown for string');
  }
  if (utils.formatCost(NaN) !== 'unknown') {
    throw new Error('Expected unknown for NaN');
  }
});

// Test escapeMarkdown
runTest('escapeMarkdown basic', () => {
  const result = utils.escapeMarkdown('code```block```here');
  if (result !== 'code\\`\\`\\`block\\`\\`\\`here') {
    throw new Error(`Expected escaped backticks, got '${result}'`);
  }
});

runTest('escapeMarkdown empty/null', () => {
  if (utils.escapeMarkdown(null) !== '') {
    throw new Error('Expected empty string for null');
  }
  if (utils.escapeMarkdown('') !== '') {
    throw new Error('Expected empty string for empty');
  }
});

// Test getToolIcon
runTest('getToolIcon known tools', () => {
  if (utils.getToolIcon('Bash') !== '💻') {
    throw new Error('Expected 💻 for Bash');
  }
  if (utils.getToolIcon('Read') !== '📖') {
    throw new Error('Expected 📖 for Read');
  }
  if (utils.getToolIcon('Edit') !== '📝') {
    throw new Error('Expected 📝 for Edit');
  }
  if (utils.getToolIcon('TodoWrite') !== '📋') {
    throw new Error('Expected 📋 for TodoWrite');
  }
});

runTest('getToolIcon unknown tool', () => {
  if (utils.getToolIcon('UnknownTool') !== '🔧') {
    throw new Error('Expected 🔧 for unknown tool');
  }
});

// Test createRawJsonSection
runTest('createRawJsonSection basic', () => {
  const data = { type: 'test', value: 123 };
  const result = utils.createRawJsonSection(data);
  if (!result.includes('<details>')) {
    throw new Error('Expected collapsible section');
  }
  if (!result.includes('📄 Raw JSON')) {
    throw new Error('Expected Raw JSON summary');
  }
  if (!result.includes('```json')) {
    throw new Error('Expected json code block');
  }
});

// Test createRawJsonSection wraps single objects in array
runTest('createRawJsonSection wraps single object in array', () => {
  const data = { type: 'test', value: 123 };
  const result = utils.createRawJsonSection(data);
  // The output should contain an array (starting with '[')
  if (!result.includes('[\n')) {
    throw new Error('Expected array wrapper in JSON output');
  }
});

// Test createRawJsonSection preserves arrays
runTest('createRawJsonSection preserves existing arrays', () => {
  const data = [{ type: 'first' }, { type: 'second' }];
  const result = utils.createRawJsonSection(data);
  // Should contain array but NOT nested array
  if (!result.includes('"type": "first"') || !result.includes('"type": "second"')) {
    throw new Error('Expected both array elements in output');
  }
});

// ============================================
// FUNCTION EXPORT TESTS
// ============================================

console.log('\n=== Testing Function Exports ===\n');

runTest('isInteractiveModeSupported claude', () => {
  if (!isInteractiveModeSupported('claude')) {
    throw new Error('Expected true for claude');
  }
});

runTest('isInteractiveModeSupported opencode', () => {
  if (isInteractiveModeSupported('opencode')) {
    throw new Error('Expected false for opencode');
  }
});

runTest('isInteractiveModeSupported other tools', () => {
  if (isInteractiveModeSupported('codex')) {
    throw new Error('Expected false for codex');
  }
  if (isInteractiveModeSupported('unknown')) {
    throw new Error('Expected false for unknown');
  }
});

// ============================================
// ASYNC TESTS
// ============================================

console.log('\n=== Testing Async Functions ===\n');

await runAsyncTest('validateInteractiveModeConfig disabled', async () => {
  const logs = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };

  const result = await validateInteractiveModeConfig({ interactiveMode: false, tool: 'claude' }, mockLog);
  if (!result) {
    throw new Error('Expected true when interactive mode is disabled');
  }
});

await runAsyncTest('validateInteractiveModeConfig enabled with claude', async () => {
  const logs = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };

  const result = await validateInteractiveModeConfig({ interactiveMode: true, tool: 'claude' }, mockLog);
  if (!result) {
    throw new Error('Expected true when interactive mode is enabled with claude');
  }
  if (!logs.some(l => l.includes('Interactive mode: ENABLED'))) {
    throw new Error('Expected ENABLED log message');
  }
});

await runAsyncTest('validateInteractiveModeConfig enabled with opencode', async () => {
  const logs = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };

  const result = await validateInteractiveModeConfig({ interactiveMode: true, tool: 'opencode' }, mockLog);
  if (result) {
    throw new Error('Expected false when interactive mode is enabled with unsupported tool');
  }
  if (!logs.some(l => l.includes('only supported for --tool claude'))) {
    throw new Error('Expected warning log message');
  }
});

// ============================================
// HANDLER TESTS
// ============================================

console.log('\n=== Testing Interactive Handler ===\n');

await runAsyncTest('createInteractiveHandler returns expected interface', async () => {
  const mockLog = () => Promise.resolve();
  const mock$ = () => Promise.resolve();

  const handler = createInteractiveHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
  });

  if (typeof handler.processEvent !== 'function') {
    throw new Error('Expected processEvent function');
  }
  if (typeof handler.flush !== 'function') {
    throw new Error('Expected flush function');
  }
  if (typeof handler.getState !== 'function') {
    throw new Error('Expected getState function');
  }
  if (typeof handler._handlers !== 'object') {
    throw new Error('Expected _handlers object');
  }
});

await runAsyncTest('handler initial state', async () => {
  const mockLog = () => Promise.resolve();
  const mock$ = () => Promise.resolve();

  const handler = createInteractiveHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
  });

  const state = handler.getState();
  if (state.sessionId !== null) {
    throw new Error('Expected sessionId to be null initially');
  }
  if (state.messageCount !== 0) {
    throw new Error('Expected messageCount to be 0 initially');
  }
  if (state.toolUseCount !== 0) {
    throw new Error('Expected toolUseCount to be 0 initially');
  }
});

await runAsyncTest('processEvent handles system.init', async () => {
  const logs = [];
  const comments = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };
  const mock$ = (...args) => {
    // Extract the body from template literals
    const body = args[0].reduce((acc, str, i) => acc + str + (args[i + 1] || ''), '');
    comments.push(body);
    return Promise.resolve();
  };

  const handler = createInteractiveHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: true,
  });

  await handler.processEvent({
    type: 'system',
    subtype: 'init',
    session_id: 'test-session-123',
    cwd: '/tmp/test',
    tools: ['Read', 'Write', 'Bash'],
  });

  const state = handler.getState();
  if (state.sessionId !== 'test-session-123') {
    throw new Error('Expected sessionId to be set');
  }
});

await runAsyncTest('processEvent handles assistant text', async () => {
  const mockLog = () => Promise.resolve();
  const comments = [];
  const mock$ = (...args) => {
    comments.push(args);
    return Promise.resolve();
  };

  const handler = createInteractiveHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
  });

  // Need to wait for rate limiting interval
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
  if (state.messageCount !== 1) {
    throw new Error('Expected messageCount to be 1');
  }
});

await runAsyncTest('processEvent handles tool_use', async () => {
  const mockLog = () => Promise.resolve();
  const mock$ = () => Promise.resolve();

  const handler = createInteractiveHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
  });

  await handler.processEvent({
    type: 'assistant',
    message: {
      model: 'claude-sonnet-4-5-20250929',
      content: [
        {
          type: 'tool_use',
          id: 'tool-123',
          name: 'Bash',
          input: { command: 'ls -la' },
        },
      ],
    },
  });

  const state = handler.getState();
  if (state.toolUseCount !== 1) {
    throw new Error('Expected toolUseCount to be 1');
  }
});

await runAsyncTest('processEvent handles result', async () => {
  const mockLog = () => Promise.resolve();
  const mock$ = () => Promise.resolve();

  const handler = createInteractiveHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
  });

  await handler.processEvent({
    type: 'result',
    subtype: 'success',
    is_error: false,
    duration_ms: 120000,
    num_turns: 10,
    total_cost_usd: 0.5,
    session_id: 'test-session',
  });

  // Result handler doesn't update counters, just posts comment
  // This test just verifies no errors are thrown
});

await runAsyncTest('processEvent handles unrecognized events', async () => {
  const mockLog = () => Promise.resolve();
  const mock$ = () => Promise.resolve();

  const handler = createInteractiveHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
  });

  // Should not throw
  await handler.processEvent({
    type: 'custom_type',
    subtype: 'unknown',
    data: { foo: 'bar' },
  });
});

await runAsyncTest('processEvent handles null/invalid input', async () => {
  const mockLog = () => Promise.resolve();
  const mock$ = () => Promise.resolve();

  const handler = createInteractiveHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
  });

  // Should not throw
  await handler.processEvent(null);
  await handler.processEvent(undefined);
  await handler.processEvent({});
  await handler.processEvent('not an object');
});

await runAsyncTest('handler does not post without PR info', async () => {
  const logs = [];
  const comments = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };
  const mock$ = () => {
    comments.push('posted');
    return Promise.resolve();
  };

  const handler = createInteractiveHandler({
    owner: '', // Empty owner
    repo: 'test-repo',
    prNumber: null, // No PR number
    $: mock$,
    log: mockLog,
    verbose: true,
  });

  await handler.processEvent({
    type: 'system',
    subtype: 'init',
    session_id: 'test-123',
    cwd: '/tmp',
    tools: [],
  });

  if (comments.length > 0) {
    throw new Error('Expected no comments when PR info is missing');
  }
});

// ============================================
// COMMENT ID EXTRACTION TESTS (Issue #844 fix validation)
// ============================================

console.log('\n=== Testing Comment ID Extraction ===\n');

// Test that validates the fix for issue #844 requirement #4
// The regex must correctly extract comment IDs from gh pr comment output
runTest('comment ID extraction from gh output URL', () => {
  // Simulate the output from gh pr comment
  const testOutputs = ['https://github.com/owner/repo/pull/123#issuecomment-1234567890\n', 'https://github.com/owner/repo/pull/123#issuecomment-9876543210', 'https://github.com/some-owner/some-repo/issues/456#issuecomment-111222333\n'];

  const expectedIds = ['1234567890', '9876543210', '111222333'];

  for (let i = 0; i < testOutputs.length; i++) {
    const output = testOutputs[i];
    const match = output.match(/issuecomment-(\d+)/);
    if (!match) {
      throw new Error(`Expected match for output: ${output}`);
    }
    if (match[1] !== expectedIds[i]) {
      throw new Error(`Expected ID ${expectedIds[i]}, got ${match[1]}`);
    }
  }
});

runTest('comment ID extraction handles empty/invalid output', () => {
  const invalidOutputs = ['', null, undefined, 'no comment id here', 'https://github.com/'];

  for (const output of invalidOutputs) {
    const safeOutput = output?.toString() || '';
    const match = safeOutput.match(/issuecomment-(\d+)/);
    if (match) {
      throw new Error(`Expected no match for output: ${output}`);
    }
  }
});

runTest('comment ID extraction with Buffer-like objects', () => {
  // Simulate what happens if stdout is a Buffer (edge case)
  const bufferLike = {
    toString: () => 'https://github.com/owner/repo/pull/1#issuecomment-555666777\n',
  };

  // Test both patterns from the code
  const output1 = bufferLike?.toString() || '';
  const match1 = output1.match(/issuecomment-(\d+)/);
  if (!match1 || match1[1] !== '555666777') {
    throw new Error(`Buffer-like toString extraction failed: ${match1}`);
  }
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

runTest('sanitizeUnicode: clean string passes through unchanged', () => {
  const clean = 'Hello, world!\nLine 2\nLine 3';
  const result = utils.sanitizeUnicode(clean);
  if (result !== clean) {
    throw new Error(`Expected clean string to be unchanged, got: ${JSON.stringify(result)}`);
  }
});

runTest('sanitizeUnicode: full emoji surrogate pair is preserved', () => {
  // 🤖 (U+1F916) = \uD83E\uDD16 — a valid surrogate pair, must NOT be replaced
  const withEmoji = 'Bot \uD83E\uDD16 deployed successfully';
  const result = utils.sanitizeUnicode(withEmoji);
  if (result !== withEmoji) {
    throw new Error(`Expected full surrogate pair to be preserved, got: ${JSON.stringify(result)}`);
  }
});

runTest('sanitizeUnicode: orphaned high surrogate is replaced with U+FFFD', () => {
  // Simulate the exact bug from issue #1324: \uD83E without its low surrogate \uDD16
  const orphanedHigh = 'text\uD83Emore';
  const result = utils.sanitizeUnicode(orphanedHigh);
  if (!result.includes('\uFFFD')) {
    throw new Error(`Expected U+FFFD replacement character, got: ${JSON.stringify(result)}`);
  }
  if (result.includes('\uD83E')) {
    throw new Error(`Expected orphaned high surrogate to be removed, got: ${JSON.stringify(result)}`);
  }
});

runTest('sanitizeUnicode: orphaned low surrogate is replaced with U+FFFD', () => {
  // Low surrogate without a preceding high surrogate
  const orphanedLow = 'text\uDD16more';
  const result = utils.sanitizeUnicode(orphanedLow);
  if (!result.includes('\uFFFD')) {
    throw new Error(`Expected U+FFFD replacement character, got: ${JSON.stringify(result)}`);
  }
  if (result.includes('\uDD16')) {
    throw new Error(`Expected orphaned low surrogate to be removed, got: ${JSON.stringify(result)}`);
  }
});

runTest('sanitizeUnicode: reproduces and fixes exact bug from issue #1324', () => {
  // This is the actual content from the log file that caused the 400 API error:
  // The emoji 🤖 was truncated, leaving only the high surrogate \uD83E
  const buggyContent = 'All changes have been merged to the main branch.\n\n---\n\uD83E\n...';
  const sanitized = utils.sanitizeUnicode(buggyContent);

  // After sanitization, JSON.stringify must produce output the Anthropic API accepts
  // (i.e., no orphaned surrogates)
  const jsonString = JSON.stringify({ content: sanitized });

  // Verify no orphaned high surrogate (\uD83E not followed by \uDC00-\uDFFF)
  // In JSON the orphaned surrogate appears as \ud83e
  if (jsonString.includes('\\ud83e') && !jsonString.includes('\\ud83e\\u')) {
    throw new Error(`JSON still contains orphaned surrogate: ${jsonString.substring(0, 200)}`);
  }

  // Verify the fix marker (replacement character or removal)
  if (sanitized.includes('\uD83E')) {
    throw new Error('Sanitized content still contains the orphaned high surrogate');
  }
});

runTest('sanitizeUnicode: multiple orphaned surrogates in one string', () => {
  // Two separate orphaned high surrogates in one string
  const text = 'a\uD83Eb\uD83Fc';
  const result = utils.sanitizeUnicode(text);
  if (result.includes('\uD83E') || result.includes('\uD83F')) {
    throw new Error(`Expected all orphaned surrogates replaced, got: ${JSON.stringify(result)}`);
  }
  // Should have two replacement characters
  const replacements = [...result].filter(c => c === '\uFFFD').length;
  if (replacements !== 2) {
    throw new Error(`Expected 2 replacement characters, got ${replacements} in: ${JSON.stringify(result)}`);
  }
});

runTest('sanitizeUnicode: null input returns empty string', () => {
  if (utils.sanitizeUnicode(null) !== '') {
    throw new Error('Expected empty string for null');
  }
});

runTest('sanitizeUnicode: undefined input returns empty string', () => {
  if (utils.sanitizeUnicode(undefined) !== '') {
    throw new Error('Expected empty string for undefined');
  }
});

runTest('sanitizeUnicode: empty string returns empty string', () => {
  if (utils.sanitizeUnicode('') !== '') {
    throw new Error('Expected empty string for empty input');
  }
});

runTest('truncateMiddle: sanitizes content even when no truncation needed', () => {
  // Content below truncation threshold must still be sanitized
  const contentWithOrphan = 'Line with orphan: \uD83E end';
  const result = utils.truncateMiddle(contentWithOrphan, { maxLines: 100 });
  if (result.includes('\uD83E')) {
    throw new Error('Expected orphaned surrogate to be sanitized even in short content');
  }
  if (!result.includes('\uFFFD')) {
    throw new Error('Expected replacement character in sanitized short content');
  }
});

runTest('truncateMiddle: sanitizes content after truncation', () => {
  // Content that spans truncation boundary and contains surrogate pair
  // The high surrogate lands in the kept section, low surrogate is in truncated middle
  const lines = [];
  for (let i = 0; i < 100; i++) {
    if (i === 19) {
      // This line's last character will be an orphaned high surrogate after assembly
      lines.push('Last kept line ending with orphan: \uD83E');
    } else {
      lines.push(`Line ${i}: some content here`);
    }
  }
  const content = lines.join('\n');
  const result = utils.truncateMiddle(content, { maxLines: 50, keepStart: 20, keepEnd: 20 });

  // Must not contain any orphaned surrogates
  if (result.includes('\uD83E')) {
    throw new Error('Expected orphaned surrogate to be removed after truncation');
  }
});

runTest('safeJsonStringify: sanitizes string values before serialization', () => {
  // This is the safety net: even if sanitizeUnicode was not called on input,
  // safeJsonStringify will sanitize strings in the replacer
  const obj = {
    message: 'content with orphan: \uD83E end',
    nested: { text: 'another \uD83F orphan' },
  };
  const json = utils.safeJsonStringify(obj);

  // The resulting JSON string must not contain orphaned surrogates
  if (json.includes('\\ud83e') || json.includes('\\ud83f')) {
    throw new Error(`safeJsonStringify JSON still contains orphaned surrogate: ${json}`);
  }
  // Must be parseable
  const parsed = JSON.parse(json);
  if (!parsed.message.includes('\uFFFD')) {
    throw new Error('Expected replacement character in parsed message');
  }
});

runTest('safeJsonStringify: normal strings are not corrupted', () => {
  const obj = { name: 'Alice', emoji: '🤖', value: 42 };
  const json = utils.safeJsonStringify(obj);
  const parsed = JSON.parse(json);
  if (parsed.name !== 'Alice') {
    throw new Error('Expected name to be preserved');
  }
  if (parsed.value !== 42) {
    throw new Error('Expected value to be preserved');
  }
  // Full emoji should survive because it is a valid surrogate pair
  if (parsed.emoji !== '🤖') {
    throw new Error(`Expected emoji to be preserved, got: ${parsed.emoji}`);
  }
});

// ============================================
// CONFIG CONSTANT TESTS
// ============================================

console.log('\n=== Testing Configuration Constants ===\n');

runTest('CONFIG constants are defined', () => {
  if (typeof utils.CONFIG.MIN_COMMENT_INTERVAL !== 'number') {
    throw new Error('Expected MIN_COMMENT_INTERVAL to be a number');
  }
  if (typeof utils.CONFIG.MAX_LINES_BEFORE_TRUNCATION !== 'number') {
    throw new Error('Expected MAX_LINES_BEFORE_TRUNCATION to be a number');
  }
  if (typeof utils.CONFIG.LINES_TO_KEEP_START !== 'number') {
    throw new Error('Expected LINES_TO_KEEP_START to be a number');
  }
  if (typeof utils.CONFIG.LINES_TO_KEEP_END !== 'number') {
    throw new Error('Expected LINES_TO_KEEP_END to be a number');
  }
});

runTest('CONFIG constants have reasonable values', () => {
  if (utils.CONFIG.MIN_COMMENT_INTERVAL < 1000) {
    throw new Error('MIN_COMMENT_INTERVAL should be at least 1000ms');
  }
  if (utils.CONFIG.MAX_LINES_BEFORE_TRUNCATION < 10) {
    throw new Error('MAX_LINES_BEFORE_TRUNCATION should be at least 10');
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Test Results for interactive-mode.lib.mjs:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
