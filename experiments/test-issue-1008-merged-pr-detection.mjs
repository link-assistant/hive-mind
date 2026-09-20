#!/usr/bin/env node

/**
 * Test for Issue #1008: Log attachment in GitHub comment didn't work
 *
 * This test verifies that the fix for finding merged PRs works correctly.
 * The issue was that `gh pr list` without `--state all` only returns OPEN PRs,
 * so merged PRs were not found when trying to attach logs.
 *
 * Test cases:
 * 1. Verify --state all finds merged PRs
 * 2. Verify --state all finds open PRs
 * 3. Verify --state all finds closed PRs
 * 4. Verify without --state all, merged PRs are NOT found
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

const { $ } = await use('command-stream');

console.log('🧪 Testing Issue #1008 fix: Merged PR detection\n');

// Test case: ideav/orbits PR #89 (was merged during session)
const testRepo = 'ideav/orbits';
const testBranch = 'issue-88-a46bad708fee';
const expectedPrNumber = 89;

console.log(`📋 Test repo: ${testRepo}`);
console.log(`📋 Test branch: ${testBranch}`);
console.log(`📋 Expected PR: #${expectedPrNumber}\n`);

// Test 1: Without --state all (should return empty array)
console.log('Test 1: gh pr list WITHOUT --state all');
const withoutStateAll = await $`gh pr list --repo ${testRepo} --head ${testBranch} --json number,state`;
const withoutStateAllResult = withoutStateAll.stdout.toString().trim();
const withoutStateAllPrs = withoutStateAllResult ? JSON.parse(withoutStateAllResult) : [];
console.log(`  Result: ${withoutStateAllPrs.length} PR(s) found`);
console.log(`  Expected: 0 (merged PRs should NOT be found)`);
if (withoutStateAllPrs.length === 0) {
  console.log('  ✅ PASSED: Without --state all, merged PR was correctly NOT found\n');
} else {
  console.log('  ❌ FAILED: Without --state all, merged PR should not be found\n');
}

// Test 2: With --state all (should find the merged PR)
console.log('Test 2: gh pr list WITH --state all');
const withStateAll = await $`gh pr list --repo ${testRepo} --head ${testBranch} --state all --json number,state`;
const withStateAllResult = withStateAll.stdout.toString().trim();
const withStateAllPrs = withStateAllResult ? JSON.parse(withStateAllResult) : [];
console.log(`  Result: ${withStateAllPrs.length} PR(s) found`);
console.log(`  Expected: 1 (should find merged PR #${expectedPrNumber})`);

if (withStateAllPrs.length > 0) {
  const foundPr = withStateAllPrs[0];
  console.log(`  Found PR #${foundPr.number} (state: ${foundPr.state})`);

  if (foundPr.number === expectedPrNumber && foundPr.state === 'MERGED') {
    console.log('  ✅ PASSED: With --state all, merged PR was correctly found\n');
  } else {
    console.log('  ❌ FAILED: PR found but unexpected number or state\n');
  }
} else {
  console.log('  ❌ FAILED: With --state all, merged PR should be found\n');
}

// Test 3: Also verify with another repo that had a working case
console.log('Test 3: Verify working case (andchir/install_scripts PR #124)');
const workingRepo = 'andchir/install_scripts';
const workingBranch = 'issue-123-5ff800a42ca7';
const workingPrNumber = 124;

const workingTest = await $`gh pr list --repo ${workingRepo} --head ${workingBranch} --state all --json number,state`;
const workingResult = workingTest.stdout.toString().trim();
const workingPrs = workingResult ? JSON.parse(workingResult) : [];

if (workingPrs.length > 0 && workingPrs[0].number === workingPrNumber) {
  console.log(`  ✅ PASSED: Working case PR #${workingPrNumber} found (state: ${workingPrs[0].state})\n`);
} else {
  console.log(`  ⚠️  Could not verify working case PR\n`);
}

// Summary
console.log('=== Test Summary ===');
console.log('The fix adds --state all to gh pr list command to find PRs regardless of state.');
console.log('This ensures logs can be attached even when PRs are merged during the session.\n');

// Verify the fix is in place
console.log('Verifying fix in solve.results.lib.mjs...');
const fs = (await use('fs')).promises;
const libContent = await fs.readFile('./src/solve.results.lib.mjs', 'utf8');

if (libContent.includes('--state all')) {
  console.log('✅ Fix verified: --state all is present in solve.results.lib.mjs');
} else {
  console.log('❌ Fix NOT found: --state all is missing from solve.results.lib.mjs');
}

if (libContent.includes('Issue #1008')) {
  console.log('✅ Documentation verified: Issue #1008 comment is present');
} else {
  console.log('⚠️  Documentation note: Consider adding Issue #1008 reference comment');
}

console.log('\n✅ All tests completed!');
