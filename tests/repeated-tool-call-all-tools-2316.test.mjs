#!/usr/bin/env node

/**
 * Regression test for issue #2316: the repeated-tool-call breaker existed only
 * for claude, and only counted failures.
 *
 * The Rust `--tool codex` run issued the identical `gh issue view ...` command
 * 78 times in a row, every one succeeding with the same output, and the PR
 * comment reported the resulting 6.2M-token turn as `6.2M / 200K (3092%) input
 * tokens`. Every adapter now feeds one shared breaker; identical successful calls
 * trip it too, the session ends with the `repeated_tool_call` reason, the reason
 * is posted, and the next session receives it as feedback.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2316
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createToolCallLoopGuard, REPEATED_TOOL_CALL_REASON, resetRepeatedToolCallState, takeRepeatedToolCallFeedback, takeRepeatedToolCallVerdict } from '../src/tool-call-loop-guard.lib.mjs';
import { createRepeatedToolCallBreaker } from '../src/repeated-tool-call-breaker.lib.mjs';
import { classifySessionResult } from '../src/session-result.lib.mjs';
import { buildAgentBudgetStats, buildBudgetStatsString } from '../src/claude.budget-stats.lib.mjs';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
const test = async (description, fn) => {
  resetRepeatedToolCallState();
  try {
    await fn();
    console.log(`  PASS: ${description}`);
    passed++;
  } catch (error) {
    console.log(`  FAIL: ${description}`);
    console.log(`      ${error.stack || error.message}`);
    failed++;
  }
};

const COMMAND = `/bin/bash -lc "gh issue view 'https://github.com/o/r/issues/1' --json title --jq .title"`;
const OUTPUT = 'Implement Hello World in Rust\n';

/** One tool call in each adapter's stream format, as the raw stdout text the adapter reads. */
const ADAPTER_EVENTS = {
  claude: i => [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: `toolu_${i}`, name: 'Bash', input: { command: COMMAND } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `toolu_${i}`, is_error: false, content: OUTPUT }] } },
  ],
  qwen: i => [
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: `call_${i}`, name: 'run_shell_command', input: { command: COMMAND } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: `call_${i}`, is_error: false, content: OUTPUT }] } },
  ],
  codex: i => [
    { type: 'item.started', item: { id: `item_${i}`, type: 'command_execution', command: COMMAND, aggregated_output: '', exit_code: null, status: 'in_progress' } },
    { type: 'item.completed', item: { id: `item_${i}`, type: 'command_execution', command: COMMAND, aggregated_output: OUTPUT, exit_code: 0, status: 'completed' } },
  ],
  // Agent and OpenCode re-emit the same part on every state change.
  agent: i => ['pending', 'running', 'completed', 'completed'].map(status => ({ type: 'tool_use', part: { id: `prt_${i}`, type: 'tool', callID: `call_${i}`, tool: 'bash', state: { status, input: { command: COMMAND }, output: status === 'completed' ? OUTPUT : undefined } } })),
  opencode: i => ['running', 'completed'].map(status => ({ type: 'tool_use', part: { id: `prt_${i}`, type: 'tool', callID: `call_${i}`, tool: 'bash', state: { status, input: { command: COMMAND }, output: status === 'completed' ? OUTPUT : undefined } } })),
  gemini: i => [
    { type: 'tool_use', tool_name: 'run_shell_command', tool_id: `tool_${i}`, parameters: { command: COMMAND } },
    { type: 'tool_result', tool_id: `tool_${i}`, status: 'success', output: OUTPUT },
  ],
};

/** Agent/OpenCode print pretty JSON (several lines per record); the rest NDJSON. */
const serialize = (adapter, record) => (adapter === 'agent' || adapter === 'opencode' ? `${JSON.stringify(record, null, 2)}\n` : `${JSON.stringify(record)}\n`);

const runSession = async (adapter, calls) => {
  const stops = [];
  const guard = createToolCallLoopGuard({ limit: 3, stopSession: async verdict => stops.push(verdict) });
  let endedAfter = null;
  for (let i = 1; i <= calls && endedAfter === null; i++) {
    for (const record of ADAPTER_EVENTS[adapter](i)) {
      // Split every record across two chunks: the guard must not depend on chunk boundaries.
      const text = serialize(adapter, record);
      await guard.observeOutput(text.slice(0, 7));
      if (await guard.observeOutput(text.slice(7))) {
        endedAfter = i;
        break;
      }
    }
  }
  return { guard, stops, endedAfter };
};

console.log('Issue #2316: one repeated-tool-call breaker for every adapter\n');

