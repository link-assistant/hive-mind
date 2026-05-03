#!/usr/bin/env node
// Issue: Command output is always printed to stdout even when only capturing
// This causes problems when building CLI tools that need clean output

import { use } from 'use-m';
const { $ } = await use('command-stream');

console.log('=== Issue #16: Unwanted stdout output ===\n');

// Problem: These commands output to stdout even when we only want to capture
console.log('1. Default behavior - outputs to console:');
try {
  const result1 = await $`echo "This appears on stdout even when captured"`;
  console.log('   Captured:', result1.stdout.toString().trim());
} catch (error) {
  console.error('   Error:', error.message);
}

console.log('\n2. Attempting to suppress with 2>/dev/null - still outputs:');
try {
  const result2 = await $`echo "Still visible" 2>/dev/null`;
  console.log('   Captured:', result2.stdout.toString().trim());
} catch (error) {
  console.error('   Error:', error.message);
}

console.log('\n3. WORKAROUND - Using custom $ with mirror: false:');
try {
  const $silent = $({ mirror: false, capture: true });
  const result3 = await $silent`echo "This should be silent"`;
  console.log('   Captured:', result3.stdout.toString().trim());
  console.log('   ✅ Output was suppressed!');
} catch (error) {
  console.error('   Error:', error.message);
}

console.log('\n4. Real-world example - System commands with verbose output:');
console.log('   Running vm_stat on macOS...');

// Problem case
console.log('\n   With default $:');
try {
  const result4 = await $`vm_stat | head -3`;
  console.log('   [Above output was unwanted]');
} catch (error) {
  console.error('   Error:', error.message);
}

// Solution
console.log('\n   With $silent:');
try {
  const $silent = $({ mirror: false, capture: true });
  const result5 = await $silent`vm_stat | head -3`;
  console.log('   ✅ Output suppressed, data captured internally');
  console.log('   First line:', result5.stdout.toString().split('\n')[0]);
} catch (error) {
  console.error('   Error:', error.message);
}

console.log('\n=== Summary ===');
console.log('Problem: Default $ always mirrors output to stdout');
console.log("Impact: CLI tools get polluted output, can't create clean interfaces");
console.log('Workaround: Use $({ mirror: false, capture: true }) for silent execution');
console.log('\nRecommendation for library:');
console.log('- Add a global silent mode option');
console.log('- Or provide a $silent export by default');
console.log('- Document this pattern prominently in README');
