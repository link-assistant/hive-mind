/**
 * Shared test utilities for lightweight test files.
 *
 * Provides a minimal test runner with pass/fail counting and summary output.
 * Usage:
 *   import { test, asyncTest, printSummary, getFailCount } from './test-helpers.mjs';
 */

let testsPassed = 0;
let testsFailed = 0;

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

export function printSummary() {
  console.log('\n' + '='.repeat(60));
  console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed, ${testsPassed + testsFailed} total\n`);
}

export function getFailCount() {
  return testsFailed;
}
