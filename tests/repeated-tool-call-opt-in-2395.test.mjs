#!/usr/bin/env node

/**
 * Regression test for issue #2395: "`🔁 Session stopped: repeated tool call`
 * was never a requirement".
 *
 * Two `--tool codex --auto-merge` sessions were killed while they waited for
 * CI. `gh pr checks` exits 8 while checks are pending (and 1 once a check has
 * failed), codex reports every non-zero exit as `status: "failed"`, and the
 * always-on breaker counted three polls one minute apart as "the same failing
 * call". The fixtures are the exact `item.completed` records from both logs.
 *
 * Required now:
 * - the breaker is off unless `--detect-repeated-tool-calls` or
 *   `HIVE_MIND_DETECT_REPEATED_TOOL_CALLS` enables it;
 * - its default limit is 10 (was 3);
 * - CI polling is never counted, even when enabled;
 * - a failing call is only "the same" when its output is the same too.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2395
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRepeatedToolCallBreaker, getRepeatedToolCallLimit, isPollingToolInput, isRepeatedToolCallDetectionEnabled, REPEATED_TOOL_CALL_LIMIT_DEFAULT, resolveRepeatedToolCallLimit } from '../src/repeated-tool-call-breaker.lib.mjs';
import { createToolCallLoopGuard, resetRepeatedToolCallState, takeRepeatedToolCallVerdict } from '../src/tool-call-loop-guard.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS } from '../src/solve.config.lib.mjs';

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

const readFixture = async name => (await readFile(join(repoRoot, 'tests', 'fixtures', name), 'utf8')).trim().split('\n');
const pVsNpPolls = await readFixture('issue-2395-p-vs-np-gh-pr-checks.jsonl');
const agentPolls = await readFixture('issue-2395-agent-gh-pr-checks.jsonl');

/** Feed raw codex stdout lines to a guard, as the codex adapter does. */
const replay = async (guard, lines) => {
  for (const line of lines) await guard.observeOutput(`${line}\n`);
  return guard;
};

const codexFailure = (i, command, output) => JSON.stringify({ type: 'item.completed', item: { id: `item_${i}`, type: 'command_execution', command, aggregated_output: output, exit_code: 1, status: 'failed' } });

console.log('Issue #2395: the repeated-tool-call breaker is opt-in\n');

await test('the fixtures are the polls that tripped the breaker: gh pr checks, failing, with changing output', async () => {
  for (const lines of [pVsNpPolls, agentPolls]) {
    const items = lines.map(line => JSON.parse(line).item);
    assert.equal(items.length, 3);
    assert.ok(items.every(item => /gh pr checks \d+/.test(item.command) && item.status === 'failed'));
    assert.equal(new Set(items.map(item => item.command)).size, 1, 'the same command every time');
    assert.equal(new Set(items.map(item => item.aggregated_output)).size, 3, 'a different output every time');
  }
  assert.deepEqual(
    pVsNpPolls.map(line => JSON.parse(line).item.exit_code),
    [8, 8, 8]
  );
  assert.deepEqual(
    agentPolls.map(line => JSON.parse(line).item.exit_code),
    [8, 8, 1]
  );
});

await test('detection is disabled by default (no option, no environment)', async () => {
  assert.equal(isRepeatedToolCallDetectionEnabled({ argv: {}, env: {} }), false);
  assert.equal(resolveRepeatedToolCallLimit({ argv: {}, env: {} }), 0);
  assert.equal(resolveRepeatedToolCallLimit({ argv: { detectRepeatedToolCalls: false }, env: {} }), 0);
  assert.equal(getRepeatedToolCallLimit({}), 0);
  // A limit alone does not switch it on: only the explicit option does.
  assert.equal(resolveRepeatedToolCallLimit({ argv: { repeatedToolCallLimit: 3 }, env: { HIVE_MIND_REPEATED_TOOL_CALL_LIMIT: '3' } }), 0);
});

await test('the default limit is 10 once enabled', async () => {
  assert.equal(REPEATED_TOOL_CALL_LIMIT_DEFAULT, 10);
  assert.equal(resolveRepeatedToolCallLimit({ argv: { detectRepeatedToolCalls: true }, env: {} }), 10);
  assert.equal(resolveRepeatedToolCallLimit({ argv: { 'detect-repeated-tool-calls': true }, env: {} }), 10);
  assert.equal(resolveRepeatedToolCallLimit({ argv: {}, env: { HIVE_MIND_DETECT_REPEATED_TOOL_CALLS: 'true' } }), 10);
  assert.equal(resolveRepeatedToolCallLimit({ argv: {}, env: { HIVE_MIND_DETECT_REPEATED_TOOL_CALLS: '1' } }), 10);
  assert.equal(resolveRepeatedToolCallLimit({ argv: {}, env: { HIVE_MIND_DETECT_REPEATED_TOOL_CALLS: 'false' } }), 0);
  assert.equal(getRepeatedToolCallLimit({ HIVE_MIND_DETECT_REPEATED_TOOL_CALLS: 'true' }), 10);
});

