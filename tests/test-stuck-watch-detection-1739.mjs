#!/usr/bin/env node
// Issue #1739: tests for the run_in_background task tracker and the
// stuck-watch classifier used by claude.lib.mjs to diagnose orphaned
// watcher sessions.
//
// @hive-mind-test-suite default

import assert from 'node:assert/strict';

import { BackgroundTaskTracker, classifyStuckWatch, looksLikePassiveWaitText } from '../src/claude.background-tasks.lib.mjs';

// --- BackgroundTaskTracker.observe ----------------------------------------

{
  const t = new BackgroundTaskTracker();
  // Unrelated events are ignored.
  assert.equal(t.observe(null), null);
  assert.equal(t.observe({}), null);
  assert.equal(t.observe({ type: 'tool_use', name: 'Read' }), null);
  assert.equal(t.liveCount(), 0);
}

{
  // assistant tool_use with run_in_background populates the command cache.
  const t = new BackgroundTaskTracker();
  t.observe({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_017JNou6gzahPtt2pcHfB7Ro',
          name: 'Bash',
          input: {
            command: 'until [ "$(gh run view 25213264339 --json status -q .status)" = "completed" ]; do sleep 20; done',
            description: 'Wait for new CI run, report failures only',
            run_in_background: true,
          },
        },
      ],
    },
  });
  // No task_started yet → nothing alive.
  assert.equal(t.liveCount(), 0);

  // Now the system task_started arrives.
  const info = t.observe({
    type: 'system',
    subtype: 'task_started',
    task_id: 'bebe1a8de',
    tool_use_id: 'toolu_017JNou6gzahPtt2pcHfB7Ro',
    description: 'Wait for new CI run, report failures only',
    task_type: 'local_bash',
  });
  assert.ok(info, 'observe should return the task info');
  assert.equal(info.taskId, 'bebe1a8de');
  assert.equal(info.toolUseId, 'toolu_017JNou6gzahPtt2pcHfB7Ro');
  assert.match(info.command ?? '', /^until \[/);
  assert.equal(t.liveCount(), 1);
  assert.equal(t.totalStarted, 1);

  // task_completed reaps it.
  const reaped = t.observe({ type: 'system', subtype: 'task_completed', task_id: 'bebe1a8de' });
  assert.ok(reaped, 'observe should return the previously-tracked info on completion');
  assert.equal(t.liveCount(), 0);
  assert.equal(t.totalStarted, 1, 'totalStarted is cumulative; not decremented');
}

{
  // Foreground Bash tool_use (no run_in_background) is ignored.
  const t = new BackgroundTaskTracker();
  t.observe({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_FOREGROUND',
          name: 'Bash',
          input: { command: 'ls', description: 'List' },
        },
      ],
    },
  });
  assert.equal(t.commandByToolUseId.has('toolu_FOREGROUND'), false);
}

// --- looksLikePassiveWaitText --------------------------------------------

{
  // Real text from issue #1739.
  assert.equal(looksLikePassiveWaitText("Wait for the watch command to finish — I'll be notified when the background bash task completes."), true);
  assert.equal(looksLikePassiveWaitText("I'll wait for CI to finish."), true);
  assert.equal(looksLikePassiveWaitText('I will wait for the workflow to complete.'), true);
  assert.equal(looksLikePassiveWaitText('Once the run completes, I will report.'), true);
  // Substantive multi-paragraph summary should NOT trip the heuristic, even
  // if it mentions "wait".
  const longSummary = 'I implemented the fix in src/foo.mjs by adding a guard against null inputs. ' + 'I also added unit tests in tests/foo.test.mjs covering the null and empty cases. ' + 'The CI run was kicked off; we should wait for it to finish before merging, but the ' + 'manual smoke test passed locally and the diff is minimal. Push complete.';
  assert.equal(looksLikePassiveWaitText(longSummary), false);
  // Empty / non-string.
  assert.equal(looksLikePassiveWaitText(''), false);
  assert.equal(looksLikePassiveWaitText(null), false);
  assert.equal(looksLikePassiveWaitText(undefined), false);
  assert.equal(looksLikePassiveWaitText(42), false);
  // Mention without passive-wait shape.
  assert.equal(looksLikePassiveWaitText('Done.'), false);
  assert.equal(looksLikePassiveWaitText('Tests pass; merging now.'), false);
}

// --- classifyStuckWatch ---------------------------------------------------

{
  // No live tasks → not stuck regardless of text.
  const t = new BackgroundTaskTracker();
  assert.deepEqual(classifyStuckWatch({ tracker: t, finalText: "I'll wait for CI to finish." }), {
    stuck: false,
    reason: null,
  });
}

{
  // Live task + non-passive text → not stuck.
  const t = new BackgroundTaskTracker();
  t.observe({ type: 'system', subtype: 'task_started', task_id: 'X', task_type: 'local_bash', description: 'd' });
  assert.deepEqual(classifyStuckWatch({ tracker: t, finalText: 'Done; merged the PR.' }), {
    stuck: false,
    reason: null,
  });
}

{
  // The exact issue-1739 shape: live task + passive end-of-turn text.
  const t = new BackgroundTaskTracker();
  t.observe({
    type: 'system',
    subtype: 'task_started',
    task_id: 'bebe1a8de',
    task_type: 'local_bash',
    description: 'Wait for new CI run, report failures only',
  });
  const result = classifyStuckWatch({
    tracker: t,
    finalText: "Wait for the watch command to finish — I'll be notified when the background bash task completes.",
  });
  assert.equal(result.stuck, true);
  assert.match(result.reason, /Issue #1739/);
}

// --- formatForLog --------------------------------------------------------

{
  const t = new BackgroundTaskTracker();
  // Empty case
  assert.deepEqual(t.formatForLog({ now: 1_000_000 }), ['🔎 Background tasks: clean (0 alive at result event)']);
  // Non-empty case
  t.observe({
    type: 'assistant',
    message: {
      content: [
        {
          type: 'tool_use',
          id: 'toolu_X',
          name: 'Bash',
          input: { command: 'until X; do sleep 20; done', run_in_background: true },
        },
      ],
    },
  });
  t.observe({
    type: 'system',
    subtype: 'task_started',
    task_id: 'bebe1a8de',
    tool_use_id: 'toolu_X',
    description: 'Wait for new CI run, report failures only',
    task_type: 'local_bash',
  });
  // Fix startedAt for deterministic age computation.
  for (const v of t.alive.values()) v.startedAt = 1_000_000;
  const lines = t.formatForLog({ now: 1_042_000 });
  assert.equal(lines.length, 2);
  assert.match(lines[0], /still alive at result event: 1/);
  assert.match(lines[1], /bebe1a8de\s+age=42s/);
  assert.match(lines[1], /Wait for new CI run/);
  assert.match(lines[1], /until X/);
}

console.log('✅ stuck-watch-detection (Issue #1739) tests passed');
