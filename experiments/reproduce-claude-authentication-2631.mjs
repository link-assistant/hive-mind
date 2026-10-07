// Run the bounded, mocked regression against the adapter before this fix.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';

const fixture = new URL('../src/.claude-auth-baseline-2631.mjs', import.meta.url);
try {
  await writeFile(fixture, execFileSync('git', ['show', '900a6443:src/claude.lib.mjs']));
  const baseline = spawnSync(process.execPath, ['--test', 'tests/claude-authentication-retry-2631.test.mjs'], { env: { ...process.env, HIVE_TEST_CLAUDE_ADAPTER: fixture.href }, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  console.log(baseline.stdout);
  assert.equal(baseline.status, 1);
  assert.match(baseline.stdout, /1 !== 2/);
} finally {
  await rm(fixture, { force: true });
}
