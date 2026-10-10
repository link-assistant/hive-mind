#!/usr/bin/env node
/**
 * Issue #2890 experiment: `docker kill` (SIGKILL) a container that runs a
 * bot-like process with queued, waiting, starting and recovering work and
 * keeps its state on a host directory, then `docker rm` it (as a redeploy
 * does) and restore the queue from that directory.
 *
 *   node experiments/issue-2890-docker-kill.mjs [image]   (default node:24-slim)
 *
 * The repository is mounted read-only; the container runs as the current
 * user so the 0600 queue files stay readable on the host.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTranslations } from '../src/i18n.lib.mjs';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { createSessionStore } from '../src/session-store.lib.mjs';
import { createSolveQueueDurability } from '../src/telegram-solve-queue.durability.lib.mjs';

const image = process.argv[2] || 'node:24-slim';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hm-2890-docker-'));
const name = `hm-2890-kill-${process.pid}`;
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8' }).trim();

docker('run', '-d', '--name', name, '--user', `${process.getuid()}:${process.getgid()}`, '-e', 'HOME=/tmp', '-e', 'HIVE_MIND_STATE_DIR=/state', '-v', `${repo}:/app:ro`, '-v', `${stateDir}:/state`, image, 'node', '/app/tests/fixtures/issue-2890/solve-queue-bot-child.mjs', 'snapshot');
try {
  const deadline = Date.now() + 120000;
  while (!docker('logs', name).includes('READY')) {
    if (Date.now() > deadline) throw new Error(`the container did not get ready:\n${execFileSync('docker', ['logs', name], { encoding: 'utf8' })}`);
    execFileSync('sleep', ['0.2']);
  }
  docker('kill', name);
  console.log(`docker kill: exit code ${docker('inspect', '-f', '{{.State.ExitCode}}', name)}`);
} finally {
  docker('rm', '-f', name);
}
console.log(`state left on the host (${stateDir}):`);
console.log(
  fs
    .readdirSync(stateDir)
    .map(file => `  ${file}`)
    .join('\n')
);

await loadTranslations('en');
const sent = [];
const telegram = { editMessageText: async () => true, sendMessage: async (chatId, text, extra) => (sent.push({ chatId, text, extra }), { message_id: 1 }) };
const sessions = createSessionStore({ dir: stateDir }).load();
const queue = new SolveQueue({ autoStart: false, verbose: false });
const durability = createSolveQueueDurability({ queue, telegram, stateDir, logDir: null, env: {}, clinkPath: false, log: console.log, reconciler: { isSessionRunning: async record => record.sessionId === 'uuid-alive', isUrlRunning: async () => false } });
const summary = await durability.start();
await durability.close();
const ids = list => list.map(entry => entry.record.url.split('/').at(-1)).join(', ');
console.log(`restored from ${summary.source}: queued again ${ids(summary.requeued)}; still running ${ids(summary.running)}`);
for (const [tool, items] of Object.entries(queue.queues).filter(([, items]) => items.length)) console.log(`  ${tool}: ${items.map(item => `${item.url.split('/').at(-1)}${item.interruptedStarts ? ` (interrupted ${item.interruptedStarts})` : ''}`).join(', ')}`);
console.log(`sessions.json: ${sessions.map(({ sessionName, sessionInfo }) => `${sessionName}${sessionInfo.killRecoveryAttempts ? ` (kill recovery attempts ${sessionInfo.killRecoveryAttempts})` : ''}`).join(', ')}`);
console.log(`notice for chat ${sent[0]?.chatId} topic ${sent[0]?.extra?.message_thread_id}:\n${sent[0]?.text}`);
const ok = summary.requeued.length === 4 && summary.running.length === 1 && sessions.some(entry => entry.sessionInfo.killRecoveryAttempts === 2) && sent.length === 1;
console.log(ok ? 'OK: the queue survived docker kill + docker rm' : 'FAILED');
process.exit(ok ? 0 : 1);
