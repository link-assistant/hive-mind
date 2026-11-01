// Required integration gate after both release-shaped PR images are built.
// This checks the installed launcher against the host and nested daemons;
// Native controls cover credential publication, selected Claude history and
// default-authority concurrent Claude refresh against a strict rotating provider.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { startDetachedDockerPull } from '../src/docker-pull-detached.lib.mjs';
import { TASK_IMAGE_PULL_TIMEOUT_MS } from '../src/task-image-refresh.lib.mjs';
import { waitForPackagedDockerDaemon } from './docker-pr-daemon-ready.lib.mjs';

const execute = promisify(execFile);
const docker = (args, budget = 60_000) => execute('docker', args, { maxBuffer: 1024 * 1024, signal: AbortSignal.timeout(budget) });
const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-packaged-mounts-'));
const probeImage = process.env.HIVE_MOUNT_TEST_IMAGE || 'node:24-alpine';
// The Gemini native history adapter requires util-linux flock's timed locks.
const geminiImage = process.env.HIVE_MOUNT_TEST_GEMINI_IMAGE || 'node:24-bookworm-slim';
const geminiFixture = fileURLToPath(new URL('../experiments/issue-3785', import.meta.url));
const script = fileURLToPath(new URL('./verify-mounted-task-backing.mjs', import.meta.url));
const dataScript = fileURLToPath(new URL('./verify-mounted-tool-data.mjs', import.meta.url));
const codexAuthScript = fileURLToPath(new URL('./verify-mounted-codex-auth.mjs', import.meta.url));
const claudeAuthScript = fileURLToPath(new URL('./verify-mounted-claude-auth.mjs', import.meta.url));
const claudeHistoryScript = fileURLToPath(new URL('./verify-mounted-claude-history.mjs', import.meta.url));
const claudeRefreshScript = fileURLToPath(new URL('./verify-mounted-claude-refresh.mjs', import.meta.url));
const nativeRuntimeHelper = fileURLToPath(new URL('./mounted-native-runtime.lib.mjs', import.meta.url));
const socket = '/var/run/docker.sock';
const socketGroup = String((await fs.stat(socket)).gid);
try {
  const historyDirectories = ['sessions', 'archived_sessions', 'thread-writer-locks', 'rollout-migrations'];
  for (const directory of historyDirectories) await fs.mkdir(path.join(fixture, 'home/.codex', directory), { recursive: true });
  for (const relative of ['', 'home', 'home/.codex', ...historyDirectories.map(directory => `home/.codex/${directory}`)]) await fs.chmod(path.join(fixture, relative), 0o777);
  await fs.writeFile(path.join(fixture, 'home/.codex/auth.json'), '{"synthetic":"canonical"}', { mode: 0o644 });
  for (const image of new Set([probeImage, geminiImage])) {
    try {
      await docker(['image', 'inspect', '--format', '{{.Id}}', image]);
    } catch {
      await startDetachedDockerPull(['pull', image], { timeoutMs: TASK_IMAGE_PULL_TIMEOUT_MS });
    }
  }
  await docker(['image', 'save', '-o', path.join(fixture, 'probe-image.tar'), probeImage]);
  await docker(['image', 'save', '-o', path.join(fixture, 'gemini-image.tar'), geminiImage]);
  for (const [variant, image] of [
    ['host', `${process.env.IMAGE_NAME || 'konard/hive-mind'}:test`],
    ['nested', `${process.env.DIND_IMAGE_NAME || 'konard/hive-mind-dind'}:test`],
  ]) {
    for (const directory of historyDirectories) for (const index of [0, 1]) await fs.rm(path.join(fixture, `home/.codex/${directory}/task-${index}`), { force: true });
    const name = `hive-packaged-mount-${randomUUID()}`;
    try {
      const args = ['run', '--detach', '--pull', 'never', '--name', name, '--env', 'DIND_HOST_PASSTHROUGH=off', '--mount', `type=bind,source=${fixture},target=/mount-fixture`, '--mount', `type=bind,source=${script},target=/verify-mounted-task-backing.mjs,readonly`];
      args.push('--mount', `type=bind,source=${dataScript},target=/verify-mounted-tool-data.mjs,readonly`);
      args.push('--mount', `type=bind,source=${codexAuthScript},target=/verify-mounted-codex-auth.mjs,readonly`);
      args.push('--mount', `type=bind,source=${claudeAuthScript},target=/verify-mounted-claude-auth.mjs,readonly`);
      args.push('--mount', `type=bind,source=${claudeHistoryScript},target=/verify-mounted-claude-history.mjs,readonly`);
      args.push('--mount', `type=bind,source=${claudeRefreshScript},target=/verify-mounted-claude-refresh.mjs,readonly`);
      args.push('--mount', `type=bind,source=${nativeRuntimeHelper},target=/mounted-native-runtime.lib.mjs,readonly`);
      args.push('--mount', `type=bind,source=${geminiFixture},target=/verify-gemini-storage-fixture,readonly`);
      if (variant === 'host') args.push('--group-add', socketGroup, '--mount', `type=bind,source=${socket},target=${socket}`);
      else args.push('--privileged');
      args.push(image, 'sleep', 'infinity');
      await docker(args);
      await waitForPackagedDockerDaemon({ docker, name, variant });
      if (variant === 'nested') {
        await docker(['exec', name, 'docker', 'image', 'load', '-i', '/mount-fixture/probe-image.tar']);
        await docker(['exec', name, 'docker', 'image', 'load', '-i', '/mount-fixture/gemini-image.tar']);
      }
      const expectedHome = variant === 'host' ? path.join(fixture, 'home') : '/mount-fixture/home';
      const result = await docker(['exec', '--env', `HIVE_MOUNT_TEST_IMAGE=${probeImage}`, '--env', `HIVE_MOUNT_TEST_EXPECTED_HOME=${expectedHome}`, name, 'bash', '-lc', 'node --max-old-space-size=128 /verify-mounted-task-backing.mjs "$(command -v hive)"'], 120_000);
      process.stdout.write(`${variant}: ${result.stdout}`);
      // The small filesystem fixture has Node but no search binary. Exercise
      // the executable actually installed in this release image, mounted from
      // the shared fixture in the selected daemon's filesystem namespace.
      await fs.rm(path.join(fixture, 'rg'), { force: true });
      await docker(['cp', `${name}:/home/box/.local/bin/rg`, path.join(fixture, 'rg')]);
      const searchSource = path.join(path.dirname(expectedHome), 'rg');
      const dataResult = await docker(['exec', '--env', `HIVE_MOUNT_TEST_IMAGE=${probeImage}`, '--env', `HIVE_MOUNT_TEST_EXPECTED_HOME=${expectedHome}`, '--env', `HIVE_MOUNT_TEST_SEARCH_SOURCE=${searchSource}`, name, 'bash', '-lc', 'node --max-old-space-size=128 /verify-mounted-tool-data.mjs "$(command -v hive)"'], 120_000).catch(async error => {
        // These fixtures contain synthetic values only. Preserve their bounded
        // private diagnostics before finally removes the disposable container.
        const diagnostic = path.join(process.env.RUNNER_TEMP || os.tmpdir(), `hive-tool-data-${variant}-${randomUUID()}.log`);
        await docker(['cp', `${name}:/tmp/hive-tool-data-gate-private.log`, diagnostic])
          .then(() => fs.chmod(diagnostic, 0o600))
          .catch(() => {});
        throw error;
      });
      process.stdout.write(`${variant}: ${dataResult.stdout}`);
      const codexAuthResult = await docker(['exec', '--env', `HIVE_MOUNT_TEST_IMAGE=${probeImage}`, name, 'bash', '-lc', 'node --max-old-space-size=128 /verify-mounted-codex-auth.mjs "$(command -v hive)"'], 120_000);
      process.stdout.write(`${variant}: ${codexAuthResult.stdout}`);
      const claudeAuthResult = await docker(['exec', '--env', `HIVE_MOUNT_TEST_IMAGE=${probeImage}`, name, 'bash', '-lc', 'node --max-old-space-size=128 /verify-mounted-claude-auth.mjs "$(command -v hive)"'], 120_000);
      process.stdout.write(`${variant}: ${claudeAuthResult.stdout}`);
      // Peers must reach the synthetic provider in the root's loopback namespace.
      const historyNetwork = variant === 'host' ? `container:${name}` : 'host';
      for (const legacy of [true, false]) {
        const historyCommand = `node --max-old-space-size=128 /verify-mounted-claude-history.mjs "$(command -v hive)"${legacy ? ' --expect-legacy-history-gap' : ''}`;
        const historyResult = await docker(['exec', '--env', `HIVE_MOUNT_TEST_IMAGE=${probeImage}`, '--env', `HIVE_MOUNT_TEST_NETWORK=${historyNetwork}`, '--env', 'HIVE_MOUNT_TEST_DIAGNOSTICS=1', name, 'bash', '-lc', historyCommand], 120_000);
        process.stdout.write(`${variant}: ${historyResult.stdout}`);
      }
      // Issue #3785: default (migrated) authority, concurrent root/two-peer native
      // refresh against a strict rotating provider, with a file-only control.
      const refreshResult = await docker(['exec', '--env', `HIVE_MOUNT_TEST_IMAGE=${probeImage}`, '--env', `HIVE_MOUNT_TEST_NETWORK=${historyNetwork}`, name, 'bash', '-lc', 'node --max-old-space-size=128 /verify-mounted-claude-refresh.mjs "$(command -v hive)"'], 360_000);
      process.stdout.write(`${variant}: ${refreshResult.stdout}`);
      const geminiCommand = `set -euo pipefail
        launcher=$(command -v hive)
        hive_source=$(dirname "$(readlink -f "$launcher")")
        native_root=$(node --max-old-space-size=128 --input-type=module -e 'import {pathToFileURL} from "node:url";const {verifyNativeGeminiCommand}=await import(pathToFileURL(process.argv[1]+"/native-gemini-command.lib.mjs"));process.stdout.write((await verifyNativeGeminiCommand()).root)' "$hive_source")
        python3 /verify-gemini-storage-fixture/probe-gemini-native-cli.py "$native_root" --history --docker-storage --docker-launcher "$launcher" --docker-network "$HIVE_MOUNT_TEST_NETWORK" --diagnostics /mount-fixture/gemini-native-storage.log`;
      const geminiResult = await docker(['exec', '--env', `HIVE_MOUNT_TEST_GEMINI_IMAGE=${geminiImage}`, '--env', `HIVE_MOUNT_TEST_NETWORK=${historyNetwork}`, '--env', 'TMPDIR=/mount-fixture', '--env', 'PYTHONDONTWRITEBYTECODE=1', '--env', 'HIVE_MOUNT_TEST_DIAGNOSTICS=1', name, 'bash', '-lc', geminiCommand], 360_000);
      process.stdout.write(`${variant}: ${geminiResult.stdout}`);
      for (const directory of historyDirectories) for (const index of [0, 1]) assert.equal(await fs.readFile(path.join(fixture, `home/.codex/${directory}/task-${index}`), 'utf8'), 'persisted');
    } finally {
      await docker(['rm', '-f', name]).catch(() => {});
    }
  }
} finally {
  await fs.rm(fixture, { recursive: true, force: true });
}
