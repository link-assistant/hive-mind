/**
 * @hive-mind-test-suite default
 * Issue #2838: `hive --concurrency 2` started two workers inside a container capped at 2.92 GiB,
 * so each solve (agent, subagents and cargo) had about 1.5 GiB and was OOM-killed. The startup
 * checks cap `--concurrency` so every worker gets at least the per-worker minimum of the cgroup limit.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_MIN_MEMORY_PER_WORKER_MB, capConcurrencyForMemory, planConcurrencyForMemory, resolveMinMemoryPerWorkerMB } from '../src/hive-concurrency-memory.lib.mjs';
import { runStartupChecks } from '../src/hive.startup-checks.lib.mjs';

const LIMITED = { availableMB: 224, hostAvailableMB: 11117, limitedBy: 'cgroup', cgroup: { version: 2, limitMB: 2990, currentMB: 2765, swapLimitMB: 0 } };
const UNLIMITED = { availableMB: 11117, hostAvailableMB: 11117, limitedBy: 'host', cgroup: null };

test('the per-worker minimum defaults to 2048MB, comes from the option or the environment, and 0 turns the cap off', () => {
  assert.equal(DEFAULT_MIN_MEMORY_PER_WORKER_MB, 2048);
  assert.equal(resolveMinMemoryPerWorkerMB({}, {}), 2048);
  assert.equal(resolveMinMemoryPerWorkerMB({}, { HIVE_MIND_MIN_MEMORY_PER_WORKER: '1024' }), 1024);
  assert.equal(resolveMinMemoryPerWorkerMB({ minMemoryPerWorker: 512 }, { HIVE_MIND_MIN_MEMORY_PER_WORKER: '1024' }), 512, 'the option wins');
  assert.equal(resolveMinMemoryPerWorkerMB({ minMemoryPerWorker: 0 }, {}), 0);
  assert.equal(resolveMinMemoryPerWorkerMB({}, { HIVE_MIND_MIN_MEMORY_PER_WORKER: 'lots' }), 2048, 'an invalid value keeps the default');
});

test('the incident: 2 workers in a 2990MB cgroup are capped to 1', () => {
  const plan = planConcurrencyForMemory({ concurrency: 2, effective: LIMITED, minPerWorkerMB: 2048 });
  assert.equal(plan.concurrency, 1);
  assert.equal(plan.capped, true);
  assert.equal(plan.perWorkerMB, 1495);
});

test('enough memory, no cgroup limit, or the cap turned off keep --concurrency', () => {
  assert.equal(planConcurrencyForMemory({ concurrency: 4, effective: { ...LIMITED, cgroup: { ...LIMITED.cgroup, limitMB: 16384 } }, minPerWorkerMB: 2048 }).capped, false);
  assert.equal(planConcurrencyForMemory({ concurrency: 8, effective: UNLIMITED, minPerWorkerMB: 2048 }).capped, false);
  assert.equal(planConcurrencyForMemory({ concurrency: 2, effective: null, minPerWorkerMB: 2048 }).capped, false);
  assert.equal(planConcurrencyForMemory({ concurrency: 2, effective: LIMITED, minPerWorkerMB: 0 }).capped, false);
});

test('a limit below one worker minimum keeps 1 worker and warns', () => {
  const plan = planConcurrencyForMemory({ concurrency: 3, effective: { ...LIMITED, cgroup: { ...LIMITED.cgroup, limitMB: 1024 } }, minPerWorkerMB: 2048 });
  assert.equal(plan.concurrency, 1);
  assert.equal(plan.capped, true);
  assert.equal(plan.belowMinimum, true);
});

test('capConcurrencyForMemory lowers argv.concurrency and logs why', async () => {
  const logs = [];
  const argv = { concurrency: 2 };
  const plan = await capConcurrencyForMemory({ argv, env: {}, log: async message => logs.push(message), readEffectiveMemory: () => LIMITED });
  assert.equal(argv.concurrency, 1);
  assert.equal(plan.capped, true);
  const text = logs.join('\n');
  assert.match(text, /--concurrency 2 lowered to 1/);
  assert.match(text, /2990MB cgroup memory limit/);
  assert.match(text, /--min-memory-per-worker/);
});

test('runStartupChecks applies the cap before the workers start, even when the other checks are skipped', async () => {
  const argv = { concurrency: 2, dryRun: true };
  const result = await runStartupChecks({ argv, log: async () => {}, safeExit: async () => {}, readEffectiveMemory: () => LIMITED });
  assert.equal(result.skipped, true);
  assert.equal(argv.concurrency, 1);
});
