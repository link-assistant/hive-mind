#!/usr/bin/env node

/**
 * Issue #2890 — the solve queue survives a restart.
 *
 * Run: node examples/solve-queue-restart-demo.mjs [state-dir]
 *
 * A first "bot" queues three of the commands that were lost on 2026-10-09,
 * starts one of them and stops without any shutdown step (as after a
 * SIGKILL). A second "bot" on the same state directory restores the queue
 * and prints the notice the chat would get. The stored `.lino` projection is
 * printed in between.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { loadTranslations } = await import('../src/i18n.lib.mjs');
const { SolveQueue } = await import('../src/telegram-solve-queue.lib.mjs');
const { createSolveQueueDurability } = await import('../src/telegram-solve-queue.durability.lib.mjs');

await loadTranslations('en');
const stateDir = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'solve-queue-demo-'));
const sent = [];
const telegram = { editMessageText: async () => true, sendMessage: async (chatId, text, extra) => (sent.push({ chatId, text, extra }), { message_id: 1 }) };
const quiet = () => {};

// --- the first bot -----------------------------------------------------------
const first = new SolveQueue({ autoStart: false, verbose: false });
const firstDurability = createSolveQueueDurability({ queue: first, telegram, stateDir, logDir: null, env: {}, clinkPath: false, notify: false, log: quiet });
await firstDurability.start();
const urls = ['https://github.com/linksplatform/doublets-rs/issues/64', 'https://github.com/link-assistant/calculator/issues/235', 'https://github.com/link-assistant/web-capture/issues/160'];
const items = urls.map((url, index) => {
  const item = first.enqueue({ url, args: [url, '--tool', 'codex', '--model', 'gpt-5.5'], ctx: { telegram, chat: { id: -1001 }, message: { message_id: 10 + index }, from: { id: 42 } }, requester: '@requester', infoBlock: `URL: ${url}`, tool: 'codex', commandAlias: 'codex', locale: 'en' });
  item.messageInfo = { chatId: -1001, messageId: 20 + index };
  first.notifyStateChange('message', item);
  return item;
});
// The first item was starting, but its session never came up.
const toolQueue = first.getToolQueue('codex');
toolQueue.splice(toolQueue.indexOf(items[0]), 1);
items[0].setStarting();
first.processing.set(items[0].id, items[0]);
first.recordStart('codex');
first.notifyStateChange('starting', items[0]);
items[0].assignSessionId('uuid-never-started', 'docker');
await firstDurability.flush();
console.log(`State directory: ${stateDir}`);
console.log(
  fs
    .readdirSync(stateDir)
    .map(name => `  ${name}`)
    .join('\n')
);
console.log('\n--- solve-queue.lino ---');
console.log(fs.readFileSync(path.join(stateDir, 'solve-queue.lino'), 'utf8').trim());

// --- the second bot, after the kill ------------------------------------------
const second = new SolveQueue({ autoStart: false, verbose: false });
const secondDurability = createSolveQueueDurability({ queue: second, telegram, stateDir, logDir: null, env: {}, clinkPath: false, log: quiet, reconciler: { isSessionRunning: async () => false, isUrlRunning: async () => false } });
const summary = await secondDurability.start();
console.log(`\n--- restored from ${summary.source} (revision ${summary.revision}) ---`);
for (const item of second.queues.codex) console.log(`  ${item.id} ${item.url} interruptedStarts=${item.interruptedStarts}`);
console.log('\n--- notice sent to chat -1001 ---');
console.log(sent.map(message => message.text).join('\n\n'));
await secondDurability.close();
