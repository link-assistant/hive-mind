/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs/promises';

// Host-socket isolation needs a client in the launcher image even though the
// daemon lives outside it. Box's non-DinD image does not guarantee that client.
for (const file of ['Dockerfile', 'coolify/Dockerfile']) {
  test(`${file} supplies and verifies the host-socket Docker client`, async () => {
    const source = await fs.readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.ok(/COPY --from=docker:29\.9\.2-cli \/usr\/local\/bin\/docker \/usr\/local\/bin\/docker/u.test(source), 'the host-socket client must be installed explicitly');
    assert.ok(/^RUN docker --version$/mu.test(source), 'the image build must execute its client');
  });
}

test('running image verification requires a working Docker client', async () => {
  const source = await fs.readFile(new URL('../scripts/verify-docker-image.sh', import.meta.url), 'utf8');
  assert.ok(/^docker --version$/mu.test(source), 'runtime verification must execute its client');
});

test('missing packaged client fails before daemon retries without exposing exec output', async () => {
  const { waitForPackagedDockerDaemon } = await import('../scripts/docker-pr-daemon-ready.lib.mjs');
  const commands = [];
  await assert.rejects(
    waitForPackagedDockerDaemon({
      name: 'synthetic',
      variant: 'host',
      docker: async args => {
        commands.push(args);
        throw new Error('private-exec-output');
      },
    }),
    error => error.message === 'host image has no working Docker client; daemon verification cannot start.'
  );
  assert.deepEqual(commands, [['exec', 'synthetic', 'docker', '--version']]);
});

test('a packaged client is checked before waiting for a starting daemon', { timeout: 1000 }, async () => {
  const { waitForPackagedDockerDaemon } = await import('../scripts/docker-pr-daemon-ready.lib.mjs');
  const commands = [];
  let attempts = 0;
  await waitForPackagedDockerDaemon({
    name: 'synthetic',
    variant: 'nested',
    retryDelayMs: 0,
    docker: async args => {
      commands.push(args);
      if (args[3] === 'info' && attempts++ === 0) throw new Error('starting');
    },
  });
  assert.deepEqual(commands, [
    ['exec', 'synthetic', 'docker', '--version'],
    ['exec', 'synthetic', 'docker', 'info', '--format', '{{.ServerVersion}}'],
    ['exec', 'synthetic', 'docker', 'info', '--format', '{{.ServerVersion}}'],
  ]);
});
