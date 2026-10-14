/**
 * @hive-mind-test-suite default
 * Issue #3207: killing a timed-out `docker pull` makes the daemon cancel it,
 * and the layers it already fetched stay held by a containerd lease (about
 * 17 GB for 6 hours on the reporting host). A pull now runs detached: the
 * caller stops waiting when the budget elapses, but the pull itself finishes,
 * so its layers become an image the next task finds locally.
 *
 * `docker` is never executed: `spawnImpl` stands in a short Node.js script for
 * it, which is enough to prove the process survives the timeout.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/3207
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { pullDockerImage, startDetachedDockerPull } from '../src/docker-pull-detached.lib.mjs';
import { FORMAL_AI_IMAGE_SOURCES, classifyDockerRegistryError, ensureFormalAiSidecarImage } from '../src/formal-ai-image.lib.mjs';
import { FORMAL_AI_BOOTSTRAP_VERSION } from '../src/formal-ai-version.lib.mjs';

/** A `spawnImpl` that runs `script` with Node.js in place of `docker`. */
const fakeDocker =
  (script, seen = []) =>
  (command, args, options) => {
    seen.push({ command, args, options });
    return spawn(process.execPath, ['-e', script], options);
  };

const waitFor = async (predicate, timeoutMs = 10_000) => {
  const deadline = Date.now() + timeoutMs;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 25));
  return predicate();
};

test('a pull that finishes in time resolves with its output and runs detached from the caller', async () => {
  const seen = [];
  const result = await startDetachedDockerPull(['pull', 'example/image:1'], { timeoutMs: 10_000, spawnImpl: fakeDocker("console.log('Status: Downloaded newer image for example/image:1')", seen) });
  assert.match(result.stdout, /Downloaded newer image/);
  assert.deepEqual(seen[0].args, ['pull', 'example/image:1']);
  assert.equal(seen[0].command, 'docker');
  assert.equal(seen[0].options.detached, true);
  assert.equal(seen[0].options.stdio[0], 'ignore', 'no pipe ties the pull to this process');
});

test('a refused pull rejects with its own output, which still classifies', async () => {
  const error = await startDetachedDockerPull(['pull', 'example/private:1'], { timeoutMs: 10_000, spawnImpl: fakeDocker("console.error('Error response from daemon: error from registry: unauthorized'); process.exit(1)") }).catch(caught => caught);
  assert.ok(error instanceof Error);
  assert.equal(error.code, 1);
  assert.match(error.stderr, /unauthorized/);
  assert.equal(error.continuesInBackground, undefined);
  assert.equal(classifyDockerRegistryError(error.stderr, { error }).kind, 'unauthorized');
});

test('a pull that outlives the budget is not killed: it keeps running and finishes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-mind-3207-pull-'));
  const marker = path.join(dir, 'finished');
  try {
    const script = `setTimeout(() => require('fs').writeFileSync(${JSON.stringify(marker)}, 'done'), 600)`;
    const startedAt = Date.now();
    const error = await startDetachedDockerPull(['pull', 'example/huge:1'], { timeoutMs: 100, spawnImpl: fakeDocker(script) }).catch(caught => caught);
    assert.ok(Date.now() - startedAt < 550, 'the caller stops waiting at the budget');
    assert.equal(error.code, 'ETIMEDOUT');
    assert.equal(error.continuesInBackground, true);
    assert.ok(Number.isInteger(error.pid));
    assert.match(error.message, /continues in the background/);
    assert.equal(fs.existsSync(marker), false, 'the pull is still running when the caller gives up');
    assert.equal(await waitFor(() => fs.existsSync(marker)), true, 'the pull ran to completion instead of being killed');

    const diagnosis = classifyDockerRegistryError(error.stderr, { error, timeoutMs: 600_000 });
    assert.equal(diagnosis.kind, 'timeout');
    assert.match(diagnosis.reason, /did not finish in 10 min; it continues in the background/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('pullDockerImage keeps a test stub in charge and detaches only the real runner', async () => {
  const calls = [];
  const run = async (command, args, options) => {
    calls.push({ command, args, options });
    return { stdout: 'stubbed' };
  };
  assert.deepEqual(await pullDockerImage(['pull', 'example/image:1'], { run, timeoutMs: 5_000 }), { stdout: 'stubbed' });
  assert.deepEqual(calls, [{ command: 'docker', args: ['pull', 'example/image:1'], options: { encoding: 'utf8', timeout: 5_000 } }]);

  const seen = [];
  const result = await pullDockerImage(['pull', 'example/image:2'], { timeoutMs: 10_000, spawnImpl: fakeDocker("console.log('pulled')", seen) });
  assert.equal(result.stdout, 'pulled');
  assert.equal(seen[0].options.detached, true);
});

test('a sidecar pull still running in the background is a timeout without the containerd lease warning', async () => {
  const REPOSITORY = 'ghcr.io/link-assistant/formal-ai';
  const env = { HIVE_MIND_IMAGE_VARIANT: 'dind', HIVE_MIND_DOCKER_ISOLATION_IMAGE_TAG: '2.35.9' };
  const continuing = image => Object.assign(new Error(`docker pull ${image} did not finish in time; it continues in the background (pid 42)`), { code: 'ETIMEDOUT', continuesInBackground: true, pid: 42, stdout: '', stderr: '' });
  const run = async (command, args) => {
    if (args[0] === 'pull') throw continuing(args[args.length - 1]);
    throw Object.assign(new Error('No such image'), { stderr: 'Error: No such image' });
  };
  const logs = [];
  const error = await ensureFormalAiSidecarImage({ env, run, timeoutMs: 600_000, log: async line => logs.push(line) }).catch(caught => caught);
  assert.ok(error instanceof Error);
  const pulled = error.formalAiImageAttempts.filter(attempt => attempt.source === FORMAL_AI_IMAGE_SOURCES.PUBLISHED);
  assert.deepEqual(
    pulled.map(attempt => attempt.image),
    [`${REPOSITORY}:${FORMAL_AI_BOOTSTRAP_VERSION}-slim`, `${REPOSITORY}:${FORMAL_AI_BOOTSTRAP_VERSION}`]
  );
  assert.deepEqual(
    pulled.map(attempt => attempt.kind),
    ['timeout', 'timeout']
  );
  assert.match(error.message, /continues in the background/);
  assert.doesNotMatch(logs.join('\n'), /containerd lease/, 'nothing was cancelled, so nothing is leased');
});
