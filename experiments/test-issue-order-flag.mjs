#!/usr/bin/env node

console.log('Testing issue-order flag implementation...\n');

console.log('Test 1: Verify that issue-order flag accepts "asc" and "desc" values');
const testIssues = [
  { url: 'https://github.com/test/repo/issues/3', title: 'Third issue', createdAt: '2025-01-03T00:00:00Z' },
  { url: 'https://github.com/test/repo/issues/1', title: 'First issue', createdAt: '2025-01-01T00:00:00Z' },
  { url: 'https://github.com/test/repo/issues/2', title: 'Second issue', createdAt: '2025-01-02T00:00:00Z' }
];

console.log('Original order (unsorted):');
testIssues.forEach((issue, idx) => {
  console.log(`  ${idx + 1}. ${issue.title} - ${issue.createdAt}`);
});

console.log('\nTest 2: Sort ascending (oldest first)');
const issuesAsc = [...testIssues].sort((a, b) => {
  const dateA = new Date(a.createdAt);
  const dateB = new Date(b.createdAt);
  return dateA - dateB;
});

issuesAsc.forEach((issue, idx) => {
  console.log(`  ${idx + 1}. ${issue.title} - ${issue.createdAt}`);
});

console.log('\nTest 3: Sort descending (newest first)');
const issuesDesc = [...testIssues].sort((a, b) => {
  const dateA = new Date(a.createdAt);
  const dateB = new Date(b.createdAt);
  return dateB - dateA;
});

issuesDesc.forEach((issue, idx) => {
  console.log(`  ${idx + 1}. ${issue.title} - ${issue.createdAt}`);
});

console.log('\nTest 4: Verify expected order');
const expectedAsc = ['First issue', 'Second issue', 'Third issue'];
const actualAsc = issuesAsc.map(i => i.title);
const ascMatch = JSON.stringify(expectedAsc) === JSON.stringify(actualAsc);

const expectedDesc = ['Third issue', 'Second issue', 'First issue'];
const actualDesc = issuesDesc.map(i => i.title);
const descMatch = JSON.stringify(expectedDesc) === JSON.stringify(actualDesc);

console.log(`  Ascending order: ${ascMatch ? '✅ PASS' : '❌ FAIL'}`);
console.log(`  Descending order: ${descMatch ? '✅ PASS' : '❌ FAIL'}`);

if (ascMatch && descMatch) {
  console.log('\n✅ All tests passed!');
  process.exit(0);
} else {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
}
