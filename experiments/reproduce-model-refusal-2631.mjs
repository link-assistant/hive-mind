// Token-free regression against the initial implementation's PR-only refusal report.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';

const baseline = new URL('../src/.refusal-baseline-2631.mjs', import.meta.url);
try {
  await writeFile(baseline, execFileSync('git', ['show', '7a7f1c75:src/failed-task-retention.lib.mjs']));
  const result = spawnSync(process.execPath, ['--test', 'tests/failed-task-classification-2631.test.mjs'], { env: { ...process.env, HIVE_TEST_RETENTION_ADAPTER: baseline.href }, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  process.stdout.write(result.stdout || '');
  process.stderr.write(result.stderr || '');
  assert.equal(result.status, 1, 'the baseline must miss the original-issue refusal report');
  assert.match(result.stdout, /refusal guidance reaches the original issue/);
} finally {
  await rm(baseline, { force: true });
}
