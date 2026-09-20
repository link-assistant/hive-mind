#!/usr/bin/env node

/**
 * @hive-mind-test-suite default
 *
 * Regression tests for issue #2031: an obsolete failed check-run must not
 * restart the AI when GitHub says the live PR is CLEAN and MERGEABLE.
 */

import assert from 'node:assert/strict';
import { isAuthoritativeCleanMergeState, reconcileStaleCIBlockers } from '../src/solve.auto-merge-helpers.lib.mjs';

const staleRerunIncident = {
  mergeable: true,
  mergeableState: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
};

assert.equal(isAuthoritativeCleanMergeState(staleRerunIncident), true, 'CLEAN/MERGEABLE must override a stale rollup failure');

const staleRollupBlockers = [
  { type: 'ci_failure', message: 'old title check failed' },
  { type: 'ci_cancelled', message: 'superseded run' },
  { type: 'external_review_limit', message: 'review credits exhausted' },
];
assert.deepEqual(reconcileStaleCIBlockers(staleRollupBlockers, { status: 'failure' }, staleRerunIncident), [{ type: 'external_review_limit', message: 'review credits exhausted' }], 'only stale CI failure/cancellation blockers should be removed');
assert.deepEqual(reconcileStaleCIBlockers(staleRollupBlockers, { status: 'failure' }, { mergeable: false, mergeableState: 'CONFLICTING', mergeStateStatus: 'DIRTY' }), staleRollupBlockers, 'conflicts must retain every CI blocker');
assert.deepEqual(reconcileStaleCIBlockers(staleRollupBlockers, { status: 'pending' }, staleRerunIncident), staleRollupBlockers, 'pending CI must remain pending even when GitHub currently reports CLEAN');

for (const mergeStatus of [{ mergeable: false, mergeableState: 'CONFLICTING', mergeStateStatus: 'DIRTY' }, { mergeable: false, mergeableState: 'MERGEABLE', mergeStateStatus: 'BLOCKED' }, { mergeable: false, mergeableState: 'MERGEABLE', mergeStateStatus: 'BEHIND' }, { mergeable: false, mergeableState: null, mergeStateStatus: 'UNKNOWN' }, { mergeable: true, mergeableState: 'MERGEABLE', mergeStateStatus: 'UNSTABLE' }, { mergeable: true }, null]) {
  assert.equal(isAuthoritativeCleanMergeState(mergeStatus), false, `must not override rollup failures for ${JSON.stringify(mergeStatus)}`);
}

console.log('✅ Issue #2031 stale re-run check reconciliation tests passed');
