#!/usr/bin/env node
/**
 * Test script for issue #944 fix
 * Tests that parseStringValues() correctly handles LINO configuration
 * with --tokens-budget-stats flag
 */

import { lino } from '../src/lino.lib.mjs';

console.log('🧪 Testing Issue #944 Fix: parseStringValues() vs parse()\n');

// Test configuration that was failing
const testConfig = `
TELEGRAM_HIVE_OVERRIDES:
  --all-issues
  --once
  --skip-issues-with-prs
  --attach-logs
  --verbose
  --no-tool-check
  --auto-continue-on-limit-reset
  --tokens-budget-stats
`;

console.log('Test Configuration:');
console.log(testConfig);
console.log('\n' + '='.repeat(60) + '\n');

// Test 1: Old method (parse) - would fail with .trim()
console.log('Test 1: Using lino.parse() (old method)');
console.log('-'.repeat(60));
const parseResult = lino.parse(testConfig);
console.log('Result type:', typeof parseResult);
console.log('Result is array:', Array.isArray(parseResult));
console.log('Number of items:', parseResult.length);
console.log('Items:', parseResult);
console.log('');

// Check each item type
console.log('Type checking each item:');
parseResult.forEach((item, index) => {
  console.log(`  [${index}]: ${typeof item} - "${item}"`);
  if (typeof item !== 'string') {
    console.log(`    ⚠️  WARNING: Item ${index} is not a string!`);
  }
});

console.log('\n' + '='.repeat(60) + '\n');

// Test 2: New method (parseStringValues) - safe for .trim()
console.log('Test 2: Using lino.parseStringValues() (new method)');
console.log('-'.repeat(60));
const parseStringResult = lino.parseStringValues(testConfig);
console.log('Result type:', typeof parseStringResult);
console.log('Result is array:', Array.isArray(parseStringResult));
console.log('Number of items:', parseStringResult.length);
console.log('Items:', parseStringResult);
console.log('');

// Check each item type
console.log('Type checking each item:');
parseStringResult.forEach((item, index) => {
  console.log(`  [${index}]: ${typeof item} - "${item}"`);
  if (typeof item !== 'string') {
    console.log(`    ❌ ERROR: Item ${index} is not a string!`);
  }
});

console.log('\n' + '='.repeat(60) + '\n');

// Test 3: Simulate the actual fix - applying .trim() on results
console.log('Test 3: Simulating telegram-bot.mjs processing');
console.log('-'.repeat(60));

console.log('\n❌ Old code (would crash):');
try {
  const oldResult = lino
    .parse(testConfig)
    .map(line => line.trim()) // This could fail!
    .filter(line => line);
  console.log('  ✅ No error (all items were strings)');
  console.log('  Result:', oldResult);
} catch (error) {
  console.log(`  💥 ERROR: ${error.message}`);
  console.log('  This is the bug from issue #944!');
}

console.log('\n✅ New code (safe):');
try {
  const newResult = lino
    .parseStringValues(testConfig)
    .map(line => line.trim()) // Safe!
    .filter(line => line);
  console.log('  ✅ Success! No errors.');
  console.log('  Result:', newResult);

  // Verify --tokens-budget-stats is in the result
  if (newResult.includes('--tokens-budget-stats')) {
    console.log('  ✅ --tokens-budget-stats flag correctly parsed!');
  } else {
    console.log('  ❌ --tokens-budget-stats flag missing!');
  }
} catch (error) {
  console.log(`  ❌ ERROR: ${error.message}`);
}

console.log('\n' + '='.repeat(60) + '\n');

// Test 4: Edge cases
console.log('Test 4: Edge Cases');
console.log('-'.repeat(60));

const edgeCases = [
  { name: 'Empty string', input: '' },
  { name: 'Single flag', input: '--verbose' },
  { name: 'Multiple flags inline', input: '--verbose --no-tool-check --tokens-budget-stats' },
];

edgeCases.forEach(testCase => {
  console.log(`\nTest: ${testCase.name}`);
  console.log(`Input: "${testCase.input}"`);

  const parseResult = lino.parse(testCase.input);
  const stringResult = lino.parseStringValues(testCase.input);

  console.log(`  parse(): [${parseResult.length}] ${JSON.stringify(parseResult)}`);
  console.log(`  parseStringValues(): [${stringResult.length}] ${JSON.stringify(stringResult)}`);
});

console.log('\n' + '='.repeat(60) + '\n');
console.log('✅ All tests completed!\n');
console.log('Summary:');
console.log('  - lino.parse() can return non-string values');
console.log('  - lino.parseStringValues() only returns strings');
console.log('  - Using parseStringValues() fixes the issue #944 bug');
console.log('  - The fix ensures .trim() can be safely called');
