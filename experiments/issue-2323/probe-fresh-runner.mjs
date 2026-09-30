/** Verify the standalone GitHub API adapter on a checkout without node_modules. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const work = mkdtempSync(join(tmpdir(), 'hive-github-fresh-runner-'));
try {
  for (const path of ['package.json', 'package-lock.json', 'src', 'scripts']) cpSync(path, join(work, path), { recursive: true });
  const args = ['--input-type=module', '-e', "await import('./scripts/github-api.lib.mjs'); console.log('GitHub API adapter loaded');"];
  const options = { cwd: work, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, stdio: 'pipe' };
  assert.throws(() => execFileSync(process.execPath, args, options), /Cannot find package 'semver'/);
  console.log('Reproduced the missing dependency on a fresh checkout.');
  console.log(execFileSync(process.execPath, ['scripts/npm-install-with-retry.mjs', 'ci'], options));
  assert.match(execFileSync(process.execPath, args, options), /GitHub API adapter loaded/);
  console.log('The adapter loads after the workflow dependency installation.');
} finally {
  rmSync(work, { recursive: true, force: true });
}
