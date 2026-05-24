#!/usr/bin/env node
/**
 * Solve Queue Concurrency Tests (Issue #1474)
 *
 * Verifies per-tool concurrency modes:
 * - 'global-one-at-a-time' (default for agent)
 * - 'per-free-model-one-at-a-time'
 * - 'per-model-one-at-a-time'
 * - 'off' (default for claude/codex/qwen/gemini)
 *
 * Also covers HIVE_MIND_QUEUE_CONFIG lino notation parsing and
 * isFreeAgentModel() classification.
 *
 * Run with: node tests/solve-queue-concurrency.test.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1474
 */

import assert from 'node:assert/strict';
import { SolveQueue, QUEUE_CONFIG, resetSolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { parseQueueConfig, CONCURRENCY_MODES } from '../src/queue-config.lib.mjs';
import { isFreeAgentModel, normalizeAgentModelKey } from '../src/models/index.mjs';
import { resetLimitCache } from '../src/limits.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

function beforeEach() {
  resetSolveQueue();
  resetLimitCache();
}

/**
 * Build a queue with all external process probes stubbed to "nothing running"
 * and system resource / API limit checks stubbed to "always OK", so concurrency
 * gating is exercised in isolation regardless of the host's RAM/CPU/disk state.
 * Uses autoStart=false so the consumer loop doesn't actually spawn anything.
 */
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

/**
 * Mutate QUEUE_CONFIG.concurrency for a single test and restore after.
 *
 * Works for both sync and async `fn`:
 *  - If `fn()` returns a thenable, attach restore to its resolution/rejection
 *    AND return a promise so callers can `await` it.
 *  - If `fn()` returns a plain value, restore synchronously before returning.
 *
 * A naive `try { return fn() } finally { restore() }` is wrong for async fns
 * because `finally` runs immediately after the pending promise is returned,
 * restoring state before the async body has actually executed.
 */
function withConcurrency(overrides, fn) {
  const saved = { ...QUEUE_CONFIG.concurrency };
  const restore = () => {
    for (const k of Object.keys(QUEUE_CONFIG.concurrency)) delete QUEUE_CONFIG.concurrency[k];
    Object.assign(QUEUE_CONFIG.concurrency, saved);
  };
  Object.assign(QUEUE_CONFIG.concurrency, overrides);
  let result;
  try {
    result = fn();
  } catch (err) {
    restore();
    throw err;
  }
  if (result && typeof result.then === 'function') {
    return result.then(
      value => {
        restore();
        return value;
      },
      err => {
        restore();
        throw err;
      }
    );
  }
  restore();
  return result;
}

// ============================================================================
// isFreeAgentModel & normalizeAgentModelKey
// ============================================================================

console.log('\n📋 isFreeAgentModel / normalizeAgentModelKey (R4)\n');

test('isFreeAgentModel detects -free suffix on bare alias', () => {
  assert.equal(isFreeAgentModel('minimax-m2.5-free'), true);
  assert.equal(isFreeAgentModel('gpt-5-nano-free'), true);
});

test('isFreeAgentModel detects entries in freeToBaseModelMap', () => {
  assert.equal(isFreeAgentModel('nemotron-3-super-free'), true);
  assert.equal(isFreeAgentModel('deepseek-r1-free'), true);
});

test('isFreeAgentModel detects -free suffix on fully-prefixed ids', () => {
  assert.equal(isFreeAgentModel('opencode/minimax-m2.5-free'), true);
  assert.equal(isFreeAgentModel('kilo/glm-5-free'), true);
});

test('isFreeAgentModel returns false for paid / unknown models', () => {
  assert.equal(isFreeAgentModel('claude-sonnet-4-5'), false);
  assert.equal(isFreeAgentModel('gpt-5'), false);
  assert.equal(isFreeAgentModel(''), false);
  assert.equal(isFreeAgentModel(null), false);
  assert.equal(isFreeAgentModel(undefined), false);
});

test('normalizeAgentModelKey returns mapped id when known, raw otherwise', () => {
  // Unmapped string survives untouched (used as the gating key).
  assert.equal(normalizeAgentModelKey('some-unknown-model'), 'some-unknown-model');
  assert.equal(normalizeAgentModelKey(''), '');
  assert.equal(normalizeAgentModelKey(null), '');
});

// ============================================================================
// QUEUE_CONFIG defaults (R1, R5)
// ============================================================================

console.log('\n📋 Concurrency defaults (R1, R5)\n');

test('agent concurrency defaults to global-one-at-a-time', () => {
  assert.equal(QUEUE_CONFIG.concurrency.agent, 'global-one-at-a-time');
});

test('claude/codex/qwen/gemini concurrency default to off', () => {
  assert.equal(QUEUE_CONFIG.concurrency.claude, 'off');
  assert.equal(QUEUE_CONFIG.concurrency.codex, 'off');
  assert.equal(QUEUE_CONFIG.concurrency.qwen, 'off');
  assert.equal(QUEUE_CONFIG.concurrency.gemini, 'off');
});

test('CONCURRENCY_MODES enumerates the supported modes', () => {
  assert.deepEqual([...CONCURRENCY_MODES].sort(), ['global-one-at-a-time', 'off', 'per-free-model-one-at-a-time', 'per-model-one-at-a-time']);
});

// ============================================================================
// parseQueueConfig — lino notation for *-concurrency entries (R3)
// ============================================================================

console.log('\n📋 parseQueueConfig — *-concurrency lino entries (R3)\n');

test('parseQueueConfig parses (agent-concurrency per-free-model-one-at-a-time)', () => {
  const cfg = parseQueueConfig('((agent-concurrency per-free-model-one-at-a-time))');
  assert.deepEqual(cfg.concurrency, { agent: 'per-free-model-one-at-a-time' });
});

test('parseQueueConfig parses multiple *-concurrency entries', () => {
  const cfg = parseQueueConfig('((agent-concurrency per-free-model-one-at-a-time)(claude-concurrency global-one-at-a-time))');
  assert.deepEqual(cfg.concurrency, {
    agent: 'per-free-model-one-at-a-time',
    claude: 'global-one-at-a-time',
  });
});

test('parseQueueConfig accepts *-concurrency alongside threshold entries', () => {
  const cfg = parseQueueConfig('((ram (65% enqueue))(agent-concurrency global-one-at-a-time))');
  assert.ok(cfg.ram, 'ram threshold should still be parsed');
  assert.equal(cfg.ram.value, 0.65);
  assert.equal(cfg.ram.strategy, 'enqueue');
  assert.deepEqual(cfg.concurrency, { agent: 'global-one-at-a-time' });
});

test('parseQueueConfig drops *-concurrency entries with unknown modes', () => {
  // An unrecognized mode is silently dropped so the queue falls back to the
  // env var or the built-in default rather than booting in a confusing state.
  const cfg = parseQueueConfig('((agent-concurrency totally-bogus))');
  assert.equal(cfg.concurrency, undefined, 'No concurrency entry should be emitted');
});

// ============================================================================
// SolveQueueItem.model plumbing
// ============================================================================

console.log('\n📋 SolveQueueItem.model plumbing\n');

test('enqueue stores the requested model on the queue item (normalized for gating)', () => {
  beforeEach();
  const queue = buildQueue();
  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '',
    requester: 'u',
    infoBlock: 'i',
    tool: 'agent',
    model: 'minimax-m2.5-free',
  });
  // The queue normalizes the alias to its full provider id (opencode/...)
  // so that two requests for the same provider-side rate-limited model share
  // a slot, while kilo/minimax-m2.5-free (different provider) gets its own.
  assert.equal(item.model, 'opencode/minimax-m2.5-free');
  queue.stop();
});

