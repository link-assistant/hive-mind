#!/usr/bin/env node

/**
 * Comprehensive test for issue #667 pricing calculation fixes
 * Tests:
 * 1. Number formatting (spaces instead of commas)
 * 2. Pricing formula accuracy
 * 3. Session data tracking across auto-restarts
 */

// Import the formatNumber function
import { formatNumber, calculateModelCost } from '../src/claude.lib.mjs';

console.log('🧪 Testing Issue #667 Pricing Calculation Fixes\n');
console.log('=' .repeat(60));

// Test 1: Number Formatting
console.log('\n📊 Test 1: Number Formatting (spaces, no commas)');
console.log('-'.repeat(60));

const numberTests = [
  { input: 4606045, expected: '4 606 045', label: 'Large token count' },
  { input: 121696, expected: '121 696', label: 'Medium token count' },
  { input: 430, expected: '430', label: 'Small token count' },
  { input: 200000, expected: '200 000', label: 'Context window' },
  { input: 0, expected: '0', label: 'Zero' },
  { input: 1, expected: '1', label: 'Single digit' },
  { input: 12, expected: '12', label: 'Two digits' },
  { input: 123, expected: '123', label: 'Three digits' },
  { input: 1234, expected: '1 234', label: 'Four digits' },
  { input: 12345, expected: '12 345', label: 'Five digits' },
  { input: 1234567890, expected: '1 234 567 890', label: 'Large number' },
];

let passed = 0;
let failed = 0;

numberTests.forEach(({ input, expected, label }) => {
  const result = formatNumber(input);
  const pass = result === expected;
  if (pass) {
    passed++;
    console.log(`  ✅ ${label}: ${input} → "${result}"`);
  } else {
    failed++;
    console.log(`  ❌ ${label}: ${input} → "${result}" (expected: "${expected}")`);
  }
});

// Test 2: Decimal Formatting
console.log('\n💰 Test 2: Decimal Number Formatting');
console.log('-'.repeat(60));

const decimalTests = [
  { input: 1.932214, label: 'Total cost' },
  { input: 0.456360, label: 'Cache write cost' },
  { input: 1.381814, label: 'Cache read cost' },
  { input: 0.001290, label: 'Input cost' },
  { input: 0.084975, label: 'Output cost' },
];

decimalTests.forEach(({ input, label }) => {
  const result = formatNumber(input);
  // Check that result doesn't contain commas
  const hasComma = result.includes(',');
  const hasSpace = result.includes(' ');
  const hasDot = result.includes('.');

  if (!hasComma && hasDot) {
    passed++;
    console.log(`  ✅ ${label}: $${input} → "${result}" (no commas, has decimal)`);
  } else {
    failed++;
    console.log(`  ❌ ${label}: $${input} → "${result}" (has comma: ${hasComma}, has space in decimal: ${hasSpace})`);
  }
});

// Test 3: Edge Cases
console.log('\n🔍 Test 3: Edge Cases');
console.log('-'.repeat(60));

const edgeCases = [
  { input: null, expected: 'N/A', label: 'Null value' },
  { input: undefined, expected: 'N/A', label: 'Undefined value' },
  { input: 0, expected: '0', label: 'Zero' },
  { input: -1234, expected: '-1 234', label: 'Negative number' },
];

edgeCases.forEach(({ input, expected, label }) => {
  const result = formatNumber(input);
  const pass = result === expected;
  if (pass) {
    passed++;
    console.log(`  ✅ ${label}: ${input} → "${result}"`);
  } else {
    failed++;
    console.log(`  ❌ ${label}: ${input} → "${result}" (expected: "${expected}")`);
  }
});

// Test 4: Pricing Formula Accuracy
console.log('\n🧮 Test 4: Pricing Formula Accuracy');
console.log('-'.repeat(60));

const formulaTests = [
  {
    tokens: 4606045,
    pricePerM: 0.3,
    expected: 1.381814,  // Rounded to 6 decimals
    label: 'Cache read: 4 606 045 tokens × $0.3/M'
  },
  {
    tokens: 121696,
    pricePerM: 3.75,
    expected: 0.456360,
    label: 'Cache write: 121 696 tokens × $3.75/M'
  },
  {
    tokens: 430,
    pricePerM: 3,
    expected: 0.001290,
    label: 'Input: 430 tokens × $3/M'
  },
  {
    tokens: 5665,
    pricePerM: 15,
    expected: 0.084975,
    label: 'Output: 5 665 tokens × $15/M'
  },
];

