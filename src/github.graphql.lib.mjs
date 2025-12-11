/**
 * GraphQL API utilities for GitHub issue fetching
 * This module provides functions to fetch issues using GitHub's GraphQL API
 */

/**
 * Fetch issues from a single repository with pagination support for >100 issues
 * @param {string} owner - Repository owner
 * @param {string} repoName - Repository name
 * @param {Function} log - Logging function
 * @param {Function} cleanErrorMessage - Error message cleaner
 * @param {number} issueLimit - Maximum number of issues to fetch per query (default 100)
 * @returns {Promise<Array>} Array of issues
 */
async function fetchRepositoryIssuesWithPagination(owner, repoName, log, cleanErrorMessage, issueLimit = 100) {
  const { execSync } = await import('child_process');
  const allIssues = [];
  let hasNextPage = true;
  let cursor = null;
  let pageNum = 0;

  try {
    while (hasNextPage) {
      pageNum++;

      // Build query with cursor for pagination
      const graphqlQuery = `
        query($owner: String!, $repo: String!, $issueLimit: Int!, $cursor: String) {
          repository(owner: $owner, name: $repo) {
            issues(states: OPEN, first: $issueLimit, after: $cursor) {
              totalCount
              pageInfo {
                hasNextPage
                endCursor
              }
              nodes {
                number
                title
                url
                createdAt
              }
            }
          }
        }
      `;

      // Execute GraphQL query
      const escapedQuery = graphqlQuery.replace(/'/g, '\'\\\'\'');
      let graphqlCmd = `gh api graphql -f query='${escapedQuery}' -f owner='${owner}' -f repo='${repoName}' -F issueLimit=${issueLimit}`;

      if (cursor) {
        graphqlCmd += ` -f cursor='${cursor}'`;
      }

      await log(`      📄 Fetching issues page ${pageNum} from ${owner}/${repoName}...`, { verbose: true });

      // Add delay for rate limiting
      await new Promise(resolve => setTimeout(resolve, 1000));

      const result = execSync(graphqlCmd, { encoding: 'utf8', env: process.env });
      const data = JSON.parse(result);
      const issuesData = data.data.repository.issues;

      // Add issues to collection
      allIssues.push(...issuesData.nodes);

      // Check if there are more pages
      hasNextPage = issuesData.pageInfo.hasNextPage;
      cursor = issuesData.pageInfo.endCursor;

      await log(`      ✅ Fetched ${issuesData.nodes.length} issues (total so far: ${allIssues.length}/${issuesData.totalCount})`, { verbose: true });
    }

    return allIssues;

  } catch (error) {
    await log(`      ❌ Failed to fetch issues from ${owner}/${repoName}: ${cleanErrorMessage(error)}`, { verbose: true });
    // Return what we have so far
    return allIssues;
  }
}

/**
 * Try to fetch issues using GraphQL API with full pagination support
 * This approach uses cursor-based pagination to handle unlimited repositories and issues
 * @param {string} owner - Organization or user name
 * @param {string} scope - 'organization' or 'user'
 * @param {Function} log - Logging function
 * @param {Function} cleanErrorMessage - Error message cleaner
 * @param {number} repoLimit - Maximum number of repos to fetch per query (default 100)
 * @param {number} issueLimit - Maximum number of issues to fetch per repo query (default 100)
 * @returns {Promise<{success: boolean, issues: Array, repoCount: number}>}
 */
