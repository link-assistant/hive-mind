#!/usr/bin/env node

// Experiment to test GitHub GraphQL API for batch querying pull requests for multiple issues

import { execSync } from 'child_process';

async function testGraphQLBatchQuery() {
  console.log('🔬 Testing GitHub GraphQL API for batch PR queries\n');

  // Test repository
  const owner = 'link-assistant';
  const repo = 'hive-mind';
  const issueNumbers = [186, 194, 197]; // Using valid issue numbers

  // GraphQL query to get PR information for multiple issues in one request
  const query = `
    query GetPullRequestsForIssues {
      repository(owner: "${owner}", name: "${repo}") {
        ${issueNumbers.map(num => `
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
        }`).join('\n')}
      }
    }
  `;

  console.log('📝 GraphQL Query (fetching PR info for issues #186, #194, #197):');
  console.log('Query structure preview (abbreviated)...\n');

  try {
    // Execute GraphQL query using gh api graphql
    const result = execSync(`gh api graphql -f query='${query}'`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024 // 10MB buffer
    });

    const data = JSON.parse(result);
    console.log('✅ GraphQL query successful!\n');

    // Parse results to show PR information
    console.log('📋 Summary:');
    let totalAPICalls = 0;
    let issuesWithPRs = 0;
    let issuesWithoutPRs = 0;

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
          issuesWithPRs++;
          for (const pr of linkedPRs) {
            console.log(`    - PR #${pr.number}: ${pr.title} (${pr.state}${pr.isDraft ? ', DRAFT' : ''})`);
          }
        } else {
          console.log(`  No linked PRs found`);
          issuesWithoutPRs++;
        }
      }
    }

    console.log('\n📊 Statistics:');
    console.log(`  - Total issues checked: ${issueNumbers.length}`);
    console.log(`  - Issues with PRs: ${issuesWithPRs}`);
    console.log(`  - Issues without PRs: ${issuesWithoutPRs}`);
    console.log(`  - API calls used: 1 (GraphQL batch query)`);
    console.log(`  - API calls saved: ${issueNumbers.length - 1} (compared to individual REST API calls)`);

    console.log('\n🎯 Benefits of GraphQL batch querying:');
    console.log('  ✅ Single API call for multiple issues');
    console.log('  ✅ Reduces rate limit consumption');
    console.log('  ✅ Faster execution (no sequential waiting)');
    console.log('  ✅ Can batch up to ~50-100 issues per query');
    console.log('  ✅ Complete timeline information included');

    return data;

  } catch (error) {
    console.error('❌ GraphQL query failed:', error.message);
    if (error.stderr) {
      console.error('Error details:', error.stderr.toString());
    }
    return null;
  }
}

// Alternative approach using REST API with single call
async function testRESTAPIBatchApproach() {
  console.log('\n\n🔬 Alternative: REST API approach (current implementation)\n');

  const owner = 'link-assistant';
  const repo = 'hive-mind';
  const issueNumbers = [186, 194, 197];

  console.log('Current approach makes individual API calls:');

  let apiCallCount = 0;
  for (const issueNum of issueNumbers) {
    console.log(`  - API call ${++apiCallCount}: gh api repos/${owner}/${repo}/issues/${issueNum}/timeline`);
  }

  console.log(`\nTotal API calls needed: ${apiCallCount}`);
  console.log('⚠️  This approach is inefficient and prone to rate limiting!');
}

// Compare the approaches
async function compareApproaches() {
  console.log('\n\n📈 Comparison: GraphQL vs REST API for batch PR checking\n');

  console.log('Scenario: Check 50 issues for linked PRs');
  console.log('\n┌─────────────────────┬──────────────┬─────────────────┐');
  console.log('│ Approach            │ API Calls    │ Rate Limit Risk │');
  console.log('├─────────────────────┼──────────────┼─────────────────┤');
  console.log('│ Current (REST)      │ 50           │ High            │');
  console.log('│ GraphQL (batched)   │ 1            │ Low             │');
  console.log('│ Savings             │ 49 (98%)     │ Significant     │');
  console.log('└─────────────────────┴──────────────┴─────────────────┘');

  console.log('\n💡 Implementation Strategy:');
  console.log('  1. Group issues into batches of 50');
  console.log('  2. Use GraphQL to fetch PR data for each batch');
  console.log('  3. Cache results to avoid repeated queries');
  console.log('  4. Fall back to REST API for individual queries if needed');
}

// Run tests
(async () => {
  console.log('=' .repeat(60));
  console.log('GitHub GraphQL Batch PR Query Experiment');
  console.log('=' .repeat(60));

  const graphqlResult = await testGraphQLBatchQuery();

  if (graphqlResult) {
    await testRESTAPIBatchApproach();
    await compareApproaches();

    console.log('\n\n✅ Conclusion:');
    console.log('GraphQL batch querying can significantly reduce API calls');
    console.log('and improve performance when checking multiple issues for PRs.');
  }
})();