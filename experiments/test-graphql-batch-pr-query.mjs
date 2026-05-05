#!/usr/bin/env node

// Experiment to test GitHub GraphQL API for batch querying pull requests for multiple issues

import { execSync } from 'child_process';

async function testGraphQLBatchQuery() {
  console.log('🔬 Testing GitHub GraphQL API for batch PR queries\n');

  // Test repository
  const owner = 'link-assistant';
  const repo = 'hive-mind';
  const issueNumbers = [186, 189, 194]; // Sample issue numbers to test

  // GraphQL query to get PR information for multiple issues in one request
  const query = `
    query GetPullRequestsForIssues {
      repository(owner: "${owner}", name: "${repo}") {
        ${issueNumbers
          .map(
            num => `
        issue${num}: issue(number: ${num}) {
          number
          title
          state
          timelineItems(first: 100, itemTypes: [CROSS_REFERENCED_EVENT]) {
            nodes {
              ... on CrossReferencedEvent {
                source {
                  ... on PullRequest {
                    number
                    title
                    state
                    isDraft
                    url
                  }
                }
              }
            }
          }
        }`
          )
          .join('\n')}
      }
    }
  `;

  console.log('📝 GraphQL Query:');
  console.log(query);
  console.log('\n');

  try {
    // Execute GraphQL query using gh api graphql
    const result = execSync(`gh api graphql -f query='${query}'`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
    });

    const data = JSON.parse(result);
    console.log('✅ GraphQL query successful!\n');

    console.log('📊 Results:');
    console.log(JSON.stringify(data, null, 2));
    console.log('\n');

    // Parse results to show PR information
    console.log('📋 Summary:');
    for (const issueNum of issueNumbers) {
      const issueData = data.data.repository[`issue${issueNum}`];
      if (issueData) {
        console.log(`\nIssue #${issueNum}: ${issueData.title}`);
        console.log(`  State: ${issueData.state}`);

        // Find linked PRs
        const linkedPRs = [];
        for (const item of issueData.timelineItems.nodes || []) {
          if (item?.source) {
            linkedPRs.push(item.source);
          }
        }

        if (linkedPRs.length > 0) {
          console.log(`  Linked PRs:`);
          for (const pr of linkedPRs) {
            console.log(`    - PR #${pr.number}: ${pr.title} (${pr.state}${pr.isDraft ? ', DRAFT' : ''})`);
          }
        } else {
          console.log(`  No linked PRs found`);
        }
      }
    }

    console.log('\n🎯 This approach can fetch PR data for multiple issues in a single API call!');
    console.log('💡 Benefits:');
    console.log('  - Reduces API calls from N (one per issue) to 1');
    console.log('  - More efficient for batch processing');
    console.log('  - Less likely to hit rate limits');
    console.log('  - Can fetch up to ~100 issues in a single query (GraphQL complexity limits apply)');
  } catch (error) {
    console.error('❌ GraphQL query failed:', error.message);
    console.error('Error output:', error.stderr?.toString() || error.stdout?.toString());
  }
}

// Alternative: Using REST API with search
async function testSearchAPIForPRs() {
  console.log('\n\n🔬 Alternative: Testing GitHub Search API for linked PRs\n');

  const owner = 'link-assistant';
  const repo = 'hive-mind';

  try {
    // Search for all open PRs in the repository
    const searchResult = execSync(`gh api "search/issues?q=repo:${owner}/${repo}+type:pr+state:open" --jq '.items[] | {number, title, state, body}'`, { encoding: 'utf8' });

    console.log('✅ Search API query successful!');
    console.log('Results:', searchResult);

    console.log('\n💡 We could parse PR bodies/titles to find issue references');
    console.log('   - Look for patterns like "Fixes #123", "Closes #456"');
    console.log('   - Build a map of issue->PRs relationships');
    console.log('   - This approach requires only 1 API call for all PRs');
  } catch (error) {
    console.error('❌ Search API query failed:', error.message);
  }
}

// Run tests
(async () => {
  await testGraphQLBatchQuery();
  await testSearchAPIForPRs();
})();
