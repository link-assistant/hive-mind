/**
 * @hive-mind-test-suite default
 *
 * Issue #3215 follow-up to #3211: `solve` exits 5 when a session finished
 * without changes. The completion message already says "⚠️ finished without
 * changes", but two other consumers still treated exit 5 as a crash:
 *   - the docker keep policy (`on-failure`) kept the task container;
 *   - `/queue` listed the task under Failed with "exit code 5".
 * A no-changes run is neither a success nor a failure: the container is
 * removed like a finished run, and `/queue` lists it as done with ⚠️.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { classifySessionOutcome } from '../src/work-session-formatting.lib.mjs';
import { buildDockerTaskContainerCompletionAction } from '../src/session-monitor.lib.mjs';
import { SolveQueue, resetSolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { preloadAllLocales } from '../src/i18n.lib.mjs';

await preloadAllLocales();

test('exit 5 is a no-changes outcome only for solve and only when not killed', () => {
  assert.deepEqual(classifySessionOutcome({ exitCode: 5, status: 'failed', command: 'solve' }), { failed: true, killed: false, signal: null, noChanges: true });
  assert.equal(classifySessionOutcome({ exitCode: 5, status: 'failed', command: 'hive' }).noChanges, false);
  assert.equal(classifySessionOutcome({ exitCode: 5, status: 'killed', command: 'solve' }).noChanges, false);
  assert.equal(classifySessionOutcome({ exitCode: 1, command: 'solve' }).noChanges, false);
  assert.equal(classifySessionOutcome({ exitCode: 0, command: 'solve' }).noChanges, false);
});

test('docker on-failure policy removes the container of a solve that finished without changes', () => {
  const env = { HIVE_MIND_KEEP_TASK_CONTAINER: 'on-failure' };
  const sessionInfo = { isolationBackend: 'docker', sessionId: 'solve-no-changes', command: 'solve' };
  const noChanges = buildDockerTaskContainerCompletionAction({ sessionName: 'solve-no-changes', sessionInfo, exitCode: 5, status: 'failed', env });
  assert.equal(noChanges.shouldRemove, true);
  assert.equal(noChanges.extraSection, '');
  // A real failure keeps the container, as before.
  const failed = buildDockerTaskContainerCompletionAction({ sessionName: 'solve-no-changes', sessionInfo, exitCode: 1, status: 'failed', env });
  assert.equal(failed.shouldRemove, false);
  // Exit 5 from another command is still a failure.
  const hive = buildDockerTaskContainerCompletionAction({ sessionName: 'hive-5', sessionInfo: { ...sessionInfo, command: 'hive' }, exitCode: 5, status: 'failed', env });
  assert.equal(hive.shouldRemove, false);
});

test('/queue lists a no-changes run as done with ⚠️, not as Failed', async () => {
  resetSolveQueue();
  const queue = new SolveQueue({ verbose: false, autoStart: false, getRunningProcesses: async () => ({ count: 0, processes: [] }), getRunningIsolatedSessions: async () => ({ count: 0, byTool: {} }), getRunningSessionItems: async () => [] });
  try {
    for (const [n, sessionName] of [
      [1, 'ok'],
      [2, 'no-changes'],
      [3, 'crashed'],
    ]) {
      const url = `https://github.com/o/r/issues/${n}`;
      queue.executeCallback = async () => ({ success: true, sessionId: sessionName, output: `session: ${sessionName}` });
      const item = queue.enqueue({ url, args: [url], tool: 'claude' });
      queue.getToolQueue('claude').splice(queue.getToolQueue('claude').indexOf(item), 1);
      queue.processing.set(item.id, item);
      item.setStarting();
      await queue.executeItem(item);
    }
    queue.recordSessionCompletion({ sessionName: 'ok', command: 'solve', exitCode: 0, status: 'executed' });
    queue.recordSessionCompletion({ sessionName: 'no-changes', command: 'solve', exitCode: 5, status: 'failed' });
    queue.recordSessionCompletion({ sessionName: 'crashed', command: 'solve', exitCode: 1, status: 'failed' });
    const status = await queue.formatDetailedStatus();
    assert.match(status, /⚠️ \[o\/r#2\]\([^)]*\) — finished without changes/);
    assert.match(status, /✅ \[o\/r#1\]/);
    assert.match(status, /❌ \[o\/r#3\]\([^)]*\) — exit code 1/);
    assert.doesNotMatch(status, /o\/r#2\]\([^)]*\) — exit code 5/);
    assert.match(status, /Completed: 2, Failed: 1/);
    assert.deepEqual([queue.stats.totalSessionSucceeded, queue.stats.totalSessionNoChanges, queue.stats.totalSessionFailed], [1, 1, 1]);
  } finally {
    queue.stop();
  }
});
