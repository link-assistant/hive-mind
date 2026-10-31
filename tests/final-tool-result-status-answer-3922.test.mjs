#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #3922: Claude finished its turn with `subtype: success`, but the last tool call was
 * `…; gh pr checks 414 --repo …` on a pull request without CI. gh exits 1 with
 * "no checks reported on the '<branch>' branch" (cli/cli#9390, cli/cli#9682), so the session
 * was reported as "Final tool result failed: Exit code 1 <three PR comments flattened>…" and
 * --auto-restart-until-mergeable stopped with `tool_failure` although the work was done.
 *
 * The fixture holds the four real main-thread events of that session, extracted from the saved
 * log by experiments/issue-3922-extract-fixture.mjs.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES = '1';
process.env.HIVE_MIND_RESULT_STREAM_CLOSE_MS = '1000';
process.env.HIVE_MIND_STREAM_ACTIVITY_MS = '0';
process.env.HIVE_MIND_STREAM_STARTUP_MS = '5000';

globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'command-stream') return { $: () => ({ stream: async function* noopStream() {} }) };
  if (packageName === 'fs') return { ...fs, default: fs };
  if (packageName === 'os') return { ...os, default: os };
  if (packageName === 'path') return { ...path, default: path };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return import(packageName);
};

const { classifyToolResultError, collectClaudeStreamEventFacts, describeFinalToolResultFailure, updateTerminalToolResult } = await import('../src/claude.stream-events.lib.mjs');
const { executeClaudeCommand } = await import('../src/claude.lib.mjs');
const { resetCumulativeAnthropicCost } = await import('../src/anthropic-cost-accumulator.lib.mjs');

const fixturePath = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'issue-3922-gh-pr-checks-no-checks.jsonl');
const fixtureEvents = fs
  .readFileSync(fixturePath, 'utf8')
  .split('\n')
  .filter(Boolean)
  .map(line => JSON.parse(line));
const reportedToolResult = fixtureEvents[1].message.content[0].content;

const bash = (id, command) => ({ type: 'assistant', session_id: 's-3922', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } });
const toolResult = (id, content, isError = true) => ({ type: 'user', session_id: 's-3922', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, is_error: isError, content }] } });
const success = { type: 'result', subtype: 'success', is_error: false, result: 'Done.', session_id: 's-3922', total_cost_usd: 0 };

