/** @hive-mind-test-suite default */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isFixtureProcessAlive } from '../experiments/issue-3785/process-liveness.mjs';

test('native fixture liveness handles process exit during the proc read', () => {
  assert.equal(
    isFixtureProcessAlive(undefined, () => assert.fail('no process to read')),
    false
  );
  // `X`: reaped and being released; seen right after a `Z` read on CI (#4055).
  for (const state of ['S', 'R', 'D', 'Z', 'X']) {
    assert.equal(
      isFixtureProcessAlive(42, (filename, encoding) => {
        assert.equal(filename, '/proc/42/stat');
        assert.equal(encoding, 'utf8');
        return `42 (fixture) ${state} 1 2 3`;
      }),
      !['Z', 'X'].includes(state),
      state
    );
  }
  for (const code of ['ENOENT', 'ESRCH']) {
    assert.equal(
      isFixtureProcessAlive(42, () => {
        throw Object.assign(new Error('synthetic process exit'), { code });
      }),
      false,
      code
    );
  }
  const denied = Object.assign(new Error('synthetic permission failure'), { code: 'EACCES' });
  assert.throws(
    () =>
      isFixtureProcessAlive(42, () => {
        throw denied;
      }),
    error => error === denied
  );
});