for (const adapter of Object.keys(ADAPTER_EVENTS)) {
  await test(`${adapter}: 6 identical tool calls end the session with the ${REPEATED_TOOL_CALL_REASON} reason`, async () => {
    const { guard, stops, endedAfter } = await runSession(adapter, 10);
    assert.equal(endedAfter, 6, 'the sixth identical call trips the breaker');
    assert.equal(stops.length, 1, 'the session is stopped exactly once');
    assert.equal(guard.tripped, true);
    assert.match(stops[0].reason, /Identical tool call repeated 6 times in a row, returning the same output every time/);
    assert.match(stops[0].reason, /gh issue view/, 'the reason names the repeated call');

    const argv = { model: 'formal-ai', autoRestartUntilMergeable: true };
    const toolResult = await classifySessionResult({ toolResult: { success: true, sessionId: 's' }, argv });
    assert.equal(toolResult.stopReason, REPEATED_TOOL_CALL_REASON);
    assert.equal(toolResult.success, false);
    assert.equal(toolResult.restartWithFeedback, true, 'the restart loop continues');
    assert.equal(toolResult.errorInfo.message, stops[0].reason);
    const feedback = takeRepeatedToolCallFeedback();
    assert.match(feedback.join('\n'), /stopped by the repeated-tool-call breaker: Identical tool call repeated 6 times/);
    assert.deepEqual(takeRepeatedToolCallFeedback(), [], 'the feedback is handed over once');
  });
}

await test('five identical calls, or six calls with changing output, keep the session running', async () => {
  for (const adapter of Object.keys(ADAPTER_EVENTS)) {
    const { endedAfter } = await runSession(adapter, 5);
    assert.equal(endedAfter, null, `${adapter}: five calls are below the limit`);
  }
  const breaker = createRepeatedToolCallBreaker({ limit: 3 });
  for (let i = 0; i < 10; i++) assert.equal(breaker.recordCall({ tool: 'shell', input: { command: 'cat build.log' }, output: `line ${i}` }), null);
  for (let i = 0; i < 10; i++) assert.equal(breaker.recordCall({ tool: 'shell', input: { command: 'sleep 30 && gh run view 1' }, output: 'in_progress' }), null, 'polling is not a loop');
  assert.equal(takeRepeatedToolCallVerdict(), null, 'nothing was published');
});

await test('identical failing codex commands trip at the failure limit (3)', async () => {
  const guard = createToolCallLoopGuard({ limit: 3 });
  const fail = i => `${JSON.stringify({ type: 'item.completed', item: { id: `item_${i}`, type: 'command_execution', command: 'cargo run', aggregated_output: 'error[E0425]', exit_code: 101, status: 'failed' } })}\n`;
  assert.equal(await guard.observeOutput(fail(1)), null);
  assert.equal(await guard.observeOutput(fail(2)), null);
  const verdict = await guard.observeOutput(fail(3));
  assert.match(verdict.reason, /repeated 3 times, failing every time: shell\(\{"command":"cargo run"\}\)/);
});

await test('HIVE_MIND_REPEATED_TOOL_CALL_LIMIT=0 disables the breaker', async () => {
  const guard = createToolCallLoopGuard({ limit: 0 });
  for (let i = 1; i <= 20; i++) for (const record of ADAPTER_EVENTS.codex(i)) assert.equal(await guard.observeOutput(`${JSON.stringify(record)}\n`), null);
});

await test('replaying the Rust codex run ends the session within the limit, not after 78 calls', async () => {
  const log = await readFile(join(repoRoot, 'docs/case-studies/issue-2320/logs/rust-codex.log'), 'utf8');
  const stops = [];
  // Issue #2395: the breaker is opt-in now (`--detect-repeated-tool-calls`); this
  // replays the Rust run with it enabled at the limit the run was designed for.
  const guard = createToolCallLoopGuard({ limit: 3, stopSession: async verdict => stops.push(verdict) });
  let commands = 0;
  for (const line of log.split('\n')) {
    const match = line.match(/^\[[^\]]+\] \[STDOUT\] (.*)$/);
    if (!match) continue;
    if (/"type":"item\.completed".*"command_execution"/.test(match[1])) commands++;
    if (await guard.observeOutput(`${match[1]}\n`)) break;
  }
  assert.equal(stops.length, 1, 'the breaker stopped the session');
  assert.equal(commands, 6, 'after the sixth identical command, not the 78th');
  assert.match(stops[0].reason, /gh issue view 'https:\/\/github\.com\/konard\/test-hello-world-019fb331/);
});

