#!/usr/bin/env node

/**
 * Unit tests for URL hash fragment handling
 *
 * This test verifies that GitHub URLs with hash fragments (e.g., #issuecomment-123)
 * are correctly parsed. This was a bug fix for issue #991.
 *
 * Bug: URLs like https://github.com/owner/repo/pull/9#issuecomment-123 were incorrectly
 * returning urlNumber as "9#issuecomment-123" instead of "9".
 */

const { parseGitHubUrl } = await import('../src/github.lib.mjs');
const { validateGitHubUrl, parseUrlComponents } = await import('../src/solve.validation.lib.mjs');

console.log('===========================================');
console.log('Unit Tests: URL Hash Fragment Handling');
console.log('Issue #991 Fix Verification');
console.log('===========================================\n');

let passed = 0;
let failed = 0;

function runTest(name, testFn) {
  try {
    const result = testFn();
    if (result === true) {
      passed++;
      console.log(`✅ PASS: ${name}`);
    } else {
      failed++;
      console.log(`❌ FAIL: ${name}`);
      console.log(`   Reason: ${result}`);
    }
  } catch (error) {
    failed++;
    console.log(`❌ FAIL: ${name}`);
    console.log(`   Error: ${error.message}`);
  }
}

console.log('Test Suite 1: parseGitHubUrl - Hash Fragment Handling\n');

// Test parseGitHubUrl handles hash fragments correctly
runTest('PR URL with issuecomment hash fragment', () => {
  const result = parseGitHubUrl('https://github.com/tool2agent/tool2agent/pull/9#issuecomment-3691329187');
  if (!result.valid) return `Expected valid, got: ${JSON.stringify(result)}`;
  if (result.type !== 'pull') return `Expected type 'pull', got: ${result.type}`;
  if (result.number !== 9) return `Expected number 9, got: ${result.number}`;
  if (result.owner !== 'tool2agent') return `Expected owner 'tool2agent', got: ${result.owner}`;
  return true;
});

runTest('Issue URL with issuecomment hash fragment', () => {
  const result = parseGitHubUrl('https://github.com/owner/repo/issues/123#issuecomment-456');
  if (!result.valid) return `Expected valid, got: ${JSON.stringify(result)}`;
  if (result.type !== 'issue') return `Expected type 'issue', got: ${result.type}`;
  if (result.number !== 123) return `Expected number 123, got: ${result.number}`;
  return true;
});

runTest('PR URL with discussion hash fragment', () => {
  const result = parseGitHubUrl('https://github.com/owner/repo/pull/789#discussion_r123456');
  if (!result.valid) return `Expected valid, got: ${JSON.stringify(result)}`;
  if (result.type !== 'pull') return `Expected type 'pull', got: ${result.type}`;
  if (result.number !== 789) return `Expected number 789, got: ${result.number}`;
  return true;
});

runTest('PR URL with pullrequestreview hash fragment', () => {
  const result = parseGitHubUrl('https://github.com/owner/repo/pull/42#pullrequestreview-999');
  if (!result.valid) return `Expected valid, got: ${JSON.stringify(result)}`;
  if (result.type !== 'pull') return `Expected type 'pull', got: ${result.type}`;
  if (result.number !== 42) return `Expected number 42, got: ${result.number}`;
  return true;
});

runTest('Issue URL without hash fragment (baseline)', () => {
  const result = parseGitHubUrl('https://github.com/owner/repo/issues/500');
  if (!result.valid) return `Expected valid, got: ${JSON.stringify(result)}`;
  if (result.type !== 'issue') return `Expected type 'issue', got: ${result.type}`;
  if (result.number !== 500) return `Expected number 500, got: ${result.number}`;
  return true;
});

console.log('\nTest Suite 2: validateGitHubUrl - Hash Fragment Handling\n');

