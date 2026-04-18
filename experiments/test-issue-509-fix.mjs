#!/usr/bin/env node

/**
 * Test script for issue #509 fix
 * Verifies that swap memory is properly displayed in error messages
 */

// Temporarily unset CI to avoid command-stream trace logs
const originalCI = process.env.CI;
delete process.env.CI;

import { checkRAM } from '../src/memory-check.mjs';

async function testSwapDisplayInErrors() {
  console.log('Testing swap display in error messages for issue #509\n');

  // Collect log messages
  const logMessages = [];
  const mockLog = async message => {
    logMessages.push(message);
    console.log(message);
  };

  // Test with impossibly high memory requirement to trigger failure
  console.log('Test 1: High memory requirement (should fail and show swap)');
  console.log('='.repeat(60));
  const result = await checkRAM(999999, { log: mockLog });
  console.log('\nResult:', JSON.stringify(result, null, 2));

  // Verify that error message contains swap information
  const errorMessage = logMessages.find(msg => msg.includes('Insufficient memory'));

  if (!errorMessage) {
    console.log('\n❌ FAIL: No "Insufficient memory" error message found');
    process.exit(1);
  }

  console.log('\n✅ Found error message:', errorMessage);

  // Check that swap info is present in the error message
  if (!errorMessage.includes('swap:') && !errorMessage.includes('page file:')) {
    console.log('❌ FAIL: Error message does not contain swap information');
    console.log('   Error message should include swap details');
    process.exit(1);
  }

  console.log('✅ PASS: Error message contains swap information');

  // Check that total memory is shown
  if (!errorMessage.includes('total:')) {
    console.log('❌ FAIL: Error message does not contain total memory');
    console.log('   Error message should include total available memory (RAM + swap)');
    process.exit(1);
  }

  console.log('✅ PASS: Error message contains total memory information');

  // Verify that swap and totalAvailable are in the result object
  if (result.swap === undefined) {
    console.log('❌ FAIL: Result object missing swap property');
    process.exit(1);
  }

  console.log('✅ PASS: Result object contains swap property:', result.swap);

  if (result.totalAvailable === undefined) {
    console.log('❌ FAIL: Result object missing totalAvailable property');
    process.exit(1);
  }

  console.log('✅ PASS: Result object contains totalAvailable property:', result.totalAvailable, 'MB');

  console.log('\n' + '='.repeat(60));
  console.log('✅ All tests passed! Issue #509 is fixed.');
  console.log('   Swap memory is now properly displayed in error messages.');
}

testSwapDisplayInErrors()
  .catch(error => {
    console.error('\n❌ Test failed with error:', error);
    process.exit(1);
  })
  .finally(() => {
    // Restore CI if it was set
    if (originalCI !== undefined) {
      process.env.CI = originalCI;
    }
  });