await test('without a restart loop the reason is the session failure message', async () => {
  const breaker = createToolCallLoopGuard({ limit: 1 });
  await breaker.observeOutput(`${JSON.stringify(ADAPTER_EVENTS.codex(1)[1])}\n`);
  await breaker.observeOutput(`${JSON.stringify(ADAPTER_EVENTS.codex(2)[1])}\n`);
  const toolResult = await classifySessionResult({ toolResult: { success: true }, argv: { autoRestartUntilMergeable: false } });
  assert.equal(toolResult.restartWithFeedback, false);
  assert.equal(toolResult.success, false);
  assert.match(toolResult.errorInfo.message, /Identical tool call repeated 2 times in a row/);
});

await test('the reason is posted to the pull request', async () => {
  const guard = createToolCallLoopGuard({ limit: 1 });
  for (let i = 1; i <= 2; i++) await guard.observeOutput(`${JSON.stringify(ADAPTER_EVENTS.codex(i)[1])}\n`);
  const posted = [];
  const fake$ =
    options =>
    async (strings, ...values) => {
      posted.push({ command: strings.reduce((acc, s, i) => acc + s + (values[i] ?? ''), ''), stdin: options?.stdin });
      return { code: 0, stdout: '{"id":42}', stderr: '' };
    };
  await classifySessionResult({ toolResult: { success: true }, argv: { autoRestartUntilMergeable: true }, owner: 'konard', repo: 'test-hello-world', prNumber: 2, $: fake$ });
  assert.equal(posted.length, 1);
  assert.match(posted[0].command, /gh api repos\/konard\/test-hello-world\/issues\/2\/comments -X POST/);
  const body = JSON.parse(posted[0].stdin).body;
  assert.match(body, /Session stopped: repeated tool call/);
  assert.match(body, /repeated_tool_call/);
  assert.match(body, /The next session is told about this call/);
});

await test('every adapter feeds the shared guard, and the restart loop hands over its feedback', async () => {
  for (const adapter of ['codex', 'agent', 'opencode', 'gemini', 'qwen']) {
    const source = await readFile(join(repoRoot, 'src', `${adapter}.lib.mjs`), 'utf8');
    assert.match(source, /createToolCallLoopGuard\(\{ log, limit: resolveRepeatedToolCallLimit\(\{ argv \}\), stopSession/, `${adapter} creates the guard`);
    assert.match(source, /await toolCallLoopGuard\.observeOutput\(/, `${adapter} feeds its stdout`);
  }
  assert.match(await readFile(join(repoRoot, 'src', 'claude.lib.mjs'), 'utf8'), /publishRepeatedToolCallVerdict\(toolCallLoop\)/, 'claude publishes its own breaker verdict');
  const restart = await readFile(join(repoRoot, 'src', 'solve.restart-shared.lib.mjs'), 'utf8');
  assert.match(restart, /\.\.\.takeRepeatedToolCallFeedback\(\)\]/);
  assert.match(restart, /await classifySessionResult\(/);
  const solve = await readFile(join(repoRoot, 'src', 'solve.mjs'), 'utf8');
  assert.match(solve, /await classifySessionResult\(/);
  assert.match(solve, /\|\| toolResult\.restartWithFeedback;/, 'a breaker stop with a restart loop is not a terminal failure');
  assert.match(solve, /&& !toolResult\.restartWithFeedback;/, 'and not a critical error that auto-commits');
});

await test('a cumulative total above the context window is not printed as a context fill', async () => {
  const stats = buildBudgetStatsString(buildAgentBudgetStats({ inputTokens: 6183844, outputTokens: 27382, cacheReadTokens: 0, cacheWriteTokens: 0, stepCount: 1, respondedModelId: 'formal-ai', contextLimit: 200000, outputLimit: 100000, peakContextUsage: 6183844 }, { modelName: 'Formal AI', totalCostUSD: 0 }));
  assert.doesNotMatch(stats, /3092%/);
  assert.doesNotMatch(stats, /6\.2M \/ 200K/);
  assert.match(stats, /6\.2M input tokens across requests \(cumulative, larger than the 200K context window, so not one request's context\)/);
  const normal = buildBudgetStatsString(buildAgentBudgetStats({ inputTokens: 15000, outputTokens: 1000, cacheReadTokens: 0, cacheWriteTokens: 0, stepCount: 5, respondedModelId: 'm', contextLimit: 204800, outputLimit: 32000, peakContextUsage: 14000 }, { modelName: 'M', totalCostUSD: 0.005 }));
  assert.match(normal, /15K \/ 204\.8K \(7%\) input tokens/, 'a real per-request fill keeps its percentage');
});

console.log(`\nResults: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
