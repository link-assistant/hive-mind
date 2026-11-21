/**
 * @hive-mind-test-suite default
 *
 * Issue #3469: /solve on an empty queue starts the session at once, so it never
 * becomes a queue item. Its completion logged "matches no launched queue item"
 * twice in the bot log, which read like a lost session.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';

test('a directly started session completion explains why no queue item matched', () => {
  const queue = new SolveQueue({ verbose: false, autoStart: false, getRunningProcesses: async () => ({ count: 0, processes: [] }), getRunningIsolatedSessions: async () => ({ count: 0, byTool: {} }), getRunningSessionItems: async () => [] });
  const logged = [];
  queue.log = message => logged.push(message);
  const item = queue.recordSessionCompletion({ sessionName: 'f22a6700-184f-447e-9b69-77af91971f72', url: 'https://github.com/link-assistant/hive-mind/issues/3445', command: 'solve', exitCode: 1, status: 'failed' });
  assert.equal(item, null);
  assert.deepEqual(logged, ['Session completion for session f22a6700-184f-447e-9b69-77af91971f72 exit=1 status=failed matches no launched queue item (expected for a session started directly, without queueing)']);
});
