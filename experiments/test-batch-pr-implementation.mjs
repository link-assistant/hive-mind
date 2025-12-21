#!/usr/bin/env node

// Test script to verify the batch PR checking implementation

import { batchCheckPullRequestsForIssues } from '../github.lib.mjs';

async function testBatchImplementation() {
  console.log('🧪 Testing Batch PR Checking Implementation\n');
  console.log('='.repeat(60));

  // Test with some real issues from the hive-mind repository
  const testCases = [
    {
      owner: 'link-assistant',
      repo: 'hive-mind',
      issues: [186, 194, 197, 183, 184], // Mix of issues with and without PRs
      description: 'Mixed issues from hive-mind repo',
    },
  ];

  for (const testCase of testCases) {
    console.log(`\n📝 Test: ${testCase.description}`);
    console.log(`   Repository: ${testCase.owner}/${testCase.repo}`);
    console.log(`   Issues to check: ${testCase.issues.join(', ')}`);
    console.log('');

    const startTime = Date.now();

    try {
      // Call our new batch function
      const results = await batchCheckPullRequestsForIssues(testCase.owner, testCase.repo, testCase.issues);

      const elapsed = Date.now() - startTime;

      console.log('✅ Batch check completed successfully!');
      console.log(`   Time taken: ${elapsed}ms`);
      console.log('\n📊 Results:');

      for (const issueNum of testCase.issues) {
        const result = results[issueNum];
        if (result) {
          console.log(`\n   Issue #${issueNum}:`);
          if (result.error) {
            console.log(`      ❌ Error: ${result.error}`);
          } else {
            console.log(`      Title: ${result.title}`);
            console.log(`      State: ${result.state}`);
            console.log(`      Open PRs: ${result.openPRCount}`);
            if (result.linkedPRs && result.linkedPRs.length > 0) {
              console.log(`      Linked PRs:`);
              for (const pr of result.linkedPRs) {
                console.log(`        - PR #${pr.number}: ${pr.title} (${pr.state})`);
              }
            }
          }
        } else {
          console.log(`\n   Issue #${issueNum}: No data returned`);
        }
      }

      // Compare with individual API calls approach
      console.log('\n\n📈 Performance Comparison:');
      console.log('   Batch GraphQL approach:');
      console.log(`      - API calls: 1`);
      console.log(`      - Time: ${elapsed}ms`);
      console.log('   Individual REST API approach (estimated):');
      console.log(`      - API calls: ${testCase.issues.length}`);
      console.log(`      - Estimated time: ${testCase.issues.length * 1000}ms (with delays)`);
      console.log(`   \n   💡 Efficiency improvement: ${Math.round((1 - 1 / testCase.issues.length) * 100)}% fewer API calls`);
    } catch (error) {
      console.error('❌ Test failed:', error.message);
      if (error.stack) {
        console.error('Stack trace:', error.stack);
      }
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('✅ Testing complete!');
}

// Run the test
testBatchImplementation().catch(console.error);
