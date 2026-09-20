#!/usr/bin/env node

/**
 * Unit Tests: Issue #1952 - cancelled-by-timeout CI must be treated as a failure.
 *
 * Reproduces the teleton-agent PR #670 failure: a job that hit its `timeout-minutes`
 * limit surfaces as a check-run with conclusion 'cancelled', but the parent workflow_run
 * concludes 'failure'. getDetailedCIStatus only inspects check-runs, so it reported
 * status='cancelled' and the auto-merge loop posted a "Cancelled CI/CD Requires Review"
 * comment and stopped, instead of treating the timeout as a CI failure and restarting the AI.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1952
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyCancelledCIByWorkflowRuns, getFailedWorkflowRuns, getIncompleteWorkflowRuns, FAILURE_LIKE_WORKFLOW_RUN_CONCLUSIONS } from '../src/cancelled-ci-rerun.lib.mjs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = (description, fn) => {
  try {
    fn();
    console.log(`  ${GREEN}PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

console.log('================================================================================');
console.log('Unit Tests: Issue #1952 - cancelled-by-timeout CI treated as failure');
console.log('================================================================================\n');

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Pure helper behaviour
// ---------------------------------------------------------------------------

test('timeout-cancellation (workflow_run failure) classifies as failure', () => {
  // Teleton case: a "Build (Runtime) (20)" job timed out → its check-run conclusion is
  // 'cancelled', but the parent workflow_run concluded 'failure'.
  const runs = [{ id: 1, status: 'completed', conclusion: 'failure', name: 'CI', html_url: 'https://example/run/1', path: '.github/workflows/ci.yml' }];
  const { classification, failedRuns } = classifyCancelledCIByWorkflowRuns({ runs });
  assert(classification === 'failure', `expected 'failure', got '${classification}'`);
  assert(failedRuns.length === 1, 'failed run should be surfaced');
});

test("'timed_out' and 'startup_failure' run conclusions also classify as failure", () => {
  assert(classifyCancelledCIByWorkflowRuns({ runs: [{ status: 'completed', conclusion: 'timed_out' }] }).classification === 'failure', 'timed_out should be a failure');
  assert(classifyCancelledCIByWorkflowRuns({ runs: [{ status: 'completed', conclusion: 'startup_failure' }] }).classification === 'failure', 'startup_failure should be a failure');
  assert(FAILURE_LIKE_WORKFLOW_RUN_CONCLUSIONS.has('failure') && FAILURE_LIKE_WORKFLOW_RUN_CONCLUSIONS.has('timed_out') && FAILURE_LIKE_WORKFLOW_RUN_CONCLUSIONS.has('startup_failure'), 'failure-like set should include the three failure conclusions');
});

test('genuine manual/concurrency cancellation classifies as cancelled (re-triggerable)', () => {
  const runs = [{ id: 2, status: 'completed', conclusion: 'cancelled', name: 'Lint', html_url: 'https://example/run/2' }];
  assert(classifyCancelledCIByWorkflowRuns({ runs }).classification === 'cancelled', 'pure cancellation should remain re-triggerable cancelled');
});

test('stale run with no failures classifies as cancelled', () => {
  const runs = [{ id: 3, status: 'completed', conclusion: 'stale', name: 'Old' }];
  assert(classifyCancelledCIByWorkflowRuns({ runs }).classification === 'cancelled', 'stale should map to cancelled re-trigger flow');
});

test('mixed failure + cancellation classifies as failure (other fails => fail)', () => {
  const runs = [
    { id: 4, status: 'completed', conclusion: 'cancelled', name: 'Lint' },
    { id: 5, status: 'completed', conclusion: 'failure', name: 'Build' },
  ];
  assert(classifyCancelledCIByWorkflowRuns({ runs }).classification === 'failure', 'a real failure alongside a cancellation must be treated as a failure');
});

test('in-progress run defers classification to pending (wait for terminal state)', () => {
  // Issue #1952: "wait until all checks are success, fail or cancelled, to auto restart".
  const runs = [
    { id: 6, status: 'completed', conclusion: 'cancelled', name: 'Lint' },
    { id: 7, status: 'in_progress', conclusion: null, name: 'Build' },
  ];
  const { classification, incompleteRuns } = classifyCancelledCIByWorkflowRuns({ runs });
  assert(classification === 'pending', `expected 'pending', got '${classification}'`);
  assert(incompleteRuns.length === 1, 'the in-progress run should be reported as incomplete');
});

test('queued run also defers classification to pending', () => {
  const runs = [{ id: 8, status: 'queued', conclusion: null, name: 'Build' }];
  assert(classifyCancelledCIByWorkflowRuns({ runs }).classification === 'pending', 'queued runs are not terminal');
});

test('getFailedWorkflowRuns ignores incomplete runs (only completed failures count)', () => {
  const runs = [
    { status: 'in_progress', conclusion: null },
    { status: 'completed', conclusion: 'failure' },
  ];
  assert(getFailedWorkflowRuns(runs).length === 1, 'only the completed failure should count');
  assert(getIncompleteWorkflowRuns(runs).length === 1, 'the in-progress run should be incomplete');
});

test('empty run list classifies as cancelled (no failure/no pending signal)', () => {
  assert(classifyCancelledCIByWorkflowRuns({ runs: [] }).classification === 'cancelled', 'no runs => fall back to existing cancelled re-trigger flow');
});

// ---------------------------------------------------------------------------
// Wiring assertions — the fix is actually used in the decision paths
// ---------------------------------------------------------------------------

const helpersSrc = readFileSync(join(repoRoot, 'src', 'solve.auto-merge-helpers.lib.mjs'), 'utf8');
const autoMergeSrc = readFileSync(join(repoRoot, 'src', 'solve.auto-merge.lib.mjs'), 'utf8');

test('getMergeBlockers cross-references workflow runs in the cancelled branch', () => {
  assert(helpersSrc.includes('classifyCancelledCIByWorkflowRuns'), 'getMergeBlockers should classify cancelled CI by workflow-run conclusions');
});

test('getMergeBlockers emits ci_failure when a cancelled check belongs to a failed workflow run', () => {
  // The 'failure' classification branch must push a ci_failure blocker.
  const idx = helpersSrc.indexOf("classification === 'failure'");
  assert(idx !== -1, 'failure classification branch should exist');
  // Stop at the next branch so we only inspect the 'failure' block.
  const end = helpersSrc.indexOf('} else {', idx);
  const segment = helpersSrc.slice(idx, end === -1 ? idx + 1200 : end);
  assert(segment.includes("type: 'ci_failure'"), 'failure classification must produce a ci_failure blocker');
});

test('getMergeBlockers waits (ci_pending) when workflow runs are not yet terminal', () => {
  const idx = helpersSrc.indexOf("classification === 'pending'");
  assert(idx !== -1, 'pending classification branch should exist');
  const segment = helpersSrc.slice(idx, idx + 600);
  assert(segment.includes("type: 'ci_pending'"), 'pending classification must produce a ci_pending blocker');
});

test('watchUntilMergeable defers to ci_failure restart when cancellation coexists with a failure', () => {
  assert(autoMergeSrc.includes('ciFailureBlocker'), 'watchUntilMergeable should detect a coexisting ci_failure blocker');
  assert(autoMergeSrc.includes('cancelledBlocker && !billingBlocker && !ciFailureBlocker'), 'the cancelled-review path must be skipped when a ci_failure blocker is present');
});

console.log('\n================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

process.exit(failed === 0 ? 0 : 1);
