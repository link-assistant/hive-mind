/** Run with node experiments/issue-2630/reproduce-docker-startup.mjs. */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID } from 'node:crypto';
import { buildResumeCommand } from '../../src/session-resume.lib.mjs';
import { buildShellCommand } from '../../src/shell-command.lib.mjs';
import { checkResumedDockerStartup, cleanupFailedResumeSnapshot } from '../../src/isolation-runner.resume.lib.mjs';

const run = promisify(execFile);
const original = `issue-2630-${randomUUID()}`;
const containers = [original, `${original}-resume-1`, `${original}-resume-2`];
const images = [1, 2].map(attempt => `start-command-resume/${original}:${attempt}`);
const docker = async args => (await run('docker', args)).stdout.trim();
// Nested daemons without delegated cgroup controllers can run this finite,
// non-stress fixture with --without-resource-limits.
const resources = process.argv.includes('--without-resource-limits') ? ['--network', 'none'] : ['--memory', '64m', '--cpus', '0.25', '--network', 'none'];

try {
  await docker(['pull', 'busybox:1.37.0']);
  // This finite fixture preserves a real executable in the killed container's
  // filesystem without launching an AI tool or applying OOM pressure.
  const setup = 'mkdir -p /usr/local/bin; printf \'#!/bin/sh\nprintf "%%s\\n" "$@"\\n\' > /usr/local/bin/solve; chmod +x /usr/local/bin/solve';
  await docker(['run', '--name', original, ...resources, 'busybox:1.37.0', 'sh', '-c', setup]);
  for (const image of images) await docker(['commit', original, image]);
  const url = 'https://github.com/link-assistant/hive-mind/issues/2630';
  const args = [url, '--tool', 'claude', '--requirements', "literal $HOME and a single quote: '"];
  const command = buildResumeCommand({ sessionInfo: { command: 'solve', commandAlias: 'claude', args }, lastSessionId: 'fixture-session' });
  const commands = [command.chatDisplay, `exec ${buildShellCommand(command.binary, command.args)}`];
  for (let index = 0; index < 2; index++) {
    const sessionName = containers[index + 1];
    await docker(['run', '-d', '--name', sessionName, ...resources, images[index], 'sh', '-c', commands[index]]);
    const result = await checkResumedDockerStartup(sessionName, { verbose: true });
    const output = await docker(['logs', sessionName]);
    if (index === 0) {
      assert.equal(result.failed, true);
      assert.equal(result.exitCode, 127);
      assert.equal((await cleanupFailedResumeSnapshot({ mode: 'docker-snapshot', sessionName, previousSessionName: original, snapshotImage: images[index] }, { verbose: true })).success, true);
      await assert.rejects(docker(['container', 'inspect', sessionName]));
      await assert.rejects(docker(['image', 'inspect', images[index]]));
      console.log('Before: /claude exited 127; failed derived container and snapshot removed.');
    } else {
      assert.equal(result.failed, false);
      assert.equal(result.exitCode, 0);
      assert.equal(output, command.args.join('\n'));
      console.log('After: exec solve exited 0 and received every literal argument.');
    }
  }
  assert.equal(await docker(['inspect', '--format', '{{.State.Status}}', original]), 'exited');
  console.log('Original container retained during failed-resume cleanup.');
} finally {
  for (const name of containers) await docker(['rm', '-f', name]).catch(() => {});
  for (const image of images) await docker(['image', 'rm', image]).catch(() => {});
}
