// Token-free comparison with the last commit before host authentication preflight.
// Empty PATH guarantees neither revision can launch Docker or start-command.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const fixture = new URL('../src/.preflight-baseline-2631.mjs', import.meta.url);
const originalPath = process.env.PATH;
try {
  const baseline = execFileSync('git', ['show', '900a6443:src/isolation-runner.lib.mjs'], { encoding: 'utf8' });
  await writeFile(fixture, baseline);
  process.env.PATH = '/nonexistent';
  const options = { backend: 'docker', hostPreflight: async () => ({ success: false, failureKind: 'auth', error: 'operator re-login required' }) };
  const before = await (await import(fixture.href)).executeWithIsolation('solve', [], options);
  const after = await (await import('../src/isolation-runner.lib.mjs')).executeWithIsolation('solve', [], options);
  assert.notEqual(before.failureKind, 'auth');
  assert.match(before.error, /start-command/);
  assert.equal(after.failureKind, 'auth');
  console.log({ before: before.error, after: after.error });
} finally {
  process.env.PATH = originalPath;
  await rm(fileURLToPath(fixture), { force: true });
}