test('enqueue normalizes alias so opencode/ and kilo/ variants use separate slots', () => {
  beforeEach();
  const queue = buildQueue();
  const a = queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'minimax-m2.5-free' });
  const b = queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'kilo/minimax-m2.5-free' });
  assert.equal(a.model, 'opencode/minimax-m2.5-free');
  assert.equal(b.model, 'kilo/minimax-m2.5-free');
  assert.notEqual(a.model, b.model, 'Different providers must produce different gating keys');
  queue.stop();
});

test('enqueue preserves unknown model strings as-is', () => {
  beforeEach();
  const queue = buildQueue();
  const item = queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'totally-custom-model' });
  assert.equal(item.model, 'totally-custom-model');
  queue.stop();
});

test('enqueue without a model stores null (no gating possible)', () => {
  beforeEach();
  const queue = buildQueue();
  const item = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '',
    requester: 'u',
    infoBlock: 'i',
    tool: 'agent',
  });
  assert.equal(item.model, null);
  queue.stop();
});

test('getProcessingCountByToolAndModel counts only matching (tool, model) pairs', () => {
  beforeEach();
  const queue = buildQueue();
  queue.processing.set('a', { id: 'a', tool: 'agent', model: 'minimax-m2.5-free' });
  queue.processing.set('b', { id: 'b', tool: 'agent', model: 'minimax-m2.5-free' });
  queue.processing.set('c', { id: 'c', tool: 'agent', model: 'gpt-5-nano' });
  queue.processing.set('d', { id: 'd', tool: 'claude', model: 'claude-sonnet-4-5' });
  assert.equal(queue.getProcessingCountByToolAndModel('agent', 'minimax-m2.5-free'), 2);
  assert.equal(queue.getProcessingCountByToolAndModel('agent', 'gpt-5-nano'), 1);
  assert.equal(queue.getProcessingCountByToolAndModel('agent', 'nonexistent'), 0);
  assert.equal(queue.getProcessingCountByToolAndModel('claude', 'claude-sonnet-4-5'), 1);
  queue.stop();
});

