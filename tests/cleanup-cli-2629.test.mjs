/**
 * CLI regressions use a finite local Docker fixture, never a real daemon.
 * @hive-mind-test-suite default
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getCleanupLogDirectory, initializeCleanupLog } from '../src/cleanup.logs.lib.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
async function runCli(t, scenario, flags = [], mode = undefined) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanup-2629-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const bin = path.join(directory, 'bin');
  const tmp = path.join(directory, 'tmp');
  await fs.mkdir(bin);
  await fs.mkdir(tmp);
  await fs.symlink(path.join(root, 'experiments/issue-2629/docker-fixture.mjs'), path.join(bin, 'docker'));
  await fs.symlink(path.join(root, 'src/cleanup.mjs'), path.join(bin, 'hive-cleanup'));
  const calls = path.join(directory, 'calls.jsonl');
  const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp, XDG_STATE_HOME: path.join(directory, 'state'), CLEANUP_DOCKER_SCENARIO: scenario, CLEANUP_DOCKER_CALLS: calls };
  delete env.HIVE_MIND_CLEANUP_DOCKER_ISOLATION;
  delete env.HIVE_CLEANUP_DOCKER_ISOLATION;
  if (mode) env.HIVE_MIND_CLEANUP_DOCKER_ISOLATION = mode;
  const child = spawnSync(process.execPath, [path.join(bin, 'hive-cleanup'), '--no-sessions', '--no-agent-snapshots', '--no-resolve-branches', ...flags], { encoding: 'utf8', env, timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = `${child.stdout}\n${child.stderr}`;
  const status = child.status;

  return {
    directory,
    bin,
    env,
    output,
    status,
    calls: (await fs.readFile(calls, 'utf8'))
      .trim()
      .split('\n')
      .map(line => JSON.parse(line)),
  };
}

test('failed discovery exits nonzero and preserves the actual error', { timeout: 65000 }, async t => {
  const result = await runCli(t, 'discovery-failure', ['--dry-run']);
  assert.equal(result.status, 1);
  assert.match(result.output, /docker ps failed.*snapshotter/);
  assert.doesNotMatch(result.output, /none detected|Nothing to delete/);
  assert.equal(result.calls.length, 3);
});

test('TTL environment policy reports container and unique image bytes in dry-run', { timeout: 65000 }, async t => {
  const result = await runCli(t, 'failed', ['--dry-run'], 'failed-older-than=48h');
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /docker remove 1 \(14G\)/);
  assert.match(result.output, /resume images remove 1 \(4.1G\)/);
  assert.equal(
    result.calls.some(args => args.includes('rm')),
    false
  );
  assert.match(result.output, /failed container retention expired/);
});

test('successful leaks are flagged and removed with their unused snapshots', { timeout: 65000 }, async t => {
  const result = await runCli(t, 'success', ['--force']);
  assert.equal(result.status, 0, result.output);
  assert.match(result.output, /successful container was not removed by start-command \(bug\)/);
  assert.deepEqual(
    result.calls.find(args => args[0] === 'rm'),
    ['rm', 'a'.repeat(64)]
  );
  assert.deepEqual(
    result.calls.find(args => args[0] === 'image' && args[1] === 'rm'),
    ['image', 'rm', `sha256:${'b'.repeat(64)}`]
  );
  assert.equal(
    result.calls.some(args => args.includes('-f')),
    false
  );
  assert.equal(
    (await fs.readdir(result.bin)).some(name => name.endsWith('.log')),
    false
  );
  const logs = await fs.readdir(getCleanupLogDirectory({ env: result.env }));
  assert.equal(logs.length, 1);
  assert.equal((await fs.stat(path.join(getCleanupLogDirectory({ env: result.env }), logs[0]))).mode & 0o777, 0o600);
});

test('restart race preserves container and its referenced image', { timeout: 65000 }, async t => {
  const result = await runCli(t, 'restart-race', ['--force', '--docker-isolation', 'all']);
  assert.equal(
    result.calls.some(args => args.includes('-f')),
    false
  );
  assert.match(result.output, /0 Docker isolation containers, 1 kept or failed/);
  assert.equal(
    result.calls.some(args => args[0] === 'image' && args[1] === 'rm'),
    false
  );
});

test('cleanup log retention keeps thirty files and leaves unrelated files and live writers', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanup-logs-2629-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const old = Array.from({ length: 40 }, (_, i) => `cleanup-2026-10-07T00-00-${String(i).padStart(2, '0')}-000Z-99999999.log`);
  for (const name of old) await fs.writeFile(path.join(directory, name), 'old');
  const live = `cleanup-2020-01-01T00-00-00-000Z-${process.pid}.log`;
  await fs.writeFile(path.join(directory, live), 'active');
  await fs.writeFile(path.join(directory, 'unrelated.log'), 'keep');
  await fs.symlink(path.join(directory, 'unrelated.log'), path.join(directory, 'cleanup-2000-01-01T00-00-00-000Z.log'));
  await initializeCleanupLog(path.join(directory, 'cleanup-2026-10-07T23-00-00-000Z-99999998.log'));
  const files = await fs.readdir(directory);
  assert.equal(files.filter(name => /^cleanup-2026/.test(name)).length, 30);
  assert.equal(await fs.readFile(path.join(directory, live), 'utf8'), 'active');
  assert.equal(await fs.readFile(path.join(directory, 'unrelated.log'), 'utf8'), 'keep');
  assert.equal((await fs.lstat(path.join(directory, 'cleanup-2000-01-01T00-00-00-000Z.log'))).isSymbolicLink(), true);
});

test('log location honors absolute XDG state home and falls back for relative values', () => {
  assert.equal(getCleanupLogDirectory({ env: {}, home: '/users/test' }), '/users/test/.local/state/hive-mind/logs');
  assert.equal(getCleanupLogDirectory({ env: { XDG_STATE_HOME: 'relative' }, home: '/users/test' }), '/users/test/.local/state/hive-mind/logs');
  assert.equal(getCleanupLogDirectory({ env: { XDG_STATE_HOME: '/state' } }), '/state/hive-mind/logs');
});
