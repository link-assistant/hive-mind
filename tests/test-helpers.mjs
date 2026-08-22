/**
 * Shared test utilities for lightweight test files.
 *
 * Provides a minimal test runner with pass/fail counting and summary output.
 * Usage:
 *   import { test, asyncTest, printSummary, getFailCount } from './test-helpers.mjs';
 *
 * @hive-mind-test-skip
 */

let testsPassed = 0;
let testsFailed = 0;
let testsSkipped = 0;

export function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    testsFailed++;
  }
}

export function skip(message) {
  console.log(`  ⏭️ SKIP: ${message}`);
  testsSkipped++;
}

export function test(name, fn) {
  try {
    fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

export async function asyncTest(name, fn) {
  try {
    await fn();
    console.log(`✅ ${name}`);
    testsPassed++;
  } catch (error) {
    console.log(`❌ ${name}`);
    console.log(`   Error: ${error.message}`);
    testsFailed++;
  }
}

export function printSummary(separator = 60) {
  console.log('\n' + '='.repeat(separator));
  const skipPart = testsSkipped > 0 ? `, ${testsSkipped} skipped` : '';
  const total = testsPassed + testsFailed + testsSkipped;
  console.log(`Results: ${testsPassed} passed, ${testsFailed} failed${skipPart}, ${total} total`);
  console.log('='.repeat(separator));
}

export function getFailCount() {
  return testsFailed;
}