// ============================================================================
// canStartUnderConcurrencyMode — direct unit tests
// ============================================================================

console.log('\n📋 canStartUnderConcurrencyMode (Issue #1474)\n');

test("'off' mode never blocks", () => {
  beforeEach();
  const queue = buildQueue();
  queue.processing.set('a', { id: 'a', tool: 'claude', model: 'x' });
  withConcurrency({ claude: 'off' }, () => {
    const item = { tool: 'claude', model: 'x' };
    assert.equal(queue.canStartUnderConcurrencyMode('claude', item), true);
  });
  queue.stop();
});

test("'global-one-at-a-time' blocks when any item of this tool is processing", () => {
  beforeEach();
  const queue = buildQueue();
  withConcurrency({ agent: 'global-one-at-a-time' }, () => {
    const item = { tool: 'agent', model: 'minimax-m2.5-free' };
    assert.equal(queue.canStartUnderConcurrencyMode('agent', item), true);
    queue.processing.set('a', { id: 'a', tool: 'agent', model: 'gpt-5-nano' });
    assert.equal(queue.canStartUnderConcurrencyMode('agent', item), false);
  });
  queue.stop();
});

test("'global-one-at-a-time' does not consider other tools' processing items", () => {
  beforeEach();
  const queue = buildQueue();
  queue.processing.set('a', { id: 'a', tool: 'claude', model: 'x' });
  withConcurrency({ agent: 'global-one-at-a-time' }, () => {
    const item = { tool: 'agent', model: 'minimax-m2.5-free' };
    assert.equal(queue.canStartUnderConcurrencyMode('agent', item), true);
  });
  queue.stop();
});

test("'per-free-model-one-at-a-time' gates only free models", () => {
  beforeEach();
  const queue = buildQueue();
  withConcurrency({ agent: 'per-free-model-one-at-a-time' }, () => {
    queue.processing.set('a', { id: 'a', tool: 'agent', model: 'minimax-m2.5-free' });
    // Same free model is blocked
    assert.equal(queue.canStartUnderConcurrencyMode('agent', { tool: 'agent', model: 'minimax-m2.5-free' }), false);
    // Different free model is allowed (key R2 case)
    assert.equal(queue.canStartUnderConcurrencyMode('agent', { tool: 'agent', model: 'gpt-5-nano-free' }), true);
    // Non-free model is NOT gated even if a free one is in flight
    assert.equal(queue.canStartUnderConcurrencyMode('agent', { tool: 'agent', model: 'claude-sonnet-4-5' }), true);
    // Item with no declared model bypasses the gate
    assert.equal(queue.canStartUnderConcurrencyMode('agent', { tool: 'agent', model: null }), true);
  });
  queue.stop();
});

test("'per-model-one-at-a-time' gates every model", () => {
  beforeEach();
  const queue = buildQueue();
  withConcurrency({ agent: 'per-model-one-at-a-time' }, () => {
    queue.processing.set('a', { id: 'a', tool: 'agent', model: 'claude-sonnet-4-5' });
    assert.equal(queue.canStartUnderConcurrencyMode('agent', { tool: 'agent', model: 'claude-sonnet-4-5' }), false);
    assert.equal(queue.canStartUnderConcurrencyMode('agent', { tool: 'agent', model: 'minimax-m2.5-free' }), true);
  });
  queue.stop();
});

test('unknown concurrency mode falls back to permissive', () => {
  beforeEach();
  const queue = buildQueue();
  withConcurrency({ agent: 'totally-bogus-mode' }, () => {
    queue.processing.set('a', { id: 'a', tool: 'agent', model: 'minimax-m2.5-free' });
    assert.equal(queue.canStartUnderConcurrencyMode('agent', { tool: 'agent', model: 'minimax-m2.5-free' }), true);
  });
  queue.stop();
});

// ============================================================================
// findStartableItems — integration with the concurrency gate
// ============================================================================

console.log('\n📋 findStartableItems gating (R1, R2, R5)\n');

await asyncTest('R1: agent default (global-one-at-a-time) makes only 1 of 2 startable', async () => {
  beforeEach();
  const queue = buildQueue();
  queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'minimax-m2.5-free' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'gpt-5-nano' });

  const first = await queue.findStartableItems();
  const agentStarts = first.filter(s => s.tool === 'agent');
  assert.equal(agentStarts.length, 1, 'Only one agent item is startable at a time');

  // Simulate the first item moving to processing
  queue.processing.set(agentStarts[0].item.id, agentStarts[0].item);
  // Remove it from the queue so findStartableItems considers the next head
  const aq = queue.getToolQueue('agent');
  const idx = aq.findIndex(i => i.id === agentStarts[0].item.id);
  if (idx !== -1) aq.splice(idx, 1);

  const second = await queue.findStartableItems();
  const agentStartsAgain = second.filter(s => s.tool === 'agent');
  assert.equal(agentStartsAgain.length, 0, 'Second agent item still blocked while first is processing');
  queue.stop();
});