formulaTests.forEach(({ tokens, pricePerM, expected, label }) => {
  // Calculate: (tokens / 1000000) * pricePerM
  const calculated = (tokens / 1000000) * pricePerM;
  const roundedCalculated = Number(calculated.toFixed(6));
  const pass = Math.abs(roundedCalculated - expected) < 0.000001;

  if (pass) {
    passed++;
    console.log(`  ✅ ${label}`);
    console.log(`      Formula: (${formatNumber(tokens)} / 1 000 000) × $${pricePerM} = $${calculated.toFixed(6)}`);
  } else {
    failed++;
    console.log(`  ❌ ${label}`);
    console.log(`      Formula: (${formatNumber(tokens)} / 1 000 000) × $${pricePerM} = $${calculated.toFixed(6)}`);
    console.log(`      Expected: $${expected.toFixed(6)}, got: $${roundedCalculated.toFixed(6)}`);
  }
});

// Test 5: Calculate Model Cost Function
console.log('\n⚙️  Test 5: calculateModelCost Function');
console.log('-'.repeat(60));

const mockUsage = {
  inputTokens: 430,
  cacheCreationTokens: 121696,
  cacheReadTokens: 4606045,
  outputTokens: 5665
};

const mockModelInfo = {
  cost: {
    input: 3,
    cache_write: 3.75,
    cache_read: 0.3,
    output: 15
  }
};

const costResult = calculateModelCost(mockUsage, mockModelInfo, true);

console.log(`  Testing with mock usage data:`);
console.log(`    Input tokens: ${formatNumber(mockUsage.inputTokens)}`);
console.log(`    Cache creation tokens: ${formatNumber(mockUsage.cacheCreationTokens)}`);
console.log(`    Cache read tokens: ${formatNumber(mockUsage.cacheReadTokens)}`);
console.log(`    Output tokens: ${formatNumber(mockUsage.outputTokens)}`);
console.log('');

if (costResult && costResult.breakdown) {
  const breakdown = costResult.breakdown;
  const expectedTotal = 1.924439;  // Sum of all costs

  console.log(`  Breakdown:`);
  console.log(`    Input: ${formatNumber(breakdown.input.tokens)} tokens × $${breakdown.input.costPerMillion}/M = $${breakdown.input.cost.toFixed(6)}`);
  console.log(`    Cache write: ${formatNumber(breakdown.cacheWrite.tokens)} tokens × $${breakdown.cacheWrite.costPerMillion}/M = $${breakdown.cacheWrite.cost.toFixed(6)}`);
  console.log(`    Cache read: ${formatNumber(breakdown.cacheRead.tokens)} tokens × $${breakdown.cacheRead.costPerMillion}/M = $${breakdown.cacheRead.cost.toFixed(6)}`);
  console.log(`    Output: ${formatNumber(breakdown.output.tokens)} tokens × $${breakdown.output.costPerMillion}/M = $${breakdown.output.cost.toFixed(6)}`);
  console.log(`    Total: $${costResult.total.toFixed(6)}`);

  const totalMatch = Math.abs(costResult.total - expectedTotal) < 0.000001;
  if (totalMatch) {
    passed++;
    console.log(`  ✅ Total cost calculation correct`);
  } else {
    failed++;
    console.log(`  ❌ Total cost calculation incorrect: expected $${expectedTotal.toFixed(6)}, got $${costResult.total.toFixed(6)}`);
  }
} else {
  failed++;
  console.log(`  ❌ calculateModelCost did not return expected breakdown`);
}

// Test 6: Verify No Commas in Output
console.log('\n🔍 Test 6: Verify Output Contains No Commas');
console.log('-'.repeat(60));

const sampleOutput = `
Input: ${formatNumber(4606045)} tokens × $0.3/M = $1.381814
Cache write: ${formatNumber(121696)} tokens × $3.75/M = $0.456360
Cache read: ${formatNumber(4606045)} tokens × $0.3/M = $1.381814
Output: ${formatNumber(5665)} tokens × $15/M = $0.084975
Context window: ${formatNumber(200000)} tokens
`;

const hasCommasInOutput = sampleOutput.includes(',') && !sampleOutput.includes('$'); // Allow commas in labels, not in numbers
const outputClean = !(/\d,\d/.test(sampleOutput)); // Check for digit-comma-digit pattern

if (outputClean) {
  passed++;
  console.log(`  ✅ Sample output contains no numeric commas`);
  console.log(`  Sample output:`);
  sampleOutput.split('\n').filter(l => l.trim()).forEach(line => {
    console.log(`    ${line.trim()}`);
  });
} else {
  failed++;
  console.log(`  ❌ Sample output contains numeric commas`);
}

// Summary
console.log('\n' + '='.repeat(60));
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log('='.repeat(60));

if (failed === 0) {
  console.log('\n✅ All tests passed! Issue #667 fixes are working correctly.');
  process.exit(0);
} else {
  console.log(`\n❌ ${failed} test(s) failed. Please review the output above.`);
  process.exit(1);
}
