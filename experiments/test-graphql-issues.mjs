#!/usr/bin/env node

/**
 * Experiment: Test GraphQL API for fetching issues from user/org
 *
 * This script tests the GitHub GraphQL API's ability to fetch issues
 * directly from a user or organization with filters applied.
 *
 * Benefits over REST API:
 * 1. Single request instead of multiple paginated requests
 * 2. Can fetch exactly the fields we need
 * 3. Built-in filtering capabilities
 * 4. Better performance for large organizations
 */

import { execSync } from 'child_process';

/**
 * Test fetching issues from a user using GraphQL
 * @param {string} username - GitHub username
 * @param {string|null} label - Optional label to filter by
 * @param {number} limit - Maximum number of issues to fetch
 */
async function testUserIssuesWithGraphQL(username, label = null, limit = 100) {
  console.log(`\n🧪 Testing GraphQL API for user: ${username}`);
  console.log(`   Label filter: ${label || 'none (all issues)'}`);
  console.log(`   Limit: ${limit}`);

  try {
    // Build the GraphQL query
    // Note: GitHub GraphQL API doesn't support searching issues by user directly
    // We need to use the search query syntax
    let searchQuery = `is:issue is:open author:${username}`;
    if (label) {
      searchQuery += ` label:"${label}"`;
    }

    const graphqlQuery = `
      query($queryString: String!, $limit: Int!) {
        search(query: $queryString, type: ISSUE, first: $limit) {
          issueCount
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ... on Issue {
              number
              title
              url
              createdAt
              repository {
                name
                owner {
                  login
                }
              }
            }
          }
        }
      }
    `;

    // Execute the query
    const result = execSync(
      `gh api graphql -f query='${graphqlQuery.replace(/'/g, "'\\''")}' -f queryString='${searchQuery}' -F limit=${limit}`,
      { encoding: 'utf8' }
    );

    const data = JSON.parse(result);
    const issues = data.data.search.nodes;
    const totalCount = data.data.search.issueCount;
    const hasMore = data.data.search.pageInfo.hasNextPage;

    console.log(`   ✅ Found ${issues.length} issues (total: ${totalCount}, has more: ${hasMore})`);
    console.log(`   Sample issues:`);
    for (const issue of issues.slice(0, 5)) {
      console.log(`      - ${issue.repository.owner.login}/${issue.repository.name}#${issue.number}: ${issue.title}`);
    }

    return { issues, totalCount, hasMore };
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  }
}

/**
 * Test fetching issues from an organization using GraphQL
 * @param {string} orgName - GitHub organization name
 * @param {string|null} label - Optional label to filter by
 * @param {number} limit - Maximum number of issues to fetch
 */
async function testOrgIssuesWithGraphQL(orgName, label = null, limit = 100) {
  console.log(`\n🧪 Testing GraphQL API for organization: ${orgName}`);
  console.log(`   Label filter: ${label || 'none (all issues)'}`);
  console.log(`   Limit: ${limit}`);

  try {
    // Build the GraphQL query
    let searchQuery = `is:issue is:open org:${orgName}`;
    if (label) {
      searchQuery += ` label:"${label}"`;
    }

    const graphqlQuery = `
      query($queryString: String!, $limit: Int!) {
        search(query: $queryString, type: ISSUE, first: $limit) {
          issueCount
          pageInfo {
            hasNextPage
            endCursor
          }
          nodes {
            ... on Issue {
              number
              title
              url
              createdAt
              repository {
                name
                owner {
                  login
                }
              }
            }
          }
        }
      }
    `;

    // Execute the query
    const result = execSync(
      `gh api graphql -f query='${graphqlQuery.replace(/'/g, "'\\''")}' -f queryString='${searchQuery}' -F limit=${limit}`,
      { encoding: 'utf8' }
    );

    const data = JSON.parse(result);
    const issues = data.data.search.nodes;
    const totalCount = data.data.search.issueCount;
    const hasMore = data.data.search.pageInfo.hasNextPage;

    console.log(`   ✅ Found ${issues.length} issues (total: ${totalCount}, has more: ${hasMore})`);
    console.log(`   Sample issues:`);
    for (const issue of issues.slice(0, 5)) {
      console.log(`      - ${issue.repository.owner.login}/${issue.repository.name}#${issue.number}: ${issue.title}`);
    }

    return { issues, totalCount, hasMore };
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  }
}

