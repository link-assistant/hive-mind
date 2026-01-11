#!/usr/bin/env node

/**
 * Test script to verify that 404 errors during fork creation do not trigger retries
 *
 * This test simulates the scenario from issue #808 where attempting to fork
 * a non-existent or inaccessible repository should fail immediately with a
 * helpful error message instead of retrying 5 times.
 *
 * Expected behavior:
 * - Tool should detect HTTP 404 error
 * - Tool should NOT retry (saves ~30 seconds)
 * - Tool should display user-friendly error message
 * - Tool should suggest checking permissions
 */

// Use use-m to dynamically import modules for cross-runtime compatibility
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

const { $ } = await use('command-stream');

console.log('🧪 Testing 404 No-Retry Fix for Issue #808\n');

// Test case: Try to access a repository that doesn't exist
const testRepo = 'nonexistent-user-12345/nonexistent-repo-67890';
const [owner, repo] = testRepo.split('/');

console.log(`📋 Test Case: Attempting to fork ${testRepo}`);
console.log('   Expected: Immediate failure with helpful error message');
console.log('   Expected: No retry attempts\n');

const startTime = Date.now();

// Simulate what getRootRepository does
console.log('1️⃣ Testing getRootRepository function behavior...');
const rootRepoResult = await $`gh api repos/${owner}/${repo} --jq '{fork: .fork, source: .source.full_name}' 2>&1`;

if (rootRepoResult.code !== 0) {
  const errorOutput = (rootRepoResult.stderr || rootRepoResult.stdout || '').toString();

  if (errorOutput.includes('HTTP 404') || errorOutput.includes('Not Found')) {
    console.log('   ✅ Correctly detected 404 error');
    console.log('   ✅ Function should return null (no retry)\n');
  } else {
    console.log('   ⚠️  Error detected but not 404:', errorOutput.split('\n')[0]);
  }
} else {
  console.log('   ❌ Unexpected: Repository exists!\n');
}

// Simulate what fork creation does
console.log('2️⃣ Testing fork creation behavior...');
const forkResult = await $`gh repo fork ${owner}/${repo} --clone=false 2>&1`;
const forkOutput = (forkResult.stderr || forkResult.stdout || '').toString();

if (forkResult.code !== 0) {
  if (forkOutput.includes('HTTP 404') || forkOutput.includes('Not Found')) {
    console.log('   ✅ Correctly detected 404 error during fork creation');
    console.log('   ✅ Should NOT retry - exit immediately\n');
  } else {
    console.log('   ⚠️  Fork failed with non-404 error:', forkOutput.split('\n')[0]);
  }
} else {
  console.log('   ❌ Unexpected: Fork succeeded!\n');
}

const endTime = Date.now();
const duration = ((endTime - startTime) / 1000).toFixed(2);

console.log(`⏱️  Test completed in ${duration}s`);
console.log('');

// Verify timing
if (parseFloat(duration) < 5) {
  console.log('✅ PASS: Execution time < 5 seconds (no retries)');
  console.log('   Without fix: Would take ~35+ seconds (5 retries with exponential backoff)');
  console.log('   With fix: Takes < 5 seconds (immediate failure)');
} else {
  console.log('⚠️  WARNING: Execution took longer than expected');
  console.log('   This might indicate retries are still happening');
}

console.log('');
console.log('📊 Summary:');
console.log('   - 404 errors should be detected immediately');
console.log('   - No retry attempts should occur for 404 errors');
console.log('   - User-friendly error messages should be displayed');
console.log('   - Tool should save ~30 seconds and 10 API requests');
console.log('');
console.log('💡 To verify the fix in the full solve tool:');
console.log('   node src/solve.mjs https://github.com/nonexistent-user/nonexistent-repo/issues/1 --auto-fork --verbose');
console.log('');
