/**
 * @hive-mind-test-suite default
 *
 * Issue #3469: the bot log said only
 *
 *   [VERBOSE] isolation-runner: could not parse df output for Docker disk space
 *
 * which does not say which path was measured or what df answered, so a missing
 * data root could not be told apart from an unexpected df format.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { checkDockerDiskSpace, parseDfAvailableKb } from '../src/isolation-runner.lib.mjs';

const fakeDollar = answers => async () => () => async strings => {
  const command = strings.join('');
  const answer = answers.find(([prefix]) => command.startsWith(prefix))?.[1];
  if (answer instanceof Error) throw answer;
  return answer ?? { code: 0, stdout: '', stderr: '' };
};

const captureConsole = async fn => {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
};

test('parseDfAvailableKb reads the Available column and rejects anything else', () => {
  assert.equal(parseDfAvailableKb('Filesystem     1024-blocks     Used Available Capacity Mounted on\noverlay          202051056 53980028 148054644      27% /var/lib/docker\n'), 148054644);
  assert.equal(parseDfAvailableKb('Filesystem     1024-blocks     Used Available Capacity Mounted on\n'), null);
  assert.equal(parseDfAvailableKb(''), null);
  assert.equal(parseDfAvailableKb(undefined), null);
});

test('an unparseable df answer names the data root, the exit code and stderr', async () => {
  const getDollar = fakeDollar([
    ['docker info', { code: 0, stdout: '/var/lib/docker\n', stderr: '' }],
    ['df -Pk', { code: 1, stdout: '', stderr: 'df: /var/lib/docker: No such file or directory\n' }],
  ]);
  const { result, lines } = await captureConsole(() => checkDockerDiskSpace(true, { getDollar }));
  assert.equal(result, null);
  assert.deepEqual(lines, [`[VERBOSE] isolation-runner: could not parse df output for Docker disk space (data root '/var/lib/docker', df exit 1, stdout "", stderr "df: /var/lib/docker: No such file or directory")`]);
});

test('a readable df still reports the free space', async () => {
  const getDollar = fakeDollar([
    ['docker info', new Error('Cannot connect to the Docker daemon')],
    ['df -Pk', { code: 0, stdout: 'Filesystem 1024-blocks Used Available Capacity Mounted on\n/dev/sda1 1000 0 2097152 0% /\n', stderr: '' }],
  ]);
  const { result, lines } = await captureConsole(() => checkDockerDiskSpace(true, { getDollar }));
  assert.deepEqual(result, { availableGiB: 2, dataRoot: '/var/lib/docker' });
  assert.deepEqual(lines, ["[VERBOSE] isolation-runner: Docker data root '/var/lib/docker' has 2.0 GiB free"]);
});
