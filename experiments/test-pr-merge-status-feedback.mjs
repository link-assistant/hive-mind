#!/usr/bin/env node

/**
 * Test for PR and merge status feedback (Issue #320)
 *
 * This test verifies that:
 * 1. PR state is reported when NOT "OPEN"
 * 2. Merge status is reported when NOT "CLEAN"
 * 3. PR state and merge status are NOT reported when in good states
 */

import { detectAndCountFeedback } from '../src/solve.feedback.lib.mjs';

console.log('🧪 Test: PR and Merge Status Feedback (Issue #320)');
console.log('================================================\n');

let testsPassed = 0;
let testsTotal = 0;

function test(name, testFn) {
  testsTotal++;
  console.log(`🔬 Test ${testsTotal}: ${name}`);
  try {
    const result = testFn();
    if (result) {
      console.log('   ✅ PASS\n');
      testsPassed++;
    } else {
      console.log('   ❌ FAIL\n');
    }
  } catch (error) {
    console.log(`   ❌ ERROR: ${error.message}\n`);
  }
}

// Mock $ function that returns empty data
const mock$ = async command => {
  // For user query
  if (command.join && command.join(' ').includes('gh api user')) {
    return { code: 0, stdout: 'testuser' };
  }
  // For git log
  if (command.join && command.join(' ').includes('git log')) {
    return { code: 0, stdout: new Date().toISOString() };
  }
  // For comments
  if (command.join && command.join(' ').includes('comments')) {
    return { code: 0, stdout: '[]' };
  }
  // For PR details
  if (command.join && command.join(' ').includes('repos/')) {
    return { code: 0, stdout: JSON.stringify({ updated_at: new Date(0).toISOString() }) };
  }
  // For commits
  if (command.join && command.join(' ').includes('commits')) {
    return { code: 0, stdout: '[]' };
  }
  // For check runs
  if (command.join && command.join(' ').includes('check-runs')) {
    return { code: 0, stdout: JSON.stringify({ check_runs: [] }) };
  }
  // For reviews
  if (command.join && command.join(' ').includes('reviews')) {
    return { code: 0, stdout: '[]' };
  }
  return { code: 1, stderr: 'Unknown command' };
};

const mockLog = async () => {};
const mockFormatAligned = (icon, label, value) => `${icon} ${label} ${value}`;
const mockCleanErrorMessage = error => error.message || error;

// Test 1: CLEAN merge status should NOT be reported
test('CLEAN merge status should NOT be reported', async () => {
  const result = await detectAndCountFeedback({
    prNumber: 1,
    branchName: 'test-branch',
    owner: 'owner',
    repo: 'repo',
    issueNumber: 1,
    isContinueMode: true,
    argv: { verbose: false },
    mergeStateStatus: 'CLEAN',
    prState: 'OPEN',
    workStartTime: null,
    log: mockLog,
    formatAligned: mockFormatAligned,
    cleanErrorMessage: mockCleanErrorMessage,
    $: mock$,
  });

  const hasMergeStatus = result.feedbackLines.some(line => line.toLowerCase().includes('merge status'));

  if (hasMergeStatus) {
    console.log('   FAILED: CLEAN merge status was reported but should not be');
    return false;
  }
  return true;
});

// Test 2: DIRTY merge status should be reported
test('DIRTY merge status should be reported', async () => {
  const result = await detectAndCountFeedback({
    prNumber: 1,
    branchName: 'test-branch',
    owner: 'owner',
    repo: 'repo',
    issueNumber: 1,
    isContinueMode: true,
    argv: { verbose: false },
    mergeStateStatus: 'DIRTY',
    prState: 'OPEN',
    workStartTime: null,
    log: mockLog,
    formatAligned: mockFormatAligned,
    cleanErrorMessage: mockCleanErrorMessage,
    $: mock$,
  });

  const hasDirtyStatus = result.feedbackLines.some(line => line.includes('Merge status is DIRTY'));

  if (!hasDirtyStatus) {
    console.log('   FAILED: DIRTY merge status was not reported');
    console.log('   Feedback lines:', result.feedbackLines);
    return false;
  }
  return true;
});

