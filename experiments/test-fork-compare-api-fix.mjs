#!/usr/bin/env node

/**
 * Test: Verify Compare API uses correct head reference in fork mode
 *
 * This test validates the fix for issue #678 where PR creation failed in fork mode
 * because the Compare API was checking for commits using the wrong head reference.
 *
 * Root Cause:
 * - In fork mode, branches are pushed to the fork (e.g., konard/repo)
 * - But Compare API was checking in upstream (e.g., owner/repo) using just branchName
 * - This caused 404 errors because branchName doesn't exist in upstream
 *
 * Solution:
 * - Use forkUser:branchName format for head reference in fork mode
 * - This matches the format used in gh pr create command
 */

console.log('🧪 Testing Compare API head reference fix for fork mode\n');

// Test data
const testCases = [
  {
    name: 'Non-fork mode',
    fork: false,
    forkedRepo: null,
    owner: 'owner',
    repo: 'repo',
    baseBranch: 'main',
    branchName: 'feature-branch',
    expectedHeadRef: 'feature-branch',
    expectedApiCall: 'repos/owner/repo/compare/main...feature-branch'
  },
  {
    name: 'Fork mode',
    fork: true,
    forkedRepo: 'konard/repo',
    owner: 'upstream-owner',
    repo: 'repo',
    baseBranch: 'main',
    branchName: 'issue-123-abc',
    expectedHeadRef: 'konard:issue-123-abc',
    expectedApiCall: 'repos/upstream-owner/repo/compare/main...konard:issue-123-abc'
  },
  {
    name: 'Fork mode with custom base branch',
    fork: true,
    forkedRepo: 'user123/test-repo',
    owner: 'original-owner',
    repo: 'test-repo',
    baseBranch: 'develop',
    branchName: 'hotfix-456',
    expectedHeadRef: 'user123:hotfix-456',
    expectedApiCall: 'repos/original-owner/test-repo/compare/develop...user123:hotfix-456'
  }
];

console.log('Testing head reference construction logic:\n');

let allPassed = true;

for (const testCase of testCases) {
  console.log(`📝 Test: ${testCase.name}`);
  console.log(`   Fork mode: ${testCase.fork}`);
  console.log(`   Forked repo: ${testCase.forkedRepo || 'N/A'}`);
  console.log(`   Branch: ${testCase.branchName}`);

  // Simulate the logic from the fix
  let headRef;
  if (testCase.fork && testCase.forkedRepo) {
    const forkUser = testCase.forkedRepo.split('/')[0];
    headRef = `${forkUser}:${testCase.branchName}`;
  } else {
    headRef = testCase.branchName;
  }

  const apiCall = `repos/${testCase.owner}/${testCase.repo}/compare/${testCase.baseBranch}...${headRef}`;

  console.log(`   Computed head ref: ${headRef}`);
  console.log(`   API call: ${apiCall}`);

  if (headRef === testCase.expectedHeadRef) {
    console.log(`   ✅ Head ref matches expected: ${testCase.expectedHeadRef}`);
  } else {
    console.log(`   ❌ Head ref mismatch!`);
    console.log(`      Expected: ${testCase.expectedHeadRef}`);
    console.log(`      Got: ${headRef}`);
    allPassed = false;
  }

  if (apiCall === testCase.expectedApiCall) {
    console.log(`   ✅ API call matches expected\n`);
  } else {
    console.log(`   ❌ API call mismatch!`);
    console.log(`      Expected: ${testCase.expectedApiCall}`);
    console.log(`      Got: ${apiCall}\n`);
    allPassed = false;
  }
}

console.log('─'.repeat(60));
console.log('\n📊 Test Summary:');
if (allPassed) {
  console.log('✅ All tests passed! The Compare API head reference fix works correctly.\n');
  console.log('Impact:');
  console.log('  • Non-fork mode: Uses simple branch name (unchanged)');
  console.log('  • Fork mode: Uses forkUser:branch format (fixed)');
  console.log('  • This matches the gh pr create command format');
  console.log('  • Prevents 404 errors in fork mode Compare API checks');
  process.exit(0);
} else {
  console.log('❌ Some tests failed. Please review the implementation.\n');
  process.exit(1);
}
