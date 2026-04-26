#!/usr/bin/env node

/**
 * Integration test for archived repository filtering
 * Tests the batchCheckArchivedRepositories function
 */

import { batchCheckArchivedRepositories } from '../src/github.lib.mjs';

console.log('🧪 Testing batchCheckArchivedRepositories function...\n');

// Test with known repositories (some archived, some not)
const testRepos = [
  // Archived repository from the issue
  { owner: 'konard', name: 'test-hello-world-01992020-00f8-7cf2-9bb6-a1c2a7718de5' },
  // Regular repository (should not be archived)
  { owner: 'link-assistant', name: 'hive-mind' },
  // Another test repository
  { owner: 'konard', name: 'vk-bot' },
];

try {
  console.log(`Testing with ${testRepos.length} repositories:`);
  testRepos.forEach(repo => {
    console.log(`  - ${repo.owner}/${repo.name}`);
  });
  console.log();

  const results = await batchCheckArchivedRepositories(testRepos);

  console.log('Results:');
  for (const [repoKey, isArchived] of Object.entries(results)) {
    const status = isArchived ? '🗄️  ARCHIVED' : '✅ ACTIVE';
    console.log(`  ${status}: ${repoKey}`);
  }
  console.log();

  // Verify the archived repository is correctly detected
  const archivedRepo = `${testRepos[0].owner}/${testRepos[0].name}`;
  if (results[archivedRepo] === true) {
    console.log('✅ SUCCESS: Archived repository correctly detected!');
  } else {
    console.error('❌ FAILED: Archived repository was not detected!');
    process.exit(1);
  }

  console.log('\n🎉 Integration test passed!\n');
} catch (error) {
  console.error('❌ Test failed with error:', error.message);
  if (error.stack) {
    console.error(error.stack);
  }
  process.exit(1);
}
