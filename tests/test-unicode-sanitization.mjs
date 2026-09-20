#!/usr/bin/env node

/**
 * Unit tests for unicode-sanitization.lib.mjs
 *
 * Tests the shared Unicode sanitization module that is used across all
 * CLI output parsing paths (claude.lib.mjs, agent.lib.mjs, codex.lib.mjs,
 * opencode.lib.mjs, interactive-mode.lib.mjs) to prevent orphaned UTF-16
 * surrogates from causing Anthropic API 400 errors.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1324
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const { sanitizeUnicode, sanitizeObjectStrings } = await import(join(__dirname, '..', 'src', 'unicode-sanitization.lib.mjs'));

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

function assertEqual(actual, expected, msg = '') {
  if (actual !== expected) {
    throw new Error(`${msg}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function assertDeepEqual(actual, expected, msg = '') {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) {
    throw new Error(`${msg}Expected ${e}, got ${a}`);
  }
}

// ============================================
// sanitizeUnicode() — BASIC TESTS
// ============================================

console.log('\n=== sanitizeUnicode: Basic Tests ===\n');

await runTest('returns empty string for null', () => {
  assertEqual(sanitizeUnicode(null), '');
});

await runTest('returns empty string for undefined', () => {
  assertEqual(sanitizeUnicode(undefined), '');
});

await runTest('returns empty string for empty string', () => {
  assertEqual(sanitizeUnicode(''), '');
});

await runTest('returns non-string input unchanged', () => {
  // sanitizeUnicode only operates on strings; non-string truthy values pass through
  assertEqual(sanitizeUnicode(123), 123);
  assertEqual(sanitizeUnicode(false), ''); // falsy → empty string via `text || ''`
});

await runTest('passes through clean ASCII text', () => {
  const text = 'Hello, world! This is a normal string.';
  assertEqual(sanitizeUnicode(text), text);
});

await runTest('passes through clean BMP Unicode', () => {
  const text = 'Привет мир — Ελληνικά — العربية — 日本語 — 中文';
  assertEqual(sanitizeUnicode(text), text);
});

await runTest('preserves valid emoji (surrogate pairs)', () => {
  const text = '🤖 Robot says hello 🌍';
  assertEqual(sanitizeUnicode(text), text);
});

await runTest('preserves multiple sequential valid emoji', () => {
  const text = '🤖✅💰📎🔗';
  assertEqual(sanitizeUnicode(text), text);
});

// ============================================
// sanitizeUnicode() — ORPHANED SURROGATE TESTS
// ============================================

console.log('\n=== sanitizeUnicode: Orphaned Surrogate Tests ===\n');

await runTest('replaces orphaned high surrogate', () => {
  const text = 'before\uD83Eafter';
  assertEqual(sanitizeUnicode(text), 'before\uFFFDafter');
});

await runTest('replaces orphaned low surrogate', () => {
  const text = 'before\uDD16after';
  assertEqual(sanitizeUnicode(text), 'before\uFFFDafter');
});

await runTest('replaces orphaned high surrogate at start', () => {
  const text = '\uD83Estart of text';
  assertEqual(sanitizeUnicode(text), '\uFFFDstart of text');
});

await runTest('replaces orphaned high surrogate at end', () => {
  const text = 'end of text\uD83E';
  assertEqual(sanitizeUnicode(text), 'end of text\uFFFD');
});

await runTest('replaces orphaned low surrogate at start', () => {
  const text = '\uDD16start of text';
  assertEqual(sanitizeUnicode(text), '\uFFFDstart of text');
});

await runTest('replaces orphaned low surrogate at end', () => {
  const text = 'end of text\uDD16';
  assertEqual(sanitizeUnicode(text), 'end of text\uFFFD');
});

await runTest('replaces multiple orphaned surrogates', () => {
  const text = '\uD83Efoo\uDD16bar\uD800baz';
  assertEqual(sanitizeUnicode(text), '\uFFFDfoo\uFFFDbar\uFFFDbaz');
});

await runTest('replaces reversed surrogate pair (low before high)', () => {
  const text = '\uDD16\uD83E';
  assertEqual(sanitizeUnicode(text), '\uFFFD\uFFFD');
});

await runTest('handles string of only orphaned surrogates', () => {
  const text = '\uD800\uD801\uD802';
  assertEqual(sanitizeUnicode(text), '\uFFFD\uFFFD\uFFFD');
});

await runTest('preserves valid pair but replaces adjacent orphan', () => {
  // valid pair \uD83E\uDD16 = 🤖, then orphaned \uD83E
  const text = '\uD83E\uDD16\uD83E';
  assertEqual(sanitizeUnicode(text), '🤖\uFFFD');
});

await runTest('handles orphaned high at surrogate range boundaries', () => {
  // D800 is first high surrogate, DBFF is last high surrogate
  assertEqual(sanitizeUnicode('\uD800'), '\uFFFD');
  assertEqual(sanitizeUnicode('\uDBFF'), '\uFFFD');
});

await runTest('handles orphaned low at surrogate range boundaries', () => {
  // DC00 is first low surrogate, DFFF is last low surrogate
  assertEqual(sanitizeUnicode('\uDC00'), '\uFFFD');
  assertEqual(sanitizeUnicode('\uDFFF'), '\uFFFD');
});

await runTest('valid pairs at surrogate range boundaries are preserved', () => {
  // D800+DC00 is the first valid pair, DBFF+DFFF is the last valid pair
  const first = '\uD800\uDC00';
  const last = '\uDBFF\uDFFF';
  assertEqual(sanitizeUnicode(first), first);
  assertEqual(sanitizeUnicode(last), last);
});

// ============================================
// sanitizeUnicode() — REAL-WORLD CLAUDE OUTPUT
// ============================================

console.log('\n=== sanitizeUnicode: Real-World Claude Output Patterns ===\n');

await runTest('handles exact issue #1324 API error message', () => {
  // This is the exact error message from the issue
  const errorMsg = 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"The request body is not valid JSON: no low surrogate in string: line 1 column 28642 (char 28641)"},"request_id":"req_011CYEFwLV3CotFyg7Xr7zVy"}';
  // Error message itself is clean ASCII — should pass through unchanged
  assertEqual(sanitizeUnicode(errorMsg), errorMsg);
});

await runTest('handles Claude result event with emoji-rich content', () => {
  const text = '🤖 I created the PR with these changes:\n✅ Fixed the bug\n💰 Cost: $0.12\n📎 Attached logs\n🔗 Link: https://github.com/example';
  assertEqual(sanitizeUnicode(text), text);
});

await runTest('handles persisted-output truncation that splits emoji', () => {
  // Simulates what happens when <persisted-output> truncation cuts
  // in the middle of a 🤖 emoji (U+1F916 = D83E DD16)
  const truncated = 'Some output text with emoji 🤖 and more \uD83E';
  const expected = 'Some output text with emoji 🤖 and more \uFFFD';
  assertEqual(sanitizeUnicode(truncated), expected);
});

await runTest('handles hive-mind status messages with emoji', () => {
  const statusMsg = '🤖 Solution Draft Log\n💰 Cost: $3.003222\n📎 Log file uploaded\n🔗 View complete log';
  assertEqual(sanitizeUnicode(statusMsg), statusMsg);
});

await runTest('handles Cyrillic + emoji mixed content', () => {
  const text = 'Привет 🤖 мир 🌍 тест ✅';
  assertEqual(sanitizeUnicode(text), text);
});

await runTest('handles CJK characters with emoji', () => {
  const text = '日本語テスト 🤖 中文测试 🌍';
  assertEqual(sanitizeUnicode(text), text);
});

await runTest('handles tool result with truncated emoji at boundary', () => {
  // Real scenario: tool_result content gets truncated by persisted-output
  const content = 'File content: {"status": "ok", "emoji": "🤖' + '\uD83E' + '"}';
  const expected = 'File content: {"status": "ok", "emoji": "🤖' + '\uFFFD' + '"}';
  assertEqual(sanitizeUnicode(content), expected);
});

await runTest('handles large text with 1000 valid emoji', () => {
  const emoji = '🤖';
  const text = emoji.repeat(1000);
  assertEqual(sanitizeUnicode(text), text);
});

await runTest('is idempotent on clean strings', () => {
  const text = 'Hello world 🤖';
  assertEqual(sanitizeUnicode(sanitizeUnicode(text)), sanitizeUnicode(text));
});

await runTest('is idempotent on strings with orphans', () => {
  const text = 'Hello \uD83E world';
  const once = sanitizeUnicode(text);
  const twice = sanitizeUnicode(once);
  assertEqual(once, twice);
  assertEqual(once, 'Hello \uFFFD world');
});

// ============================================
// sanitizeObjectStrings() — BASIC TESTS
// ============================================

console.log('\n=== sanitizeObjectStrings: Basic Tests ===\n');

await runTest('sanitizes string value', () => {
  assertEqual(sanitizeObjectStrings('hello\uD83E'), 'hello\uFFFD');
});

await runTest('returns number as-is', () => {
  assertEqual(sanitizeObjectStrings(42), 42);
});

await runTest('returns boolean as-is', () => {
  assertEqual(sanitizeObjectStrings(true), true);
});

await runTest('returns null as-is', () => {
  assertEqual(sanitizeObjectStrings(null), null);
});

await runTest('returns undefined as-is', () => {
  assertEqual(sanitizeObjectStrings(undefined), undefined);
});

await runTest('sanitizes flat object', () => {
  const input = { name: 'test\uD83E', count: 5 };
  const result = sanitizeObjectStrings(input);
  assertEqual(result.name, 'test\uFFFD');
  assertEqual(result.count, 5);
});

await runTest('sanitizes nested object', () => {
  const input = { outer: { inner: 'text\uD83E' } };
  const result = sanitizeObjectStrings(input);
  assertEqual(result.outer.inner, 'text\uFFFD');
});

await runTest('sanitizes array of strings', () => {
  const input = ['clean', 'dirty\uD83E'];
  const result = sanitizeObjectStrings(input);
  assertEqual(result[0], 'clean');
  assertEqual(result[1], 'dirty\uFFFD');
});

await runTest('sanitizes mixed array', () => {
  const input = ['text\uD83E', 42, null, { key: 'val\uDD16' }];
  const result = sanitizeObjectStrings(input);
  assertEqual(result[0], 'text\uFFFD');
  assertEqual(result[1], 42);
  assertEqual(result[2], null);
  assertEqual(result[3].key, 'val\uFFFD');
});

// ============================================
// sanitizeObjectStrings() — CLAUDE NDJSON EVENT SIMULATION
// ============================================

console.log('\n=== sanitizeObjectStrings: Claude NDJSON Event Simulation ===\n');

await runTest('sanitizes assistant text event with orphaned surrogate', () => {
  // Simulates an assistant event where content was truncated by persisted-output
  const event = {
    type: 'assistant',
    message: {
      id: '6c18c735-0d38-42c0-8fba-5694a276934e',
      model: '<synthetic>',
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: 'Here is the output with emoji 🤖 and truncated\uD83E',
        },
      ],
    },
    session_id: 'd12b2d61-7ab1-48dc-9677-3a1261066898',
  };

  const result = sanitizeObjectStrings(event);
  assertEqual(result.message.content[0].text, 'Here is the output with emoji 🤖 and truncated\uFFFD');
  // Non-string fields should be preserved
  assertEqual(result.type, 'assistant');
  assertEqual(result.session_id, 'd12b2d61-7ab1-48dc-9677-3a1261066898');
});

await runTest('sanitizes result event from issue #1324', () => {
  // Simulates the actual result event from issue #1324
  const event = {
    type: 'result',
    subtype: 'success',
    is_error: true,
    duration_ms: 18602,
    result: 'API Error: 400 {"type":"error","error":{"type":"invalid_request_error","message":"The request body is not valid JSON: no low surrogate in string: line 1 column 28642 (char 28641)"},"request_id":"req_011CYEFwLV3CotFyg7Xr7zVy"}',
    session_id: 'd12b2d61-7ab1-48dc-9677-3a1261066898',
    total_cost_usd: 0.11730099999999997,
  };

  const result = sanitizeObjectStrings(event);
  // The error message is clean ASCII, so it should pass through unchanged
  assertEqual(result.result, event.result);
  assertEqual(result.type, 'result');
  assertEqual(result.total_cost_usd, 0.11730099999999997);
});

await runTest('sanitizes tool_result event with persisted-output content', () => {
  // Simulates a tool_result event where the content was truncated
  // by Claude CLI's persisted-output feature, splitting a surrogate pair
  const event = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'tool_123',
          content: 'Command output: git log showed commits with emoji 🤖\uD83E',
          is_error: false,
        },
      ],
    },
  };

  const result = sanitizeObjectStrings(event);
  assertEqual(result.message.content[0].content, 'Command output: git log showed commits with emoji 🤖\uFFFD');
  assertEqual(result.message.content[0].tool_use_id, 'tool_123');
  assertEqual(result.message.content[0].is_error, false);
});

await runTest('sanitizes tool_use event with emoji in input', () => {
  const event = {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'tool_456',
          name: 'Bash',
          input: {
            command: 'echo "🤖 Testing\uD83E"',
            description: 'Run test command',
          },
        },
      ],
    },
  };

  const result = sanitizeObjectStrings(event);
  assertEqual(result.message.content[0].input.command, 'echo "🤖 Testing\uFFFD"');
  assertEqual(result.message.content[0].input.description, 'Run test command');
});

await runTest('sanitizes system.init event (clean — should pass through)', () => {
  const event = {
    type: 'system',
    subtype: 'init',
    session_id: 'abc-123',
    tools: ['Bash', 'Read', 'Write'],
    mcp_servers: [],
  };

  const result = sanitizeObjectStrings(event);
  assertDeepEqual(result, event);
});

await runTest('sanitizes deeply nested object from real assistant event', () => {
  const event = {
    type: 'assistant',
    message: {
      id: 'msg-1',
      model: 'claude-opus-4-5-20251101',
      role: 'assistant',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_creation: {
          ephemeral_1h_input_tokens: 200,
        },
      },
      content: [
        {
          type: 'text',
          text: 'I will fix the bug\uD83E in the code 🤖',
        },
      ],
    },
  };

  const result = sanitizeObjectStrings(event);
  assertEqual(result.message.content[0].text, 'I will fix the bug\uFFFD in the code 🤖');
  assertEqual(result.message.usage.input_tokens, 100);
  assertEqual(result.message.usage.cache_creation.ephemeral_1h_input_tokens, 200);
});

await runTest('handles event with multiple content items, some with orphans', () => {
  const event = {
    type: 'assistant',
    message: {
      content: [
        { type: 'text', text: 'Clean text 🤖' },
        { type: 'text', text: 'Dirty text\uD83E end' },
        { type: 'tool_use', id: 'tool_1', name: 'Read', input: { path: '/tmp/test\uDD16.txt' } },
      ],
    },
  };

  const result = sanitizeObjectStrings(event);
  assertEqual(result.message.content[0].text, 'Clean text 🤖');
  assertEqual(result.message.content[1].text, 'Dirty text\uFFFD end');
  assertEqual(result.message.content[2].input.path, '/tmp/test\uFFFD.txt');
});

// ============================================
// JSON.stringify ROUND-TRIP SAFETY
// ============================================

console.log('\n=== JSON Round-trip Safety Tests ===\n');

await runTest('sanitized string survives JSON.stringify round-trip', () => {
  const dirty = 'text\uD83Emore';
  const sanitized = sanitizeUnicode(dirty);
  // This should NOT throw
  const json = JSON.stringify(sanitized);
  const parsed = JSON.parse(json);
  assertEqual(parsed, 'text\uFFFDmore');
});

await runTest('sanitized object survives JSON.stringify round-trip', () => {
  const dirty = {
    type: 'result',
    result: 'output with orphan\uD83E and valid 🤖',
    session_id: 'test-session',
  };
  const sanitized = sanitizeObjectStrings(dirty);
  // This should NOT throw
  const json = JSON.stringify(sanitized);
  const parsed = JSON.parse(json);
  assertEqual(parsed.result, 'output with orphan\uFFFD and valid 🤖');
  assertEqual(parsed.type, 'result');
});

await runTest('sanitized complex event survives JSON.stringify round-trip', () => {
  const event = {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'text',
          text: 'Text with orphan\uD83E at truncation point',
        },
      ],
    },
    session_id: 'test-\uDBFF',
  };
  const sanitized = sanitizeObjectStrings(event);
  // This should NOT throw — the original would throw in strict parsers
  const json = JSON.stringify(sanitized);
  const parsed = JSON.parse(json);
  assertEqual(parsed.message.content[0].text, 'Text with orphan\uFFFD at truncation point');
  assertEqual(parsed.session_id, 'test-\uFFFD');
});

await runTest('pathological input: all surrogate code units', () => {
  // Every possible orphaned high surrogate (D800-DBFF has 1024 values)
  // Test a representative sample
  const highs = ['\uD800', '\uD83E', '\uDB00', '\uDBFF'];
  for (const h of highs) {
    const result = sanitizeUnicode(h);
    assertEqual(result, '\uFFFD', `High surrogate ${h.charCodeAt(0).toString(16)} should be replaced`);
  }
});

await runTest('pathological input: all low surrogate code units', () => {
  const lows = ['\uDC00', '\uDD16', '\uDE00', '\uDFFF'];
  for (const l of lows) {
    const result = sanitizeUnicode(l);
    assertEqual(result, '\uFFFD', `Low surrogate ${l.charCodeAt(0).toString(16)} should be replaced`);
  }
});

// ============================================
// SIMULATED REGULAR CLAUDE COMMAND PARSING
// ============================================

console.log('\n=== Simulated Regular Claude Command NDJSON Parsing ===\n');

await runTest('simulated NDJSON line parsing with sanitization', () => {
  // This simulates what happens in claude.lib.mjs at lines 977-986:
  //   const data = sanitizeObjectStrings(JSON.parse(line));
  //   await log(JSON.stringify(data, null, 2));
  const ndjsonLine = '{"type":"assistant","message":{"content":[{"type":"text","text":"Output with emoji \\ud83e\\udd16 and orphan \\ud83e"}]},"session_id":"test-123"}';

  const data = JSON.parse(ndjsonLine);
  const sanitized = sanitizeObjectStrings(data);
  // The valid pair \uD83E\uDD16 (🤖) should be preserved
  // The orphaned \uD83E should be replaced with \uFFFD
  if (!sanitized.message.content[0].text.includes('🤖')) {
    throw new Error('Valid emoji should be preserved');
  }
  if (sanitized.message.content[0].text.includes('\uD83E') && !sanitized.message.content[0].text.includes('🤖')) {
    throw new Error('Orphaned surrogate should be replaced');
  }
  // Verify JSON.stringify doesn't produce invalid JSON
  const json = JSON.stringify(sanitized, null, 2);
  JSON.parse(json); // Should not throw
});

await runTest('simulated result event with cost data preserved', () => {
  const ndjsonLine = '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":0.117301,"result":"Task completed successfully \\ud83e\\udd16","session_id":"test-456"}';

  const data = JSON.parse(ndjsonLine);
  const sanitized = sanitizeObjectStrings(data);

  assertEqual(sanitized.type, 'result');
  assertEqual(sanitized.subtype, 'success');
  assertEqual(sanitized.is_error, false);
  assertEqual(sanitized.total_cost_usd, 0.117301);
  if (!sanitized.result.includes('🤖')) {
    throw new Error('Valid emoji should be preserved in result');
  }
});

await runTest('simulated message count tracking preserved after sanitization', () => {
  const events = ['{"type":"message","content":"Message 1 \\ud83e\\udd16"}', '{"type":"tool_use","name":"Bash","input":{"command":"echo test"}}', '{"type":"message","content":"Message 2"}'];

  let messageCount = 0;
  let toolUseCount = 0;

  for (const line of events) {
    const data = sanitizeObjectStrings(JSON.parse(line));
    if (data.type === 'message') messageCount++;
    else if (data.type === 'tool_use') toolUseCount++;
  }

  assertEqual(messageCount, 2);
  assertEqual(toolUseCount, 1);
});

await runTest('simulated session limit detection works after sanitization', () => {
  const event = {
    type: 'result',
    is_error: true,
    result: 'Session limit reached. Please try again later.\uD83E',
  };

  const sanitized = sanitizeObjectStrings(event);
  // The detection logic checks lastMessage.includes('Session limit reached')
  if (!sanitized.result.includes('Session limit reached')) {
    throw new Error('Session limit detection should still work after sanitization');
  }
});

await runTest('simulated overload error detection works after sanitization', () => {
  const event = {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'text',
          text: 'API Error: 500 {"type":"error","error":{"type":"api_error","message":"Overloaded"}}\uD83E',
        },
      ],
    },
  };

  const sanitized = sanitizeObjectStrings(event);
  const text = sanitized.message.content[0].text;
  if (!text.includes('API Error: 500') || !text.includes('api_error') || !text.includes('Overloaded')) {
    throw new Error('Overload error detection pattern should survive sanitization');
  }
});

await runTest('simulated 503 error detection works after sanitization', () => {
  const event = {
    type: 'assistant',
    message: {
      content: [
        {
          type: 'text',
          text: 'API Error: 503 upstream connect error\uDD16',
        },
      ],
    },
  };

  const sanitized = sanitizeObjectStrings(event);
  const text = sanitized.message.content[0].text;
  if (!text.includes('API Error: 503') || !text.includes('upstream connect error')) {
    throw new Error('503 error detection pattern should survive sanitization');
  }
});

await runTest('simulated request timeout detection works after sanitization', () => {
  const event = {
    type: 'result',
    is_error: true,
    result: 'Request timed out',
  };

  const sanitized = sanitizeObjectStrings(event);
  assertEqual(sanitized.result, 'Request timed out');
});

await runTest('simulated resultSummary capture preserved after sanitization', () => {
  const event = {
    type: 'result',
    subtype: 'success',
    result: 'I successfully fixed the bug by updating the parser.\n\nChanges:\n- Fixed truncation logic 🤖\n- Added tests\uD83E\n- Updated docs',
    total_cost_usd: 0.5,
  };

  const sanitized = sanitizeObjectStrings(event);
  if (!sanitized.result.includes('🤖')) {
    throw new Error('Valid emoji should be preserved in result summary');
  }
  if (sanitized.result.includes('\uD83E') && !sanitized.result.includes('🤖')) {
    throw new Error('Orphaned surrogate should be replaced in result summary');
  }
  // The result should be safe to post as a GitHub PR comment
  const json = JSON.stringify(sanitized);
  JSON.parse(json); // Should not throw
});

// ============================================
// PERFORMANCE / STRESS TESTS
// ============================================

console.log('\n=== Performance / Stress Tests ===\n');

await runTest('handles very large string efficiently', () => {
  // 100KB string with emoji every 100 chars
  let text = '';
  for (let i = 0; i < 1000; i++) {
    text += 'A'.repeat(97) + '🤖\n';
  }
  const start = Date.now();
  const result = sanitizeUnicode(text);
  const elapsed = Date.now() - start;
  assertEqual(result, text);
  if (elapsed > 1000) throw new Error(`Took too long: ${elapsed}ms`);
});

await runTest('handles deeply nested object', () => {
  let obj = { value: 'deep\uD83E' };
  for (let i = 0; i < 50; i++) {
    obj = { nested: obj };
  }
  const result = sanitizeObjectStrings(obj);
  // Traverse to the deepest value
  let current = result;
  for (let i = 0; i < 50; i++) {
    current = current.nested;
  }
  assertEqual(current.value, 'deep\uFFFD');
});

// ============================================
// SUMMARY
// ============================================

console.log(`\n${'='.repeat(50)}`);
console.log(`Total: ${testsPassed + testsFailed} | ✅ Passed: ${testsPassed} | ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

if (testsFailed > 0) {
  process.exit(1);
}
