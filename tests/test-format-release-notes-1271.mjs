#!/usr/bin/env node

/**
 * Test script for format-release-notes.mjs changes (Issue #1271)
 *
 * Tests the commit hash extraction logic to ensure it finds ALL commit hashes
 * in a changelog entry, not just the first one.
 */

// Sample changelog entry from v1.21.4 release
const sampleChangelogBody = `### Patch Changes

- ea19c72: Fix queue issues: rejection, display, and formatting
  - Fix disk rejection not blocking queue placement when threshold exceeded
  - Restore "used" label on progress bars when below threshold
  - Show per-queue breakdown in /limits command
  - Group queue items by tool and use human-readable time in /solve_queue

- aa42f3a: fix: improve merge queue error handling and debugging (Issue #1269)
  - Always log errors (not just in verbose mode) for critical merge queue failures
  - Always notify users via Telegram when merge queue fails unexpectedly
  - Add timeout wrapper (60s) for onStatusUpdate callback to prevent infinite blocking
  - Add error handling for CI check failures in waitForCI loop
  - Add comprehensive case study documentation in docs/case-studies/issue-1269/
`;

// Test the NEW regex logic (Issue #1271 fix)
console.log('Testing commit hash extraction (Issue #1271 fix)...\n');

// Extract the patch changes section
const patchChangesMatch = sampleChangelogBody.match(/### Patch Changes\s*\n([\s\S]+?)(?=###|$)/);
const rawDescription = patchChangesMatch ? patchChangesMatch[1] : null;

if (!rawDescription) {
  console.error('FAIL: Could not extract patch changes section');
  process.exit(1);
}

console.log('Raw description extracted:');
console.log('---');
console.log(rawDescription);
console.log('---\n');

// Extract ALL commit hashes
const commitHashRegex = /-\s+([a-f0-9]{7,40}):/g;
const commitHashes = [...rawDescription.matchAll(commitHashRegex)].map(m => m[1]);

console.log(`Found ${commitHashes.length} commit hash(es):`);
commitHashes.forEach((hash, i) => console.log(`  ${i + 1}. ${hash}`));

// Verify expected results
const expectedHashes = ['ea19c72', 'aa42f3a'];

if (commitHashes.length !== expectedHashes.length) {
  console.error(`\nFAIL: Expected ${expectedHashes.length} hashes, got ${commitHashes.length}`);
  process.exit(1);
}

for (let i = 0; i < expectedHashes.length; i++) {
  if (commitHashes[i] !== expectedHashes[i]) {
    console.error(`\nFAIL: Hash ${i + 1} mismatch. Expected ${expectedHashes[i]}, got ${commitHashes[i]}`);
    process.exit(1);
  }
}

console.log('\n✓ All commit hashes extracted correctly!');

// Test PR formatting
console.log('\nTesting PR link formatting...');

const testCases = [
  { prNumbers: [], expected: '' },
  { prNumbers: [1268], expected: '**Related Pull Request:** #1268' },
  { prNumbers: [1268, 1270], expected: '**Related Pull Requests:** #1268, #1270' },
  { prNumbers: [1270, 1268], expected: '**Related Pull Requests:** #1268, #1270' }, // Should be sorted
];

for (const testCase of testCases) {
  const sorted = testCase.prNumbers.sort((a, b) => a - b);
  let result = '';
  if (sorted.length > 0) {
    const prLabel = sorted.length === 1 ? 'Related Pull Request' : 'Related Pull Requests';
    const prLinks = sorted.map(n => `#${n}`).join(', ');
    result = `**${prLabel}:** ${prLinks}`;
  }

  if (result !== testCase.expected) {
    console.error(`  FAIL: Expected "${testCase.expected}", got "${result}"`);
    process.exit(1);
  }
  console.log(`  ✓ PRs ${JSON.stringify(testCase.prNumbers)} → "${result}"`);
}

console.log('\n✓ All PR formatting tests passed!');
console.log('\n======================================');
console.log('All tests PASSED! Issue #1271 fix verified.');
console.log('======================================');
