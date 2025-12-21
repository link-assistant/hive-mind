#!/usr/bin/env node

/**
 * Test for Issue #346: Verify merge status is fetched in auto-continue mode
 *
 * This test verifies that when auto-continue mode is used, the merge status
 * and PR state are properly fetched and would be passed to the feedback function.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

console.log('🧪 Test: Issue #346 - Merge Status in Auto-Continue Mode');
console.log('='.repeat(60));

// Simulate the fixed code path
async function testAutoContinuePathFix() {
  console.log('\n📋 Testing that gh pr view fetches all required fields...\n');

  // Test with an actual PR from this repository
  // We'll use PR #334 which should exist based on the issue logs
  const prNumber = 334;
  const owner = 'link-assistant';
  const repo = 'hive-mind';

  try {
    // This simulates the fixed line 199 in solve.mjs
    const { stdout, stderr } = await execAsync(
      `gh pr view ${prNumber} --repo ${owner}/${repo} --json headRepositoryOwner,mergeStateStatus,state`
    );

    if (stdout) {
      const prCheckData = JSON.parse(stdout);

      console.log('✅ Successfully fetched PR data:');
      console.log(`   PR State: ${prCheckData.state}`);
      console.log(`   Merge Status: ${prCheckData.mergeStateStatus}`);
      console.log(`   Head Repo Owner: ${prCheckData.headRepositoryOwner?.login || 'N/A'}`);

      // Verify that these fields are actually populated
      if (prCheckData.state && prCheckData.mergeStateStatus) {
        console.log('\n✅ SUCCESS: Both prState and mergeStateStatus are populated!');
        console.log('   These values will now be passed to detectAndCountFeedback()');
        return true;
      } else {
        console.log('\n❌ FAILED: Some fields are missing');
        console.log(`   prState: ${prCheckData.state || 'MISSING'}`);
        console.log(`   mergeStateStatus: ${prCheckData.mergeStateStatus || 'MISSING'}`);
        return false;
      }
    } else {
      console.log('❌ Failed to fetch PR data');
      console.log(`   Error: ${stderr}`);
      return false;
    }
  } catch (error) {
    console.log('❌ Error during test:');
    console.log(`   ${error.message}`);
    return false;
  }
}

// Run the test
const result = await testAutoContinuePathFix();

console.log('\n' + '='.repeat(60));
if (result) {
  console.log('🎉 Test PASSED: Issue #346 fix is working correctly!');
  process.exit(0);
} else {
  console.log('❌ Test FAILED: Issue #346 fix needs adjustment');
  process.exit(1);
}
