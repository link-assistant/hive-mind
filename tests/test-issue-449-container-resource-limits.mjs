#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Regression tests for issue #449. Docker isolation already exists through
 * start-command; these tests cover the missing additive resource controls.
 */

import assert from 'node:assert/strict';

import { applyDockerContainerResourceLimits, buildDockerUpdateArgs, detectContainerDiskLimitBreach, normalizeContainerResourceLimits, resolveContainerResourceLimits } from '../src/container-resource-limits.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS: ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL: ${name}`);
    console.error(error?.stack || error);
    failed++;
  }
}

await test('omitted limits preserve the current unlimited behavior', () => {
  const normalized = normalizeContainerResourceLimits({});
  assert.deepEqual(normalized, { cpu: null, memory: null, disk: null });
  assert.deepEqual(
    resolveContainerResourceLimits(normalized, {
      cpuCores: 8,
      memoryBytes: 16 * 1024 ** 3,
      diskBytes: 100 * 1024 ** 3,
    }),
    {
      cpuCores: null,
      memoryBytes: null,
      diskBytes: null,
      requested: normalized,
    }
  );
});

await test('fixed CPU, RAM, and disk values resolve without defaults', () => {
  const requested = normalizeContainerResourceLimits({ cpu: '1.5', memory: '512MiB', disk: '20GB' });
  assert.deepEqual(requested, { cpu: '1.5', memory: '512MiB', disk: '20GB' });
  assert.deepEqual(
    resolveContainerResourceLimits(requested, {
      cpuCores: 8,
      memoryBytes: 16 * 1024 ** 3,
      diskBytes: 100 * 1024 ** 3,
    }),
    {
      cpuCores: 1.5,
      memoryBytes: 512 * 1024 ** 2,
      diskBytes: 20_000_000_000,
      requested,
    }
  );
});

await test('percentages resolve against host CPU, RAM, and available disk', () => {
  const requested = normalizeContainerResourceLimits({ cpu: '25%', memory: '50%', disk: '10%' });
  assert.deepEqual(
    resolveContainerResourceLimits(requested, {
      cpuCores: 8,
      memoryBytes: 16 * 1024 ** 3,
      diskBytes: 100_000_000_000,
    }),
    {
      cpuCores: 2,
      memoryBytes: 8 * 1024 ** 3,
      diskBytes: 10_000_000_000,
      requested,
    }
  );
  assert.equal(resolveContainerResourceLimits({ cpu: '25%' }, { cpuCores: 6 }).cpuCores, 1.5, 'CPU percentage retains fractional cores');
});

await test('invalid and unsafe values are rejected before a container starts', () => {
  assert.throws(() => normalizeContainerResourceLimits({ cpu: '0' }), /greater than zero/i);
  assert.throws(() => normalizeContainerResourceLimits({ memory: 'five gigs' }), /memory/i);
  assert.throws(() => normalizeContainerResourceLimits({ disk: '101%' }), /between 0 and 100/i);
});

await test('Docker update contains only explicitly configured enforceable limits', () => {
  assert.deepEqual(buildDockerUpdateArgs({ cpuCores: null, memoryBytes: null, diskBytes: null }), []);
  assert.deepEqual(buildDockerUpdateArgs({ cpuCores: 1.5, memoryBytes: 512 * 1024 ** 2, diskBytes: 20_000_000_000 }), ['update', '--cpus', '1.5', '--memory', String(512 * 1024 ** 2), '--memory-swap', String(512 * 1024 ** 2)]);
});

await test('limits are applied while the Docker start gate is closed', async () => {
  const calls = [];
  const result = await applyDockerContainerResourceLimits(
    'session-449',
    { cpu: '50%', memory: '25%', disk: '5%' },
    {
      capacity: { cpuCores: 4, memoryBytes: 8 * 1024 ** 3, diskBytes: 100_000_000_000 },
      runDocker: async args => {
        calls.push(args);
        return { success: true, error: null };
      },
    }
  );
  assert.equal(result.success, true);
  assert.deepEqual(calls, [['update', '--cpus', '2', '--memory', String(2 * 1024 ** 3), '--memory-swap', String(2 * 1024 ** 3), 'session-449']]);
  assert.equal(result.resolved.diskBytes, 5_000_000_000);
});

await test('disk quota detects only measurements above the configured limit', () => {
  assert.equal(detectContainerDiskLimitBreach({ limitBytes: null, observedBytes: 10 }), null);
  assert.equal(detectContainerDiskLimitBreach({ limitBytes: 100, observedBytes: 100 }), null);
  assert.deepEqual(detectContainerDiskLimitBreach({ limitBytes: 100, observedBytes: 101 }), {
    resource: 'disk',
    limitBytes: 100,
    observedBytes: 101,
  });
});

await test('resource limits fail closed on non-Docker isolation backends', async () => {
  const { executeWithIsolation } = await import('../src/isolation-runner.lib.mjs');
  const result = await executeWithIsolation('solve', ['https://github.com/o/r/issues/1'], {
    backend: 'screen',
    sessionId: 'issue-449-non-docker',
    containerResourceLimits: { cpu: '1' },
  });
  assert.equal(result.success, false);
  assert.match(result.error, /require the Docker isolation backend/i);
});

console.log(`\nTotal: ${passed + failed}, Passed: ${passed}, Failed: ${failed}`);
process.exit(failed > 0 ? 1 : 0);
