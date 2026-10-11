#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #3015: the solver stopped Claude Code 30 s after its success result while print mode was
 * still waiting for a background task (a `gh run watch` that Claude Code had auto-backgrounded).
 * Print mode keeps the CLI alive until background tasks finish or its own
 * CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS passes (Issue #2301), and a finished task re-wakes the
 * model. The post-result close timeout (Issue #1280) must respect that wait.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_RETRIES = '1';
process.env.HIVE_MIND_INITIAL_TRANSIENT_ERROR_DELAY_MS = '1';
process.env.HIVE_MIND_MAX_TRANSIENT_ERROR_DELAY_MS = '1';
process.env.HIVE_MIND_RETRY_BACKOFF_MULTIPLIER = '1';
process.env.HIVE_MIND_RESULT_STREAM_CLOSE_MS = '100';
process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS = '600';
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

const { createClaudeBackgroundTaskTracker, createClaudeResultCloseController, describeBackgroundTasks, isMainThreadAssistantEvent, planResultCloseTimeout } = await import('../src/claude.result-close.lib.mjs');
const { assessClaudeTurnCompletion } = await import('../src/claude.print-turn.lib.mjs');
const { executeClaudeCommand } = await import('../src/claude.lib.mjs');
const { resetCumulativeAnthropicCost } = await import('../src/anthropic-cost-accumulator.lib.mjs');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const session = 'session-3015-bg';
// Event shapes copied from the Issue #3015 log (Claude Code 2.1.x stream-json).
const task = { task_id: 'bzyssdyux', run_id: '0mv3lrq3f-c302a31e', task_type: 'local_bash', description: 'Wait for CI runs on latest commit' };
const taskStarted = { type: 'system', subtype: 'task_started', task_id: task.task_id, tool_use_id: 'toolu_wait', description: task.description, is_backgrounded: false, task_type: 'local_bash', session_id: session };
const tasksChanged = tasks => ({ type: 'system', subtype: 'background_tasks_changed', tasks, session_id: session });
const taskBackgrounded = { type: 'system', subtype: 'task_updated', task_id: task.task_id, patch: { is_backgrounded: true }, session_id: session };
const taskNotification = status => ({ type: 'system', subtype: 'task_notification', task_id: task.task_id, tool_use_id: 'toolu_wait', status, summary: task.description, session_id: session });
const assistant = text => ({ type: 'assistant', session_id: session, parent_tool_use_id: null, message: { content: [{ type: 'text', text }] } });
const result = text => ({ type: 'result', subtype: 'success', is_error: false, result: text, num_turns: 3, total_cost_usd: 0.01, session_id: session });
const ndjson = (...events) => ({ type: 'stdout', data: Buffer.from(events.map(event => `${JSON.stringify(event)}\n`).join('')) });

test('the tracker follows background tasks from Claude Code stream events', () => {
  const tracker = createClaudeBackgroundTaskTracker();
  assert.equal(tracker.observeEvent(taskStarted), false, 'a foreground task is not a background task');
  assert.equal(tracker.observeEvent(tasksChanged([task])), true);
  assert.equal(tracker.observeEvent(taskBackgrounded), false, 'already known from background_tasks_changed');
  assert.deepEqual(tracker.running(), [{ id: 'bzyssdyux', type: 'local_bash', description: 'Wait for CI runs on latest commit' }]);
  assert.equal(tracker.observeEvent(taskNotification('completed')), true);
  assert.deepEqual(tracker.running(), []);
  assert.equal(tracker.observeEvent(assistant('done')), false);
});

test('the tracker works without background_tasks_changed (older CLI versions)', () => {
  const tracker = createClaudeBackgroundTaskTracker();
  tracker.observeEvent(taskStarted);
  assert.equal(tracker.observeEvent(taskBackgrounded), true);
  assert.deepEqual(tracker.running(), [{ id: 'bzyssdyux', type: null, description: 'Wait for CI runs on latest commit' }]);
  assert.equal(tracker.observeEvent({ type: 'system', subtype: 'task_updated', task_id: task.task_id, patch: { status: 'killed' } }), true);
  assert.deepEqual(tracker.running(), []);
  assert.equal(tracker.observeEvent({ ...taskStarted, task_id: 'agent1', task_type: 'local_agent', is_backgrounded: true }), true);
  assert.equal(describeBackgroundTasks(tracker.running()), 'agent1 (Wait for CI runs on latest commit)');
});

test('isMainThreadAssistantEvent ignores subagent messages', () => {
  assert.equal(isMainThreadAssistantEvent(assistant('x')), true);
  assert.equal(isMainThreadAssistantEvent({ ...assistant('x'), parent_tool_use_id: 'toolu_1' }), false);
  assert.equal(isMainThreadAssistantEvent(taskStarted), false);
});

test('the close timeout waits for running background tasks up to the print-mode ceiling', () => {
  const base = { awaitingExitSince: 1000, streamCloseMs: 30000, printBgWaitCeilingMs: 2400000, fallbackWaitMs: 3600000 };
  assert.deepEqual(planResultCloseTimeout({ ...base, runningTasks: [], now: 1000 }).delayMs, 30000);
  const waiting = planResultCloseTimeout({ ...base, runningTasks: [{ id: 'bzyssdyux', description: task.description }], now: 1000 });
  assert.equal(waiting.waitingForTasks, true);
  assert.equal(waiting.delayMs, 2430000);
  assert.match(waiting.message, /bzyssdyux \(Wait for CI runs on latest commit\)/);
  // Re-planned 10 minutes later: the ceiling counts from when the main thread went idle.
  assert.equal(planResultCloseTimeout({ ...base, runningTasks: [{ id: 'a' }], now: 601000 }).delayMs, 1830000);
  // Never shorter than the plain close timeout.
  assert.equal(planResultCloseTimeout({ ...base, runningTasks: [{ id: 'a' }], now: 99999999 }).delayMs, 30000);
  // Ceiling disabled (0 = Claude Code waits indefinitely): bounded by the fallback.
  assert.equal(planResultCloseTimeout({ ...base, printBgWaitCeilingMs: 0, runningTasks: [{ id: 'a' }], now: 1000 }).delayMs, 3630000);
  assert.equal(planResultCloseTimeout({ ...base, printBgWaitCeilingMs: 0, fallbackWaitMs: 0, runningTasks: [{ id: 'a' }], now: 1000 }).delayMs, 3630000);
});

test('the controller pauses on a reopened turn and re-plans when tasks finish', async () => {
  const logs = [];
  let timeouts = 0;
  const controller = createClaudeResultCloseController({ streamCloseMs: 50, printBgWaitCeilingMs: 400, fallbackWaitMs: 0, log: async message => logs.push(message), isForceExitTriggered: () => false, onTimeout: () => timeouts++ });
  await controller.observeEvent(tasksChanged([task]));
  await controller.onResult();
  assert.equal(controller.isAwaitingExit(), true);
  await sleep(150);
  assert.equal(timeouts, 0, 'a running background task keeps the CLI alive');
  await controller.observeEvent(taskNotification('completed'));
  await controller.observeEvent(assistant('CI is green.'));
  assert.equal(controller.isAwaitingExit(), false, 'the re-woken model reopened the turn');
  await sleep(150);
  assert.equal(timeouts, 0, 'no close timeout while the turn is open');
  await controller.onResult();
  await sleep(150);
  assert.equal(timeouts, 1, 'a CLI that hangs with no background task is still stopped');
  assert.deepEqual(controller.state(), { timeoutFired: true, stoppedWithBackgroundTasks: false });
  controller.stop();
});

test('the solver-stopped cause does not blame Claude Code', () => {
  const resultEvent = result('done');
  assert.match(assessClaudeTurnCompletion({ resultEvent, stoppedTaskCount: 1, sessionId: 's', solverStopped: true }).cause, /^the solver stopped Claude Code after its result/);
  assert.equal(assessClaudeTurnCompletion({ resultEvent, stoppedTaskCount: 1, sessionId: 's' }).cause, 'Claude Code stopped background tasks when print mode exited');
});

/**
 * Run executeClaudeCommand with a fake `$`. `scripts[n]` is an async generator for the n-th CLI
 * run; it receives `killed` (resolves with the signal) and yields stream chunks.
 */
async function replay(scripts) {
  resetCumulativeAnthropicCost();
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'hive-mind-3015-bg-'));
  let logFile = path.join(tempDir, 'current.log');
  await writeFile(logFile, '');
  const logs = [];
  const kills = [];
  let runs = 0;
  const fakeDollar = () => () => {
    const script = scripts[Math.min(runs++, scripts.length - 1)];
    let onKill;
    const killed = new Promise(resolve => {
      onKill = resolve;
    });
    const command = {
      result: null,
      kill(signal) {
        kills.push({ signal, at: Date.now() });
        onKill(signal);
      },
      async *stream() {
        const code = yield* script({ killed });
        command.result = { code };
        yield { type: 'exit', code };
      },
    };
    return command;
  };
  try {
    const toolResult = await executeClaudeCommand({
      tempDir,
      branchName: 'issue-3015-test',
      prompt: 'Continue.',
      systemPrompt: 'Solve the issue.',
      escapedPrompt: 'Continue.',
      escapedSystemPrompt: 'Solve the issue.',
      argv: { model: 'opus', tool: 'claude', url: 'https://github.com/link-assistant/hive-mind/issues/3015', verbose: true, fallbackModel: null, disable1mContext: false, uselessToolsDisabled: false },
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
      prNumber: 3018,
      issueNumber: 3015,
    });
    return { toolResult, logs, kills, runs };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

test('Claude is not stopped while print mode waits for a background task, and its re-woken turn counts', { timeout: 10000 }, async () => {
  const { toolResult, logs, kills, runs } = await replay([
    async function* run() {
      yield ndjson(taskStarted, tasksChanged([task]), taskBackgrounded, assistant('Waiting for CI.'), result('Waiting for CI.'));
      await sleep(400); // 4x the 100 ms close timeout: the old fixed timer sent SIGTERM here.
      yield ndjson(taskNotification('completed'), tasksChanged([]), assistant('CI passed; the PR is ready.'));
      await sleep(300); // the reopened turn is not subject to the close timeout
      yield ndjson(result('CI passed; the PR is ready.'));
      return 0;
    },
  ]);
  assert.deepEqual(kills, [], `no kill expected; logs:\n${logs.filter(line => line.includes('📌') || line.includes('⚠️')).join('\n')}`);
  assert.equal(runs, 1, 'no #2301 resume: nothing was stopped');
  assert.equal(toolResult.success, true);
  assert.equal(toolResult.resultSummary, 'CI passed; the PR is ready.', "the re-woken turn's summary is the final one");
  assert.ok(logs.some(line => line.includes('Claude Code is waiting for 1 background task(s): bzyssdyux (Wait for CI runs on latest commit)')));
  assert.ok(logs.some(line => line.includes('stream close timeout paused')));
});

test('Claude is stopped only after the print-mode ceiling, and the resume names the solver as the cause', { timeout: 10000 }, async () => {
  const startedAt = Date.now();
  const { toolResult, logs, kills, runs } = await replay([
    async function* hanging({ killed }) {
      yield ndjson(taskStarted, tasksChanged([task]), taskBackgrounded, assistant('Waiting for CI.'), result('Waiting for CI.'));
      await killed;
      yield ndjson(taskNotification('stopped'), tasksChanged([]));
      return 143;
    },
    async function* resumed() {
      yield ndjson(assistant('Checked CI; everything is done.'), result('Checked CI; everything is done.'));
      return 0;
    },
  ]);
  assert.equal(kills.length, 1);
  assert.ok(kills[0].at - startedAt >= 600, `killed after ${kills[0].at - startedAt} ms, before the 600 ms ceiling`);
  assert.ok(logs.some(line => line.includes('while background task(s) were still running: bzyssdyux')));
  assert.equal(runs, 2, 'the #2301 continuation resumed the session');
  assert.ok(logs.some(line => line.includes('Resuming Claude session') && line.includes('the solver stopped Claude Code after its result')));
  assert.equal(toolResult.success, true);
});

test('a CLI that hangs after its result with no background task is still stopped after the close timeout', { timeout: 10000 }, async () => {
  const startedAt = Date.now();
  const { toolResult, kills, runs } = await replay([
    async function* hanging({ killed }) {
      yield ndjson(assistant('Done.'), result('Done.'));
      await killed;
      return 143;
    },
  ]);
  assert.equal(kills.length, 1);
  assert.ok(kills[0].at - startedAt < 600, 'the plain 100 ms close timeout applies');
  assert.equal(runs, 1);
  assert.equal(toolResult.success, true);
});
