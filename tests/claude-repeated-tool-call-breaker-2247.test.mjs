#!/usr/bin/env node

/**
 * Regression coverage for issue #2247 (H4).
 *
 * The 2026-09-13 Kotlin run (`solve --model formal-ai --tool claude` against a
 * fresh `konard/test-hello-world-*` repository) made 547
 * `mcp__playwright__browser_click` calls with the same input, `{"target": ""}`,
 * each answered `Unexpected token "" while parsing css selector ""`, until
 * Anthropic replied `Prompt is too long` (Kotlin log line 106044). Nothing was
 * written to the repository. Two defects made that possible:
 *
 *   1. nothing counted how often the *same* failing call had already been made,
 *      so the session ran until its context was exhausted;
 *   2. Playwright MCP was attached to a `--model formal-ai` task that reads its
 *      issue through `gh`/WebFetch and never needs a browser.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildToolCallSignature, createRepeatedToolCallBreaker, describeRepeatedToolCall, getRepeatedToolCallLimit, REPEATED_TOOL_CALL_LIMIT_DEFAULT } from '../src/repeated-tool-call-breaker.lib.mjs';
import { cascadePlaywrightMcpDisable, shouldSkipPlaywrightMcpForFormalAi, wasPlaywrightMcpRequestedExplicitly } from '../src/playwright-mcp.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// ---------------------------------------------------------------------------
// 1. The breaker, replayed against the shape of the Kotlin stream events.
// ---------------------------------------------------------------------------

const CLICK_INPUT = { target: '' };
const CLICK_ERROR = 'Unexpected token "" while parsing css selector ""';

let nextId = 0;
const toolUseEvent = (input = CLICK_INPUT, name = 'mcp__playwright__browser_click') => {
  const id = `toolu_${++nextId}`;
  return { id, event: { type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } } };
};
const toolResultEvent = (id, { isError = true, content = CLICK_ERROR } = {}) => ({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] } });

const replayClicks = (breaker, times, input = CLICK_INPUT) => {
  const verdicts = [];
  for (let i = 0; i < times; i++) {
    const { id, event } = toolUseEvent(input);
    verdicts.push(breaker.observe(event));
    verdicts.push(breaker.observe(toolResultEvent(id)));
  }
  return verdicts.filter(Boolean);
};

assert.equal(REPEATED_TOOL_CALL_LIMIT_DEFAULT, 3, 'the issue prescribes breaking after 3 identical failing calls');

{
  const breaker = createRepeatedToolCallBreaker();
  const first = replayClicks(breaker, 2);
  assert.deepEqual(first, [], 'two identical failures are not yet a loop');
  assert.equal(breaker.tripped, false);

  const tripped = replayClicks(breaker, 1);
  assert.equal(tripped.length, 1, 'the third identical failing call trips the breaker');
  const verdict = tripped[0];
  assert.equal(verdict.tool, 'mcp__playwright__browser_click');
  assert.deepEqual(verdict.input, CLICK_INPUT);
  assert.equal(verdict.count, 3);
  assert.equal(verdict.error, CLICK_ERROR);
  assert.match(verdict.reason, /Identical tool call repeated 3 times, failing every time: mcp__playwright__browser_click/);
  assert.match(verdict.reason, /Unexpected token .* while parsing css selector/);
  assert.equal(breaker.tripped, true);
  assert.equal(breaker.observe(toolUseEvent().event), verdict, 'a tripped breaker keeps its first verdict');
}

{
  // Succeeding calls never count, no matter how many of them there are: the 547
  // repeats mattered because every single one came back as an error.
  const breaker = createRepeatedToolCallBreaker();
  for (let i = 0; i < 10; i++) {
    const { id, event } = toolUseEvent();
    breaker.observe(event);
    breaker.observe(toolResultEvent(id, { isError: false, content: 'clicked' }));
  }
  assert.equal(breaker.tripped, false, 'successful calls are not a loop');
}

{
  // A different input is a different call: retrying with a real selector after
  // two empty ones is progress, not a loop.
  const breaker = createRepeatedToolCallBreaker();
  replayClicks(breaker, 2);
  const verdicts = replayClicks(breaker, 2, { target: '#submit' });
  assert.deepEqual(verdicts, [], 'the counter is per (tool, input) pair');
  assert.equal(replayClicks(breaker, 1).length, 1, 'the original call still reaches its own limit');
}

{
  // Key order must not create a new signature.
  assert.equal(buildToolCallSignature({ name: 'Bash', input: { command: 'ls', timeout: 1 } }), buildToolCallSignature({ name: 'Bash', input: { timeout: 1, command: 'ls' } }));
  assert.notEqual(buildToolCallSignature({ name: 'Bash', input: { command: 'ls' } }), buildToolCallSignature({ name: 'Read', input: { command: 'ls' } }));
}

{
  // A `tool_result` whose `tool_use` was never seen (a resumed session replaying
  // history) cannot be attributed to a call and must not be counted.
  const breaker = createRepeatedToolCallBreaker();
  for (let i = 0; i < 5; i++) breaker.observe(toolResultEvent('toolu_unknown'));
  assert.equal(breaker.tripped, false);
}

{
  // The limit is configurable, and 0 switches the breaker off entirely.
  assert.equal(getRepeatedToolCallLimit({ HIVE_MIND_REPEATED_TOOL_CALL_LIMIT: '10' }), 10);
  assert.equal(getRepeatedToolCallLimit({ HIVE_MIND_REPEATED_TOOL_CALL_LIMIT: '' }), REPEATED_TOOL_CALL_LIMIT_DEFAULT);
  assert.equal(getRepeatedToolCallLimit({ HIVE_MIND_REPEATED_TOOL_CALL_LIMIT: 'nonsense' }), REPEATED_TOOL_CALL_LIMIT_DEFAULT);
  assert.equal(getRepeatedToolCallLimit({}), REPEATED_TOOL_CALL_LIMIT_DEFAULT);
  const disabled = createRepeatedToolCallBreaker({ limit: getRepeatedToolCallLimit({ HIVE_MIND_REPEATED_TOOL_CALL_LIMIT: '0' }) });
  replayClicks(disabled, 547);
  assert.equal(disabled.tripped, false, 'HIVE_MIND_REPEATED_TOOL_CALL_LIMIT=0 disables the breaker');
}

// A long input is truncated so the reason stays readable in a GitHub comment.
assert.ok(describeRepeatedToolCall({ tool: 'Bash', input: { command: 'x'.repeat(1000) }, count: 3 }).length < 400);

// ---------------------------------------------------------------------------
// 2. The Claude runner reports the loop as the failure reason.
// ---------------------------------------------------------------------------

const claudeSource = await readFile(join(repoRoot, 'src', 'claude.lib.mjs'), 'utf8');
assert.ok(claudeSource.includes("from './repeated-tool-call-breaker.lib.mjs'"), 'claude.lib.mjs wires the breaker');
assert.ok(claudeSource.includes('repeatedToolCallBreaker.observe(data)'), 'every stream event is offered to the breaker');
assert.ok(/if \(repeatedToolCallFailure\) \{\n\s+commandFailed = true;\n\s+lastMessage = repeatedToolCallFailure\.reason;/.test(claudeSource), 'a tripped breaker fails the session with the loop as the reason');
assert.ok(claudeSource.includes('repeatedToolCall: repeatedToolCallFailure'), 'the verdict is carried out to the caller for failure classification');

// ---------------------------------------------------------------------------
// 3. Playwright MCP is not attached to a `--model formal-ai` run.
// ---------------------------------------------------------------------------

assert.equal(shouldSkipPlaywrightMcpForFormalAi({ argv: { model: 'formal-ai' }, rawArgs: [] }), true);
assert.equal(shouldSkipPlaywrightMcpForFormalAi({ argv: { model: 'formalai/formal-ai' }, rawArgs: [] }), true, 'both spellings of the model are covered');
assert.equal(shouldSkipPlaywrightMcpForFormalAi({ argv: { model: 'sonnet' }, rawArgs: [] }), false, 'other models keep the default');
assert.equal(shouldSkipPlaywrightMcpForFormalAi({ argv: { model: 'formal-ai' }, rawArgs: ['--playwright-mcp'] }), false, 'an explicit request wins');
assert.equal(shouldSkipPlaywrightMcpForFormalAi({ argv: { model: 'formal-ai' }, rawArgs: ['--playwright-mcp=true'] }), false);
assert.equal(wasPlaywrightMcpRequestedExplicitly(['--no-playwright-mcp']), false, '--no-playwright-mcp is not a request for it');

{
  const argv = { model: 'formal-ai', tool: 'claude' };
  const logs = [];
  await cascadePlaywrightMcpDisable(argv, async message => logs.push(message), { rawArgs: [] });
  assert.equal(argv.playwrightMcp, false, 'the formal-ai run does not get a browser');
  assert.equal(argv.promptPlaywrightMcp, false, 'and the prompt does not advertise one');
  assert.equal(argv.playwrightMcpAutoCleanup, false);
  assert.ok(
    logs.some(message => message.includes('formal-ai')),
    'the reason is logged'
  );
}

{
  const argv = { model: 'sonnet', tool: 'claude' };
  await cascadePlaywrightMcpDisable(argv, null, { rawArgs: [] });
  assert.equal(argv.playwrightMcp, undefined, 'a normal run is untouched');
}

console.log('PASS: issue #2247 (H4) repeated-failing-tool-call breaker and formal-ai Playwright policy');
