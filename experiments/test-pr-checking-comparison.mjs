#!/usr/bin/env node

// Compare old vs new PR checking approaches

import { execSync } from 'child_process';
import { batchCheckPullRequestsForIssues } from '../github.lib.mjs';

// Old approach - individual API calls
async function oldApproach(owner, repo, issueNumbers) {
  console.log('📊 Old Approach (Individual REST API calls per issue):');
  const results = {};
  let apiCalls = 0;
  const startTime = Date.now();

  for (const issueNum of issueNumbers) {
    try {
      // Simulate the old hasOpenPullRequests logic
      const cmd = `gh api repos/${owner}/${repo}/issues/${issueNum}/timeline --jq '[.[] | select(.event == "cross-referenced" and .source.issue.pull_request != null and .source.issue.state == "open")] | length'`;

      const output = execSync(cmd, { encoding: 'utf8' }).trim();
      const openPrCount = parseInt(output) || 0;
      apiCalls++;

      results[issueNum] = {
        openPRCount: openPrCount
      };

      console.log(`   Issue #${issueNum}: ${openPrCount} open PR(s)`);

      // Add delay to avoid rate limits (as in original code)
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (error) {
      console.error(`   Issue #${issueNum}: Error - ${error.message}`);
      results[issueNum] = { error: error.message };
      apiCalls++;
    }
  }

  const elapsed = Date.now() - startTime;
  console.log(`\n   ⏱️  Time taken: ${elapsed}ms`);
  console.log(`   📡 API calls made: ${apiCalls}`);

  return { results, apiCalls, time: elapsed };
}

// New approach - batch GraphQL
async function newApproach(owner, repo, issueNumbers) {
  console.log('\n📊 New Approach (Batch GraphQL query):');
  const startTime = Date.now();

  const results = await batchCheckPullRequestsForIssues(owner, repo, issueNumbers);

  const elapsed = Date.now() - startTime;

  for (const [issueNum, data] of Object.entries(results)) {
    if (data.error) {
      console.log(`   Issue #${issueNum}: Error - ${data.error}`);
    } else {
      console.log(`   Issue #${issueNum}: ${data.openPRCount} open PR(s)`);
    }
  }

  console.log(`\n   ⏱️  Time taken: ${elapsed}ms`);
  console.log(`   📡 API calls made: 1 (batch query)`);

  return { results, apiCalls: 1, time: elapsed };
}

// Main comparison
async function compareApproaches() {
  console.log('🔬 Comparing PR Checking Approaches\n');
  console.log('=' .repeat(60));

  const owner = 'link-assistant';
  const repo = 'hive-mind';
  const issues = [183, 184, 186, 194, 197]; // Mix of issues

  console.log(`\nTest Setup:`);
  console.log(`   Repository: ${owner}/${repo}`);
  console.log(`   Issues to check: ${issues.join(', ')}`);
  console.log(`   Total issues: ${issues.length}\n`);

  // Wait before starting to respect rate limits
  console.log('⏰ Waiting 5 seconds to respect rate limits...\n');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Test old approach
  const oldResults = await oldApproach(owner, repo, issues);

  // Wait between approaches
  console.log('\n⏰ Waiting 5 seconds between approaches...');
  await new Promise(resolve => setTimeout(resolve, 5000));

  // Test new approach
  const newResults = await newApproach(owner, repo, issues);

  // Compare results
  console.log('\n' + '=' .repeat(60));
  console.log('📈 Comparison Results:\n');

  console.log('┌─────────────────┬──────────────────┬──────────────────┐');
  console.log('│ Metric          │ Old Approach     │ New Approach     │');
  console.log('├─────────────────┼──────────────────┼──────────────────┤');
  console.log(`│ API Calls       │ ${String(oldResults.apiCalls).padEnd(16)} │ ${String(newResults.apiCalls).padEnd(16)} │`);
  console.log(`│ Time (ms)       │ ${String(oldResults.time).padEnd(16)} │ ${String(newResults.time).padEnd(16)} │`);
  console.log(`│ Avg time/issue  │ ${String(Math.round(oldResults.time / issues.length)).padEnd(16)} │ ${String(Math.round(newResults.time / issues.length)).padEnd(16)} │`);
  console.log('└─────────────────┴──────────────────┴──────────────────┘');

  const apiReduction = Math.round((1 - newResults.apiCalls / oldResults.apiCalls) * 100);
  const timeReduction = Math.round((1 - newResults.time / oldResults.time) * 100);

  console.log(`\n💡 Improvements:`);
  console.log(`   - API calls reduced by: ${apiReduction}%`);
  console.log(`   - Time reduced by: ${timeReduction}%`);
  console.log(`   - Scale benefit: As issue count increases, savings multiply`);

  console.log('\n✅ Conclusion:');
  console.log('   The new batch GraphQL approach significantly reduces API calls');
  console.log('   and improves performance, especially important for rate limit');
  console.log('   management when processing multiple issues.');
}

// Run comparison
compareApproaches().catch(console.error);