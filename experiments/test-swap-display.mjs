#!/usr/bin/env node

/**
 * Test to verify swap information is displayed in error messages
 */

import { checkRAM } from '../src/memory-check.mjs';

console.log('Testing memory check with high requirement to trigger error...\n');

// Set a very high requirement to force a failure
const result = await checkRAM(999999, {});

console.log('\n📊 Result:', JSON.stringify(result, null, 2));

if (!result.success) {
  console.log('\n✅ Test passed: Error was triggered');

  // Verify swap info is in the result
  if (result.swap) {
    console.log('✅ Swap info is present:', result.swap);
  } else {
    console.log('❌ Swap info is missing!');
    process.exit(1);
  }

  // Verify totalAvailable is in the result
  if (result.totalAvailable !== undefined) {
    console.log('✅ Total available memory is present:', result.totalAvailable, 'MB');
  } else {
    console.log('❌ Total available memory is missing!');
    process.exit(1);
  }
} else {
  console.log('\n⚠️  Warning: Check passed unexpectedly (system has >999GB RAM!)');
}

console.log('\n✅ All checks passed!');