await test('the limit comes from --repeated-tool-call-limit, then HIVE_MIND_REPEATED_TOOL_CALL_LIMIT', async () => {
  const env = { HIVE_MIND_DETECT_REPEATED_TOOL_CALLS: 'true', HIVE_MIND_REPEATED_TOOL_CALL_LIMIT: '7' };
  assert.equal(resolveRepeatedToolCallLimit({ argv: {}, env }), 7);
  assert.equal(resolveRepeatedToolCallLimit({ argv: { repeatedToolCallLimit: 4 }, env }), 4);
  assert.equal(resolveRepeatedToolCallLimit({ argv: { detectRepeatedToolCalls: true, repeatedToolCallLimit: 0 }, env: {} }), 0, '0 still disables');
  assert.equal(resolveRepeatedToolCallLimit({ argv: { detectRepeatedToolCalls: true }, env: { HIVE_MIND_REPEATED_TOOL_CALL_LIMIT: 'nonsense' } }), 10);
});

await test('solve exposes --detect-repeated-tool-calls (default false) and --repeated-tool-call-limit', async () => {
  const detect = SOLVE_OPTION_DEFINITIONS['detect-repeated-tool-calls'];
  assert.equal(detect?.type, 'boolean');
  assert.equal(detect.default, false);
  assert.match(detect.description, /Disabled by default/);
  const limit = SOLVE_OPTION_DEFINITIONS['repeated-tool-call-limit'];
  assert.equal(limit?.type, 'number');
  // No yargs default, so HIVE_MIND_REPEATED_TOOL_CALL_LIMIT is not shadowed.
  assert.equal(limit.default, undefined);
  assert.match(limit.description, /default: 10/);
});

await test('by default, the p-vs-np and agent polls do not stop the session', async () => {
  for (const lines of [pVsNpPolls, agentPolls]) {
    const stops = [];
    const guard = await replay(createToolCallLoopGuard({ limit: resolveRepeatedToolCallLimit({ argv: {}, env: {} }), stopSession: async verdict => stops.push(verdict) }), lines);
    assert.equal(guard.tripped, false);
    assert.equal(stops.length, 0);
    assert.equal(takeRepeatedToolCallVerdict(), null, 'no 🔁 comment is posted');
  }
});

await test('even when enabled with the old limit of 3 (or 1), polling CI never stops the session', async () => {
  for (const limit of [1, 3, 10]) {
    for (const lines of [pVsNpPolls, agentPolls]) {
      const guard = await replay(createToolCallLoopGuard({ limit }), [...lines, ...lines, ...lines, ...lines]);
      assert.equal(guard.tripped, false, `limit ${limit}`);
    }
  }
});

await test('CI and wait commands are recognised as polling', async () => {
  for (const command of ["/bin/bash -lc 'gh pr checks 623 --repo konard/p-vs-np'", '/bin/bash -lc "gh pr checks 323 --repo link-assistant/agent --json name,state,link --jq \'.[]\'"', 'gh run view 123 --log-failed', 'gh run list --branch x --limit 5', 'gh run watch 123', 'gh pr view 1 --json statusCheckRollup', 'gh api --paginate repos/o/r/commits/abc/check-runs', 'gh api --paginate repos/o/r/actions/runs?branch=x', 'sleep 60 && gh pr view 1', 'glab ci status']) {
    assert.equal(isPollingToolInput({ command }), true, command);
  }
  for (const command of ['gh issue view 1 --json title', 'npm test', 'cat src/index.js', 'gh pr view 1 --json body']) {
    assert.equal(isPollingToolInput({ command }), false, command);
  }
});

await test('when enabled, a failing call only counts as repeated when its output repeats too', async () => {
  const command = 'npm test';
  const changing = createToolCallLoopGuard({ limit: 3 });
  await replay(
    changing,
    Array.from({ length: 20 }, (_, i) => codexFailure(i, command, `${i} tests failed`))
  );
  assert.equal(changing.tripped, false, 'a different failure each time is progress, not a loop');

  const identical = createToolCallLoopGuard({ limit: 3 });
  await replay(
    identical,
    Array.from({ length: 3 }, (_, i) => codexFailure(i, command, 'Error: Cannot find module x'))
  );
  assert.equal(identical.tripped, true, 'the #2247 loop (same call, same error) still trips once enabled');
  assert.equal(identical.verdict.count, 3);
});

