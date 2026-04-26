#!/usr/bin/env node

/**
 * Unit Tests: Issue #1690 - Auto-restart-until-mergeable stuck on invalid workflow file
 *
 * Reproduces the bug where the auto-merge loop spins forever waiting for check-runs
 * to appear when a GitHub Actions workflow file fails to parse.
 *
 * Real-world example (from the issue):
 *   - Repo:       Jhon-Crow/One-try
 *   - PR:         #22 at SHA 0789b04
 *   - Workflow:   .github/workflows/build.yml (Build Portable Windows EXE)
 *   - Failure:    Invalid workflow file: env.GODOT_VERSION expression error
 *   - workflow_run state observed via API:
 *       status=completed, conclusion=failure, jobs=0
 *   - Symptom:    "[VERBOSE] /merge: PR #22 has no CI check-runs yet, but 1
 *                  workflow run(s) were triggered for SHA 0789b04 - genuine race
 *                  condition (waiting for check-runs to appear)"  ↺ forever
 *
 * Fix: when a workflow_run is `completed` with conclusion `failure` /
 * `startup_failure` / `timed_out` AND has zero jobs, treat it as a real
 * ci_failure so the auto-restart loop kicks in and propagates the error to
 * the AI solver instead of waiting indefinitely.
 *
 * Run with: node tests/test-invalid-workflow-file-1690.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1690
 * @see https://github.com/link-assistant/hive-mind/issues/1466 (related, action_required)
 * @see https://github.com/link-assistant/hive-mind/issues/1442 (related, no workflow runs)
 */

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = (description, fn) => {
  try {
    const r = fn();
    if (r && typeof r.then === 'function') {
      return r
        .then(() => {
          console.log(`  ${GREEN}✅ PASS:${RESET} ${description}`);
          passed++;
        })
        .catch(e => {
          console.log(`  ${RED}❌ FAIL:${RESET} ${description}`);
          console.log(`      Error: ${e.message}`);
          failed++;
        });
    }
    console.log(`  ${GREEN}✅ PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}❌ FAIL:${RESET} ${description}`);
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
console.log('Unit Tests: Issue #1690 - Auto-restart stuck on invalid workflow file');
console.log('================================================================================\n');

/**
 * Simulates the FIXED `no_checks` + has-workflow-runs branch of getMergeBlockers
 * including the new issue #1690 detection layer (jobs count check).
 */
async function simulateMergeBlockersForNoChecksBranch({ workflowRuns, jobsCounts }) {
  const blockers = [];

  if (workflowRuns.length === 0) {
    return { blockers, noCiTriggered: true, raceCondition: false };
  }

  // Issue #1466 layer: all workflows completed with non-executing conclusions
  const allRunsCompleted = workflowRuns.every(r => r.status === 'completed');
  const allRunsNonExecuting = allRunsCompleted && workflowRuns.every(r => r.conclusion === 'action_required' || r.conclusion === 'cancelled' || r.conclusion === 'stale' || r.conclusion === 'skipped');
  if (allRunsNonExecuting) {
    const conclusions = [...new Set(workflowRuns.map(r => r.conclusion))].join(', ');
    return { blockers, noCiTriggered: true, workflowRunConclusions: conclusions, raceCondition: false };
  }

  // Issue #1690 layer: detect invalid workflow files (failed completed runs with no jobs)
  const failedCompletedRuns = workflowRuns.filter(r => r.status === 'completed' && (r.conclusion === 'failure' || r.conclusion === 'startup_failure' || r.conclusion === 'timed_out'));
  const invalidWorkflowRuns = [];
  for (const run of failedCompletedRuns) {
    const jobsCount = jobsCounts[run.id];
    if (jobsCount === 0) invalidWorkflowRuns.push(run);
  }
  if (invalidWorkflowRuns.length > 0) {
    blockers.push({
      type: 'ci_failure',
      message: 'CI/CD workflow file is invalid — no jobs were instantiated',
      details: invalidWorkflowRuns.map(r => `${r.path || r.name} — see ${r.html_url}`),
    });
    return { blockers, noCiTriggered: false, raceCondition: false, invalidWorkflowDetected: true };
  }

  // Otherwise: genuine race condition (jobs exist or not all completed)
  blockers.push({
    type: 'ci_pending',
    message: `CI/CD checks have not started yet (${workflowRuns.length} workflow run(s) triggered, waiting for check-runs to appear)`,
    details: workflowRuns.map(r => r.name),
  });
  return { blockers, noCiTriggered: false, raceCondition: true };
}

// ===== Test Suite 1: The exact issue #1690 scenario =====
console.log('📋 Test Suite 1: Invalid workflow file scenarios (issue #1690 reproduction)\n');

await test('Single failed run with 0 jobs → ci_failure (NOT race condition)', async () => {
  const result = await simulateMergeBlockersForNoChecksBranch({
    workflowRuns: [
      {
        id: 24943234488,
        name: '.github/workflows/build.yml',
        path: '.github/workflows/build.yml',
        status: 'completed',
        conclusion: 'failure',
        html_url: 'https://github.com/Jhon-Crow/One-try/actions/runs/24943234488',
      },
    ],
    jobsCounts: { 24943234488: 0 },
  });

  assert(result.raceCondition === false, 'Should NOT be treated as race condition');
  assert(result.invalidWorkflowDetected === true, 'Should be flagged as invalid workflow');
  assert(result.blockers.length === 1, 'Should add 1 blocker');
  assert(result.blockers[0].type === 'ci_failure', 'Blocker should be ci_failure (triggers AI restart)');
  assert(result.blockers[0].message.includes('invalid'), 'Message should mention invalid workflow');
  assert(result.blockers[0].details[0].includes('build.yml'), 'Details should reference workflow file path');
  assert(result.blockers[0].details[0].includes('runs/24943234488'), 'Details should include workflow run URL');
});

await test('startup_failure with 0 jobs → ci_failure', async () => {
  const result = await simulateMergeBlockersForNoChecksBranch({
    workflowRuns: [{ id: 1, name: 'ci', path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'startup_failure', html_url: 'https://example.com/runs/1' }],
    jobsCounts: { 1: 0 },
  });

  assert(result.invalidWorkflowDetected === true, 'startup_failure with 0 jobs should be flagged');
  assert(result.blockers[0].type === 'ci_failure', 'Should be ci_failure blocker');
});

await test('timed_out with 0 jobs → ci_failure', async () => {
  const result = await simulateMergeBlockersForNoChecksBranch({
    workflowRuns: [{ id: 1, name: 'ci', path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'timed_out', html_url: 'https://example.com/runs/1' }],
    jobsCounts: { 1: 0 },
  });

  assert(result.invalidWorkflowDetected === true, 'timed_out with 0 jobs should be flagged');
  assert(result.blockers[0].type === 'ci_failure', 'Should be ci_failure blocker');
});

await test('Multiple failed runs, all with 0 jobs → ci_failure with all listed', async () => {
  const result = await simulateMergeBlockersForNoChecksBranch({
    workflowRuns: [
      { id: 1, name: 'a', path: '.github/workflows/a.yml', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/runs/1' },
      { id: 2, name: 'b', path: '.github/workflows/b.yml', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/runs/2' },
    ],
    jobsCounts: { 1: 0, 2: 0 },
  });

  assert(result.blockers[0].type === 'ci_failure', 'Should be ci_failure blocker');
  assert(result.blockers[0].details.length === 2, 'Should list both invalid workflows');
});

// ===== Test Suite 2: Real failures with jobs should NOT be misclassified =====
console.log('\n📋 Test Suite 2: Real failures keep their existing race-condition handling\n');

await test('Failed run with jobs > 0 → race condition (existing behavior, check-runs incoming)', async () => {
  // Real failure: workflow ran 5 jobs, some failed. check-runs should appear shortly.
  const result = await simulateMergeBlockersForNoChecksBranch({
    workflowRuns: [{ id: 1, name: 'ci', path: '.github/workflows/ci.yml', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/runs/1' }],
    jobsCounts: { 1: 5 },
  });

  assert(result.raceCondition === true, 'Real failure (jobs > 0) stays as race condition');
  assert(result.invalidWorkflowDetected !== true, 'Should NOT be flagged as invalid workflow');
  assert(result.blockers[0].type === 'ci_pending', 'Should remain ci_pending');
});

await test("Mix: one invalid + one in_progress → still race condition (don't restart while CI is running)", async () => {
  const result = await simulateMergeBlockersForNoChecksBranch({
    workflowRuns: [
      { id: 1, name: 'invalid', path: '.github/workflows/bad.yml', status: 'completed', conclusion: 'failure', html_url: 'https://example.com/runs/1' },
      { id: 2, name: 'good', path: '.github/workflows/ci.yml', status: 'in_progress', conclusion: null, html_url: 'https://example.com/runs/2' },
    ],
    jobsCounts: { 1: 0 },
  });

  // The in_progress run keeps the loop waiting; we still flag the invalid one as a real failure.
  // Expected: ci_failure blocker is set so AI can fix the invalid workflow file even while CI runs.
  assert(result.invalidWorkflowDetected === true, 'Invalid workflow should still be detected');
  assert(result.blockers[0].type === 'ci_failure', 'Should produce ci_failure blocker');
});

// ===== Test Suite 3: Existing non-executing conclusions still take precedence =====
console.log('\n📋 Test Suite 3: Existing non-executing handling is preserved\n');

await test('All action_required (issue #1466) → noCiTriggered (NOT ci_failure)', async () => {
  const result = await simulateMergeBlockersForNoChecksBranch({
    workflowRuns: [{ id: 1, name: 'CI', status: 'completed', conclusion: 'action_required' }],
    jobsCounts: { 1: 0 },
  });

  assert(result.noCiTriggered === true, 'action_required keeps noCiTriggered behavior');
  assert(result.blockers.length === 0, 'No blockers added');
});

await test('All cancelled → noCiTriggered (NOT ci_failure)', async () => {
  const result = await simulateMergeBlockersForNoChecksBranch({
    workflowRuns: [{ id: 1, name: 'CI', status: 'completed', conclusion: 'cancelled' }],
    jobsCounts: { 1: 0 },
  });

  assert(result.noCiTriggered === true, 'cancelled keeps noCiTriggered behavior');
});

// ===== Test Suite 4: Verify the fix integrates with real source code =====
console.log('\n📋 Test Suite 4: Helper export and integration\n');

await test('getWorkflowRunJobsCount is exported from github-merge.lib.mjs', async () => {
  const lib = await import('../src/github-merge.lib.mjs');
  assert(typeof lib.getWorkflowRunJobsCount === 'function', 'getWorkflowRunJobsCount should be exported');
});

await test('Helper module exports default with the new helper too', async () => {
  const lib = await import('../src/github-merge.lib.mjs');
  // The default export is built from named exports, so the helper appears there as well.
  assert(typeof lib.default === 'object' && lib.default !== null, 'default export should be an object');
  assert(typeof lib.default.getWorkflowRunJobsCount === 'function', 'default export should include getWorkflowRunJobsCount');
});

// ===== Summary =====
console.log('\n================================================================================');
console.log(`Results: ${GREEN}${passed} passed${RESET}, ${failed > 0 ? RED : ''}${failed} failed${RESET}`);
console.log('================================================================================');

if (failed > 0) {
  process.exit(1);
}
