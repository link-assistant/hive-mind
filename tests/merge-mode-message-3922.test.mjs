#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Issue #3922: with --auto-restart-until-mergeable the solve log said "🔄 Auto-merge mode
 * enabled - will attempt to merge after verification" and one second later "Mode:
 * Auto-restart-until-mergeable (will NOT auto-merge)". Only --auto-merge merges.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const { describePostSessionMergeWait } = await import('../src/solve.results.lib.mjs');

test('--auto-restart-until-mergeable does not announce a merge it will not perform', () => {
  const message = describePostSessionMergeWait({ autoRestartUntilMergeable: true });
  assert.doesNotMatch(message, /Auto-merge mode enabled|will attempt to merge/);
  assert.match(message, /will NOT merge it/);
});

test('--auto-merge still announces the merge (also when combined with the restart loop)', () => {
  for (const argv of [{ autoMerge: true }, { autoMerge: true, autoRestartUntilMergeable: true }]) {
    assert.match(describePostSessionMergeWait(argv), /Auto-merge mode enabled - will merge the pull request/);
  }
});

test('the monitor banner uses the same rule (only --auto-merge merges)', () => {
  const monitor = readFileSync(new URL('../src/solve.auto-merge.lib.mjs', import.meta.url), 'utf8');
  assert.match(monitor, /const isAutoMerge = argv\.autoMerge \|\| false;/);
  assert.match(monitor, /isAutoMerge \? 'Auto-merge \(will merge when ready\)' : 'Auto-restart-until-mergeable \(will NOT auto-merge\)'/);
});
