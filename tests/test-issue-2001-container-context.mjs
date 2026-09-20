#!/usr/bin/env node
/**
 * Issue #2001 execution-context detection tests.
 *
 * The solve command must detect where it is running so that per-task disk usage
 * is scoped to the container context (the cloned working tree + Docker
 * writable-layer size) instead of the whole host/VM filesystem. These tests
 * exercise the pure `detectExecutionContext()` / `formatExecutionContextForLog()`
 * helpers with injected filesystem and environment stubs.
 *
 * Run with: node tests/test-issue-2001-container-context.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2001
 */

import assert from 'node:assert/strict';

import { RESOURCE_PHASE_SOLVE_START, detectExecutionContext, formatExecutionContextForLog, recordResourceSnapshot } from '../src/solve.resource-diagnostics.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    passed++;
  } catch (error) {
    console.error(`❌ ${name}`);
    console.error(error?.stack || error);
    failed++;
  }
}

function fsWith({ files = {}, contents = {} } = {}) {
  return {
    existsSync: target => Object.prototype.hasOwnProperty.call(files, target) && files[target] === true,
    readFileSync: target => {
      if (Object.prototype.hasOwnProperty.call(contents, target)) return contents[target];
      throw new Error(`ENOENT: ${target}`);
    },
  };
}

await test('detects Docker via /.dockerenv marker', () => {
  const ctx = detectExecutionContext({
    ...fsWith({ files: { '/.dockerenv': true } }),
    env: {},
    platform: 'linux',
  });
  assert.equal(ctx.inContainer, true);
  assert.equal(ctx.runtime, 'docker');
  assert.ok(ctx.indicators.includes('/.dockerenv'));
});

await test('detects Docker via /proc/1/cgroup content', () => {
  const ctx = detectExecutionContext({
    ...fsWith({ contents: { '/proc/1/cgroup': '12:pids:/docker/abc123\n11:memory:/docker/abc123\n' } }),
    env: {},
    platform: 'linux',
  });
  assert.equal(ctx.inContainer, true);
  assert.equal(ctx.runtime, 'docker');
  assert.ok(ctx.indicators.includes('cgroup:docker'));
});

await test('detects Kubernetes via cgroup and env', () => {
  const ctx = detectExecutionContext({
    ...fsWith({ contents: { '/proc/1/cgroup': '11:memory:/kubepods/pod-xyz\n' } }),
    env: { KUBERNETES_SERVICE_HOST: '10.0.0.1' },
    platform: 'linux',
  });
  assert.equal(ctx.inContainer, true);
  assert.ok(ctx.indicators.includes('cgroup:kubepods'));
  assert.ok(ctx.indicators.includes('env:kubernetes'));
});

await test('reports host when no container signals are present', () => {
  const ctx = detectExecutionContext({
    ...fsWith({ contents: { '/proc/1/cgroup': '0::/init.scope\n' } }),
    env: {},
    platform: 'linux',
  });
  assert.equal(ctx.inContainer, false);
  assert.equal(ctx.runtime, null);
  assert.deepEqual(ctx.indicators, []);
});

await test('is defensive against fs impls that throw or lack methods', () => {
  const ctx = detectExecutionContext({
    existsSync: () => {
      throw new Error('boom');
    },
    readFileSync: undefined,
    env: null,
    platform: 'linux',
  });
  assert.equal(ctx.inContainer, false);
  assert.equal(ctx.runtime, null);
});

await test('formats container and host context lines distinctly', () => {
  const container = formatExecutionContextForLog({ inContainer: true, runtime: 'docker', indicators: ['/.dockerenv'] });
  assert.match(container, /Execution context: docker container/);
  assert.match(container, /scoped to this container/);
  assert.match(container, /\/\.dockerenv/);

  const host = formatExecutionContextForLog({ inContainer: false, runtime: null, indicators: [] });
  assert.match(host, /Execution context: host/);
  assert.match(host, /scoped to the working tree/);
});

await test('recordResourceSnapshot logs execution context when requested', async () => {
  const lines = [];
  await recordResourceSnapshot({
    phase: RESOURCE_PHASE_SOLVE_START,
    log: async text => {
      lines.push(text);
    },
    diskPath: '/',
    label: 'solve start',
    logExecutionContext: true,
    capture: () => ({ phase: RESOURCE_PHASE_SOLVE_START, timestamp: '2026-07-01T00:00:00.000Z', cpu: {}, memory: {}, disk: { path: '/' } }),
    detectContext: () => ({ inContainer: true, runtime: 'docker', indicators: ['/.dockerenv'] }),
  });
  assert.ok(
    lines.some(line => /Execution context: docker container/.test(line)),
    'context line is logged'
  );
  assert.ok(
    lines.some(line => /Resource usage/.test(line)),
    'resource snapshot is still logged'
  );
});

await test('recordResourceSnapshot skips context logging by default', async () => {
  const lines = [];
  await recordResourceSnapshot({
    phase: RESOURCE_PHASE_SOLVE_START,
    log: async text => {
      lines.push(text);
    },
    capture: () => ({ phase: RESOURCE_PHASE_SOLVE_START, timestamp: '2026-07-01T00:00:00.000Z', cpu: {}, memory: {}, disk: { path: '/' } }),
    detectContext: () => {
      throw new Error('detectContext must not be called when logExecutionContext is false');
    },
  });
  assert.ok(!lines.some(line => /Execution context/.test(line)), 'no context line without the flag');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
