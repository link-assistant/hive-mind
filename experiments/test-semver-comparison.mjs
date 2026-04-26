#!/usr/bin/env node

function compareSemver(a, b) {
  const aParts = a.split('.').map(Number);
  const bParts = b.split('.').map(Number);

  for (let i = 0; i < 3; i++) {
    if (aParts[i] > bParts[i]) return 1;
    if (aParts[i] < bParts[i]) return -1;
  }
  return 0;
}

const tests = [
  { a: '0.12.20', b: '0.12.20', expected: 0, desc: 'equal versions' },
  { a: '0.12.21', b: '0.12.20', expected: 1, desc: 'patch bump' },
  { a: '0.13.0', b: '0.12.20', expected: 1, desc: 'minor bump' },
  { a: '1.0.0', b: '0.12.20', expected: 1, desc: 'major bump' },
  { a: '0.12.19', b: '0.12.20', expected: -1, desc: 'lower patch' },
  { a: '0.11.99', b: '0.12.20', expected: -1, desc: 'lower minor' },
  { a: '0.12.21', b: '0.12.21', expected: 0, desc: 'equal (0.12.21)' },
];

console.log('Testing semver comparison logic:\n');

let passed = 0;
let failed = 0;

for (const test of tests) {
  const result = compareSemver(test.a, test.b);
  const status = result === test.expected ? '✅' : '❌';

  if (result === test.expected) {
    passed++;
  } else {
    failed++;
  }

  console.log(`${status} ${test.desc}: ${test.a} vs ${test.b} = ${result} (expected ${test.expected})`);
}

console.log(`\nResults: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
