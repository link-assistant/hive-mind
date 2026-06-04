#!/usr/bin/env node
/**
 * Tool Execution Failure Message Unit Tests (Issue #1845)
 *
 * Verifies that the shared `formatToolExecutionFailure` helper surfaces the
 * core error reported by the underlying tool runner, instead of only the
 * generic "<TOOL> execution failed".
 *
 * Reproduces the bug from issue #1845: a Claude run that ended with
 * "API Error: Output blocked by content filtering policy" previously showed
 * only "CLAUDE execution failed". The desired output is:
 *
 *   "CLAUDE execution failed with API Error: Output blocked by content filtering policy"
 *
 * Run with: node tests/format-tool-execution-failure-1845.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1845
 */

import assert from 'node:assert/strict';
import { formatToolExecutionFailure, extractToolErrorCore } from '../src/lib.mjs';
import { getCodexErrorEventSummary } from '../src/codex.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

console.log('\n📋 formatToolExecutionFailure Tests\n');

// ---------------------------------------------------------------------------
// Core requirement from the issue
// ---------------------------------------------------------------------------

test('appends the core error from errorInfo.message (the issue example)', () => {
  const result = formatToolExecutionFailure({
    tool: 'claude',
    toolResult: {
      success: false,
      errorInfo: { message: 'API Error: Output blocked by content filtering policy' },
    },
  });
  assert.equal(result, 'CLAUDE execution failed with API Error: Output blocked by content filtering policy');
});

test('uppercases the tool name', () => {
  const result = formatToolExecutionFailure({
    tool: 'gemini',
    toolResult: { errorInfo: { message: 'boom' } },
  });
  assert.equal(result, 'GEMINI execution failed with boom');
});

test('defaults the tool name to claude when not provided', () => {
  const result = formatToolExecutionFailure({
    toolResult: { errorInfo: { message: 'boom' } },
  });
  assert.equal(result, 'CLAUDE execution failed with boom');
});

// ---------------------------------------------------------------------------
// Fallback behaviour (no specific error available)
// ---------------------------------------------------------------------------

test('falls back to generic message when there is no errorInfo', () => {
  const result = formatToolExecutionFailure({ tool: 'claude', toolResult: { success: false } });
  assert.equal(result, 'CLAUDE execution failed');
});

test('falls back to generic message when toolResult is missing', () => {
  const result = formatToolExecutionFailure({ tool: 'codex' });
  assert.equal(result, 'CODEX execution failed');
});

test('falls back to generic message when called with no arguments', () => {
  assert.equal(formatToolExecutionFailure(), 'CLAUDE execution failed');
});

test('does NOT use resultSummary as the error (would be misleading)', () => {
  const result = formatToolExecutionFailure({
    tool: 'claude',
    toolResult: { success: false, resultSummary: 'Implemented the feature and committed it.' },
  });
  assert.equal(result, 'CLAUDE execution failed');
});

// ---------------------------------------------------------------------------
// Alternate error fields
// ---------------------------------------------------------------------------

test('uses errorInfo.errorMatch when message is absent', () => {
  const result = formatToolExecutionFailure({
    tool: 'qwen',
    toolResult: { errorInfo: { errorMatch: 'rate limited' } },
  });
  assert.equal(result, 'QWEN execution failed with rate limited');
});

test('supports errorInfo provided as a plain string', () => {
  const result = formatToolExecutionFailure({
    tool: 'opencode',
    toolResult: { errorInfo: 'permission denied' },
  });
  assert.equal(result, 'OPENCODE execution failed with permission denied');
});

test('uses toolResult.result as a last resort', () => {
  const result = formatToolExecutionFailure({
    tool: 'claude',
    toolResult: { result: 'something specific went wrong' },
  });
  assert.equal(result, 'CLAUDE execution failed with something specific went wrong');
});

// ---------------------------------------------------------------------------
// Normalisation / edge cases
// ---------------------------------------------------------------------------

test('collapses multiline / whitespace-heavy errors into a single line', () => {
  const result = formatToolExecutionFailure({
    tool: 'claude',
    toolResult: { errorInfo: { message: 'API Error:\n   Output blocked\tby   policy\n' } },
  });
  assert.equal(result, 'CLAUDE execution failed with API Error: Output blocked by policy');
});

test('does not duplicate the base phrase when the core already says "execution failed"', () => {
  const result = formatToolExecutionFailure({
    tool: 'claude',
    toolResult: { errorInfo: { message: 'CLAUDE execution failed with exit code 1' } },
  });
  assert.equal(result, 'CLAUDE execution failed');
});

test('truncates very long core errors with an ellipsis', () => {
  const long = 'x'.repeat(500);
  const result = formatToolExecutionFailure({
    tool: 'claude',
    toolResult: { errorInfo: { message: long } },
    maxLength: 50,
  });
  assert.ok(result.startsWith('CLAUDE execution failed with '), `Unexpected prefix: ${result}`);
  assert.ok(result.endsWith('…'), `Expected ellipsis suffix but got: ${result}`);
  // base + " with " + 50-char core (49 chars + ellipsis)
  assert.ok(result.length <= 'CLAUDE execution failed with '.length + 50, `Too long: ${result.length}`);
});

test('falls back to generic message when errorInfo.message is empty/whitespace', () => {
  const result = formatToolExecutionFailure({
    tool: 'claude',
    toolResult: { errorInfo: { message: '   \n\t ' } },
  });
  assert.equal(result, 'CLAUDE execution failed');
});