await test('with detection off, failure reports still name the dominant failing call (#2247 H10)', async () => {
  const breaker = createRepeatedToolCallBreaker({ limit: 0 });
  for (let i = 0; i < 5; i++) breaker.recordCall({ tool: 'Bash', input: { command: 'npm test' }, output: `run ${i}`, isError: true });
  assert.equal(breaker.tripped, false);
  assert.equal(breaker.dominantFailure()?.count, 5);
});

await test('every adapter resolves the limit from argv (opt-in), not from a hard-coded default', async () => {
  for (const adapter of ['codex', 'agent', 'opencode', 'gemini', 'qwen']) {
    const source = await readFile(join(repoRoot, 'src', `${adapter}.lib.mjs`), 'utf8');
    assert.match(source, /createToolCallLoopGuard\(\{ log, limit: resolveRepeatedToolCallLimit\(\{ argv \}\)/, adapter);
  }
  const claude = await readFile(join(repoRoot, 'src', 'claude.lib.mjs'), 'utf8');
  assert.match(claude, /createRepeatedToolCallBreaker\(\{ limit: resolveRepeatedToolCallLimit\(\{ argv \}\) \}\)/);
});

await test('the auto-merge loop continues with feedback after an opted-in breaker stop instead of reporting a tool failure', async () => {
  const source = await readFile(join(repoRoot, 'src', 'solve.auto-merge.lib.mjs'), 'utf8');
  const feedbackBranch = source.indexOf('if (isRestartWithFeedback(toolResult)) {');
  const failureBranch = source.indexOf('// Any other failure (not usage limit): stop the auto-restart loop');
  assert.ok(feedbackBranch > 0, 'restartWithFeedback is handled');
  assert.ok(feedbackBranch < failureBranch, 'before the generic tool_failure stop');
  const branch = source.slice(feedbackBranch, failureBranch);
  assert.match(branch, /continue;/);
  assert.match(branch, /await reportSessionStoppedForFeedback\(\{ toolResult, argv,.* attachLogToGitHub,/, 'the full log of the stopped session is attached');
  assert.doesNotMatch(branch, /reason: 'tool_failure'/);
});

await test('a breaker stop in the auto-merge loop attaches the full log of the stopped session and never throws', async () => {
  const { isRestartWithFeedback, reportSessionStoppedForFeedback } = await import('../src/solve.auto-merge-session-stop.lib.mjs');
  const stopped = { success: false, restartWithFeedback: true, stopReason: 'repeated_tool_call', sessionId: 's-1' };
  assert.equal(isRestartWithFeedback(stopped), true);
  assert.equal(isRestartWithFeedback({ success: false }), false);
  assert.equal(isRestartWithFeedback({ success: true, restartWithFeedback: true }), false);
  const uploads = [];
  const reported = [];
  const params = {
    toolResult: stopped,
    argv: { attachLogs: true, tool: 'codex' },
    restartLabel: '#2',
    prNumber: 323,
    owner: 'link-assistant',
    repo: 'agent',
    $: null,
    log: async () => {},
    formatAligned: (...parts) => parts.join(' '),
    getLogFile: () => '/home/box/solve.log',
    attachLogToGitHub: async options => uploads.push(options) > 0,
    sanitizeLogContent: text => text,
    formatToolExecutionFailure: () => 'codex stopped',
    reportError: error => reported.push(error),
    cleanErrorMessage: error => error.message,
  };
  assert.equal(await reportSessionStoppedForFeedback(params), true);
  assert.equal(uploads[0].targetNumber, 323);
  assert.equal(uploads[0].sessionId, 's-1');
  assert.match(uploads[0].customTitle, /#2 Log \(session stopped: repeated_tool_call\)/);
  assert.equal(await reportSessionStoppedForFeedback({ ...params, argv: { tool: 'codex' } }), false, 'no upload without --attach-logs');
  const failing = {
    ...params,
    attachLogToGitHub: async () => {
      throw new Error('gist quota');
    },
  };
  assert.equal(await reportSessionStoppedForFeedback(failing), false);
  assert.equal(reported.length, 1);
});

await test('the 🔁 comment documents that the breaker is opt-in and ignores CI polling', async () => {
  const { buildRepeatedToolCallComment } = await import('../src/session-result.lib.mjs');
  const body = buildRepeatedToolCallComment({ verdict: { reason: 'x' }, restarting: true });
  assert.match(body, /--detect-repeated-tool-calls/);
  assert.match(body, /default 10/);
  assert.match(body, /CI polling/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
