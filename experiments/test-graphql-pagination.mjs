#!/usr/bin/env node

/**
 * Experiment: Test GraphQL pagination for repositories and issues
 *
 * This script tests the new GraphQL pagination implementation to ensure it can:
 * 1. Fetch more than 100 repositories
 * 2. Fetch more than 100 issues from a single repository
 * 3. Handle pagination correctly with cursors
 */

import { tryFetchIssuesWithGraphQL } from '../src/github.graphql.lib.mjs';

// Mock logging function
const logs = [];
async function log(message, options = {}) {
  const logEntry = {
    message,
    verbose: options.verbose || false,
    level: options.level || 'info'
  };
  logs.push(logEntry);

  // Always print to console for experiment
  if (options.level === 'error') {
    console.error(message);
  } else {
    console.log(message);
  }
}

// Mock error message cleaner
function cleanErrorMessage(error) {
  if (typeof error === 'string') {
    return error;
  }
  return error.message || error.toString();
}

// Test function
async function testGraphQLPagination() {
  console.log('🧪 Starting GraphQL Pagination Test\n');

  // Test 1: Test with a user/org that likely has many repositories
  // We'll use 'konard' as mentioned in the issue
  console.log('Test 1: Fetching repositories for user "konard"');
  console.log('Expected: Should fetch all repositories with pagination\n');

  try {
    const result = await tryFetchIssuesWithGraphQL(
      'konard',
      'user',
      log,
      cleanErrorMessage,
      10, // Limit to 10 repos per page to test pagination
      5   // Limit to 5 issues per page to test issue pagination
    );

    console.log('\n✅ Test 1 Results:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Repositories fetched: ${result.repoCount}`);
    console.log(`   Total issues: ${result.issues.length}`);

    if (result.success && result.repoCount > 10) {
      console.log('   ✅ Pagination worked! Fetched more than one page of repositories.');
    } else if (result.success && result.repoCount <= 10) {
      console.log('   ℹ️  User has 10 or fewer repositories (pagination not needed).');
    } else {
      console.log('   ⚠️  GraphQL approach failed or fell back.');
    }

    // Show some sample issues
    if (result.issues.length > 0) {
      console.log('\n   Sample issues (first 3):');
      for (let i = 0; i < Math.min(3, result.issues.length); i++) {
        const issue = result.issues[i];
        console.log(`   - ${issue.repository.owner.login}/${issue.repository.name}#${issue.number}: ${issue.title}`);
      }
    }

  } catch (error) {
    console.error('❌ Test 1 failed with error:', cleanErrorMessage(error));
    console.error(error.stack);
  }

  console.log('\n' + '='.repeat(80));
  console.log('\n📊 Log Summary:');
  console.log(`   Total log entries: ${logs.length}`);
  console.log(`   Verbose logs: ${logs.filter(l => l.verbose).length}`);
  console.log(`   Error logs: ${logs.filter(l => l.level === 'error').length}`);

  console.log('\n✅ GraphQL Pagination Test Complete');
}

// Run the test
testGraphQLPagination().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
