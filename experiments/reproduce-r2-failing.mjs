#!/usr/bin/env node
import { SolveQueue, QUEUE_CONFIG, resetSolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { resetLimitCache } from '../src/limits.lib.mjs';

function buildQueue() {
  return new SolveQueue({
    verbose: true,
    autoStart: false,
    getRunningProcesses: async () => ({ count: 0, processes: [] }),
    getRunningIsolatedSessions: async () => ({ count: 0, sessions: [], byTool: {} }),
  });
}

function withConcurrency(overrides, fn) {
  const saved = { ...QUEUE_CONFIG.concurrency };
  try {
    Object.assign(QUEUE_CONFIG.concurrency, overrides);
    return fn();
  } finally {
    for (const k of Object.keys(QUEUE_CONFIG.concurrency)) delete QUEUE_CONFIG.concurrency[k];
    Object.assign(QUEUE_CONFIG.concurrency, saved);
  }
}

resetSolveQueue();
resetLimitCache();
const queue = buildQueue();

await withConcurrency({ agent: 'per-free-model-one-at-a-time' }, async () => {
  queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'minimax-m2.5-free' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'gpt-5-nano-free' });

  console.log('\n[during fn] concurrency.agent =', QUEUE_CONFIG.concurrency.agent);

  const first = await queue.findStartableItems();
  console.log(
    'first pass:',
    first.length,
    first.map(s => s.item.model)
  );
  console.log('[after first await] concurrency.agent =', QUEUE_CONFIG.concurrency.agent);

  queue.processing.set(first[0].item.id, first[0].item);
  queue.getToolQueue('agent').shift();

  console.log('\n[before second pass] concurrency.agent =', QUEUE_CONFIG.concurrency.agent);
  console.log('agent queue length:', queue.getToolQueue('agent').length);
  console.log('processing size:', queue.processing.size);
  console.log('head:', queue.getToolQueue('agent')[0] ? { tool: queue.getToolQueue('agent')[0].tool, model: queue.getToolQueue('agent')[0].model } : null);

  const second = await queue.findStartableItems();
  console.log(
    'second pass:',
    second.length,
    second.map(s => s.item.model)
  );
});

console.log('\n[after withConcurrency] concurrency.agent =', QUEUE_CONFIG.concurrency.agent);
queue.stop();
