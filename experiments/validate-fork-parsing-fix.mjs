#!/usr/bin/env node

console.log('='.repeat(80));
console.log('FORK NAME PARSING VALIDATION');
console.log('='.repeat(80));
console.log();

const testCases = [
  {
    name: 'URL format (new fork)',
    output: 'https://github.com/konard/Test_Canaan',
    expected: 'konard/Test_Canaan'
  },
  {
    name: 'Already exists format',
    output: 'konard/Test_Canaan already exists',
    expected: 'konard/Test_Canaan'
  },
  {
    name: 'Alternate fork name format',
    output: 'konard/netkeep80-jsonRVM already exists',
    expected: 'konard/netkeep80-jsonRVM'
  },
  {
    name: 'Created fork message',
    output: '✓ Created fork konard/repo-name',
    expected: 'konard/repo-name'
  },
  {
    name: 'URL with trailing content',
    output: 'https://github.com/user_name/my-repo\n',
    expected: 'user_name/my-repo'
  },
  {
    name: 'Fork name with underscores and dashes',
    output: 'user-name/repo_name already exists',
    expected: 'user-name/repo_name'
  }
];

// The fixed regex
const fixedRegex = /(?:github\.com\/|^|\s)([a-zA-Z0-9_-]+\/[a-zA-Z0-9_-]+)/;

let allPassed = true;

testCases.forEach((test, i) => {
  console.log(`Test ${i + 1}: ${test.name}`);
  console.log(`  Input:    "${test.output}"`);
  console.log(`  Expected: "${test.expected}"`);

  const match = test.output.match(fixedRegex);
  const result = match ? match[1] : null;

  console.log(`  Got:      "${result}"`);

  if (result === test.expected) {
    console.log(`  ✅ PASS`);
  } else {
    console.log(`  ❌ FAIL`);
    allPassed = false;
  }
  console.log();
});

console.log('='.repeat(80));
if (allPassed) {
  console.log('✅ ALL TESTS PASSED');
} else {
  console.log('❌ SOME TESTS FAILED');
  process.exit(1);
}
console.log('='.repeat(80));