async function replay(events) {
  resetCumulativeAnthropicCost();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-3922-'));
  let logFile = path.join(tempDir, 'current.log');
  await writeFile(logFile, '');
  const logs = [];
  const fakeDollar = () => () => ({
    result: { code: 0 },
    kill() {},
    async *stream() {
      yield { type: 'stdout', data: Buffer.from(events.map(event => JSON.stringify(event)).join('\n') + '\n') };
    },
  });
  try {
    const result = await executeClaudeCommand({
      tempDir,
      branchName: 'issue-3922-test',
      prompt: 'Continue.',
      systemPrompt: 'Solve the issue.',
      argv: { model: 'opus', tool: 'claude', url: 'https://github.com/link-assistant/hive-mind/issues/3922', verbose: false, fallbackModel: null, disable1mContext: false, uselessToolsDisabled: false },
      log: async message => logs.push(String(message)),
      getLogFile: () => logFile,
      setLogFile: value => {
        logFile = value;
      },
      formatAligned: (_icon, label, value = '') => `${label} ${value}`.trim(),
      getResourceSnapshot: async () => ({ memory: 'Mem:\nMemAvailable: 1 GB', load: '0.00' }),
      forkedRepo: null,
      feedbackLines: [],
      claudePath: 'claude',
      $: fakeDollar,
      owner: 'link-assistant',
      repo: 'hive-mind',
      prNumber: 3923,
      issueNumber: 3922,
    });
    return { result, logs };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('the reported tool result is gh telling there are no checks, not a failed verification', () => {
  assert.match(reportedToolResult, /^Exit code 1\n/);
  assert.match(reportedToolResult, /no checks reported on the 'issue-413-e424ca2a7c62' branch$/);
  assert.deepEqual(classifyToolResultError(reportedToolResult), { benign: true, category: 'no_checks_reported' });
});

test('the #3922 session replays as a success, not as "Final tool result failed"', { timeout: 10000 }, async () => {
  const { result, logs } = await replay(fixtureEvents);
  assert.equal(result.success, true, result.errorInfo?.message);
  assert.ok(!logs.some(line => line.includes('Final tool result failed')));
  const explained = logs.find(line => line.includes('session result stands'));
  assert.ok(
    explained,
    logs
      .filter(line => !line.trim().startsWith('{'))
      .join('\n')
      .slice(-2500)
  );
  assert.match(explained, /gh pr checks 414.*no_checks_reported/);
});

test('only the last output line decides: an earlier "no checks" line does not hide a later error', () => {
  const text = "Exit code 1\nno checks reported on the 'x' branch\nerror: failed to push some refs to 'origin'";
  assert.equal(classifyToolResultError(text).benign, false);
  assert.equal(classifyToolResultError("Exit code 2\nno checks reported on the 'x' branch").benign, false, 'gh uses exit 1 for this answer');
});

test('gh pr checks exit 8 with pending rows is a status answer; exit 8 without them is not', () => {
  assert.deepEqual(classifyToolResultError('Exit code 8\nbuild\tpending\t0\thttps://github.com/o/r/actions/runs/1\t\ntest\tpass\t1m\thttps://github.com/o/r/actions/runs/2\t'), { benign: true, category: 'checks_pending' });
  assert.equal(classifyToolResultError('Exit code 8\nmake: *** [all] Error 8').benign, false);
});

test('a genuine failed verification still fails the session, with a message naming the command', { timeout: 10000 }, async () => {
  const { result, logs } = await replay([bash('t1', 'javac Main.java'), toolResult('t1', 'Exit code 1\nMain.java:3: error: not a statement\n        x\n        ^\n1 error'), success]);
  assert.equal(result.success, false);
  assert.equal(result.errorInfo.message, 'Claude reported success, but its last command `javac Main.java` exited with code 1: Main.java:3: error: not a statement');
  assert.ok(
    logs.some(line => line.includes('│ 1 error')),
    'the full output stays in the log'
  );
});

test('describeFinalToolResultFailure keeps the headline short and never flattens unrelated output', () => {
  const message = describeFinalToolResultFailure({ error: `Exit code 1\n${'unrelated comment text '.repeat(50)}\nfatal: not a git repository`, command: 'gh api …; git status' });
  assert.equal(message, 'Claude reported success, but its last command `gh api …; git status` exited with code 1: fatal: not a git repository');
  assert.equal(describeFinalToolResultFailure({ error: 'Exit code 127', toolName: 'Bash' }), 'Claude reported success, but its last Bash tool call exited with code 127 without any output');
  assert.equal(describeFinalToolResultFailure({ error: 'Permission denied for Write' }), 'Claude reported success, but its last tool call failed: Permission denied for Write');
  assert.ok(describeFinalToolResultFailure({ error: 'Exit code 1\nerror x', command: 'y'.repeat(500) }).length < 260);
});

test('the terminal tool result names the command of the matching tool_use id only', () => {
  let terminal = updateTerminalToolResult(null, collectClaudeStreamEventFacts(bash('a', 'npm test')));
  terminal = updateTerminalToolResult(terminal, collectClaudeStreamEventFacts(bash('b', 'npm run lint')));
  terminal = updateTerminalToolResult(terminal, collectClaudeStreamEventFacts(toolResult('a', 'Exit code 1\nnpm ERR! Test failed.')));
  assert.equal(terminal.command, 'npm test');
  assert.equal(terminal.toolName, 'Bash');
  const subagentCall = { ...bash('c', 'rm -rf build'), parent_tool_use_id: 'task-1' };
  terminal = updateTerminalToolResult(terminal, collectClaudeStreamEventFacts(subagentCall));
  terminal = updateTerminalToolResult(terminal, collectClaudeStreamEventFacts(toolResult('c', 'Exit code 1\nerror: x')));
  assert.equal(terminal.command, null, 'subagent tool calls are not main-thread commands');
});