/**
 * Test fetching repositories and their issues using GraphQL
 * This is an alternative approach that might be more efficient
 */
async function testReposWithIssuesGraphQL(owner, isOrg = false, limit = 10) {
  console.log(`\n🧪 Testing GraphQL API for fetching repos with issues: ${owner}`);
  console.log(`   Type: ${isOrg ? 'organization' : 'user'}`);
  console.log(`   Repo limit: ${limit}`);

  try {
    const graphqlQuery = isOrg
      ? `
      query($owner: String!, $repoLimit: Int!) {
        organization(login: $owner) {
          repositories(first: $repoLimit, orderBy: {field: UPDATED_AT, direction: DESC}) {
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              name
              owner {
                login
              }
              issues(states: OPEN, first: 100) {
                totalCount
                nodes {
                  number
                  title
                  url
                  createdAt
                }
              }
            }
          }
        }
      }
    `
      : `
      query($owner: String!, $repoLimit: Int!) {
        user(login: $owner) {
          repositories(first: $repoLimit, orderBy: {field: UPDATED_AT, direction: DESC}) {
            totalCount
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              name
              owner {
                login
              }
              issues(states: OPEN, first: 100) {
                totalCount
                nodes {
                  number
                  title
                  url
                  createdAt
                }
              }
            }
          }
        }
      }
    `;

    const result = execSync(
      `gh api graphql -f query='${graphqlQuery.replace(/'/g, "'\\''")}' -f owner='${owner}' -F repoLimit=${limit}`,
      { encoding: 'utf8' }
    );

    const data = JSON.parse(result);
    const repos = isOrg ? data.data.organization.repositories : data.data.user.repositories;
    const totalRepos = repos.totalCount;
    const hasMoreRepos = repos.pageInfo.hasNextPage;

    let totalIssues = 0;
    const allIssues = [];

    for (const repo of repos.nodes) {
      totalIssues += repo.issues.totalCount;
      for (const issue of repo.issues.nodes) {
        allIssues.push({
          ...issue,
          repository: {
            name: repo.name,
            owner: repo.owner
          }
        });
      }
    }

    console.log(`   ✅ Found ${repos.nodes.length} repos (total: ${totalRepos}, has more: ${hasMoreRepos})`);
    console.log(`   ✅ Found ${allIssues.length} issues across all repos (total open: ${totalIssues})`);
    console.log(`   Note: This approach has a limitation - can only fetch 100 issues per repo`);

    return { repos: repos.nodes, totalRepos, hasMoreRepos, issues: allIssues, totalIssues };
  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    throw error;
  }
}

// Run tests
async function main() {
  console.log('🚀 Starting GraphQL API experiments\n');
  console.log('='.repeat(80));

  try {
    // Test 1: Fetch issues from konard user (all issues)
    console.log('\n📋 Test 1: Fetch all open issues from user konard');
    console.log('-'.repeat(80));
    await testUserIssuesWithGraphQL('konard', null, 20);

    // Test 2: Fetch issues from link-assistant organization
    console.log('\n📋 Test 2: Fetch all open issues from org link-assistant');
    console.log('-'.repeat(80));
    await testOrgIssuesWithGraphQL('link-assistant', null, 20);

    // Test 3: Fetch repos with issues from konard (alternative approach)
    console.log('\n📋 Test 3: Fetch repos with their issues from user konard');
    console.log('-'.repeat(80));
    await testReposWithIssuesGraphQL('konard', false, 10);

    console.log('\n' + '='.repeat(80));
    console.log('✅ All tests completed!\n');

    console.log('📊 Findings:');
    console.log('   1. GraphQL search API works but has same limitations as REST search API');
    console.log('   2. It still uses search API which is rate limited');
    console.log('   3. Alternative: Fetch repos + issues in one query, but limited to 100 issues/repo');
    console.log('   4. For comprehensive issue fetching, repository-by-repository approach is still needed');
  } catch (error) {
    console.error('\n❌ Tests failed:', error.message);
    process.exit(1);
  }
}

main();
