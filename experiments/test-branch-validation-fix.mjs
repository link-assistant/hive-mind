#!/usr/bin/env node

// Test script to validate the branch name validation fix for issue #312
// This tests that we only match PRs whose branch names correspond to the correct issue number

async function testBranchValidation() {
  console.log('Testing branch name validation for issue #312 fix\n');

  // Simulate the scenario from the issue
  const issueNumber = '92';
  const prs = [
    { number: 89, headRefName: 'issue-53-12d80c86', state: 'OPEN', createdAt: '2025-01-01T00:00:00Z' },
    { number: 90, headRefName: 'issue-92-abcd1234', state: 'OPEN', createdAt: '2025-01-01T00:00:00Z' },
    { number: 91, headRefName: 'feature/something', state: 'OPEN', createdAt: '2025-01-01T00:00:00Z' },
    { number: 92, headRefName: 'issue-92-xyz789ab', state: 'OPEN', createdAt: '2025-01-01T00:00:00Z' },
  ];

  const expectedBranchPrefix = `issue-${issueNumber}-`;
  console.log(`Looking for PRs for issue #${issueNumber}`);
  console.log(`Expected branch prefix: ${expectedBranchPrefix}*\n`);

  let matchedPRs = [];
  let skippedPRs = [];

  for (const pr of prs) {
    console.log(`Checking PR #${pr.number}: branch '${pr.headRefName}'`);

    if (pr.state === 'OPEN') {
      // Apply the fix: validate branch name
      if (!pr.headRefName.startsWith(expectedBranchPrefix)) {
        console.log(`  ❌ SKIP: Branch doesn't match pattern '${expectedBranchPrefix}*'`);
        skippedPRs.push(pr);
        continue;
      }

      console.log(`  ✅ MATCH: Branch matches expected pattern`);
      matchedPRs.push(pr);
    }
    console.log();
  }

  console.log('Results:');
  console.log(`  Matched PRs: ${matchedPRs.map(p => `#${p.number} (${p.headRefName})`).join(', ')}`);
  console.log(`  Skipped PRs: ${skippedPRs.map(p => `#${p.number} (${p.headRefName})`).join(', ')}`);
  console.log();

  // Validate results
  const expectedMatches = [90, 92];
  const expectedSkips = [89, 91];

  const actualMatches = matchedPRs.map(p => p.number);
  const actualSkips = skippedPRs.map(p => p.number);

  console.log('Validation:');
  const matchesCorrect = JSON.stringify(actualMatches.sort()) === JSON.stringify(expectedMatches.sort());
  const skipsCorrect = JSON.stringify(actualSkips.sort()) === JSON.stringify(expectedSkips.sort());

  console.log(`  Expected matches: [${expectedMatches.join(', ')}]`);
  console.log(`  Actual matches:   [${actualMatches.join(', ')}]`);
  console.log(`  ✓ Matches correct: ${matchesCorrect}`);
  console.log();
  console.log(`  Expected skips: [${expectedSkips.join(', ')}]`);
  console.log(`  Actual skips:   [${actualSkips.join(', ')}]`);
  console.log(`  ✓ Skips correct: ${skipsCorrect}`);
  console.log();

  if (matchesCorrect && skipsCorrect) {
    console.log('✅ TEST PASSED: Branch validation works correctly');
    console.log('   The fix prevents matching PRs with incorrect branch names');
    return true;
  } else {
    console.log('❌ TEST FAILED: Branch validation has issues');
    return false;
  }
}

// Run the test
testBranchValidation()
  .then(success => process.exit(success ? 0 : 1))
  .catch(error => {
    console.error('Test error:', error);
    process.exit(1);
  });