export async function tryFetchIssuesWithGraphQL(owner, scope, log, cleanErrorMessage, repoLimit = 100, issueLimit = 100) {
  const { execSync } = await import('child_process');

  try {
    await log('   🧪 Attempting GraphQL approach with pagination support...', { verbose: true });

    const isOrg = scope === 'organization';
    const allRepos = [];
    let hasNextRepoPage = true;
    let repoCursor = null;
    let repoPageNum = 0;

    // Fetch all repositories with pagination
    while (hasNextRepoPage) {
      repoPageNum++;

      // Build GraphQL query to fetch repos
      const graphqlQuery = isOrg ? `
        query($owner: String!, $repoLimit: Int!, $cursor: String) {
          organization(login: $owner) {
            repositories(first: $repoLimit, orderBy: {field: UPDATED_AT, direction: DESC}, after: $cursor) {
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
                isArchived
                issues(states: OPEN, first: 1) {
                  totalCount
                }
              }
            }
          }
        }
      ` : `
        query($owner: String!, $repoLimit: Int!, $cursor: String) {
          user(login: $owner) {
            repositories(first: $repoLimit, orderBy: {field: UPDATED_AT, direction: DESC}, after: $cursor) {
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
                isArchived
                issues(states: OPEN, first: 1) {
                  totalCount
                }
              }
            }
          }
        }
      `;

      // Execute GraphQL query
      const escapedQuery = graphqlQuery.replace(/'/g, '\'\\\'\'');
      let graphqlCmd = `gh api graphql -f query='${escapedQuery}' -f owner='${owner}' -F repoLimit=${repoLimit}`;

      if (repoCursor) {
        graphqlCmd += ` -f cursor='${repoCursor}'`;
      }

      await log(`   📄 Fetching repositories page ${repoPageNum} for ${owner}...`, { verbose: true });

      // Add delay for rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));

      const result = execSync(graphqlCmd, { encoding: 'utf8', env: process.env });
      const data = JSON.parse(result);
      const repos = isOrg ? data.data.organization.repositories : data.data.user.repositories;

      // Add repos to collection
      allRepos.push(...repos.nodes);

      // Check if there are more pages
      hasNextRepoPage = repos.pageInfo.hasNextPage;
      repoCursor = repos.pageInfo.endCursor;

      const totalRepos = repos.totalCount;
      await log(`   ✅ Fetched ${repos.nodes.length} repositories (total so far: ${allRepos.length}/${totalRepos})`, { verbose: true });
    }

    await log(`   📊 Fetched all ${allRepos.length} repositories`, { verbose: true });

    // Filter out archived repositories AND repositories not owned by the target user/org
    const ownedRepos = allRepos.filter(repo => repo.owner.login === owner);
    const unownedCount = allRepos.length - ownedRepos.length;

    if (unownedCount > 0) {
      await log(`   ⏭️  Skipping ${unownedCount} repository(ies) not owned by ${owner}`);
    }

    const nonArchivedRepos = ownedRepos.filter(repo => !repo.isArchived);
    const archivedCount = ownedRepos.length - nonArchivedRepos.length;

    if (archivedCount > 0) {
      await log(`   ⏭️  Skipping ${archivedCount} archived repository(ies)`);
    }

    await log(`   ✅ Processing ${nonArchivedRepos.length} non-archived repositories owned by ${owner}`);

    // Now fetch issues from each repository
    // For repositories with >100 issues, use pagination
    const allIssues = [];
    let reposWithIssues = 0;

    for (const repo of nonArchivedRepos) {
      const issueCount = repo.issues.totalCount;

      // Skip repos with no issues
      if (issueCount === 0) {
        continue;
      }

      await log(`   🔍 Fetching ${issueCount} issue(s) from ${repo.owner.login}/${repo.name}...`, { verbose: true });

      // Fetch all issues from this repository with pagination
      const repoIssues = await fetchRepositoryIssuesWithPagination(
        repo.owner.login,
        repo.name,
        log,
        cleanErrorMessage,
        issueLimit
      );

      // Add repository information to each issue
      for (const issue of repoIssues) {
        allIssues.push({
          ...issue,
          repository: {
            name: repo.name,
            owner: repo.owner
          }
        });
      }

      if (repoIssues.length > 0) {
        reposWithIssues++;
        await log(`   ✅ Collected ${repoIssues.length} issue(s) from ${repo.owner.login}/${repo.name}`, { verbose: true });
      }
    }

    await log(`   ✅ GraphQL pagination complete: ${nonArchivedRepos.length} non-archived repos, ${allIssues.length} issues from ${reposWithIssues} repos with issues`, { verbose: true });

    return { success: true, issues: allIssues, repoCount: nonArchivedRepos.length };

  } catch (error) {
    await log(`   ❌ GraphQL approach failed: ${cleanErrorMessage(error)}`, { verbose: true });
    await log('   💡 Falling back to gh api --paginate approach...', { verbose: true });
    return { success: false, issues: [], repoCount: 0 };
  }
}
