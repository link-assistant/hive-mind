#!/usr/bin/env node

/**
 * Test to verify the check uses only total memory (RAM + swap), not dual checking
 *
 * This test simulates a scenario where:
 * - RAM alone is insufficient (e.g., 233MB < 256MB)
 * - But total memory (RAM + swap) is sufficient (e.g., 1691MB >= 256MB)
 *
 * Expected behavior: The check should PASS (only total memory matters)
 */

import { checkRAM } from '../src/memory-check.mjs';

console.log('Testing memory check behavior with total memory check only...\n');

// First, let's see current system state
const result1 = await checkRAM(1, {});
console.log('Current system state:');
console.log(`  RAM: ${result1.availableMB}MB`);
console.log(`  Swap: ${result1.swap}`);
console.log(`  Total: ${result1.totalAvailable}MB\n`);

// Now test with a requirement between RAM and total
// If RAM < requirement < total, the check should PASS (only total matters)
const ramMB = result1.availableMB;
const totalMB = result1.totalAvailable;

if (totalMB > ramMB + 50) {
  // We have enough swap to test this scenario
  const testRequirement = ramMB + 25; // Between RAM and total

  console.log(`Testing with requirement: ${testRequirement}MB`);
  console.log(`  RAM (${ramMB}MB) < requirement (${testRequirement}MB) < Total (${totalMB}MB)`);
  console.log(`  Expected: PASS (because total >= requirement)\n`);

  const result2 = await checkRAM(testRequirement, {});

  console.log('\n📊 Result:', JSON.stringify(result2, null, 2));

  if (result2.success) {
    console.log('\n✅ Test PASSED: Check succeeded when total memory >= requirement');
    console.log('   (even though RAM alone < requirement)');
  } else {
    console.log('\n❌ Test FAILED: Check should pass when total memory >= requirement');
    console.log('   This indicates dual checking is still active!');
    process.exit(1);
  }
} else {
  console.log('⚠️  Not enough swap to test this scenario');
  console.log('   But we can verify the logic is correct in the code');

  // Test that it works when total is sufficient
  const result3 = await checkRAM(Math.floor(totalMB / 2), {});
  if (result3.success) {
    console.log('✅ Check passes when total memory is sufficient');
  } else {
    console.log('❌ Check failed unexpectedly!');
    process.exit(1);
  }
}

console.log('\n✅ All checks passed!');
