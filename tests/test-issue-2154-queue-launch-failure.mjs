#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Issue #2154, the false positive in the bot log.
 *
 * The three Formal AI tasks that never launched were dequeued and then logged
 * as successful starts:
 *
 * ```
 * 17:38:21.279Z [VERBOSE] /queue: Starting: [solve-1786555450234-255gv05] …
 * 17:38:21.279Z 🧠 Starting the Formal AI sidecar (ghcr.io/link-assistant/formal-ai:0.339.1) …
 * 17:38:21.279Z [VERBOSE] /queue: Finished: [solve-1786555450234-255gv05] … (started)
 * ```
 *
 * `SolveQueue.executeItem` called `item.setStarted()` unconditionally, so a
 * result of `{ success: false }` still became STARTED, incremented
 * `stats.totalCompleted` and landed in `queue.completed`. The log therefore
 * claimed three sessions had started while `$ --list` showed none of them —
 * the exact contradiction reported in the issue.
 *
 * A refused launch is a failed queue item. These tests pin that, and pin that
 * a healthy launch is still counted as started.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2154
 */

import assert from 'assert/strict';

import { QueueItemStatus, SolveQueue, resetSolveQueue } from '../src/telegram-solve-queue.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.log(`FAIL: ${name}`);
    console.log(`  ${error.stack || error.message}`);
    failed++;
  }
}

const SESSION = 'dad2b1ea-4d1e-4ba3-bb31-f6fe5fa5fc89';
/** The production failure, verbatim from the issue report. */
const SIDECAR_ERROR = "Formal AI sidecar could not be started, so the task was not launched (issue #2146): Command failed: docker run --detach --name hive-mind-formal-ai …\nUnable to find image 'ghcr.io/link-assistant/formal-ai:0.339.1' locally\ndocker: Error response from daemon: error from registry: unauthorized";

/** Capture console.error while `fn` runs; the bot log is exactly this stream. */
async function captureErrors(fn) {
  const lines = [];
  const original = console.error;
  console.error = (...args) => lines.push(args.map(String).join(' '));
  try {
    const value = await fn();
    return { lines, value };
  } finally {
    console.error = original;
  }
}

/**
 * A queue whose executeCallback returns `result`, plus the item it dequeued
 * with its Telegram message tracking already in place (the consumer sets that
 * up before executeItem runs).
 */
function makeQueue(result) {
  resetSolveQueue();
  const edits = [];
  const queue = new SolveQueue({ verbose: false, autoStart: false, executeCallback: async () => result });
  const item = queue.enqueue({
    url: 'https://github.com/link-assistant/hive-mind/issues/2154',
    args: '--model formal-ai',
    requester: 'konard',
    infoBlock: 'Issue: https://github.com/link-assistant/hive-mind/issues/2154',
    tool: 'codex',
    ctx: {
      from: { id: 7 },
      telegram: {
        editMessageText: async (_chatId, _messageId, _inline, text) => {
          edits.push(text);
        },
      },
    },
  });
  item.messageInfo = { chatId: 42, messageId: 100 };
  item.setStarting();
  queue.processing.set(item.id, item);
  return { queue, item, edits };
}

await test('a refused launch fails the queue item instead of reporting it as started', async () => {
  const { queue, item } = makeQueue({ success: false, sessionId: SESSION, output: '', error: SIDECAR_ERROR });

  await captureErrors(() => queue.executeItem(item));

  assert.equal(item.status, QueueItemStatus.FAILED, 'the item is FAILED, so `Finished: […] (failed)` is what the log says');
  assert.ok(String(item.error).includes('formal-ai:0.339.1'), 'the item keeps the reason it was refused');
  assert.equal(item.sessionName, SESSION, 'the item still names the session that was going to run it');
  assert.equal(queue.stats.totalFailed, 1, 'counted as failed');
  assert.equal(queue.stats.totalCompleted, 0, 'not counted as completed');
  assert.deepEqual(
    queue.completed.map(entry => entry.id),
    [],
    'a task that never ran is not queue history of started tasks'
  );
  assert.deepEqual(
    queue.failed.map(entry => entry.id),
    [item.id],
    'it is in the failed history instead'
  );
  assert.equal(queue.processing.has(item.id), false, 'and it is no longer processing');
  queue.stop();
});

await test('the refusal is written to the bot log with the session UUID', async () => {
  const { queue, item } = makeQueue({ success: false, sessionId: SESSION, error: SIDECAR_ERROR });

  const { lines } = await captureErrors(() => queue.executeItem(item));

  const logged = lines.find(line => line.includes(SESSION));
  assert.ok(logged, 'the bot log gets a line naming the session UUID');
  assert.ok(logged.includes(item.id), 'and the queue item id, so the "Starting:" line can be matched to it');
  assert.ok(logged.includes('formal-ai:0.339.1'), 'and the reason');
  queue.stop();
});

await test('the queued task reports its UUID and the missing session in Telegram', async () => {
  const { queue, item, edits } = makeQueue({ success: false, sessionId: SESSION, isolationBackend: 'docker', error: SIDECAR_ERROR });

  await captureErrors(() => queue.executeItem(item));

  const reply = edits.at(-1);
  assert.ok(reply, 'the queued task still gets a final message');
  assert.ok(reply.includes(`\`${SESSION}\``), 'the reply carries the session UUID');
  assert.ok(/Isolation: `docker`/.test(reply), 'the reply names the isolation backend');
  assert.ok(reply.includes('ghcr.io/link-assistant/formal-ai:0.339.1'), 'the reply keeps the underlying error');
  assert.ok(/not launched/i.test(reply) && reply.includes('--list'), 'the reply explains the absence from --list');
  assert.ok(reply.includes('Issue: https://github.com/link-assistant/hive-mind/issues/2154'), 'the reply keeps the info block');
  queue.stop();
});

await test('a launch with no session id still fails without inventing a session line', async () => {
  const { queue, item, edits } = makeQueue({ success: false, error: 'start-command not found in PATH' });

  await captureErrors(() => queue.executeItem(item));

  assert.equal(item.status, QueueItemStatus.FAILED, 'still a failure');
  const reply = edits.at(-1);
  assert.ok(!reply.includes('Session:'), 'no Session line for a launch that never got a UUID');
  assert.ok(reply.includes('start-command not found in PATH'), 'the reason is still reported');
  queue.stop();
});

await test('a successful launch is still counted as started', async () => {
  const { queue, item, edits } = makeQueue({ success: true, sessionId: SESSION, isolationBackend: 'docker', output: '' });

  const { lines } = await captureErrors(() => queue.executeItem(item));

  assert.equal(item.status, QueueItemStatus.STARTED, 'unchanged behaviour for a healthy launch');
  assert.equal(item.sessionName, SESSION);
  assert.equal(queue.stats.totalCompleted, 1);
  assert.equal(queue.stats.totalFailed, 0);
  assert.deepEqual(
    queue.completed.map(entry => entry.id),
    [item.id]
  );
  assert.equal(lines.length, 0, 'no error lines for a healthy launch');
  assert.ok(edits.at(-1).includes(SESSION), 'the executing message still names the session');
  queue.stop();
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
