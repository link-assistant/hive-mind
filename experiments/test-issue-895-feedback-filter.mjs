#!/usr/bin/env node
/**
 * Test script for Issue #895 fix: PR description edit feedback filtering
 *
 * This tests the logic that prevents infinite restart loops when the agent
 * updates the PR description during its work session.
 *
 * The fix filters out PR/issue description edits that occurred after workStartTime,
 * since these are likely the agent's own edits rather than external feedback.
 */

// Test scenarios
const testScenarios = [
  {
    name: 'PR edited after commit but before work started (external feedback)',
    lastCommitTime: new Date('2025-12-09T10:00:00Z'),
    workStartTime: new Date('2025-12-09T11:00:00Z'),
    prUpdatedAt: new Date('2025-12-09T10:30:00Z'), // Between commit and work start
    expectedFeedback: true,
    expectedReason: 'External edit - should trigger restart'
  },
  {
    name: 'PR edited after work started (agent self-edit)',
    lastCommitTime: new Date('2025-12-09T10:00:00Z'),
    workStartTime: new Date('2025-12-09T11:00:00Z'),
    prUpdatedAt: new Date('2025-12-09T11:30:00Z'), // After work started
    expectedFeedback: false,
    expectedReason: 'Agent self-edit - should NOT trigger restart'
  },
  {
    name: 'PR edited before commit (no feedback)',
    lastCommitTime: new Date('2025-12-09T10:00:00Z'),
    workStartTime: new Date('2025-12-09T11:00:00Z'),
    prUpdatedAt: new Date('2025-12-09T09:00:00Z'), // Before commit
    expectedFeedback: false,
    expectedReason: 'Old edit - no feedback needed'
  },
  {
    name: 'No workStartTime provided (legacy behavior)',
    lastCommitTime: new Date('2025-12-09T10:00:00Z'),
    workStartTime: null,
    prUpdatedAt: new Date('2025-12-09T10:30:00Z'), // After commit
    expectedFeedback: true,
    expectedReason: 'Without workStartTime, treat all post-commit edits as feedback'
  },
  {
    name: 'Issue edited after work started (agent self-edit)',
    lastCommitTime: new Date('2025-12-09T10:00:00Z'),
    workStartTime: new Date('2025-12-09T11:00:00Z'),
    issueUpdatedAt: new Date('2025-12-09T11:30:00Z'), // After work started
    expectedFeedback: false,
    expectedReason: 'Agent self-edit on issue - should NOT trigger restart'
  }
];

/**
 * Simulate the feedback detection logic from solve.feedback.lib.mjs
 */
function detectPrEditFeedback({ lastCommitTime, workStartTime, prUpdatedAt }) {
  let feedbackDetected = false;

  if (prUpdatedAt > lastCommitTime) {
    // Issue #895: Check if the edit happened during current work session
    if (workStartTime && prUpdatedAt > new Date(workStartTime)) {
      // Don't treat this as external feedback
      console.log('   Note: PR description updated during current work session (likely by agent itself) - ignoring');
    } else {
      // The PR was updated after last commit but before work started - external feedback
      feedbackDetected = true;
    }
  }

  return feedbackDetected;
}

function detectIssueEditFeedback({ lastCommitTime, workStartTime, issueUpdatedAt }) {
  let feedbackDetected = false;

  if (issueUpdatedAt > lastCommitTime) {
    // Issue #895: Check if the edit happened during current work session
    if (workStartTime && issueUpdatedAt > new Date(workStartTime)) {
      // Don't treat this as external feedback
      console.log('   Note: Issue description updated during current work session (likely by agent itself) - ignoring');
    } else {
      // The issue was updated after last commit but before work started - external feedback
      feedbackDetected = true;
    }
  }

  return feedbackDetected;
}

// Run tests
console.log('Testing Issue #895 Fix: PR Description Edit Feedback Filtering\n');
console.log('='.repeat(70));

let passed = 0;
let failed = 0;

for (const scenario of testScenarios) {
  console.log(`\nTest: ${scenario.name}`);
  console.log('-'.repeat(70));

  let result;
  if (scenario.prUpdatedAt) {
    result = detectPrEditFeedback({
      lastCommitTime: scenario.lastCommitTime,
      workStartTime: scenario.workStartTime,
      prUpdatedAt: scenario.prUpdatedAt
    });
  } else if (scenario.issueUpdatedAt) {
    result = detectIssueEditFeedback({
      lastCommitTime: scenario.lastCommitTime,
      workStartTime: scenario.workStartTime,
      issueUpdatedAt: scenario.issueUpdatedAt
    });
  }

  const status = result === scenario.expectedFeedback ? 'PASS' : 'FAIL';

  console.log(`  Last commit time:  ${scenario.lastCommitTime?.toISOString() || 'null'}`);
  console.log(`  Work start time:   ${scenario.workStartTime?.toISOString() || 'null'}`);
  console.log(`  PR/Issue updated:  ${(scenario.prUpdatedAt || scenario.issueUpdatedAt)?.toISOString() || 'null'}`);
  console.log(`  Expected feedback: ${scenario.expectedFeedback}`);
  console.log(`  Actual feedback:   ${result}`);
  console.log(`  Reason:            ${scenario.expectedReason}`);
  console.log(`  Status:            ${status === 'PASS' ? '✅ ' : '❌ '}${status}`);

  if (status === 'PASS') {
    passed++;
  } else {
    failed++;
  }
}

console.log('\n' + '='.repeat(70));
console.log(`Results: ${passed} passed, ${failed} failed, ${testScenarios.length} total`);
console.log('='.repeat(70));

if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
