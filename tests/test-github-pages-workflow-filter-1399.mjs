#!/usr/bin/env node

/**
 * Unit Tests: Issue #1399 — GitHub Pages deployment workflow causes infinite loop
 *
 * Tests verify that:
 * 1. GitHub Pages deployment workflows (path: "dynamic/pages/...") are filtered out
 *    from getActiveRepoWorkflows() so they don't cause infinite loops when waiting for PR CI
 * 2. Repos with ONLY a pages-build-deployment workflow are correctly treated as "no CI configured"
 * 3. Repos with BOTH user-defined CI workflows AND a pages workflow still correctly detect CI
 * 4. Backward compatibility: repos with real CI workflows still correctly wait for CI checks
 *
 * Root cause: getActiveRepoWorkflows() counted pages-build-deployment as a "CI workflow"
 * causing an infinite loop — the tool waited forever for check-runs that would never appear
 * on PR branches (GitHub Pages deployment only runs on the default branch after merge).
 *
 * Run with: node tests/test-github-pages-workflow-filter-1399.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1399
 * @see https://github.com/link-assistant/hive-mind/issues/1363 (related)
 * @see https://github.com/link-assistant/hive-mind/issues/1345 (related)
 */

// ANSI color codes for terminal output
const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = (description, fn) => {
  try {
    fn();
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

/**
 * Simulates the FIXED getActiveRepoWorkflows logic.
 * Mirrors the actual logic in src/github-merge.lib.mjs after the issue #1399 fix.
 */
function simulateFilteredWorkflows(allWorkflows) {
  // Issue #1399: Filter out GitHub Pages deployment workflows.
  // These have path "dynamic/pages/pages-build-deployment" and only run on the
  // default branch after merge — they never produce check-runs on PR branches.
  const workflows = allWorkflows.filter(wf => !wf.path.startsWith('dynamic/pages/'));

  return {
    count: workflows.length,
    hasWorkflows: workflows.length > 0,
    workflows,
  };
}

/**
 * Simulates the full getMergeBlockers logic for the `no_checks` path.
 * Mirrors the actual logic in src/solve.auto-merge.lib.mjs.
 */
function simulateNoCiLogic({ ciStatus, mergeStatus, repoWorkflows }) {
  const blockers = [];
  let noCiConfigured = false;

  if (ciStatus.status === 'no_checks') {
    if (mergeStatus.mergeable) {
      if (repoWorkflows.hasWorkflows) {
        blockers.push({
          type: 'ci_pending',
          message: `CI/CD checks have not started yet (${repoWorkflows.count} workflow(s) configured, waiting for checks to appear)`,
          details: repoWorkflows.workflows.map(wf => wf.name),
        });
      } else {
        noCiConfigured = true;
        return { blockers, noCiConfigured, earlyReturn: true };
      }
    } else {
      blockers.push({
        type: 'ci_pending',
        message: 'CI/CD checks have not started yet (waiting for checks to appear)',
        details: [],
      });
    }
  }

  return { blockers, noCiConfigured, earlyReturn: false };
}

// Common test fixture: the exact pages-build-deployment workflow from konard/links-visuals
const pagesWorkflow = { id: 144453964, name: 'pages-build-deployment', path: 'dynamic/pages/pages-build-deployment', state: 'active' };
// Common CI status for the no_checks scenario
const noChecksCiStatus = { status: 'no_checks', checks: [] };
// Mergeable PR status (mergeStateStatus=CLEAN)
const mergeableStatus = { mergeable: true, reason: null };

console.log('================================================================================');
console.log('Unit Tests: Issue #1399 — GitHub Pages deployment workflow causes infinite loop');
console.log('================================================================================\n');

// ===== Test: Workflow path filtering =====
console.log('📋 GitHub Pages Deployment Workflow Filtering\n');

test('pages-build-deployment workflow (dynamic/pages/ path) is filtered out', () => {
  const result = simulateFilteredWorkflows([pagesWorkflow]);

  assert(result.count === 0, `Expected 0 workflows after filtering, got ${result.count}`);
  assert(result.hasWorkflows === false, 'hasWorkflows should be false after filtering pages workflow');
  assert(result.workflows.length === 0, 'workflows array should be empty after filtering');
});

test('User-defined CI workflow (.github/workflows/ path) is NOT filtered out', () => {
  const allWorkflows = [{ id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' }];
  const result = simulateFilteredWorkflows(allWorkflows);

  assert(result.count === 1, `Expected 1 workflow, got ${result.count}`);
  assert(result.hasWorkflows === true, 'hasWorkflows should be true for user-defined CI');
  assert(result.workflows[0].name === 'CI', 'CI workflow should be in result');
});

test('Repo with BOTH pages-build-deployment AND user CI workflows: only CI workflows remain', () => {
  const allWorkflows = [pagesWorkflow, { id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' }, { id: 2, name: 'Deploy', path: '.github/workflows/deploy.yml', state: 'active' }];
  const result = simulateFilteredWorkflows(allWorkflows);

  assert(result.count === 2, `Expected 2 workflows after filtering, got ${result.count}`);
  assert(result.hasWorkflows === true, 'hasWorkflows should be true — real CI workflows remain');
  assert(
    result.workflows.every(wf => !wf.path.startsWith('dynamic/pages/')),
    'No dynamic/pages/ workflows should remain'
  );
});

test('Repo with ONLY pages-build-deployment: hasWorkflows=false after filtering', () => {
  // This is the exact scenario from issue #1399: konard/links-visuals
  const result = simulateFilteredWorkflows([pagesWorkflow]);

  assert(result.hasWorkflows === false, 'hasWorkflows must be false for repos with only GitHub Pages deployment');
  assert(result.count === 0, 'count must be 0 for repos with only GitHub Pages deployment');
});

test('Repo with no workflows at all: result unchanged', () => {
  const result = simulateFilteredWorkflows([]);

  assert(result.count === 0, 'Expected 0 workflows');
  assert(result.hasWorkflows === false, 'hasWorkflows should be false');
});

test('Other dynamic/ paths (not dynamic/pages/) are not filtered', () => {
  // Only dynamic/pages/ should be filtered, not other dynamic paths
  const allWorkflows = [{ id: 1, name: 'some-dynamic-workflow', path: 'dynamic/other/workflow', state: 'active' }];
  const result = simulateFilteredWorkflows(allWorkflows);

  assert(result.count === 1, 'Non-pages dynamic workflows should not be filtered');
  assert(result.hasWorkflows === true, 'hasWorkflows should be true for non-pages dynamic workflows');
});

// ===== Test: Full no-CI logic with pages-build-deployment =====
console.log('\n📋 Full No-CI Logic: Repository with Only GitHub Pages Deployment\n');

test('Issue #1399 scenario: no_checks + MERGEABLE + only pages workflow → noCiConfigured=true (fixes infinite loop)', () => {
  // This is the exact scenario that caused the bug:
  // - konard/links-visuals has ONLY pages-build-deployment
  // - PR is MERGEABLE (mergeStateStatus=CLEAN)
  // - check-runs are empty (pages-build-deployment never runs on PR branches)
  const result = simulateNoCiLogic({
    ciStatus: noChecksCiStatus,
    mergeStatus: mergeableStatus,
    repoWorkflows: simulateFilteredWorkflows([pagesWorkflow]),
  });

  assert(result.noCiConfigured === true, 'noCiConfigured must be true — pages-build-deployment is not a PR CI check');
  assert(result.blockers.length === 0, 'No blockers should be added — this prevents the infinite loop');
  assert(result.earlyReturn === true, 'Must early-return so PR is declared mergeable');
});

test('Before fix: pages-build-deployment counted as workflow → infinite loop', () => {
  // Document the OLD broken behavior (before issue #1399 fix)
  // OLD CODE (broken): did not filter dynamic/pages/ workflows
  const brokenFilteredWorkflows = {
    count: 1, // Was 1 — pages-build-deployment included
    hasWorkflows: true, // Was true — causing the bug
    workflows: [pagesWorkflow],
  };

  const result = simulateNoCiLogic({
    ciStatus: noChecksCiStatus,
    mergeStatus: mergeableStatus,
    repoWorkflows: brokenFilteredWorkflows,
  });

  // Old behavior: adds ci_pending blocker and loops forever
  assert(result.noCiConfigured === false, 'Old behavior: noCiConfigured=false (incorrect)');
  assert(result.blockers.length === 1, 'Old behavior: adds ci_pending blocker (causes infinite loop)');
  assert(result.blockers[0].type === 'ci_pending', 'Old behavior: blocker type is ci_pending');
  assert(!result.earlyReturn, 'Old behavior: no early return — infinite loop continues');
});

// ===== Test: Backward compatibility with prior fixes =====
console.log('\n📋 Backward Compatibility with Issues #1345 and #1363\n');

test('#1345 compatibility: repo with no workflows at all → noCiConfigured=true', () => {
  // Repos with absolutely no workflows (not even pages) should still work
  const result = simulateNoCiLogic({
    ciStatus: noChecksCiStatus,
    mergeStatus: mergeableStatus,
    repoWorkflows: simulateFilteredWorkflows([]),
  });

  assert(result.noCiConfigured === true, 'No workflows at all → noCiConfigured=true');
  assert(result.blockers.length === 0, 'No blockers for repos with no workflows');
  assert(result.earlyReturn === true, 'Must early-return for repos with no CI');
});

test('#1363 compatibility: repo with real CI workflows + pages workflow → race condition detected', () => {
  // Repos with real CI workflows (+ pages) should still wait for CI to start
  const allWorkflows = [pagesWorkflow, { id: 1, name: 'CI/CD Pipeline', path: '.github/workflows/ci.yml', state: 'active' }, { id: 2, name: 'Update Screenshots', path: '.github/workflows/screenshots.yml', state: 'active' }];
  const filteredWorkflows = simulateFilteredWorkflows(allWorkflows);

  const result = simulateNoCiLogic({
    ciStatus: noChecksCiStatus,
    mergeStatus: mergeableStatus, // CLEAN — no required checks
    repoWorkflows: filteredWorkflows,
  });

  assert(result.noCiConfigured === false, 'Repo with real CI workflows → noCiConfigured=false');
  assert(result.blockers.length === 1, 'Should add ci_pending blocker to wait for CI to start');
  assert(result.blockers[0].type === 'ci_pending', 'Blocker type should be ci_pending');
  assert(filteredWorkflows.count === 2, 'Only 2 real CI workflows, pages-build-deployment filtered out');
  assert(!result.earlyReturn, 'Must NOT early-return — must wait for CI');
});

test('#1363 compatibility: repo with real CI + pages → blocker message counts only real CI workflows', () => {
  const allWorkflows = [pagesWorkflow, { id: 1, name: 'CI', path: '.github/workflows/ci.yml', state: 'active' }];
  const filteredWorkflows = simulateFilteredWorkflows(allWorkflows);

  const result = simulateNoCiLogic({
    ciStatus: noChecksCiStatus,
    mergeStatus: mergeableStatus,
    repoWorkflows: filteredWorkflows,
  });

  // Blocker message should say "1 workflow(s)" not "2 workflow(s)"
  assert(result.blockers[0].message.includes('1 workflow(s)'), `Message should mention 1 workflow (pages filtered), got: "${result.blockers[0].message}"`);
  assert(!result.blockers[0].details.includes('pages-build-deployment'), 'pages-build-deployment should not appear in blocker details');
  assert(result.blockers[0].details.includes('CI'), 'Real CI workflow should appear in blocker details');
});

test('#1345 race condition preserved: no_checks + NOT MERGEABLE → always ci_pending', () => {
  // When PR is not yet mergeable, always treat as race condition regardless of workflows
  const result = simulateNoCiLogic({
    ciStatus: noChecksCiStatus,
    mergeStatus: { mergeable: false, reason: 'Merge state: UNKNOWN' },
    repoWorkflows: simulateFilteredWorkflows([pagesWorkflow]),
  });

  // When PR is not MERGEABLE, we always add ci_pending (race condition)
  // even if pages-workflow is filtered out — the MERGEABLE state drives this check
  assert(result.noCiConfigured === false, 'noCiConfigured=false when PR is not MERGEABLE');
  assert(result.blockers.length === 1, 'Should add ci_pending blocker when PR not MERGEABLE');
  assert(result.blockers[0].type === 'ci_pending', 'Blocker type should be ci_pending');
});

// ===== Test: Edge cases =====
console.log('\n📋 Edge Cases\n');

test('Multiple pages workflows with dynamic/pages/ path are all filtered', () => {
  // Edge case: multiple pages-related dynamic workflows
  const allWorkflows = [
    { id: 1, name: 'pages-build-deployment', path: 'dynamic/pages/pages-build-deployment', state: 'active' },
    { id: 2, name: 'pages-other', path: 'dynamic/pages/pages-other', state: 'active' },
  ];
  const result = simulateFilteredWorkflows(allWorkflows);

  assert(result.count === 0, 'All dynamic/pages/ workflows should be filtered out');
  assert(result.hasWorkflows === false, 'hasWorkflows should be false after filtering all pages workflows');
});

test('Workflow path exactly equal to "dynamic/pages/" prefix is filtered', () => {
  const allWorkflows = [{ id: 1, name: 'custom-pages', path: 'dynamic/pages/custom', state: 'active' }];
  const result = simulateFilteredWorkflows(allWorkflows);

  assert(result.count === 0, 'Workflow with dynamic/pages/ prefix should be filtered');
  assert(result.hasWorkflows === false, 'hasWorkflows should be false');
});

test('Real-world scenario: links-visuals repo (issue #1399) is now treated as no CI configured', () => {
  // Exact reproduction of the konard/links-visuals scenario:
  // - Only workflow: pages-build-deployment at dynamic/pages/pages-build-deployment
  // - PR #5: mergeStateStatus=CLEAN, check-runs=[], check-suites=[queued, no runs]
  const result = simulateNoCiLogic({
    ciStatus: noChecksCiStatus, // check-runs API returned []
    mergeStatus: mergeableStatus, // mergeStateStatus=CLEAN
    repoWorkflows: simulateFilteredWorkflows([pagesWorkflow]),
  });

  // Expected: PR is treated as immediately mergeable, "Ready to merge" comment posted
  assert(result.noCiConfigured === true, 'links-visuals PR #5 must be treated as noCiConfigured=true');
  assert(result.blockers.length === 0, 'No blockers — PR should be declared ready to merge');
  assert(result.earlyReturn === true, 'Must early-return so "Ready to merge" comment is posted');
});

// Summary
console.log('\n================================================================================');
console.log(`Test Results for Issue #1399:`);
console.log(`  ${GREEN}✅ Passed:${RESET} ${passed}`);
console.log(`  ${RED}❌ Failed:${RESET} ${failed}`);
console.log(`  Total: ${passed + failed}`);
console.log('================================================================================\n');

if (failed > 0) {
  console.log(`${RED}❌ Some tests failed!${RESET}`);
  process.exit(1);
} else {
  console.log(`${GREEN}✅ All tests passed!${RESET}`);
  process.exit(0);
}
