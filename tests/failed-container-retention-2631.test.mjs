/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildDockerTaskContainerCompletionAction } from '../src/session-monitor.lib.mjs';
import { hasDisposableFailureReceipt, recordDisposableFailure } from '../src/failed-task-retention.lib.mjs';

test('on-failure releases a stopped failed container after verified remote preservation', () => {
  const result = buildDockerTaskContainerCompletionAction({ sessionName: 'task', sessionInfo: { isolationBackend: 'docker', disposableFailure: true }, exitCode: 1, env: {} });
  assert.equal(result.shouldRemove, true);
});

test('cleanup receipt requires uploaded logs, a complete recovery and a remote commit', async () => {
  const messages = [];
  const options = { reason: 'authentication', logsUploaded: true, preserved: { complete: true, committed: true, pushed: true }, log: async text => messages.push(text) };
  assert.equal(await recordDisposableFailure(options), true);
  for (const override of [{ logsUploaded: false }, { preserved: { complete: false, pushed: true } }, { preserved: { complete: true, committed: true, pushed: false } }, { preserved: { complete: true, error: true } }, { reason: 'unknown' }]) assert.equal(await recordDisposableFailure({ ...options, ...override }), false);
  assert.equal(messages.length, 1);
  const receipt = `[2026-10-07T10:00:00.123Z] [RECOVERY] ${messages[0]}`;
  assert.equal(hasDisposableFailureReceipt(receipt), true);
  assert.equal(hasDisposableFailureReceipt(`[2026-10-07T10:00:00Z] [STDOUT] ${messages[0]}`), true);
  assert.equal(hasDisposableFailureReceipt(`[2026-10-07T10:00:00Z] [STDOUT] ${JSON.stringify({ quoted: messages[0] })}`), false);
  assert.equal(hasDisposableFailureReceipt('HIVE_TASK_DISPOSABLE_FAILURE authentication'), false);
  assert.equal(hasDisposableFailureReceipt(`[2026-10-07T10:00:00Z] [INFO] ${messages[0]}`), false);
});

test('a clean working tree with unpushed commits is retained', async () => {
  const head = 'a'.repeat(40);
  const makeDollar = remote => () => async strings => ({ code: 0, stdout: strings.join('').includes('ls-remote') ? `${remote}\trefs/heads/issue-1\n` : head });
  const options = { reason: 'model_refusal', logsUploaded: true, preserved: { clean: true, complete: true }, tempDir: '/work', branchName: 'issue-1', log: async () => {} };
  const argv = { autoCleanup: true };
  assert.equal(await recordDisposableFailure({ ...options, $: makeDollar('b'.repeat(40)), argv }), false);
  assert.equal(argv.autoCleanup, false, 'retaining the container must also retain its unpushed working directory');
  assert.equal(argv.autoCleanupSource, 'incomplete-recovery');
  assert.equal(await recordDisposableFailure({ ...options, $: makeDollar(head) }), true);
});

test('explicit always and failures without preservation proof retain their container', () => {
  for (const [env, disposableFailure] of [
    [{ HIVE_MIND_KEEP_TASK_CONTAINER: 'always' }, true],
    [{}, false],
  ]) {
    const result = buildDockerTaskContainerCompletionAction({ sessionName: 'task', sessionInfo: { isolationBackend: 'docker', disposableFailure }, exitCode: 1, env });
    assert.equal(result.shouldRemove, false);
  }
});
