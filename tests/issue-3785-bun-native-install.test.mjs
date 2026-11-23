/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('all three images and the source installer retain independent Bun package bytes', async () => {
  for (const filename of ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile', 'scripts/install-image-package.sh']) {
    const source = await fs.readFile(new URL(`../${filename}`, import.meta.url), 'utf8');
    const installs = [...source.matchAll(/\bbun install ([^\n]+)/gu)];
    assert.ok(installs.length > 0, filename);
    for (const [, args] of installs) assert.match(args, /(?:^|\s)--backend=copyfile(?:\s|$)/u, filename);
  }
});

const bun = spawnSync('bun', ['--version'], { encoding: 'utf8', timeout: 5000, maxBuffer: 16384 });
test('real Bun image installation admits native generation without executing fixture bytes', { timeout: 60000, skip: bun.status !== 0 || process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch) }, () => {
  const probe = fileURLToPath(new URL('../experiments/issue-3785/probe-bun-native-package.mjs', import.meta.url));
  const result = spawnSync(process.execPath, ['--max-old-space-size=64', probe], { encoding: 'utf8', timeout: 55000, maxBuffer: 262144 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stdout + result.stderr);
  for (const layout of ['Dockerfile', 'Dockerfile.dind', 'coolify/Dockerfile']) assert.ok(result.stdout.includes(`PASS: ${layout} installs real-Bun packages`), result.stdout);
});
