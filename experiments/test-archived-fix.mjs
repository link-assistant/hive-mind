#!/usr/bin/env node
// Test script to verify archived repository filtering fix

import { batchCheckArchivedRepositories } from '../src/github.batch.lib.mjs';

// Test the archived repository checking
async function testArchivedCheck() {
  console.log('🧪 Testing archived repository filtering fix...\n');

  // Test with the archived repository from issue #542
  const testRepos = [
    {
      owner: 'konard',
      name: 'test-hello-world-01992020-00f8-7cf2-9bb6-a1c2a7718de5'
    }
  ];

  console.log('📋 Testing with repository:');
  console.log(`   - ${testRepos[0].owner}/${testRepos[0].name}`);
  console.log('');

  try {
    const results = await batchCheckArchivedRepositories(testRepos);

    console.log('✅ Batch check completed successfully!\n');
    console.log('📊 Results:');
    for (const [repoKey, isArchived] of Object.entries(results)) {
      console.log(`   - ${repoKey}: ${isArchived ? '🗄️  ARCHIVED' : '✅ ACTIVE'}`);
    }
    console.log('');

    // Verify the result
    const repoKey = `${testRepos[0].owner}/${testRepos[0].name}`;
    if (results[repoKey] === true) {
      console.log('✅ Test PASSED: Archived repository correctly identified!');
      return true;
    } else {
      console.log('❌ Test FAILED: Archived repository not identified!');
      return false;
    }
  } catch (error) {
    console.error('❌ Test FAILED with error:', error.message);
    return false;
  }
}

// Test URL extraction logic
async function testUrlExtraction() {
  console.log('\n🧪 Testing URL extraction logic...\n');

  const testIssue = {
    url: 'https://github.com/konard/test-hello-world-01992020-00f8-7cf2-9bb6-a1c2a7718de5/issues/1',
    title: 'Test Issue'
  };

  console.log('📋 Testing with issue URL:');
  console.log(`   ${testIssue.url}\n`);

  const urlMatch = testIssue.url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/\d+/);
  if (urlMatch) {
    const repoOwner = urlMatch[1];
    const repoName = urlMatch[2];
    console.log('✅ URL parsing successful:');
    console.log(`   Owner: ${repoOwner}`);
    console.log(`   Repo: ${repoName}`);

    if (repoOwner === 'konard' && repoName === 'test-hello-world-01992020-00f8-7cf2-9bb6-a1c2a7718de5') {
      console.log('\n✅ Test PASSED: URL extraction works correctly!');
      return true;
    }
  }

  console.log('\n❌ Test FAILED: URL extraction did not work!');
  return false;
}

// Run all tests
async function runTests() {
  console.log('🚀 Starting archived repository filtering tests\n');
  console.log('='.repeat(60));
  console.log('');

  const test1 = await testArchivedCheck();
  const test2 = await testUrlExtraction();

  console.log('');
  console.log('='.repeat(60));
  console.log('\n📊 Test Summary:');
  console.log(`   Archived Check: ${test1 ? '✅ PASSED' : '❌ FAILED'}`);
  console.log(`   URL Extraction: ${test2 ? '✅ PASSED' : '❌ FAILED'}`);
  console.log('');

  if (test1 && test2) {
    console.log('✅ All tests PASSED!');
    process.exit(0);
  } else {
    console.log('❌ Some tests FAILED!');
    process.exit(1);
  }
}

runTests().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
