#!/usr/bin/env node
/**
 * Issue #2890: SIGKILL a bot process with items queued, waiting, starting and
 * a session in kill recovery, then start a new "bot" on the same state
 * directory and check that everything continues without manual action.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2890
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { loadTranslations } from '../src/i18n.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { createSessionStore } from '../src/session-store.lib.mjs';
import { createSessionReconciler, createSolveQueueDurability } from '../src/telegram-solve-queue.durability.lib.mjs';
import { createSolveQueuePersistence } from '../src/telegram-solve-queue.persistence.lib.mjs';

await loadTranslations('en');

const child = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'issue-2890', 'solve-queue-bot-child.mjs');

/** Start the child, wait until `ready(stdout)` holds, then kill -9 it. */
async function runAndKill(stateDir, mode, ready) {
  const proc = spawn(process.execPath, [child, mode], { env: { ...process.env, HIVE_MIND_STATE_DIR: stateDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  proc.stderr.on('data', chunk => (stderr += chunk));
  const exited = new Promise(resolve => proc.on('exit', (code, signal) => resolve({ code, signal })));
  let timer;
  await Promise.race([
    new Promise(resolve =>
      proc.stdout.on('data', chunk => {
        stdout += chunk;
        if (ready(stdout)) resolve();
      })
    ),
    exited.then(result => Promise.reject(new Error(`child exited early (${JSON.stringify(result)}): ${stderr}`))),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out waiting for the ${mode} child`)), 30000);
    }),
  ]).finally(() => clearTimeout(timer));
  proc.kill('SIGKILL');
  const result = await exited;
  return { ...result, stdout };
}

/** A new bot process: resume sessions.json, then restore the queue. */
async function relaunch(stateDir, { aliveSessions = [] } = {}) {
  const sent = [];
  const telegram = { editMessageText: async () => true, sendMessage: async (chatId, text, extra) => (sent.push({ chatId, text, extra }), { message_id: 1 }) };
  const tracked = new Map(
    createSessionStore({ dir: stateDir })
      .load()
      .map(({ sessionName, sessionInfo }) => [sessionName, sessionInfo])
  );
  const queue = new SolveQueue({ autoStart: false, verbose: false });
  const executed = [];
  const durability = createSolveQueueDurability({
    queue,
    telegram,
    stateDir,
    logDir: null,
    env: {},
    clinkPath: false,
    log: () => {},
    ensureExecuteCallback: () => {
      queue.executeCallback = async item => (executed.push(item), { success: true, sessionId: `run-${item.url.split('/').at(-1)}`, output: 'session: run' });
    },
    reconciler: createSessionReconciler({
      getTrackedSessionInfo: name => tracked.get(name) || null,
      querySessionStatus: async id => ({ exists: aliveSessions.includes(id), isolation: 'docker' }),
      hasActiveSessionForUrlAsync: async () => ({ isActive: false }),
      trackSession: (name, info) => tracked.set(name, info),
    }),
  });
  const summary = await durability.start();
  return { queue, durability, summary, tracked, sent, executed };
}

/** Let the restored queue run; return once every queue is empty and nothing is processing. */
async function drain(queue) {
  queue.sleep = () => new Promise(resolve => setTimeout(resolve, 5));
  queue.findStartableItems = async () =>
    Object.keys(queue.queues)
      .filter(tool => queue.queues[tool].length)
      .map(tool => ({ tool }));
  queue.ensureConsumerRunning();
  const started = Date.now();
  while (queue.getTotalQueueLength() > 0 || queue.processing.size > 0) {
    if (Date.now() - started > 20000) throw new Error('the restored queue did not drain');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  queue.stop();
}

console.log('\n=== kill -9 with queued, waiting, starting and recovering work ===');
{
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-2890-kill-'));
  const killed = await runAndKill(stateDir, 'snapshot', out => out.includes('READY'));
  assert(killed.signal === 'SIGKILL', 'the bot process was SIGKILLed');

  const { queue, durability, summary, tracked, sent, executed } = await relaunch(stateDir, { aliveSessions: ['uuid-alive'] });
  const order = summary.requeued.map(entry => entry.record.url.split('/').at(-1));
  assert(summary.source === 'archive', 'the queue comes back from the state directory');
  assert(order.sort().join() === '1,724,725,728', 'queued, waiting and lost-start items are all queued again');
  assert(queue.queues.codex.map(item => item.url.split('/').at(-1)).join() === '728,724,725' && queue.queues.claude.length === 1, 'each tool queue holds its items in their original order');
  assert(summary.running.length === 1 && summary.running[0].record.sessionId === 'uuid-alive', 'the start whose session survived is not run twice');
  const lost = queue.queues.codex.find(item => item.url.endsWith('/728'));
  assert(lost.interruptedStarts === 1 && lost.args.join(' ').includes('--think high') && lost.messageInfo.messageId === 928 && lost.ctx.chat.id === -100777 && lost.ctx.message.message_thread_id === 7, 'the lost start keeps its args, card and topic, and counts the interruption');
  assert(queue.lastStartTimeByTool.codex !== null, 'the start-interval state survives the kill');
  const recovering = tracked.get('uuid-recovering');
  assert(recovering?.killRecoveryAttempts === 2 && recovering.killRecoveryOfSession === 'uuid-killed', 'the session in kill recovery keeps its attempt count');
  assert(sent.length === 1 && sent[0].extra.message_thread_id === 7 && sent[0].text.includes('Back in the queue: 4') && sent[0].text.includes('Still running: 1'), 'the chat topic is told what was restored');

  await drain(queue);
  assert(
    executed
      .map(item => item.url.split('/').at(-1))
      .sort()
      .join() === '1,724,725,728',
    'every restored item runs exactly once'
  );
  assert(
    executed
      .filter(item => item.tool === 'codex')
      .map(item => item.url.split('/').at(-1))
      .join() === '728,724,725',
    'codex items run in queue order'
  );
  await durability.close();
  const after = await createSolveQueuePersistence({ dir: stateDir, clinkPath: false, log: () => {} }).load();
  assert(after.items.length === 0, 'started items leave the stored queue');

  // A second kill right after the restore: nothing is restored twice.
  const again = await relaunch(stateDir);
  assert(again.summary.requeued.length === 0 && again.summary.running.length === 0 && again.sent.length === 0, 'a later restart has nothing left to restore');
  await again.durability.close();
}

console.log('\n=== kill -9 in the middle of saves ===');
for (const round of [1, 2, 3]) {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-2890-churn-'));
  const killed = await runAndKill(stateDir, 'churn', out => (out.match(/^E\d+$/gm) || []).length >= 40 * round);
  const printed = (killed.stdout.match(/^E(\d+)$/gm) || []).map(line => Number(line.slice(1)));
  const { summary, durability } = await relaunch(stateDir);
  const restored = summary.requeued.map(entry => Number(entry.record.url.split('/').at(-1)));
  const expected = printed.filter(n => n <= (restored.at(-1) || 0));
  assert(restored.length > 0 && restored.join() === expected.join(), `round ${round}: the store holds a consistent prefix (${restored.length} of ${printed.length} enqueued, none cancelled, none missing)`);
  await durability.close();
}

printSummary();
process.exit(getFailCount() > 0 ? 1 : 0);
