#!/usr/bin/env node
/**
 * Diagnose why the second findStartableItems() pass returns 0 items
 * in the per-free-model parallel test.
 */
import { SolveQueue, QUEUE_CONFIG, resetSolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { resetLimitCache } from '../src/limits.lib.mjs';

resetSolveQueue();
resetLimitCache();

const queue = new SolveQueue({
  verbose: true,
  autoStart: false,
  getRunningProcesses: async () => ({ count: 0, processes: [] }),
  getRunningIsolatedSessions: async () => ({ count: 0, sessions: [], byTool: {} }),
});

// Force concurrency
QUEUE_CONFIG.concurrency.agent = 'per-free-model-one-at-a-time';

queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'minimax-m2.5-free' });
queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'gpt-5-nano-free' });

console.log('--- BEFORE first pass ---');
console.log('agent queue length:', queue.getToolQueue('agent').length);
console.log('processing size:', queue.processing.size);

const first = await queue.findStartableItems();
console.log('first pass startable count:', first.length);
console.log(
  'first pass details:',
  first.map(s => ({ tool: s.tool, model: s.item.model }))
);

// Simulate move first to processing
queue.processing.set(first[0].item.id, first[0].item);
queue.getToolQueue('agent').shift();

console.log('\n--- BEFORE second pass ---');
console.log('agent queue length:', queue.getToolQueue('agent').length);
console.log('processing size:', queue.processing.size);
console.log('head of agent queue:', queue.getToolQueue('agent')[0] ? { tool: queue.getToolQueue('agent')[0].tool, model: queue.getToolQueue('agent')[0].model } : null);

// What does canStartCommand say?
const head = queue.getToolQueue('agent')[0];
const check = await queue.canStartCommand({ tool: 'agent', locale: null });
console.log('\ncanStartCommand result:', {
  canStart: check.canStart,
  rejected: check.rejected,
  rejectReason: check.rejectReason,
  reasons: check.reasons,
  oneAtATime: check.oneAtATime,
  totalProcessing: check.totalProcessing,
});

const ok = queue.canStartUnderConcurrencyMode('agent', head);
console.log('\ncanStartUnderConcurrencyMode("agent", head):', ok);

const second = await queue.findStartableItems();
console.log('\nsecond pass startable count:', second.length);
console.log(
  'second pass details:',
  second.map(s => ({ tool: s.tool, model: s.item.model }))
);

queue.stop();
