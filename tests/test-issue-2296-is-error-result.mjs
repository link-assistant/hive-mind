#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #2296 (part E): Claude Code reported the 401 as
 * `{"type":"result","subtype":"success","is_error":true,...}` and the log said
 * "Detected error from Claude CLI (subtype: success)" and "Anthropic official
 * cost captured from success result". Such a result is an error: it must not
 * be labelled a success, become the solution summary, or be the authoritative cost.
 */
import fs from 'fs';
import { captureAnthropicResultCost } from '../src/anthropic-cost-accumulator.lib.mjs';
import { describeClaudeResultKind, isSuccessfulClaudeResult } from '../src/claude.stream-events.lib.mjs';

let passed = 0;
let failed = 0;
function assertEqual(actual, expected, label) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) {
    console.log(`  PASS: ${label}`);
    passed++;
  } else {
    console.log(`  FAIL: ${label}`);
    console.log(`    expected: ${JSON.stringify(expected)}`);
    console.log(`    actual:   ${JSON.stringify(actual)}`);
    failed++;
  }
}

// Shape of the result event from the incident log.
const AUTH_ERROR_RESULT = { type: 'result', subtype: 'success', is_error: true, api_error_status: 401, error: 'authentication_failed', result: 'Failed to authenticate. API Error: 401 OAuth session expired and could not be refreshed', total_cost_usd: 1.5 };
const SUCCESS_RESULT = { type: 'result', subtype: 'success', is_error: false, result: 'Done.', total_cost_usd: 2.25 };

console.log('\n--- Result classification ---');
assertEqual(isSuccessfulClaudeResult(AUTH_ERROR_RESULT), false, 'subtype "success" with is_error is not a success');
assertEqual(isSuccessfulClaudeResult(SUCCESS_RESULT), true, 'a plain success result is a success');
assertEqual(isSuccessfulClaudeResult({ type: 'result', subtype: 'error_max_turns', is_error: true }), false, 'an error subtype is not a success');
assertEqual(describeClaudeResultKind(AUTH_ERROR_RESULT), 'error result, is_error: true, subtype: success, error: authentication_failed, status: 401', 'the log label calls it an error result');
assertEqual(describeClaudeResultKind({ subtype: 'error_max_turns', is_error: true }), 'subtype: error_max_turns', 'other subtypes keep their label');

console.log('\n--- Cost capture ---');
const logs = [];
const log = async message => logs.push(message);
assertEqual(await captureAnthropicResultCost({ data: AUTH_ERROR_RESULT, model: 'opus', log }), { fallback: 1.5 }, 'the cost of an is_error result is kept as fallback, not as the authoritative total');
assertEqual(
  logs.some(line => /captured from success result/.test(line)),
  false,
  'no "captured from success result" line for an is_error result'
);
assertEqual(/error result, is_error: true/.test(logs[0]), true, 'the cost line labels the result as an error');
logs.length = 0;
assertEqual(await captureAnthropicResultCost({ data: SUCCESS_RESULT, model: 'opus', log }), { total: 2.25 }, 'a success result still sets the authoritative total');

console.log('\n--- claude.lib.mjs uses the helper everywhere it decides "success" ---');
const claudeSrc = fs.readFileSync(new URL('../src/claude.lib.mjs', import.meta.url), 'utf8');
assertEqual((claudeSrc.match(/data\.subtype === 'success'/g) || []).length, 0, 'no bare subtype === "success" checks remain in claude.lib.mjs');
assertEqual(/Detected error from Claude CLI \(\$\{describeClaudeResultKind\(data\)\}\)/.test(claudeSrc), true, 'the error log line uses the result label');

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
