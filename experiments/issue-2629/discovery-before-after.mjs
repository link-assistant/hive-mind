/** Compare the actual baseline and fixed CLI against a finite failing Docker fixture. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const baselineRef = process.argv[2] || '1675c0a575383089a7c4ba8d53b0a0def750c112';
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'cleanup-discovery-2629-'));
try {
  const checkout = path.join(directory, 'baseline');
  await fs.mkdir(checkout);
  const archive = spawnSync('git', ['archive', baselineRef, 'src', 'package.json'], { cwd: root, maxBuffer: 16 * 1024 * 1024 });
  assert.equal(archive.status, 0, String(archive.stderr));
  const extracted = spawnSync('tar', ['-x', '-C', checkout], { input: archive.stdout, encoding: 'utf8' });
  assert.equal(extracted.status, 0, extracted.stderr);
  await fs.symlink(path.join(root, 'node_modules'), path.join(checkout, 'node_modules'));
  for (const [label, source, expectedStatus] of [
    ['before', checkout, 0],
    ['after', root, 1],
  ]) {
    const isolated = path.join(directory, label);
    const bin = path.join(isolated, 'bin');
    const tmp = path.join(isolated, 'tmp');
    await fs.mkdir(bin, { recursive: true });
    await fs.mkdir(tmp);
    await fs.symlink(path.join(root, 'experiments/issue-2629/docker-fixture.mjs'), path.join(bin, 'docker'));
    await fs.symlink(path.join(source, 'src/cleanup.mjs'), path.join(bin, 'hive-cleanup'));
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: tmp, XDG_STATE_HOME: path.join(isolated, 'state'), CLEANUP_DOCKER_SCENARIO: 'discovery-failure', CLEANUP_DOCKER_CALLS: path.join(isolated, 'calls.jsonl') };
    const result = spawnSync(process.execPath, [path.join(bin, 'hive-cleanup'), '--dry-run', '--no-sessions', '--no-agent-snapshots', '--no-resolve-branches', '--no-keep-active-tasks-folders', '--docker-isolation=all'], { cwd: source, env, encoding: 'utf8', timeout: 60000 });
    const output = `${result.stdout}\n${result.stderr}`;
    assert.equal(result.status, expectedStatus, output);
    if (label === 'before') {
      assert.match(output, /none detected/);
      assert.doesNotMatch(output, /snapshotter/);
    } else {
      assert.match(output, /docker ps failed.*snapshotter/);
      assert.doesNotMatch(output, /none detected/);
    }
    const calls = (await fs.readFile(env.CLEANUP_DOCKER_CALLS, 'utf8')).trim().split('\n').map(JSON.parse);
    assert.equal(calls.length, label === 'before' ? 1 : 3);
    assert.equal(
      calls.some(args => args.includes('rm')),
      false
    );
    console.log(`${label}: exit ${result.status}; ${calls.length} listing attempts; ${label === 'before' ? 'silently reports an empty host' : 'preserves the snapshotter error'}`);
  }
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
