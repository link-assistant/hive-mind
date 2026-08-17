#!/usr/bin/env node

/**
 * Regression test for issue #2160: an in-session tool failure that the AI handles itself must not
 * be reported as a warning, and must not replace the last assistant message.
 *
 * Reported symptom (hive run 4c1dedd8-a645-479c-84ce-72a0f8d7d179, 23 occurrences):
 *   ⚠️ Tool result error detected: Blocked: sleep 240 followed by: gh pr checks 201 …
 *   ⚠️ Tool result error detected: Exit code 143
 * None of these say anything about the session outcome: the first is the AI tool's own harness
 * refusing a foreground `sleep`, the second is the AI's Bash timeout firing (SIGTERM).
 *
 * Root cause: src/claude.lib.mjs treated every `tool_result` with `is_error: true` as an error
 * signal and also did `lastMessage = eventFacts.toolResultError`, so
 * buildMissingClaudeResultMessage() could report a truncated stream as having failed "after:
 * Blocked: sleep 240 …" instead of after what the AI actually said.
 *
 * Fix: classifyToolResultError() in src/claude.stream-events.lib.mjs marks these categories as
 * benign; claude.lib.mjs logs them as ℹ️ information and never overwrites lastMessage.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2160
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyToolResultError, collectClaudeStreamEventFacts, buildMissingClaudeResultMessage } from '../src/claude.stream-events.lib.mjs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = (description, fn) => {
  try {
    fn();
    console.log(`  ${GREEN}PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Build the stream event Claude Code emits for a failed tool call. */
const toolResultEvent = content => ({
  type: 'user',
  message: { content: [{ type: 'tool_result', is_error: true, content }] },
});

console.log('================================================================================');
console.log('Regression: benign in-session tool results are not errors (Issue #2160)');
console.log('================================================================================\n');

console.log('classifyToolResultError():\n');

// Verbatim samples from the reported run log.
const benignSamples = [
  ['Blocked: sleep 240 followed by: gh pr checks 201 tail -30. To wait for a condition, use Monitor with an until-loop.', 'harness_blocked'],
  ['Blocked: sleep 60 followed by: gh run list --repo link-assistant/router --limit 5', 'harness_blocked'],
  ['Exit code 143', 'command_timeout'],
  ['Command timed out after 10m 0s', 'command_timeout'],
  ['Exit code 1', 'command_exit_code'],
  ['Exit code 127', 'command_exit_code'],
];

for (const [sample, category] of benignSamples) {
  test(`benign (${category}): ${sample.slice(0, 48)}`, () => {
    const result = classifyToolResultError(sample);
    assert(result.benign, `expected benign, got ${JSON.stringify(result)}`);
    assert(result.category === category, `expected category ${category}, got ${result.category}`);
  });
}

const realSamples = ['Path does not exist: /tmp/gh-issue-solver-1779276811027/apps/bot/src.', 'File has not been read yet. Read it first before writing to it.', 'ENOSPC: no space left on device, write'];

for (const sample of realSamples) {
  test(`still an error signal: ${sample.slice(0, 48)}`, () => {
    const result = classifyToolResultError(sample);
    assert(!result.benign, `expected a real error, got ${JSON.stringify(result)}`);
  });
}

test('empty / non-string input is not classified as benign', () => {
  for (const input of [null, undefined, '', '   ', 42]) {
    const result = classifyToolResultError(input);
    assert(!result.benign && result.category === null, `unexpected classification for ${JSON.stringify(input)}`);
  }
});

console.log('\ncollectClaudeStreamEventFacts():\n');

test('exposes the classification alongside toolResultError', () => {
  const benign = collectClaudeStreamEventFacts(toolResultEvent('Blocked: sleep 120 followed by: tail -40 out.log'));
  assert(benign.toolResultError.startsWith('Blocked:'), 'the raw text must still be captured');
  assert(benign.toolResultErrorIsBenign === true, 'a harness block must be flagged benign');
  assert(benign.toolResultErrorCategory === 'harness_blocked', `unexpected category ${benign.toolResultErrorCategory}`);

  const real = collectClaudeStreamEventFacts(toolResultEvent('<tool_use_error>Path does not exist: /x</tool_use_error>'));
  assert(real.toolResultError === 'Path does not exist: /x', `unexpected normalization: ${real.toolResultError}`);
  assert(real.toolResultErrorIsBenign === false, 'a real tool error must not be flagged benign');
});

test('events without a tool error keep the flags off', () => {
  const facts = collectClaudeStreamEventFacts({ type: 'assistant', message: { content: [{ type: 'text', text: 'hello' }] } });
  assert(facts.toolResultError === null && facts.toolResultErrorIsBenign === false && facts.toolResultErrorCategory === null, 'flags should stay clear');
});

console.log('\nTruncated-stream reporting:\n');

test('a truncated stream is reported after the assistant message, not after a blocked sleep', () => {
  // Replay the ordering seen in the log: the AI says something, then its `sleep` is blocked,
  // then the stream ends without a terminal result event.
  let lastMessage = null;
  let lastToolResultError = null;
  const events = [{ type: 'assistant', message: { content: [{ type: 'text', text: 'Waiting for CI to finish before merging.' }] } }, toolResultEvent('Blocked: sleep 240 followed by: gh pr checks 201')];
  for (const event of events) {
    const facts = collectClaudeStreamEventFacts(event);
    if (facts.lastText) lastMessage = facts.lastText;
    if (facts.toolResultError && !facts.toolResultErrorIsBenign) lastToolResultError = facts.toolResultError;
  }
  assert(lastToolResultError === null, 'a blocked sleep must not become the session error');
  const message = buildMissingClaudeResultMessage({ lastToolResultError, lastMessage });
  assert(message.includes('Waiting for CI to finish'), `expected the assistant message in the report, got: ${message}`);
  assert(!message.includes('Blocked:'), `the harness block must not be reported as the failure cause, got: ${message}`);
});

console.log('\nWiring in src/claude.lib.mjs:\n');

const claudeSrc = readFileSync(join(__dirname, '..', 'src', 'claude.lib.mjs'), 'utf8');

test('claude.lib.mjs never overwrites lastMessage with a tool result error', () => {
  assert(!claudeSrc.includes('lastMessage = eventFacts.toolResultError'), 'the assistant message must not be replaced by a tool result error');
});

test('claude.lib.mjs only records non-benign tool result errors', () => {
  assert(claudeSrc.includes('eventFacts.toolResultErrorIsBenign'), 'claude.lib.mjs should consult the classification');
  const occurrences = claudeSrc.split('lastToolResultError = eventFacts.toolResultError').length - 1;
  assert(occurrences === 2, `expected both capture sites to remain, found ${occurrences}`);
});

console.log('\nPrompt guidance (contributing factor):\n');

const enLocale = readFileSync(join(__dirname, '..', 'src', 'locales', 'en.lino'), 'utf8');

test('the prompt tells the AI not to wait with long foreground sleeps', () => {
  assert(/until-loop|do not use long foreground sleep|avoid long foreground `sleep`/i.test(enLocale), 'en.lino should carry guidance about waiting without long foreground sleeps');
});

console.log('');
console.log('================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

process.exit(failed === 0 ? 0 : 1);
