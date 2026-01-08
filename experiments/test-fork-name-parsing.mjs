#!/usr/bin/env node

// Test fork name parsing from various gh repo fork outputs

const testCases = ['konard/Test_Canaan already exists', 'https://github.com/konard/Test_Canaan', '✓ Created fork konard/netkeep80-jsonRVM', 'konard/jsonRVM', '! konard/repo-name already exists on GitHub'];

console.log('Testing fork name parsing\n');
console.log('Current regex: ([a-zA-Z0-9_-]+\\/[a-zA-Z0-9_-]+)\n');

testCases.forEach((output, i) => {
  console.log(`Test ${i + 1}: "${output}"`);

  // Current (broken) regex
  const match1 = output.match(/([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/);
  console.log(`  Current regex match: ${match1 ? match1[1] : 'NO MATCH'}`);

  // Better regex - match after github.com/ or at start of line
  const match2 = output.match(/(?:github\.com\/|^|\s)([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/);
  console.log(`  Better regex match:  ${match2 ? match2[1] : 'NO MATCH'}`);

  console.log();
});
