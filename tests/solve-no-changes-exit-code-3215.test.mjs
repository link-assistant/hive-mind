/**
 * @hive-mind-test-suite default
 *
 * Issue #3215: before #3211 a run that changed nothing exited 0. Exit 5 is
 * the new default, and `HIVE_MIND_SOLVE_NO_CHANGES_EXIT_CODE` lets a script
 * that treats every nonzero exit as an error keep the old code.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EXIT_CODE_SOLVE_NO_CHANGES, getSolveNoChangesExitCode } from '../src/solve.exit-codes.lib.mjs';

test('a run without changes exits 5 unless the operator chooses another code', () => {
  assert.equal(EXIT_CODE_SOLVE_NO_CHANGES, 5);
  assert.equal(getSolveNoChangesExitCode({}), 5);
  assert.equal(getSolveNoChangesExitCode({ HIVE_MIND_SOLVE_NO_CHANGES_EXIT_CODE: '0' }), 0);
  assert.equal(getSolveNoChangesExitCode({ HIVE_MIND_SOLVE_NO_CHANGES_EXIT_CODE: ' 3 ' }), 3);
});

test('an unusable value keeps exit 5', () => {
  for (const value of ['', 'zero', '-1', '256', '1.5', '0x5']) {
    assert.equal(getSolveNoChangesExitCode({ HIVE_MIND_SOLVE_NO_CHANGES_EXIT_CODE: value }), 5, value);
  }
});
