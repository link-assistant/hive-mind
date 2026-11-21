/**
 * @hive-mind-test-suite default
 */

import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../examples/ci-cd-pull-request-tiers/check-file-line-limits.mjs', import.meta.url));
const cwd = mkdtempSync(join(tmpdir(), 'file-line-ratchet-'));
const baseline = join(cwd, '.file-line-limits.json');
const large = 'legacy file.mjs';
const git = (...args) => execFileSync('git', args, { cwd, stdio: 'pipe', timeout: 10000 });
const lines = (file, count) => writeFileSync(join(cwd, file), Array(count).fill('line').join('\n'));
const check = (...args) => {
  const result = spawnSync(process.execPath, [script, ...args, '--', '*.mjs'], { cwd, encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  return result;
};
const pass = (...args) => {
  const result = check(...args);
  assert.equal(result.status, 0, result.stderr);
};
const fail = (message, ...args) => {
  const result = check(...args);
  assert.equal(result.status, 1, result.stdout);
  assert.match(result.stderr, message);
};

try {
  git('init', '--quiet', '--initial-branch=main');
  lines(large, 1503);
  lines('removed.mjs', 1501);
  lines('untracked.mjs', 1501);
  git('add', '--', large, 'removed.mjs');

  pass('--initialize');
  assert.deepEqual(JSON.parse(readFileSync(baseline)), { [large]: 1503, 'removed.mjs': 1501 });
  git('add', '.file-line-limits.json');
  git('-c', 'user.name=Ratchet Test', '-c', 'user.email=ratchet@example.test', 'commit', '--quiet', '-m', 'Adopt baseline');
  pass('--base', 'HEAD');

  lines(large, 1504);
  fail(/1504 lines \(ceiling 1503\)/);
  fail(/1504 lines \(ceiling 1503\)/, '--update');
  writeFileSync(baseline, JSON.stringify({ [large]: 1504, 'removed.mjs': 1501 }));
  fail(/raises the ceiling/, '--base', 'HEAD');
  git('restore', '.file-line-limits.json');

  lines(large, 1502);
  fail(/stale/);
  git('rm', '--quiet', 'removed.mjs');
  pass('--update');
  assert.deepEqual(JSON.parse(readFileSync(baseline)), { [large]: 1502 });
  pass('--base', 'HEAD');

  lines(large, 1500);
  pass('--update');
  assert.deepEqual(JSON.parse(readFileSync(baseline)), {});
  lines(large, 1501);
  fail(/1501 lines \(ceiling 1500\)/, '--update');

  lines(large, 1500);
  git('add', '--', 'untracked.mjs');
  fail(/untracked\.mjs.*1501 lines \(ceiling 1500\)/);
  fail(/untracked\.mjs.*1501 lines \(ceiling 1500\)/, '--update');
  writeFileSync(baseline, JSON.stringify({ 'untracked.mjs': 1501 }));
  fail(/raises the ceiling.*untracked\.mjs/, '--base', 'HEAD');
} finally {
  rmSync(cwd, { recursive: true, force: true });
}

console.log('file-line-ratchet-4093.test.mjs: all assertions passed');