// Test 3: UNSTABLE merge status should be reported
test('UNSTABLE merge status should be reported', async () => {
  const result = await detectAndCountFeedback({
    prNumber: 1,
    branchName: 'test-branch',
    owner: 'owner',
    repo: 'repo',
    issueNumber: 1,
    isContinueMode: true,
    argv: { verbose: false },
    mergeStateStatus: 'UNSTABLE',
    prState: 'OPEN',
    workStartTime: null,
    log: mockLog,
    formatAligned: mockFormatAligned,
    cleanErrorMessage: mockCleanErrorMessage,
    $: mock$,
  });

  const hasUnstableStatus = result.feedbackLines.some(line => line.includes('Merge status is UNSTABLE'));

  if (!hasUnstableStatus) {
    console.log('   FAILED: UNSTABLE merge status was not reported');
    console.log('   Feedback lines:', result.feedbackLines);
    return false;
  }
  return true;
});

// Test 4: OPEN PR state should NOT be reported
test('OPEN PR state should NOT be reported', async () => {
  const result = await detectAndCountFeedback({
    prNumber: 1,
    branchName: 'test-branch',
    owner: 'owner',
    repo: 'repo',
    issueNumber: 1,
    isContinueMode: true,
    argv: { verbose: false },
    mergeStateStatus: 'CLEAN',
    prState: 'OPEN',
    workStartTime: null,
    log: mockLog,
    formatAligned: mockFormatAligned,
    cleanErrorMessage: mockCleanErrorMessage,
    $: mock$,
  });

  const hasPrState = result.feedbackLines.some(line => line.toLowerCase().includes('pull request state'));

  if (hasPrState) {
    console.log('   FAILED: OPEN PR state was reported but should not be');
    return false;
  }
  return true;
});

// Test 5: CLOSED PR state should be reported
test('CLOSED PR state should be reported', async () => {
  const result = await detectAndCountFeedback({
    prNumber: 1,
    branchName: 'test-branch',
    owner: 'owner',
    repo: 'repo',
    issueNumber: 1,
    isContinueMode: true,
    argv: { verbose: false },
    mergeStateStatus: 'CLEAN',
    prState: 'CLOSED',
    workStartTime: null,
    log: mockLog,
    formatAligned: mockFormatAligned,
    cleanErrorMessage: mockCleanErrorMessage,
    $: mock$,
  });

  const hasClosedState = result.feedbackLines.some(line => line.includes('Pull request state: CLOSED'));

  if (!hasClosedState) {
    console.log('   FAILED: CLOSED PR state was not reported');
    console.log('   Feedback lines:', result.feedbackLines);
    return false;
  }
  return true;
});

// Test 6: MERGED PR state should be reported
test('MERGED PR state should be reported', async () => {
  const result = await detectAndCountFeedback({
    prNumber: 1,
    branchName: 'test-branch',
    owner: 'owner',
    repo: 'repo',
    issueNumber: 1,
    isContinueMode: true,
    argv: { verbose: false },
    mergeStateStatus: 'CLEAN',
    prState: 'MERGED',
    workStartTime: null,
    log: mockLog,
    formatAligned: mockFormatAligned,
    cleanErrorMessage: mockCleanErrorMessage,
    $: mock$,
  });

  const hasMergedState = result.feedbackLines.some(line => line.includes('Pull request state: MERGED'));

  if (!hasMergedState) {
    console.log('   FAILED: MERGED PR state was not reported');
    console.log('   Feedback lines:', result.feedbackLines);
    return false;
  }
  return true;
});

// Test 7: Both non-clean merge status and non-open PR state should be reported
test('Both non-clean merge status and non-open PR state should be reported', async () => {
  const result = await detectAndCountFeedback({
    prNumber: 1,
    branchName: 'test-branch',
    owner: 'owner',
    repo: 'repo',
    issueNumber: 1,
    isContinueMode: true,
    argv: { verbose: false },
    mergeStateStatus: 'BLOCKED',
    prState: 'CLOSED',
    workStartTime: null,
    log: mockLog,
    formatAligned: mockFormatAligned,
    cleanErrorMessage: mockCleanErrorMessage,
    $: mock$,
  });

  const hasPrState = result.feedbackLines.some(line => line.includes('Pull request state: CLOSED'));
  const hasMergeStatus = result.feedbackLines.some(line => line.includes('Merge status is BLOCKED'));

  if (!hasPrState || !hasMergeStatus) {
    console.log('   FAILED: Both statuses should be reported');
    console.log('   Has PR state:', hasPrState);
    console.log('   Has merge status:', hasMergeStatus);
    console.log('   Feedback lines:', result.feedbackLines);
    return false;
  }
  return true;
});

console.log('\n' + '='.repeat(50));
console.log(`✅ Passed: ${testsPassed}/${testsTotal}`);
console.log(`❌ Failed: ${testsTotal - testsPassed}/${testsTotal}`);

if (testsPassed === testsTotal) {
  console.log('\n🎉 All tests passed!');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed');
  process.exit(1);
}
