#!/usr/bin/env node

/**
 * Experiment to test filtering of archived repositories from GitHub search results
 * This script tests the exact scenario described in issue #542
 */

import { execSync } from 'child_process';

console.log('🧪 Testing archived repository filtering...\n');

// Test case 1: Fetch issues from a known archived repository
console.log('📋 Test 1: Checking if a repository is archived');
const testRepoOwner = 'konard';
const testRepoName = 'test-hello-world-01992020-00f8-7cf2-9bb6-a1c2a7718de5';

try {
  const repoInfo = execSync(`gh api repos/${testRepoOwner}/${testRepoName} --jq '{name: .name, archived: .archived, has_issues: .has_issues}'`, { encoding: 'utf8' });
  const repo = JSON.parse(repoInfo);
  console.log(`  Repository: ${testRepoOwner}/${testRepoName}`);
  console.log(`  Is archived: ${repo.archived}`);
  console.log(`  Has issues: ${repo.has_issues}`);
  console.log();
} catch (error) {
  console.error(`  ❌ Error checking repository: ${error.message}`);
  console.log();
}

// Test case 2: Check if search API returns repository archived status
console.log('📋 Test 2: Check if search API includes repository.isArchived field');
try {
  const searchResult = execSync(`gh search issues repo:${testRepoOwner}/${testRepoName} is:open --json url,title,number,repository --limit 5`, { encoding: 'utf8' });
  const issues = JSON.parse(searchResult);

  if (issues.length > 0) {
    console.log(`  Found ${issues.length} issue(s)`);
    console.log(`  First issue repository info:`);
    console.log(` `, JSON.stringify(issues[0].repository, null, 2));

    if (issues[0].repository && 'isArchived' in issues[0].repository) {
      console.log(`  ✅ The search API includes isArchived field:`, issues[0].repository.isArchived);
    } else {
      console.log(`  ❌ The search API does NOT include isArchived field`);
      console.log(`  Available fields:`, Object.keys(issues[0].repository || {}).join(', '));
    }
  } else {
    console.log(`  No issues found in ${testRepoOwner}/${testRepoName}`);
  }
  console.log();
} catch (error) {
  console.error(`  ❌ Error searching issues: ${error.message}`);
  console.log();
}

// Test case 3: Check all available fields from gh search issues
console.log('📋 Test 3: Check all available fields from gh search issues');
try {
  // Get the list of all available fields
  const fieldsResult = execSync(`gh search issues --help | grep -A 100 "available for '--json'"`, { encoding: 'utf8' });
  console.log('  Available --json fields for gh search issues:');
  console.log(fieldsResult);
} catch (error) {
  // Alternative: just try to get issues and see what fields are available
  try {
    const searchResult = execSync(`gh search issues repo:${testRepoOwner}/${testRepoName} is:open --limit 1 --json url,title,number,repository`, { encoding: 'utf8' });
    const issues = JSON.parse(searchResult);
    if (issues.length > 0 && issues[0].repository) {
      console.log('  Repository object keys:', Object.keys(issues[0].repository).join(', '));
    }
  } catch (err) {
    console.error(`  ❌ Error: ${err.message}`);
  }
}
console.log();

// Test case 4: Fetch repository info using GraphQL to check isArchived
console.log('📋 Test 4: Check repository using GraphQL API');
try {
  const graphqlQuery = `
    query {
      repository(owner: "${testRepoOwner}", name: "${testRepoName}") {
        name
        isArchived
        hasIssuesEnabled
        issues(states: OPEN, first: 5) {
          totalCount
          nodes {
            number
            title
            url
          }
        }
      }
    }
  `;

  const result = execSync(`gh api graphql -f query='${graphqlQuery}'`, { encoding: 'utf8' });
  const data = JSON.parse(result);

  if (data.data && data.data.repository) {
    const repo = data.data.repository;
    console.log(`  Repository: ${repo.name}`);
    console.log(`  Is archived: ${repo.isArchived}`);
    console.log(`  Has issues enabled: ${repo.hasIssuesEnabled}`);
    console.log(`  Open issues count: ${repo.issues.totalCount}`);
    if (repo.issues.nodes.length > 0) {
      console.log(`  First issue: ${repo.issues.nodes[0].title}`);
      console.log(`  Issue URL: ${repo.issues.nodes[0].url}`);
    }
  }
  console.log();
} catch (error) {
  console.error(`  ❌ Error with GraphQL: ${error.message}`);
  console.log();
}

console.log('✅ Experiment complete!\n');
console.log('💡 Findings:');
console.log('   - We need to filter issues based on repository.isArchived field');
console.log('   - The gh search API may or may not include this field automatically');
console.log('   - We can check each repository separately using the REST API');
console.log('   - GraphQL API provides isArchived directly\n');
