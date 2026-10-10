/**
 * @hive-mind-test-suite default
 * Issue #2301: replay the three real print-mode background-task sweeps (links-notation#315 and two
 * browser-commander#106 runs) and the reproduced bash-only exit through the same stream folding that
 * src/claude.lib.mjs performs, and assert there is neither a false "user rejected tool use"
 * failure nor a missed incomplete turn.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectClaudeStreamEventFacts, updateTerminalToolResult } from '../src/claude.stream-events.lib.mjs';
import { assessClaudeTurnCompletion, buildIncompleteTurnContinuationPrompt, createClaudePrintTurnTracker, CLAUDE_PRINT_BG_CEILING_PATTERN } from '../src/claude.print-turn.lib.mjs';
import { claudeCode, getClaudeEnv } from '../src/config.lib.mjs';

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'issue-2301');
const readFixture = name =>
  fs
    .readFileSync(path.join(fixtureDir, name), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line));

// Mirrors the per-event folding in executeClaudeCommand (stdout loop + stderr handler).
const replay = events => {
  const tracker = createClaudePrintTurnTracker();
  const state = { terminal: null, lastMessage: null, lastToolResultError: null, subagentErrors: 0, cancelledToolResults: 0, compactionSummary: null };
  for (const data of events) {
    if (data.__stderr) {
      tracker.observeStderr(data.__stderr);
      continue;
    }
    const facts = collectClaudeStreamEventFacts(data);
    const { afterResult } = tracker.observeEvent(data);
    state.terminal = updateTerminalToolResult(state.terminal, facts, { afterResult });
    if (facts.lastText && !afterResult) state.lastMessage = facts.lastText;
    if (facts.compactionSummary) state.compactionSummary = facts.compactionSummary;
    if (facts.subagentToolResultError) state.subagentErrors++;
    else if (afterResult && facts.toolResultError) state.cancelledToolResults++;
    else if (facts.toolResultError && !facts.toolResultErrorIsBenign) state.lastToolResultError = facts.toolResultError;
  }
  return { state, snapshot: tracker.snapshot() };
};

const assessReplay = (snapshot, recoveryAttempts = 0, maxRecoveryAttempts = 5) => assessClaudeTurnCompletion({ resultEvent: snapshot.resultEvent, stoppedTaskCount: snapshot.stoppedTaskCount, ceilingSeconds: snapshot.ceilingSeconds, recoveryAttempts, maxRecoveryAttempts, sessionId: 'session' });

for (const [name, expected] of [
  ['links-notation-315-sweep.jsonl', { stopped: 10, killedSystem: 5, results: 2 }],
  ['browser-commander-106-sweep.jsonl', { stopped: 11, killedSystem: 9, results: 1 }],
  // Third incident (solve v2.33.1, Claude Code 2.1.284): four background subagents were still
  // starting commands seconds before the sweep; all three results were emitted at exit.
  ['browser-commander-106-rerun-sweep.jsonl', { stopped: 4, killedSystem: 4, results: 3 }],
]) {
  test(`${name}: the 600s sweep is an incomplete turn, not a user rejection`, () => {
    const events = readFixture(name);
    assert.ok(
      events.some(d => d.parent_tool_use_id && JSON.stringify(d.message?.content || '').match(/Request interrupted by user|doesn't want to proceed/)),
      'fixture contains the synthetic subagent cancellation text'
    );
    const { state, snapshot } = replay(events);
    assert.equal(state.terminal?.failed ?? false, false, 'no subagent cancellation becomes the final tool result');
    assert.equal(state.lastToolResultError, null, 'subagent tool errors never become the main session error');
    assert.ok(state.subagentErrors > 0, 'subagent tool errors are still observed for diagnostics');
    assert.equal(state.compactionSummary, null, "a subagent's compaction summary is not the main session summary");
    assert.doesNotMatch(state.lastMessage || '', /Request interrupted by user/);
    assert.equal(snapshot.ceilingSeconds, 600, 'the stderr ceiling line is recognised');
    assert.equal(snapshot.resultCount, expected.results);
    assert.equal(snapshot.stoppedTaskCount, expected.stopped, 'stops before and after the result are counted, including local_bash tasks');
    assert.equal(snapshot.resultEvent.subagent_stats.killed.system, expected.killedSystem);
    const verdict = assessReplay(snapshot);
    assert.equal(verdict.incomplete, true);
    assert.equal(verdict.ceilingHit, true);
    assert.equal(verdict.cancelledTasks, expected.stopped);
    assert.equal(verdict.shouldResume, true, 'the same session is resumed');
    assert.match(verdict.cause, /600s print-mode wait ceiling/);
    assert.equal(assessReplay(snapshot, 4).shouldResume, true, 'several sweeps in a row are still resumed');
    assert.equal(assessReplay(snapshot, 5).shouldResume, false, 'continuation is bounded');
    const prompt = buildIncompleteTurnContinuationPrompt({ cause: verdict.cause, ceilingSeconds: snapshot.ceilingSeconds, stoppedTasks: snapshot.stoppedTasks });
    assert.match(prompt, /after its 600s print-mode wait ceiling/, 'the model is told the timeout was exceeded');
    assert.match(prompt, /not a user decision/);
    for (const task of snapshot.stoppedTasks.filter(t => t.summary).slice(0, 20)) assert.ok(prompt.includes(task.summary), `the cancelled task "${task.summary}" is listed`);
  });
}

test('a background Bash left running at exit is detected although killed.system is 0', () => {
  // Reproduced with Claude Code 2.1.284 (experiments/issue-2301-print-bg-ceiling/captured/run-ceiling20.tsv):
  // print mode does not wait for local_bash tasks; it kills them ~4s after the result.
  const { snapshot } = replay([
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'sleep 90', run_in_background: true } }] } },
    { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', content: 'Command running in background with ID: b0quh1olv.' }] } },
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'STARTED' }] } },
    { type: 'result', subtype: 'success', result: 'STARTED', subagent_stats: { killed: { parent: 0, user: 0, system: 0 } } },
    { type: 'system', subtype: 'task_notification', task_id: 'b0quh1olv', status: 'stopped' },
  ]);
  const verdict = assessReplay(snapshot);
  assert.equal(verdict.incomplete, true);
  assert.equal(verdict.cancelledTasks, 1);
  assert.equal(verdict.ceilingHit, false);
});

test('a task the model stopped itself (TaskStop) is not a cancelled turn', () => {
  const { snapshot } = replay([
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'TaskStop', input: { task_id: 'b1' } }] } },
    { type: 'system', subtype: 'task_notification', task_id: 'b1', status: 'stopped' },
    { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', content: 'stopped' }] } },
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Done.' }] } },
    { type: 'result', subtype: 'success', result: 'Done.' },
  ]);
  assert.equal(assessReplay(snapshot).incomplete, false);
});

test('a later main-thread turn after a result is real work, not shutdown noise', () => {
  const { state } = replay([
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Waiting.' }] } },
    { type: 'result', subtype: 'success', result: 'Waiting.' },
    { type: 'system', subtype: 'task_notification', task_id: 'a1', status: 'completed' },
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } },
    { type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', is_error: true, content: 'Error: 3 tests failed in tests/parser.test.mjs' }] } },
    { type: 'assistant', parent_tool_use_id: null, message: { content: [{ type: 'text', text: 'Tests fail.' }] } },
    { type: 'result', subtype: 'success', result: 'Tests fail.' },
  ]);
  assert.equal(state.terminal.failed, true, 'the second turn failing verification is not ignored (false negative)');
  assert.equal(state.lastMessage, 'Tests fail.');
});

test('the ceiling pattern matches the exact Claude Code 2.1.284 stderr text', () => {
  const line = 'Background tasks still running after 8s; terminating. Set CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS=0 to wait indefinitely.';
  assert.equal(CLAUDE_PRINT_BG_CEILING_PATTERN.exec(line)?.[1], '8');
  const tracker = createClaudePrintTurnTracker();
  assert.equal(tracker.observeStderr('unrelated warning'), null);
  assert.equal(tracker.observeStderr(`some prefix\n${line}\n`), 8);
});

test('background work stays enabled with a finite ceiling of 4x the Claude Code default', () => {
  const env = getClaudeEnv({});
  for (const name of ['CLAUDE_CODE_DISABLE_BACKGROUND_TASKS', 'CLAUDE_CODE_DISABLE_WORKFLOWS', 'CLAUDE_CODE_DISABLE_MCP_TASK_BACKGROUND']) assert.equal(env[name], process.env[name], `${name} is not forced on`);
  const expected = process.env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS ?? process.env.HIVE_MIND_CLAUDE_PRINT_BG_WAIT_CEILING_MS ?? '2400000';
  assert.equal(env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS, String(expected));
  assert.equal(String(claudeCode.printBgWaitCeilingMs), env.CLAUDE_CODE_PRINT_BG_WAIT_CEILING_MS);
});

test('the rerun fixture lists its cancelled subagents with their partial output files', () => {
  const { snapshot } = replay(readFixture('browser-commander-106-rerun-sweep.jsonl'));
  assert.deepEqual(
    snapshot.stoppedTasks.map(task => task.summary),
    ['JS attach modes (#102)', 'Python port of #102/#103 features', 'Rust port of #102/#103 features', 'Port JS migration tests to pytest']
  );
  const prompt = buildIncompleteTurnContinuationPrompt({ cause: 'x', ceilingSeconds: 600, stoppedTasks: snapshot.stoppedTasks });
  assert.match(prompt, /partial output: \/tmp\/claude-1001\/.*adfa585720348d6fe\.output/);
});

test('the continuation prompt caps long task lists and works without the stderr line', () => {
  const stoppedTasks = Array.from({ length: 25 }, (_, i) => ({ id: `b${i}`, summary: null, outputFile: null }));
  const prompt = buildIncompleteTurnContinuationPrompt({ cause: 'Claude Code stopped background tasks when print mode exited', stoppedTasks });
  assert.match(prompt, /- b19\n- …and 5 more/);
  assert.match(prompt, /running, and Claude Code stopped background tasks when print mode exited\. This was an automatic timeout/);
});

// Live captures from experiments/issue-2301-print-bg-ceiling/repro-ceiling.sh (Claude Code 2.1.284).
test('live: a raised ceiling lets the background agent finish, and the resume after a hit completes the work', () => {
  const hit = replay(readFixture('live-agent-ceiling.jsonl'));
  const verdict = assessReplay(hit.snapshot);
  assert.equal(verdict.shouldResume, true, 'the 8 s ceiling run is resumed');
  assert.equal(hit.snapshot.ceilingSeconds, 8);
  assert.equal(hit.state.terminal?.failed ?? false, false, 'no false user rejection');

  const raised = replay(readFixture('live-agent-raised.jsonl'));
  assert.equal(raised.snapshot.stoppedTaskCount, 0, 'with a 40 s ceiling nothing is stopped');
  assert.equal(assessReplay(raised.snapshot).incomplete, false);
  assert.match(raised.snapshot.resultEvent.result, /DONE/, 'the background agent woke the main thread with its reply');

  // On --resume, Claude Code first replays the stale `stopped` notification and an empty result
  // (num_turns 0); the real turn that follows must decide the verdict, so the resume is not repeated.
  const resumed = replay(readFixture('live-agent-resumed.jsonl'));
  assert.equal(resumed.snapshot.resultCount, 2);
  assert.equal(assessReplay(resumed.snapshot, 1).incomplete, false);
  assert.match(resumed.snapshot.resultEvent.result, /DONE/);
});
