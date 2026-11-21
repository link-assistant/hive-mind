#!/usr/bin/env node
/**
 * Reproduce the /queue reply from the issue #2823 log (2026-10-09 ~06:40Z):
 * codex had router#722-727 launched, #723/#724/#725/#727 still executing, and
 * one earlier session had ended with exit code 1. Uses only APIs that exist
 * before and after the fix, so it can be run on both to compare the output.
 *
 * Run: node experiments/issue-2823/queue-status-repro.mjs
 */
import { SolveQueue } from '../../src/telegram-solve-queue.lib.mjs';
import { preloadAllLocales } from '../../src/i18n.lib.mjs';

await preloadAllLocales();
const ROUTER = n => `https://github.com/link-assistant/router/issues/${n}`;
const running = [723, 724, 725, 727].map(n => ({ sessionName: `s-${n}`, url: ROUTER(n), tool: 'codex', startTime: new Date(Date.now() - 2 * 3600_000) }));
const queue = new SolveQueue({ autoStart: false, getRunningProcesses: async () => ({ count: 0, processes: [] }), getRunningIsolatedSessions: async () => ({ count: 0, byTool: {} }), getRunningSessionItems: async () => running });

const launch = async (url, sessionName) => {
  queue.executeCallback = async () => ({ success: true, sessionId: sessionName, output: `session: ${sessionName}` });
  const item = queue.enqueue({ url, args: [url], tool: 'codex' });
  queue.getToolQueue('codex').splice(queue.getToolQueue('codex').indexOf(item), 1);
  queue.processing.set(item.id, item);
  item.setStarting();
  await queue.executeItem(item);
};
await launch('https://github.com/link-foundation/browser-commander', 's-bc');
await launch(ROUTER(721), '33fb97ec-e994-42c7-97d2-ed2bec7504f5');
for (const n of [722, 723, 724, 725, 726, 727]) await launch(ROUTER(n), `s-${n}`);
queue.enqueue({ url: 'https://github.com/link-foundation/disk-space-saviour/issues/1', args: [], tool: 'codex' }).setWaiting('Disk usage is 79% (threshold: 65%)');

// Feed the session_completed events seen in the log (the fixed queue records them).
if (typeof queue.recordSessionCompletion === 'function') {
  queue.recordSessionCompletion({ sessionName: 's-bc', exitCode: 0, status: 'executed' });
  queue.recordSessionCompletion({ sessionName: '33fb97ec-e994-42c7-97d2-ed2bec7504f5', exitCode: 1, status: 'failed' });
  queue.recordSessionCompletion({ sessionName: 's-722', exitCode: 0, status: 'executed' });
  queue.recordSessionCompletion({ sessionName: 's-726', exitCode: 0, status: 'executed' });
}
console.log(await queue.formatDetailedStatus());
queue.stop();
