#!/usr/bin/env node

/**
 * Test number formatting requirements for issue #667
 * - No commas in numbers
 * - Use spaces for thousands separator
 * - Use . for decimal separator
 */

// Function to format numbers with spaces as thousands separator
const formatNumber = (num) => {
  if (num === null || num === undefined) return 'N/A';

  // Convert to string and split on decimal point
  const parts = num.toString().split('.');
  const integerPart = parts[0];
  const decimalPart = parts[1];

  // Add spaces every 3 digits from the right
  const formattedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

  // Return with decimal part if it exists
  return decimalPart !== undefined
    ? `${formattedInteger}.${decimalPart}`
    : formattedInteger;
};

// Test cases from the issue
console.log('Testing number formatting:\n');

// Test 1: Token counts (large integers)
const testCases = [
  { input: 4606045, expected: '4 606 045', label: 'Cache read tokens' },
  { input: 121696, expected: '121 696', label: 'Cache creation tokens' },
  { input: 430, expected: '430', label: 'Input tokens' },
  { input: 5665, expected: '5 665', label: 'Output tokens' },
  { input: 200000, expected: '200 000', label: 'Context window' },
];

console.log('Integer formatting (thousands with spaces):');
testCases.forEach(({ input, expected, label }) => {
  const result = formatNumber(input);
  const pass = result === expected ? '✅' : '❌';
  console.log(`  ${pass} ${label}: ${input} → "${result}" (expected: "${expected}")`);
});

// Test 2: Decimal numbers (costs)
console.log('\nDecimal formatting (no commas, use . for decimals):');
const decimalTests = [
  { input: 1.932214, expected: '1.932214', label: 'Total cost' },
  { input: 0.456360, expected: '0.456360', label: 'Cache write cost' },
  { input: 1.381814, expected: '1.381814', label: 'Cache read cost' },
  { input: 0.001290, expected: '0.001290', label: 'Input cost' },
];

decimalTests.forEach(({ input, expected, label }) => {
  const result = formatNumber(input);
  const pass = result === expected ? '✅' : '❌';
  console.log(`  ${pass} ${label}: ${input} → "${result}" (expected: "${expected}")`);
});

// Test 3: Formula calculation verification
console.log('\nFormula verification (tokens × $price/M):');

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
  const pass = Math.abs(roundedCalculated - expected) < 0.000001 ? '✅' : '❌';
  console.log(`  ${pass} ${label}`);
  console.log(`      Calculation: (${formatNumber(tokens)} / 1 000 000) × $${pricePerM} = $${calculated.toFixed(6)}`);
  console.log(`      Expected: $${expected.toFixed(6)}`);
});

// Test 4: Total sum verification
console.log('\nTotal sum verification:');
const costs = [0.001290, 0.456360, 1.381814, 0.084975];
const sum = costs.reduce((acc, val) => acc + val, 0);
const expectedSum = 1.924439;  // Note: slightly different due to rounding
console.log(`  Input + Cache write + Cache read + Output`);
console.log(`  $${costs[0].toFixed(6)} + $${costs[1].toFixed(6)} + $${costs[2].toFixed(6)} + $${costs[3].toFixed(6)}`);
console.log(`  = $${sum.toFixed(6)}`);
console.log(`  Expected from log: $1.924438 (difference due to rounding: $${Math.abs(sum - 1.924438).toFixed(6)})`);

// Test 5: Verify current vs proposed display format
console.log('\n\nDisplay format comparison:');
console.log('BEFORE (with commas, using toLocaleString):');
console.log(`  Input: 4,606,045 tokens × $0.3/M = $1.381814`);
console.log('\nAFTER (with spaces, no commas):');
console.log(`  Input: ${formatNumber(4606045)} tokens × $0.3/M = $${(4606045 / 1000000 * 0.3).toFixed(6)}`);

console.log('\n✅ All formatting tests complete!');
