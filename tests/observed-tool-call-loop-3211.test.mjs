#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #3211: a codex session that ran
 * `gh issue view … --json title --jq .title` 73 times with the same output, and
 * did nothing else, was reported as a success.
 *
 * Issue #2395 made the repeated-tool-call breaker opt-in because stopping
 * sessions killed legitimate CI waits, and that stays so: the breaker is off by
 * default and nothing here stops a session. What changes is that the loop is
 * *observed* - every adapter already feeds every finished call to the breaker -
 * so the outcome of the session can say "looped on `<command>` N times" instead
 * of nothing.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3211
 * @see https://github.com/link-assistant/hive-mind/issues/2395
 */

import assert from 'node:assert/strict';

import { createToolCallLoopGuard } from '../src/tool-call-loop-guard.lib.mjs';
import { createRepeatedToolCallBreaker, describeObservedToolCallLoop, getObservedToolCallLoopHistory, OBSERVED_LOOP_MIN_CALLS, resetRepeatedToolCallState, takeObservedToolCallLoop } from '../src/repeated-tool-call-breaker.lib.mjs';
import { classifySessionResult } from '../src/session-result.lib.mjs';

const ISSUE_URL = 'https://github.com/konard/test-hello-world-019fb330-fa49-7c9d-a664-b7ea33bb698a/issues/1';
const COMMAND = `/bin/bash -lc "gh issue view '${ISSUE_URL}' --json title --jq .title"`;
const codexRecord = (id, command = COMMAND, output = 'Implement Hello World in Rust\n') => ({ type: 'item.completed', item: { id: `item_${id}`, type: 'command_execution', command, aggregated_output: output, exit_code: 0, status: 'completed' } });

const logs = [];
const log = async message => {
  logs.push(String(message));
};

assert.equal(OBSERVED_LOOP_MIN_CALLS, 10, 'the same threshold the opt-in breaker uses by default');

// --- The codex reproduction: 73 identical calls, breaker off --------------

{
  resetRepeatedToolCallState();
  logs.length = 0;
  let stops = 0;
  const guard = createToolCallLoopGuard({ log, limit: 0, stopSession: async () => stops++ });
  const stream = Array.from({ length: 73 }, (_, index) => JSON.stringify(codexRecord(index))).join('\n') + '\n';
  assert.equal(await guard.observeOutput(stream), null);
  assert.equal(stops, 0, 'the session is never stopped (#2395: the breaker stays off by default)');
  assert.equal(guard.tripped, false);

  const toolResult = { success: true, sessionId: 'codex-1' };
  const classified = await classifySessionResult({ toolResult, argv: {}, log });
  assert.equal(classified.success, true, 'observing a loop does not turn the session into a failure');
  assert.equal(classified.observedToolCallLoop?.count, 73);
  const line = logs.find(entry => entry.includes('looped on'));
  assert.ok(line, 'the loop is reported in the log');
  assert.ok(line.includes(`looped on \`gh issue view '${ISSUE_URL}' --json title --jq .title\` 73 times`), line);
  assert.match(line, /not stopped/);

  const history = getObservedToolCallLoopHistory();
  assert.equal(history.length, 1, 'kept for the run outcome');
  assert.equal(describeObservedToolCallLoop(history[0]), `looped on \`gh issue view '${ISSUE_URL}' --json title --jq .title\` 73 times`);
  assert.equal(takeObservedToolCallLoop(), null, 'taken once per session');
}

// --- Not a loop -----------------------------------------------------------

{
  resetRepeatedToolCallState();
  const breaker = createRepeatedToolCallBreaker({ limit: 0 });
  for (let index = 0; index < 9; index++) breaker.recordCall({ tool: 'shell', input: { command: 'cat Main.kt' }, output: 'fun main() {}' });
  assert.equal(takeObservedToolCallLoop(), null, 'nine identical calls are below the threshold');

  // Same call, different output each time: the session is reading something that changes.
  for (let index = 0; index < 20; index++) breaker.recordCall({ tool: 'shell', input: { command: 'cargo test' }, output: `test run ${index}` });
  assert.equal(takeObservedToolCallLoop(), null);

  // CI polling is waiting, not looping.
  for (let index = 0; index < 40; index++) breaker.recordCall({ tool: 'shell', input: { command: 'gh pr checks 2 --repo o/r' }, output: 'pending', isError: true });
  for (let index = 0; index < 40; index++) breaker.recordCall({ tool: 'Bash', input: { command: 'sleep 60' }, output: '' });
  assert.equal(takeObservedToolCallLoop(), null);
  assert.deepEqual(getObservedToolCallLoopHistory(), []);
}

// --- Claude stream events are observed the same way, with the breaker off ---

{
  resetRepeatedToolCallState();
  const breaker = createRepeatedToolCallBreaker({ limit: 0 });
  for (let index = 0; index < 12; index++) {
    assert.equal(breaker.observe({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${index}`, name: 'Read', input: { file_path: '/repo/.gitkeep' } }] } }), null);
    assert.equal(breaker.observe({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `t${index}`, content: '' }] } }), null);
  }
  assert.equal(breaker.tripped, false);
  const loop = takeObservedToolCallLoop();
  assert.equal(loop?.count, 12);
  assert.equal(describeObservedToolCallLoop(loop), 'looped on `Read({"file_path":"/repo/.gitkeep"})` 12 times');
}

// --- Identical failing calls are a loop too; long commands are shortened --

{
  resetRepeatedToolCallState();
  const breaker = createRepeatedToolCallBreaker({ limit: 0 });
  const long = `node -e "${'x'.repeat(300)}"`;
  for (let index = 0; index < 10; index++) breaker.recordCall({ tool: 'shell', input: { command: long }, output: 'SyntaxError', isError: true });
  const loop = takeObservedToolCallLoop();
  assert.equal(loop?.count, 10);
  const text = describeObservedToolCallLoop(loop);
  assert.ok(text.length < 240, text);
  assert.match(text, /…` 10 times$/);
}

// --- The opt-in breaker, when enabled, still trips as before ----------------

{
  resetRepeatedToolCallState();
  let stops = 0;
  const guard = createToolCallLoopGuard({ log, limit: 10, stopSession: async () => stops++ });
  for (let index = 0; index < 20; index++) await guard.observeEvent(codexRecord(index));
  assert.equal(stops, 1, 'with --detect-repeated-tool-calls the session is still stopped at 2 x limit identical successes');
  resetRepeatedToolCallState();
}

console.log('PASS: issue #3211 a looping session is reported as looped, without being stopped');