await asyncTest('R2: per-free-model mode lets two different free models start in parallel', async () => {
  beforeEach();
  const queue = buildQueue();
  await withConcurrency({ agent: 'per-free-model-one-at-a-time' }, async () => {
    queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'minimax-m2.5-free' });
    queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'gpt-5-nano-free' });

    // First pass: head of queue is minimax-m2.5-free (normalized to opencode/...)
    // per-free-model has 0 in-flight for that key, so startable.
    const first = await queue.findStartableItems();
    assert.equal(first.length, 1, 'Only the head of each tool queue is considered per cycle');
    assert.equal(first[0].item.model, 'opencode/minimax-m2.5-free');

    // Move first item into processing
    queue.processing.set(first[0].item.id, first[0].item);
    queue.getToolQueue('agent').shift();

    // Second pass: head is gpt-5-nano-free — different free model (unknown alias
    // so it stays as 'gpt-5-nano-free'), still startable in parallel.
    const second = await queue.findStartableItems();
    assert.equal(second.length, 1, 'Different free model is independently startable');
    assert.equal(second[0].item.model, 'gpt-5-nano-free');
  });
  queue.stop();
});

await asyncTest('R2: per-free-model mode blocks two items with the SAME free model', async () => {
  beforeEach();
  const queue = buildQueue();
  await withConcurrency({ agent: 'per-free-model-one-at-a-time' }, async () => {
    queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'minimax-m2.5-free' });
    queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'minimax-m2.5-free' });

    const first = await queue.findStartableItems();
    assert.equal(first.length, 1, 'First minimax item is startable');

    // Move it into processing and pop it from the queue
    queue.processing.set(first[0].item.id, first[0].item);
    queue.getToolQueue('agent').shift();

    const second = await queue.findStartableItems();
    const blocked = second.filter(s => s.tool === 'agent');
    assert.equal(blocked.length, 0, 'Second same-free-model item is blocked while first is in-flight');
  });
  queue.stop();
});

await asyncTest('R5: claude default (off) does not gate concurrent same-model items', async () => {
  beforeEach();
  const queue = buildQueue();
  // Claude default is 'off'; two claude items should both be startable.
  queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'u', infoBlock: 'i', tool: 'claude', model: 'claude-sonnet-4-5' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'u', infoBlock: 'i', tool: 'claude', model: 'claude-sonnet-4-5' });

  const first = await queue.findStartableItems();
  // findStartableItems only ever returns the head of each tool queue per pass,
  // so we expect 1 claude entry. But it should NOT be blocked by an in-flight
  // claude item — verify by simulating one in processing and checking the head
  // is still permitted.
  assert.equal(first.length, 1, 'Head-of-queue claude item is startable');

  queue.processing.set(first[0].item.id, first[0].item);
  queue.getToolQueue('claude').shift();

  const second = await queue.findStartableItems();
  const claudeStarts = second.filter(s => s.tool === 'claude');
  assert.equal(claudeStarts.length, 1, 'A second claude item starts even while first is in-flight (off mode)');
  queue.stop();
});

await asyncTest('cross-tool isolation: agent gate does NOT block claude/codex', async () => {
  beforeEach();
  const queue = buildQueue();
  // Pretend an agent item is in-flight; with default global-one-at-a-time on agent
  // this would block additional agent starts but must NOT affect claude.
  queue.processing.set('agent-in-flight', { id: 'agent-in-flight', tool: 'agent', model: 'minimax-m2.5-free' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/1', args: '', requester: 'u', infoBlock: 'i', tool: 'claude' });
  queue.enqueue({ url: 'https://github.com/test/repo/issues/2', args: '', requester: 'u', infoBlock: 'i', tool: 'agent', model: 'gpt-5-nano-free' });

  const startables = await queue.findStartableItems();
  const claudeStarts = startables.filter(s => s.tool === 'claude');
  const agentStarts = startables.filter(s => s.tool === 'agent');
  assert.equal(claudeStarts.length, 1, 'Claude is unaffected by agent gating');
  assert.equal(agentStarts.length, 0, 'Agent is blocked by its global-one-at-a-time mode');
  queue.stop();
});

// ============================================================================
console.log('\n📊 Test Results\n');
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
console.log(`Total tests: ${testsPassed + testsFailed}`);

if (testsFailed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
