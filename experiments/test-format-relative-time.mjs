#!/usr/bin/env node
/**
 * Test script for formatRelativeTime function
 * Tests the enhanced time formatting with days support
 */

/**
 * Format relative time from now to a future date
 * This is a copy of the function from claude-limits.lib.mjs for testing
 *
 * @param {string} isoDate - ISO date string
 * @returns {string|null} Relative time string (e.g., "1h 34m" or "6d 20h 13m") or null if date is in the past
 */
function formatRelativeTime(isoDate) {
  if (!isoDate) return null;

  try {
    const now = new Date();
    const target = new Date(isoDate);
    const diffMs = target - now;

    // Check for invalid date (NaN)
    if (isNaN(diffMs)) return null;

    if (diffMs < 0) return null; // Past date

    const totalHours = Math.floor(diffMs / (1000 * 60 * 60));
    const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

    // If hours >= 24, show days
    if (totalHours >= 24) {
      const days = Math.floor(totalHours / 24);
      const hours = totalHours % 24;
      return `${days}d ${hours}h ${minutes}m`;
    }

    return `${totalHours}h ${minutes}m`;
  } catch {
    return null;
  }
}

// Test cases
function runTests() {
  console.log('Testing formatRelativeTime function\n');
  console.log('=' .repeat(50));

  let passed = 0;
  let failed = 0;

  function test(description, isoDate, expectedPattern, shouldMatch = true) {
    const result = formatRelativeTime(isoDate);
    const matches = shouldMatch
      ? (expectedPattern instanceof RegExp ? expectedPattern.test(result) : result === expectedPattern)
      : result === expectedPattern;

    if (matches) {
      console.log(`✅ PASS: ${description}`);
      console.log(`   Result: ${result}`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${description}`);
      console.log(`   Expected: ${expectedPattern}`);
      console.log(`   Got: ${result}`);
      failed++;
    }
    console.log();
  }

  // Test 1: Less than 24 hours (should not show days)
  const in23Hours = new Date(Date.now() + 23 * 60 * 60 * 1000 + 45 * 60 * 1000);
  test(
    'Less than 24 hours (23h 45m)',
    in23Hours.toISOString(),
    /^\d{1,2}h \d{1,2}m$/
  );

  // Test 2: Exactly 24 hours (should show 1 day)
  const in24Hours = new Date(Date.now() + 24 * 60 * 60 * 1000);
  test(
    'Exactly 24 hours (1d 0h)',
    in24Hours.toISOString(),
    /^1d 0h \d{1,2}m$/
  );

  // Test 3: More than 24 hours with remainder (e.g., 6d 20h 13m)
  const in164Hours13Min = new Date(Date.now() + 164 * 60 * 60 * 1000 + 13 * 60 * 1000);
  test(
    'More than 24 hours (164h = 6d 20h 13m)',
    in164Hours13Min.toISOString(),
    /^6d 20h 13m$/
  );

  // Test 4: Multiple days without hours
  const in72Hours = new Date(Date.now() + 72 * 60 * 60 * 1000);
  test(
    'Exactly 3 days (72h = 3d 0h)',
    in72Hours.toISOString(),
    /^3d 0h \d{1,2}m$/
  );

  // Test 5: Large number of days (7 days)
  const in7Days = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 5 * 60 * 60 * 1000 + 30 * 60 * 1000);
  test(
    'One week (7d 5h 30m)',
    in7Days.toISOString(),
    /^7d 5h 30m$/
  );

  // Test 6: Past date (should return null)
  const pastDate = new Date(Date.now() - 60 * 60 * 1000);
  test(
    'Past date (should return null)',
    pastDate.toISOString(),
    null
  );

  // Test 7: Null input (should return null)
  test(
    'Null input (should return null)',
    null,
    null
  );

  // Test 8: Invalid date string (should return null)
  test(
    'Invalid date string (should return null)',
    'invalid-date-string',
    null
  );

  // Test 9: Very short duration (less than 1 hour)
  const in30Min = new Date(Date.now() + 30 * 60 * 1000);
  test(
    'Less than 1 hour (30 minutes)',
    in30Min.toISOString(),
    /^0h 30m$/
  );

  // Test 10: Edge case - almost 2 days
  const in47Hours59Min = new Date(Date.now() + 47 * 60 * 60 * 1000 + 59 * 60 * 1000);
  test(
    'Almost 2 days (47h 59m = 1d 23h 59m)',
    in47Hours59Min.toISOString(),
    /^1d 23h 59m$/
  );

  // Summary
  console.log('=' .repeat(50));
  console.log(`\nTest Summary:`);
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log(`  Total:  ${passed + failed}`);

  if (failed === 0) {
    console.log('\n🎉 All tests passed!');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed!');
    process.exit(1);
  }
}

runTests();
