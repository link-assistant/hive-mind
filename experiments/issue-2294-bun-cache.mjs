/** Reproduce Bun cache cleanup outside a project without touching host caches. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function withBunCacheFixture(run) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-bun-cache-2294-'));
  try {
    const install = path.join(root, '.bun');
    const cache = path.join(install, 'install/cache');
    const global = path.join(install, 'install/global');
    const cli = path.join(global, 'node_modules/fixture-cli/index.js');
    await fs.mkdir(cache, { recursive: true });
    await fs.mkdir(path.dirname(cli), { recursive: true });
    await fs.writeFile(path.join(global, 'package.json'), '{}');
    await fs.writeFile(path.join(cache, 'fixture-cli'), 'installed CLI must survive');
    await fs.link(path.join(cache, 'fixture-cli'), cli);
    await fs.writeFile(path.join(cache, 'download'), Buffer.alloc(2 * 1024 * 1024));
    const options = { cwd: root, env: { ...process.env, BUN_INSTALL: install, BUN_INSTALL_CACHE_DIR: cache }, encoding: 'utf8' };
    return await run({ root, cache, cli, options });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

export async function runBunCacheCleanup(argv) {
  return withBunCacheFixture(async ({ cache, cli, options }) => {
    const result = spawnSync('bun', argv, options);
    const cacheExists = await fs.access(path.join(cache, 'download')).then(
      () => true,
      () => false
    );
    return { ...result, cacheExists, cliContents: await fs.readFile(cli, 'utf8') };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const before = await runBunCacheCleanup(['pm', 'cache', 'rm']);
  assert.notEqual(before.status, 0);
  assert.match(before.stderr, /No package.json/);
  console.log('before: manifest-less cache cleanup fails');
  const after = await runBunCacheCleanup(['pm', '-g', 'cache', 'rm']);
  assert.equal(after.status, 0, after.stderr);
  assert.equal(after.cacheExists, false);
  assert.equal(after.cliContents, 'installed CLI must survive');
  console.log('after: global cache cleanup succeeds; installed hard-linked CLI survives');
}
