#!/usr/bin/env node
// Queue isolation test for issue #1551: agent queue should be independent from claude queue
import assert from 'node:assert/strict';
import { SolveQueue } from '../src/telegram-solve-queue.lib.mjs';

const q = new SolveQueue({ verbose: false });
const mk = (n, tool) => ({ url: `https://github.com/t/r/issues/${n}`, args: '', requester: 'u', infoBlock: 'T', tool });

// Enqueue 2 claude items — agent queue should remain empty
q.enqueue(mk(1, 'claude'));
q.enqueue(mk(2, 'claude'));
const s1 = q.getStats();
assert.equal(s1.queued, 2, 'total queued = 2');
assert.equal(s1.queuedByTool.agent || 0, 0, 'agent queue empty despite claude items');
assert.equal(s1.queuedByTool.claude, 2, 'claude queue = 2');

// Enqueue 1 agent item — should show correct per-tool counts
q.enqueue(mk(3, 'agent'));
const s2 = q.getStats();
assert.equal(s2.queuedByTool.agent, 1, 'agent queue = 1');
assert.equal(s2.queued, 3, 'total queued = 3');

// Verify tool-specific position calculation (fix for bot entry point)
// Before fix: position = stats.queued + 1 = 4 (wrong, counts all tools)
// After fix: position = stats.queuedByTool[tool] + 1 = 2 (correct, per-tool)
assert.equal((s2.queuedByTool.agent || 0) + 1, 2, 'next agent position = #2');
assert.equal((s2.queuedByTool.claude || 0) + 1, 3, 'next claude position = #3');

q.stop();
console.log('✅ Queue isolation test passed (issue #1551)');
