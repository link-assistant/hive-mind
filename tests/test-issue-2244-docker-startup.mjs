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
import { buildDockerIsolationStartArgs, buildDockerStartGatedCommand, DOCKER_SIZE_INSPECT_TIMEOUT_MS, getDockerContainerWritableLayerSize } from '../src/isolation-runner.lib.mjs';

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

const launchArgs = ({ verbose = false, args = ['https://example.test/issues/2244'], env = { HIVE_MIND_IMAGE_VARIANT: 'dind' } } = {}) =>
  buildDockerIsolationStartArgs('solve', args, {
    sessionId: `issue-2244-${verbose ? 'verbose' : 'quiet'}`,
    tool: 'claude',
    verbose,
    env,
    homeDir: '/missing',
    existsSync: () => false,
  });

await test('DinD launches retain the daemon startup log by default', () => {
  // Issue #2244: the incident log held ONE dockerd line because box sends the
  // daemon to /var/log/dockerd.log inside the container, which dies with it.
  // Quiet runs are exactly the ones nobody is watching, so they need it most.
  assert.equal(launchArgs().includes('DIND_LOG_FILE=/dev/stderr'), true);
  assert.equal(launchArgs({ verbose: true }).includes('DIND_LOG_FILE=/dev/stderr'), true);
  assert.equal(launchArgs({ args: ['https://example.test/issues/2244', '--verbose'] }).includes('DIND_LOG_FILE=/dev/stderr'), true);
});

await test('the daemon startup log can be switched off per deployment', () => {
  for (const value of ['0', 'off', 'false', 'no']) {
    assert.equal(launchArgs({ env: { HIVE_MIND_IMAGE_VARIANT: 'dind', HIVE_MIND_DIND_DAEMON_LOG: value } }).includes('DIND_LOG_FILE=/dev/stderr'), false, `HIVE_MIND_DIND_DAEMON_LOG=${value} must disable the daemon log`);
  }
  assert.equal(launchArgs({ env: { HIVE_MIND_IMAGE_VARIANT: 'dind', HIVE_MIND_DIND_DAEMON_LOG: '1' } }).includes('DIND_LOG_FILE=/dev/stderr'), true);
});

await test('a non-DinD image never receives the daemon log switch', () => {
  assert.equal(launchArgs({ env: {} }).includes('DIND_LOG_FILE=/dev/stderr'), false);
});

await test('the start gate announces its own waiting, outcome and hand-off', () => {
  // Issue #2244's container was SIGKILLed inside this loop and the preserved
  // log proved it only by absence: the gate printed nothing at all, so there
  // was no way to tell "still gated" from "task started and died instantly".
  const gated = buildDockerStartGatedCommand("'solve' 'https://example.test'", 'issue-2244-gate');
  assert.match(gated, /hive-mind\] start-gate: waiting/);
  assert.match(gated, /hive-mind\] start-gate: still waiting/);
  assert.match(gated, /hive-mind\] start-gate: released/);
  assert.match(gated, /hive-mind\] start-gate: not released/);
  assert.match(gated, /hive-mind\] start-gate: starting task command/);
  // Every marker goes to stderr so the task's own stdout stays byte-identical.
  assert.equal(/echo "\[hive-mind\][^"]*"(?! >&2)/.test(gated), false, 'gate markers must be redirected to stderr');
  // The wait semantics themselves are unchanged: same gate path, same bound.
  assert.match(gated, /\[ ! -e "\$gate" \] && \[ "\$i" -lt 300 \]/);
  assert.match(gated, /rm -f "\$gate"; /);
  assert.ok(gated.trimEnd().endsWith("exec 'solve' 'https://example.test'"));
});

await test('a session without an id keeps an ungated, unannotated command', () => {
  assert.equal(buildDockerStartGatedCommand("'solve'", null), "'solve'");
});

await test('the gate markers are POSIX shell, and report the released path', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const fs = await import('node:fs');
  const run = promisify(execFile);
  const sessionId = `issue-2244-shell-${process.pid}`;
  fs.writeFileSync(`/tmp/hive-mind-disk-baseline-${sessionId}`, '');
  const script = buildDockerStartGatedCommand("echo 'task ran'", sessionId);
  const { stdout, stderr } = await run('sh', ['-c', script], { encoding: 'utf8' });
  assert.equal(stdout.trim(), 'task ran');
  assert.match(stderr, /start-gate: waiting/);
  assert.match(stderr, /start-gate: released after/);
  assert.match(stderr, /start-gate: starting task command/);
  assert.equal(fs.existsSync(`/tmp/hive-mind-disk-baseline-${sessionId}`), false, 'the gate file is still consumed');
});

await test('an unreleased gate reports the timeout and still starts the task', async () => {
  const { execFile } = await import('node:child_process');
  const { promisify } = await import('node:util');
  const run = promisify(execFile);
  // 3 tenths instead of 300 so the timeout branch is testable in 0.3s.
  const script = buildDockerStartGatedCommand("echo 'task ran'", `issue-2244-timeout-${process.pid}`, { waitTenths: 3 });
  const { stdout, stderr } = await run('sh', ['-c', script], { encoding: 'utf8' });
  assert.equal(stdout.trim(), 'task ran');
  assert.match(stderr, /start-gate: not released within/);
  assert.match(stderr, /start-gate: starting task command/);
});

console.log(`issue #2244 Docker startup: ${passed} passed, ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;
