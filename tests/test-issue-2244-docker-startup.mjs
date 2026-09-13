#!/usr/bin/env node
/**
 * Regression tests for issue #2244: a Docker-isolated task can remain stuck in
 * its "starting" state when Docker's optional writable-layer size calculation
 * never returns. The start gate must always be released within a bounded time.
 *
 * @hive-mind-test-suite default
 * @see https://github.com/link-assistant/hive-mind/issues/2244
 */

import assert from 'node:assert/strict';
import { buildDockerIsolationStartArgs, DOCKER_SIZE_INSPECT_TIMEOUT_MS, getDockerContainerWritableLayerSize } from '../src/isolation-runner.lib.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
    passed++;
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error?.stack || error);
    failed++;
  }
}

await test('writable-layer inspection is delegated with a finite timeout', async () => {
  let invocation = null;
  const bytes = await getDockerContainerWritableLayerSize('issue-2244-container', false, {
    timeoutMs: 123,
    execFileImpl: async (...args) => {
      invocation = args;
      return { stdout: '4096\n', stderr: '' };
    },
  });

  assert.equal(bytes, 4096);
  assert.deepEqual(invocation?.slice(0, 2), ['docker', ['inspect', '--size', '-f', '{{.SizeRw}}', 'issue-2244-container']]);
  assert.equal(invocation?.[2]?.timeout, 123);
  assert.ok(Number.isFinite(invocation?.[2]?.maxBuffer));
});

await test('the production timeout is shorter than the 30-second child gate', () => {
  assert.ok(DOCKER_SIZE_INSPECT_TIMEOUT_MS > 0);
  assert.ok(DOCKER_SIZE_INSPECT_TIMEOUT_MS < 30_000);
});

await test('a timed-out inspection is non-fatal and observable in verbose mode', async () => {
  const lines = [];
  const originalLog = console.log;
  console.log = message => lines.push(String(message));
  try {
    const bytes = await getDockerContainerWritableLayerSize('issue-2244-timeout', true, {
      timeoutMs: 17,
      execFileImpl: async () => {
        throw Object.assign(new Error('Command timed out'), { killed: true, signal: 'SIGTERM' });
      },
    });
    assert.equal(bytes, null);
  } finally {
    console.log = originalLog;
  }
  assert.match(lines.join('\n'), /timed out after 17ms/);
  assert.match(lines.join('\n'), /start gate will still be released/);
});

await test('an invalid Docker size remains an unavailable best-effort metric', async () => {
  const bytes = await getDockerContainerWritableLayerSize('issue-2244-invalid', false, {
    execFileImpl: async () => ({ stdout: 'not-a-size\n', stderr: '' }),
  });
  assert.equal(bytes, null);
});

await test('verbose DinD launches expose daemon startup logs without changing the default', () => {
  const launchArgs = (verbose, args = ['https://example.test/issues/2244']) =>
    buildDockerIsolationStartArgs('solve', args, {
      sessionId: `issue-2244-${verbose ? 'verbose' : 'quiet'}`,
      tool: 'claude',
      verbose,
      env: { HIVE_MIND_IMAGE_VARIANT: 'dind' },
      homeDir: '/missing',
      existsSync: () => false,
    });

  assert.equal(launchArgs(false).includes('DIND_LOG_FILE=/dev/stderr'), false);
  assert.equal(launchArgs(true).includes('DIND_LOG_FILE=/dev/stderr'), true);
  assert.equal(launchArgs(false, ['https://example.test/issues/2244', '--verbose']).includes('DIND_LOG_FILE=/dev/stderr'), true);
});

console.log(`issue #2244 Docker startup: ${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
