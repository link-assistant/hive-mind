/**
 * @hive-mind-test-suite default
 * Issue #3614: one `/version` answer starts dozens of version commands, so the
 * bot shares one run between concurrent requests and reuses the answer for
 * VERSION_INFO_CACHE_MS; a failed answer is not reused.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { getSharedVersionInfo, resetSharedVersionInfoForTests, VERSION_INFO_CACHE_MS } from '../src/version-info.lib.mjs';

function countingRunner() {
  const runner = async () => {
    runner.calls += 1;
    return null;
  };
  runner.calls = 0;
  return runner;
}

test('concurrent /version requests share one run of the version commands', async () => {
  resetSharedVersionInfoForTests();
  const runCommand = countingRunner();
  const results = await Promise.all([getSharedVersionInfo(false, { runCommand }), getSharedVersionInfo(false, { runCommand }), getSharedVersionInfo(false, { runCommand })]);
  const perRun = runCommand.calls;
  assert.ok(perRun > 10, `one answer runs many commands (${perRun})`);
  for (const result of results) assert.equal(result.success, true);
  await getSharedVersionInfo(false, { runCommand });
  assert.equal(runCommand.calls, perRun, 'a later request inside the interval reuses the answer');
  results[0].versions.hiveMind = 'changed';
  assert.notEqual((await getSharedVersionInfo(false, { runCommand })).versions.hiveMind, 'changed', 'callers get their own copy');
  assert.equal(VERSION_INFO_CACHE_MS, 30_000);
});

test('a failed /version answer is not reused', async () => {
  resetSharedVersionInfoForTests();
  let loads = 0;
  const load = async () => (++loads === 1 ? { success: false, error: 'docker not reachable' } : { success: true, versions: {} });
  assert.equal((await getSharedVersionInfo(false, {}, { load })).success, false);
  assert.equal((await getSharedVersionInfo(false, {}, { load })).success, true, 'the next request runs again');
  await getSharedVersionInfo(false, {}, { load });
  assert.equal(loads, 2, 'a successful answer is reused');
});
