#!/usr/bin/env node

/**
 * Regression coverage for issue #2247 (H4 and H10).
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
 * A third defect (H10) made the first one hard to diagnose: the *Solution Draft
 * Failed* comment reported `Prompt is too long`, the provider's reply to a full
 * context, and said nothing about the 547 clicks that filled it.
 *
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { buildToolCallSignature, createRepeatedToolCallBreaker, describeRepeatedToolCall, DOMINANT_FAILURE_MIN_COUNT, explainFailureWithToolHistory, getRepeatedToolCallLimit, REPEATED_TOOL_CALL_LIMIT_DEFAULT } from '../src/repeated-tool-call-breaker.lib.mjs';
import { cascadePlaywrightMcpDisable } from '../src/playwright-mcp.lib.mjs';

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

// Issue #2395: the breaker is opt-in and its default limit was raised from 3 to
// 10. The Kotlin scenario below runs it explicitly at the original limit of 3.
assert.equal(REPEATED_TOOL_CALL_LIMIT_DEFAULT, 10, 'issue #2395 raised the default limit from 3 to 10');
const KOTLIN_LIMIT = 3;

{
  const breaker = createRepeatedToolCallBreaker({ limit: KOTLIN_LIMIT });
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
  // Succeeding calls are not failures: five identical successes stay below the
  // loop threshold, and a success in between resets nothing on the failure side.
  // (Issue #2316 made a *run* of identical successful calls trip too - see
  // tests/repeated-tool-call-all-tools-2316.test.mjs.)
  const breaker = createRepeatedToolCallBreaker({ limit: KOTLIN_LIMIT });
  for (let i = 0; i < 5; i++) {
    const { id, event } = toolUseEvent();
    breaker.observe(event);
    breaker.observe(toolResultEvent(id, { isError: false, content: 'clicked' }));
  }
  assert.equal(breaker.tripped, false, 'five identical successful calls are not yet a loop');
  assert.equal(breaker.counts().size, 0, 'successes are not counted as failures');
}

{
  // A different input is a different call: retrying with a real selector after
  // two empty ones is progress, not a loop.
  const breaker = createRepeatedToolCallBreaker({ limit: KOTLIN_LIMIT });
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
  const breaker = createRepeatedToolCallBreaker({ limit: KOTLIN_LIMIT });
  for (let i = 0; i < 5; i++) breaker.observe(toolResultEvent('toolu_unknown'));
  assert.equal(breaker.tripped, false);
}

{
  // The limit is configurable, and 0 switches the breaker off entirely. Since
  // issue #2395 the environment only sets a limit once detection is enabled.
  const enabled = { HIVE_MIND_DETECT_REPEATED_TOOL_CALLS: 'true' };
  assert.equal(getRepeatedToolCallLimit({ ...enabled, HIVE_MIND_REPEATED_TOOL_CALL_LIMIT: '5' }), 5);
  assert.equal(getRepeatedToolCallLimit({ ...enabled, HIVE_MIND_REPEATED_TOOL_CALL_LIMIT: '' }), REPEATED_TOOL_CALL_LIMIT_DEFAULT);
  assert.equal(getRepeatedToolCallLimit({ ...enabled, HIVE_MIND_REPEATED_TOOL_CALL_LIMIT: 'nonsense' }), REPEATED_TOOL_CALL_LIMIT_DEFAULT);
  assert.equal(getRepeatedToolCallLimit(enabled), REPEATED_TOOL_CALL_LIMIT_DEFAULT);
  assert.equal(getRepeatedToolCallLimit({}), 0, 'issue #2395: off unless enabled');
  assert.equal(getRepeatedToolCallLimit({ HIVE_MIND_REPEATED_TOOL_CALL_LIMIT: '5' }), 0, 'issue #2395: a limit alone does not enable it');
  const disabled = createRepeatedToolCallBreaker({ limit: getRepeatedToolCallLimit({ ...enabled, HIVE_MIND_REPEATED_TOOL_CALL_LIMIT: '0' }) });
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
// 2b. Issue #2247 (H10): the failure is classified from the tool-call history
// before the provider's error string is used.
//
// The Kotlin *Solution Draft Failed* comment said `Prompt is too long`. That is
// what Anthropic replied, but it is the consequence: the context was full
// because one failing click had been repeated 547 times. A reader given only
// the provider's string has nothing to act on.
// ---------------------------------------------------------------------------

const PROMPT_TOO_LONG = 'Prompt is too long';

{
  // A session that fails without tripping the breaker (the limit was raised, or
  // the provider gave up first) still names the call it kept failing.
  const breaker = createRepeatedToolCallBreaker({ limit: 1000 });
  replayClicks(breaker, 547);
  assert.equal(breaker.tripped, false, 'this session ends the way the Kotlin run did: the provider stops it');

  const dominant = breaker.dominantFailure();
  assert.equal(dominant.tool, 'mcp__playwright__browser_click');
  assert.equal(dominant.count, 547);
  assert.equal(dominant.error, CLICK_ERROR);

  const reported = explainFailureWithToolHistory({ message: PROMPT_TOO_LONG, dominant });
  assert.match(reported, /Identical tool call repeated 547 times, failing every time: mcp__playwright__browser_click/, 'the cause comes first');
  assert.ok(reported.indexOf('repeated 547 times') < reported.indexOf(PROMPT_TOO_LONG), 'the provider error is kept, but after the cause');
  assert.ok(reported.includes(PROMPT_TOO_LONG), 'nothing the provider said is thrown away');
}

{
  // The most frequent failing call wins, and a call that failed once is noise,
  // not a pattern: a session with no repetition is reported unchanged.
  const breaker = createRepeatedToolCallBreaker({ limit: 1000 });
  replayClicks(breaker, 4, { target: '#a' });
  replayClicks(breaker, 9, { target: '#b' });
  assert.deepEqual(breaker.dominantFailure().input, { target: '#b' });

  const sparse = createRepeatedToolCallBreaker({ limit: 1000 });
  replayClicks(sparse, 1, { target: '#a' });
  replayClicks(sparse, 1, { target: '#b' });
  assert.equal(sparse.dominantFailure(), null, 'one failure per call is ordinary work, not a loop');
  assert.equal(explainFailureWithToolHistory({ message: PROMPT_TOO_LONG, dominant: null }), PROMPT_TOO_LONG, 'without a pattern the provider string is the report');
  assert.equal(DOMINANT_FAILURE_MIN_COUNT, 2);
  assert.equal(sparse.dominantFailure({ minimum: 1 }).count, 1, 'the threshold is adjustable');
}

{
  // Successful calls are not part of the history that explains a failure.
  const breaker = createRepeatedToolCallBreaker({ limit: 1000 });
  for (let i = 0; i < 20; i++) {
    const { id, event } = toolUseEvent({ target: '#ok' });
    breaker.observe(event);
    breaker.observe(toolResultEvent(id, { isError: false, content: 'clicked' }));
  }
  assert.equal(breaker.dominantFailure(), null);
}

assert.ok(claudeSource.includes('explainFailureWithToolHistory'), 'the Claude runner classifies from the tool-call history');
assert.ok(/const dominantToolCallFailure = repeatedToolCallFailure \? null : repeatedToolCallBreaker\.dominantFailure\(\);/.test(claudeSource), 'the history is consulted only when the breaker did not already name the loop');
assert.ok(claudeSource.includes('dominant: dominantToolCallFailure'), 'the reported errorInfo.message is built from it');
assert.ok(claudeSource.includes('repeatedToolCall: repeatedToolCallFailure || dominantToolCallFailure'), 'callers get the structured verdict either way');
// The transient-error classifier compares `lastMessage` exactly, so the tool
// history must not be spliced into it (`lastMessage === \'Request timed out\'`).
assert.ok(!/lastMessage = explainFailureWithToolHistory/.test(claudeSource), 'the retry classification input is left alone');

// ---------------------------------------------------------------------------
// 3. Issue #2319: Playwright MCP follows the same default for every model. The
//    Kotlin loop is stopped by the repeated-tool-call breaker (section 1), not
//    by a Formal AI-specific skip.
// ---------------------------------------------------------------------------

for (const model of ['formal-ai', 'formalai/formal-ai', 'sonnet']) {
  const argv = { model, tool: 'claude' };
  await cascadePlaywrightMcpDisable(argv, null);
  assert.equal(argv.playwrightMcp, undefined, `${model}: the Playwright MCP default is untouched`);
}

{
  const argv = { model: 'formal-ai', tool: 'claude', playwrightMcp: false };
  await cascadePlaywrightMcpDisable(argv, null);
  assert.equal(argv.promptPlaywrightMcp, false, '--no-playwright-mcp still cascades');
  assert.equal(argv.playwrightMcpAutoCleanup, false);
}

assert.ok(!(await readFile(join(repoRoot, 'src/playwright-mcp.lib.mjs'), 'utf8')).includes('isFormalAiModel'), 'no model-specific Playwright policy');

console.log('PASS: issue #2247 (H4/H10) repeated-failing-tool-call breaker, failure classification and one Playwright policy for every model');