runTest('validateGitHubUrl with PR + hash fragment returns correct number', () => {
  const result = validateGitHubUrl('https://github.com/tool2agent/tool2agent/pull/9#issuecomment-3691329187');
  if (!result.isValid) return `Expected isValid true, got: ${JSON.stringify(result)}`;
  if (!result.isPrUrl) return `Expected isPrUrl true, got: ${result.isPrUrl}`;
  if (result.number !== 9) return `Expected number 9, got: ${result.number}`;
  if (result.owner !== 'tool2agent') return `Expected owner 'tool2agent', got: ${result.owner}`;
  if (result.repo !== 'tool2agent') return `Expected repo 'tool2agent', got: ${result.repo}`;
  return true;
});

runTest('validateGitHubUrl with issue + hash fragment returns correct number', () => {
  const result = validateGitHubUrl('https://github.com/link-assistant/hive-mind/issues/991#issue-comment-test');
  if (!result.isValid) return `Expected isValid true, got: ${JSON.stringify(result)}`;
  if (!result.isIssueUrl) return `Expected isIssueUrl true, got: ${result.isIssueUrl}`;
  if (result.number !== 991) return `Expected number 991, got: ${result.number}`;
  return true;
});

console.log('\nTest Suite 3: parseUrlComponents - Hash Fragment Handling (Bug Fix)\n');

runTest('parseUrlComponents strips hash fragment from PR URL', () => {
  const result = parseUrlComponents('https://github.com/tool2agent/tool2agent/pull/9#issuecomment-3691329187');
  if (result.urlNumber !== '9') return `Expected urlNumber '9', got: '${result.urlNumber}'`;
  if (result.owner !== 'tool2agent') return `Expected owner 'tool2agent', got: '${result.owner}'`;
  if (result.repo !== 'tool2agent') return `Expected repo 'tool2agent', got: '${result.repo}'`;
  return true;
});

runTest('parseUrlComponents strips hash fragment from issue URL', () => {
  const result = parseUrlComponents('https://github.com/owner/repo/issues/123#issuecomment-456');
  if (result.urlNumber !== '123') return `Expected urlNumber '123', got: '${result.urlNumber}'`;
  return true;
});

runTest('parseUrlComponents handles discussion fragment', () => {
  const result = parseUrlComponents('https://github.com/owner/repo/pull/789#discussion_r123');
  if (result.urlNumber !== '789') return `Expected urlNumber '789', got: '${result.urlNumber}'`;
  return true;
});

runTest('parseUrlComponents handles pullrequestreview fragment', () => {
  const result = parseUrlComponents('https://github.com/owner/repo/pull/42#pullrequestreview-999');
  if (result.urlNumber !== '42') return `Expected urlNumber '42', got: '${result.urlNumber}'`;
  return true;
});

runTest('parseUrlComponents works without hash (baseline)', () => {
  const result = parseUrlComponents('https://github.com/owner/repo/issues/500');
  if (result.urlNumber !== '500') return `Expected urlNumber '500', got: '${result.urlNumber}'`;
  return true;
});

console.log('\nTest Suite 4: Edge Cases\n');

runTest('Empty hash fragment is handled', () => {
  const result = parseUrlComponents('https://github.com/owner/repo/pull/10#');
  if (result.urlNumber !== '10') return `Expected urlNumber '10', got: '${result.urlNumber}'`;
  return true;
});

runTest('Multiple hash chars (unusual but possible)', () => {
  // Only first # should split
  const result = parseUrlComponents('https://github.com/owner/repo/pull/20#comment#extra');
  if (result.urlNumber !== '20') return `Expected urlNumber '20', got: '${result.urlNumber}'`;
  return true;
});

runTest('URL with query params and hash', () => {
  // Query params come before hash in URL spec
  const result = parseGitHubUrl('https://github.com/owner/repo/pull/30?tab=files#diff-abc123');
  if (!result.valid) return `Expected valid, got: ${JSON.stringify(result)}`;
  if (result.number !== 30) return `Expected number 30, got: ${result.number}`;
  return true;
});

console.log('\n===========================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('===========================================\n');

if (failed > 0) {
  console.log('❌ Some tests failed!');
  process.exit(1);
}

console.log('✅ All tests passed!');
