#!/usr/bin/env node
/**
 * Child process for test-issue-2890-solve-queue-kill.mjs: a bot-like process
 * that keeps its solve queue and sessions in HIVE_MIND_STATE_DIR, then waits
 * to be SIGKILLed.
 *
 * Modes:
 *   snapshot - queued, waiting, starting (alive and lost) items plus a session
 *              in kill recovery; prints READY once everything is saved.
 *   churn    - enqueues and cancels items as fast as it can, printing every
 *              enqueued number, so the kill lands in the middle of saves.
 *
 * @hive-mind-test-skip
 * @see https://github.com/link-assistant/hive-mind/issues/2890
 */

import { SolveQueue } from '../../../src/telegram-solve-queue.lib.mjs';
import { createSessionStore } from '../../../src/session-store.lib.mjs';
import { createSolveQueueDurability } from '../../../src/telegram-solve-queue.durability.lib.mjs';

const mode = process.argv[2] || 'snapshot';
const stateDir = process.env.HIVE_MIND_STATE_DIR;
const telegram = { editMessageText: async () => true, sendMessage: async () => ({ message_id: 1 }) };
const queue = new SolveQueue({ autoStart: false, verbose: false });
const durability = createSolveQueueDurability({ queue, telegram, stateDir, logDir: null, env: {}, clinkPath: false, notify: false, log: () => {} });
await durability.start();

const enqueue = (n, tool = 'codex') => {
  const url = `https://github.com/link-assistant/router/issues/${n}`;
  const item = queue.enqueue({ url, args: [url, '--tool', tool, '--model', 'gpt-5.5', '--think', 'high'], ctx: { telegram, chat: { id: -100777 }, message: { message_id: 100 + n, message_thread_id: 7 }, from: { id: 42 } }, requester: '@requester', infoBlock: `URL: ${url}`, tool, commandAlias: tool, locale: 'en' });
  item.messageInfo = { chatId: -100777, messageId: 200 + n, messageThreadId: 7 };
  queue.notifyStateChange('message', item);
  return item;
};
const start = (item, sessionId) => {
  const toolQueue = queue.getToolQueue(item.tool);
  toolQueue.splice(toolQueue.indexOf(item), 1);
  item.setStarting();
  queue.processing.set(item.id, item);
  queue.recordStart(item.tool);
  queue.notifyStateChange('starting', item);
  item.assignSessionId(sessionId, 'docker');
};

if (mode === 'snapshot') {
  enqueue(724);
  const waiting = enqueue(725);
  waiting.setWaiting('Waiting for the start interval');
  queue.notifyStateChange('message', waiting);
  const alive = enqueue(727);
  const lost = enqueue(728);
  enqueue(1, 'claude');
  start(alive, 'uuid-alive');
  start(lost, 'uuid-lost');
  const sessions = createSessionStore({ dir: stateDir });
  sessions.persist('uuid-alive', { chatId: -100777, messageId: 927, url: alive.url, command: 'solve', isolationBackend: 'docker', sessionId: 'uuid-alive', tool: 'codex', startTime: new Date() });
  sessions.persist('uuid-recovering', { chatId: -100777, messageId: 999, url: 'https://github.com/link-assistant/router/issues/700', command: 'solve', isolationBackend: 'docker', sessionId: 'uuid-recovering', tool: 'codex', startTime: new Date(), killRecoveryAttempts: 2, killRecoveryResumed: true, killRecoveryOfSession: 'uuid-killed' });
  await durability.flush();
  console.log('READY');
} else {
  let n = 0;
  const loop = () => {
    for (let i = 0; i < 5; i++) {
      n += 1;
      const item = enqueue(n);
      if (n % 7 === 0) queue.cancel(item.id);
      else process.stdout.write(`E${n}\n`);
    }
    setImmediate(loop);
  };
  loop();
}
// Stay alive until the test kills the process.
const keepAlive = setInterval(() => {}, 1000);
process.on('SIGTERM', () => clearInterval(keepAlive));