test('ignores non-string error values', () => {
  const result = formatToolExecutionFailure({
    tool: 'claude',
    toolResult: { errorInfo: { message: 12345 } },
  });
  assert.equal(result, 'CLAUDE execution failed');
});

// ---------------------------------------------------------------------------
// Cross-tool result shapes — each runner surfaces errorInfo with a usable
// `.message`, so the same helper produces a self-explanatory failure for all
// of them (issue #1845 asked for the fix to be applied across the codebase).
// ---------------------------------------------------------------------------

console.log('\n📋 Cross-tool result shape Tests\n');

test('claude.lib failure shape -> includes the API error', () => {
  // Shape returned by claude.lib.mjs main commandFailed return.
  const toolResult = {
    success: false,
    sessionId: 'abc',
    limitReached: false,
    errorInfo: { message: 'API Error: Output blocked by content filtering policy', exitCode: 1 },
  };
  assert.equal(formatToolExecutionFailure({ tool: 'claude', toolResult }), 'CLAUDE execution failed with API Error: Output blocked by content filtering policy');
});

test('codex.lib failure shape (getCodexErrorEventSummary) -> includes the event message', () => {
  // Shape returned by codex.lib.mjs commandFailed return.
  const summary = getCodexErrorEventSummary({
    itemErrors: [],
    turnFailures: [{ message: 'context length exceeded' }],
    streamErrors: [],
  });
  assert.equal(summary.message, 'context length exceeded');
  assert.equal(formatToolExecutionFailure({ tool: 'codex', toolResult: { success: false, errorInfo: summary } }), 'CODEX execution failed with context length exceeded');
});

test('gemini.lib failure shape -> includes the error text', () => {
  const toolResult = { success: false, errorInfo: { message: 'Gemini command failed with exit code 1', exitCode: 1 } };
  assert.equal(formatToolExecutionFailure({ tool: 'gemini', toolResult }), 'GEMINI execution failed with Gemini command failed with exit code 1');
});

test('opencode.lib failure shape -> includes the captured error', () => {
  const toolResult = { success: false, errorInfo: { message: 'permission prompt was not accepted' } };
  assert.equal(formatToolExecutionFailure({ tool: 'opencode', toolResult }), 'OPENCODE execution failed with permission prompt was not accepted');
});

test('qwen.lib failure shape -> includes the combined error text', () => {
  const toolResult = { success: false, errorInfo: { message: 'authentication failed', exitCode: 1 } };
  assert.equal(formatToolExecutionFailure({ tool: 'qwen', toolResult }), 'QWEN execution failed with authentication failed');
});

test('agent.lib failure shape -> includes the agent error message', () => {
  const toolResult = { success: false, errorInfo: { message: 'Agent reported error: rate limit', errorType: 'UsageLimit' } };
  assert.equal(formatToolExecutionFailure({ tool: 'agent', toolResult }), 'AGENT execution failed with Agent reported error: rate limit');
});

// ---------------------------------------------------------------------------
// extractToolErrorCore — the shared root-cause extractor reused by the terminal
// "Error details:" lines (watch / auto-merge / review) so they show the same
// core error as the GitHub comment, without the "<TOOL> execution failed with"
// prefix (issue #1845: apply the fix across the codebase).
// ---------------------------------------------------------------------------

console.log('\n📋 extractToolErrorCore Tests\n');

test('extractToolErrorCore returns just the core error from errorInfo.message', () => {
  assert.equal(extractToolErrorCore({ toolResult: { errorInfo: { message: 'API Error: blocked' } } }), 'API Error: blocked');
});

test('extractToolErrorCore precedence: message > errorMatch > string > result', () => {
  assert.equal(extractToolErrorCore({ toolResult: { errorInfo: { message: 'm', errorMatch: 'e' }, result: 'r' } }), 'm');
  assert.equal(extractToolErrorCore({ toolResult: { errorInfo: { errorMatch: 'e' }, result: 'r' } }), 'e');
  assert.equal(extractToolErrorCore({ toolResult: { errorInfo: 'str', result: 'r' } }), 'str');
  assert.equal(extractToolErrorCore({ toolResult: { result: 'r' } }), 'r');
});

test('extractToolErrorCore collapses whitespace into a single line', () => {
  assert.equal(extractToolErrorCore({ toolResult: { errorInfo: { message: 'API Error:\n  blocked\tby   policy\n' } } }), 'API Error: blocked by policy');
});

test('extractToolErrorCore returns null when no usable error is present', () => {
  assert.equal(extractToolErrorCore({ toolResult: { success: false } }), null);
  assert.equal(extractToolErrorCore({ toolResult: {} }), null);
  assert.equal(extractToolErrorCore({}), null);
  assert.equal(extractToolErrorCore(), null);
});

test('extractToolErrorCore returns null for empty/whitespace and non-string messages', () => {
  assert.equal(extractToolErrorCore({ toolResult: { errorInfo: { message: '   \n\t ' } } }), null);
  assert.equal(extractToolErrorCore({ toolResult: { errorInfo: { message: 12345 } } }), null);
});

test('extractToolErrorCore does NOT use resultSummary (success summary, not an error)', () => {
  assert.equal(extractToolErrorCore({ toolResult: { resultSummary: 'Implemented the feature.' } }), null);
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n' + '='.repeat(60));
console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total\n`);

if (testsFailed > 0) {
  process.exit(1);
}
