#!/usr/bin/env node
import { SolveQueue, QUEUE_CONFIG, resetSolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { resetLimitCache } from '../src/limits.lib.mjs';

resetSolveQueue();
resetLimitCache();

function buildQueue() {
  const queue = new SolveQueue({
    verbose: false,
    autoStart: false,
    getRunningProcesses: async () => ({ count: 0, processes: [] }),
    getRunningIsolatedSessions: async () => ({ count: 0, sessions: [], byTool: {} }),
  });
  const okCheck = { ok: true, reasons: [], oneAtATime: false, rejected: false, rejectReason: null };
  queue.checkSystemResources = async () => ({ ...okCheck });
  queue.checkApiLimits = async () => ({ ...okCheck });
  return queue;
}

const queue = buildQueue();
queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'minimax-m2.5-free' });
queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'gpt-5-nano' });

console.log('QUEUE_CONFIG.concurrency:', QUEUE_CONFIG.concurrency);

const first = await queue.findStartableItems();
console.log(
  'first pass:',
  first.length,
  first.map(s => ({ tool: s.tool, model: s.item.model }))
);

queue.processing.set(first[0].item.id, first[0].item);
const aq = queue.getToolQueue('agent');
const idx = aq.findIndex(i => i.id === first[0].item.id);
if (idx !== -1) aq.splice(idx, 1);

console.log(
  'agent queue after shift:',
  aq.map(i => ({ tool: i.tool, model: i.model }))
);
console.log('processing size:', queue.processing.size);
console.log(
  'processing items:',
  [...queue.processing.values()].map(i => ({ id: i.id, tool: i.tool }))
);

const head = aq[0];
console.log('head:', { tool: head.tool, model: head.model });
console.log('getProcessingCountByTool("agent"):', queue.getProcessingCountByTool('agent'));
console.log('canStartUnderConcurrencyMode:', queue.canStartUnderConcurrencyMode('agent', head));

const check = await queue.canStartCommand({ tool: 'agent' });
console.log('canStartCommand check:', { canStart: check.canStart, oneAtATime: check.oneAtATime });

const second = await queue.findStartableItems();
console.log(
  'second pass:',
  second.length,
  second.map(s => ({ tool: s.tool, model: s.item.model }))
);
queue.stop();
