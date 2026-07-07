#!/usr/bin/env node
/**
 * Regression coverage for issue #2015 follow-up queue-stability requirements.
 *
 * Verifies that task startup pacing is global across tool queues and that host
 * resource metrics cannot be cached for more than one minute.
 */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

import { QUEUE_CONFIG, SolveQueue } from '../src/telegram-solve-queue.lib.mjs';
import { resetLimitCache, CACHE_TTL } from '../src/limits.lib.mjs';

let assertions = 0;

function assertTrue(value, message) {
  assertions++;
  assert.equal(Boolean(value), true, message);
}

function assertEqual(actual, expected, message) {
  assertions++;
  assert.equal(actual, expected, message);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`ok - ${name}`);
  } catch (error) {
    console.error(`not ok - ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function createStableQueue() {
  resetLimitCache();
  const queue = new SolveQueue({
    verbose: false,
    autoStart: false,
    getRunningProcesses: async () => ({ count: 0 }),
    getRunningIsolatedSessions: async () => ({ count: 0, byTool: {} }),
  });
  queue.checkSystemResources = async () => ({
    ok: true,
    reasons: [],
    oneAtATime: false,
    rejected: false,
    rejectReason: null,
  });
  queue.checkApiLimits = async () => ({
    ok: true,
    reasons: [],
    oneAtATime: false,
    rejected: false,
    rejectReason: null,
  });
  return queue;
}

function readSpawnedNumber(moduleRelativePath, exportExpression, env) {
  const moduleUrl = pathToFileURL(resolve(moduleRelativePath)).href;
  const script = `const mod = await import(${JSON.stringify(moduleUrl)}); console.log(${exportExpression});`;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(),
    env: { ...process.env, ...env },
    encoding: 'utf8',
  });
  assertEqual(result.status, 0, result.stderr || 'spawned import should succeed');
  const match = result.stdout.match(/(-?\d+)\s*$/);
  assertTrue(match, `spawned import should end with a number, got stdout: ${result.stdout}`);
  return Number(match[1]);
}

await test('queue startup interval defaults to a 10-minute minimum', async () => {
  assertEqual(QUEUE_CONFIG.MIN_START_INTERVAL_MS, 10 * 60 * 1000, 'default startup interval should be 10 minutes');
});

await test('queue startup interval cannot be configured below 10 minutes', async () => {
  const value = readSpawnedNumber('src/queue-config.lib.mjs', 'mod.QUEUE_CONFIG.MIN_START_INTERVAL_MS', {
    HIVE_MIND_MIN_START_INTERVAL_MS: '60000',
  });
  assertEqual(value, 10 * 60 * 1000, 'configured startup interval should be clamped to 10 minutes');
});

await test('minimum startup interval is global across tools', async () => {
  const queue = createStableQueue();
  queue.lastStartTimeByTool.claude = Date.now();
  queue.lastStartTime = Date.now();

  const agentCheck = await queue.canStartCommand({ tool: 'agent' });
  assertEqual(agentCheck.canStart, false, 'agent task should not bypass a recent claude startup');
  assertTrue(
    agentCheck.reasons.some(reason => reason.includes('Minimum interval')),
    'agent task should report min-interval waiting reason'
  );

  queue.stop();
});

await test('reserved direct starts enforce the same minimum startup interval', async () => {
  const queue = createStableQueue();

  const firstCheck = await queue.reserveStartSlot({ tool: 'codex' });
  assertEqual(firstCheck.canStart, true, 'first idle codex command should reserve an immediate direct start');
  assertEqual(firstCheck.startReserved, true, 'successful direct start should report a reserved startup slot');
  assertTrue(queue.lastStartTime !== null, 'reserved direct start should update the global last start timestamp');
  assertTrue(queue.lastStartTimeByTool.codex !== null, 'reserved direct start should update the tool last start timestamp');

  const secondCheck = await queue.reserveStartSlot({ tool: 'codex' });
  assertEqual(secondCheck.canStart, false, 'second immediate codex command should be throttled by the reserved startup slot');
  assertEqual(secondCheck.startReserved, false, 'throttled direct start should not reserve a startup slot');
  assertTrue(
    secondCheck.reasons.some(reason => reason.includes('Minimum interval')),
    'second direct start should report the min-interval waiting reason'
  );

  queue.stop();
});

await test('concurrent direct start reservations still allow only one immediate startup', async () => {
  const queue = createStableQueue();

  const results = await Promise.all([queue.reserveStartSlot({ tool: 'codex' }), queue.reserveStartSlot({ tool: 'codex' })]);
  const reservedCount = results.filter(result => result.startReserved).length;
  const throttledCount = results.filter(result => !result.canStart && result.reasons.some(reason => reason.includes('Minimum interval'))).length;

  assertEqual(reservedCount, 1, 'only one concurrent direct start should reserve the startup slot');
  assertEqual(throttledCount, 1, 'the other concurrent direct start should be throttled by min interval');

  queue.stop();
});

await test('telegram direct solve path uses reserved startup slots', async () => {
  const source = readFileSync(resolve('src/telegram-bot.mjs'), 'utf8');

  assertTrue(/reserveStartSlot\(\{\s*tool:\s*solveTool,\s*locale:\s*solveLocale\s*\}\)/.test(source), 'telegram direct solve path should reserve the startup slot before immediate execution');
  assertTrue(/check\.canStart\s*&&\s*check\.startReserved/.test(source), 'telegram direct solve path should launch immediately only after a successful reservation');
  assertTrue(!/check\.canStart\s*&&\s*toolQueuedCount\s*===\s*0/.test(source), 'telegram direct solve path should not bypass pacing based only on an empty tool queue');
});

await test('findStartableItems returns only one task across tool queues', async () => {
  const queue = createStableQueue();
  const first = queue.enqueue({
    url: 'https://github.com/test/repo/issues/1',
    args: '',
    requester: 'tester',
    infoBlock: 'First',
    tool: 'claude',
  });
  const second = queue.enqueue({
    url: 'https://github.com/test/repo/issues/2',
    args: '',
    requester: 'tester',
    infoBlock: 'Second',
    tool: 'agent',
  });
  first.createdAt = new Date('2026-07-05T00:00:00.000Z');
  second.createdAt = new Date('2026-07-05T00:00:01.000Z');

  const startable = await queue.findStartableItems();
  assertEqual(startable.length, 1, 'only one task should be eligible for a startup cycle');
  assertEqual(startable[0].item.id, first.id, 'oldest startable task should win the global startup slot');

  queue.stop();
});

await test('system metric cache TTL defaults to one minute', async () => {
  assertEqual(CACHE_TTL.SYSTEM, 60 * 1000, 'system metric cache TTL should default to 1 minute');
});

await test('system metric cache TTL cannot be configured above one minute', async () => {
  const value = readSpawnedNumber('src/limits.lib.mjs', 'mod.CACHE_TTL.SYSTEM', {
    HIVE_MIND_SYSTEM_CACHE_TTL_MS: String(5 * 60 * 1000),
  });
  assertEqual(value, 60 * 1000, 'system metric cache TTL should be capped to 1 minute');
});

if (process.exitCode) {
  console.error(`Failed after ${assertions} assertions`);
  process.exit(process.exitCode);
}

console.log(`Issue #2015 queue stability tests passed (${assertions} assertions)`);
