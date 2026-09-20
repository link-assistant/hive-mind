/**
 * Repository-by-repository issue fetching fallback for the hive.
 *
 * Extracted from src/hive.mjs (issue #2175) so the entry point stays under the
 * 1350-line early-warning threshold that protects concurrent merges (#1593).
 * The logic is unchanged; it now takes its collaborators as parameters instead
 * of closing over the dynamically imported bindings in hive.mjs, which also
 * makes it unit-testable (see tests/hive-repository-fallback-2175.test.mjs).
 *
 * Used when GitHub's search API is rate-limited: rather than giving up, every
 * repository owned by the org/user is listed and queried directly.
 */

/**
 * Build the repository-fallback fetcher with its dependencies bound.
 *
 * @param {object} deps
 * @param {Function} deps.log
 * @param {Function} deps.cleanErrorMessage
 * @param {Function} deps.tryFetchIssuesWithGraphQL
 * @param {Function} deps.execGhWithRetry
 * @param {Function} deps.fetchAllIssuesWithPagination
 * @param {Function} deps.reportError
 * @param {(ms: number) => Promise<void>} [deps.sleeper] delay between API calls
 * @returns {(owner: string, scope: string, monitorTag?: string, fetchAllIssues?: boolean) => Promise<Array>}
 */
export function createRepositoryIssueFetcher({ log, cleanErrorMessage, tryFetchIssuesWithGraphQL, execGhWithRetry, fetchAllIssuesWithPagination, reportError, sleeper = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  /**
   * Fallback function to fetch issues from organization/user repositories
   * when search API hits rate limits
   * @param {string} owner - Organization or user name
   * @param {string} scope - 'organization' or 'user'
   * @param {string} monitorTag - Label to filter by (optional)
   * @param {boolean} fetchAllIssues - Whether to fetch all issues or only labeled ones
   * @returns {Promise<Array>} Array of issues
   */
  return async function fetchIssuesFromRepositories(owner, scope, monitorTag, fetchAllIssues = false) {
    try {
      await log(`   🔄 Using repository-by-repository fallback for ${scope}: ${owner}`);
      // Strategy 1: Try GraphQL approach first (faster but has limitations)
      // Only try GraphQL for "all issues" mode, not for labeled issues
      if (fetchAllIssues) {
        const graphqlResult = await tryFetchIssuesWithGraphQL(owner, scope, log, cleanErrorMessage);
        if (graphqlResult.success) {
          await log(`   ✅ GraphQL approach successful: ${graphqlResult.issues.length} issues from ${graphqlResult.repoCount} repositories`);
          return graphqlResult.issues;
        }
      }
      // Strategy 2: Fallback to gh api --paginate approach (comprehensive but slower)
      await log('   📋 Using gh api --paginate approach for comprehensive coverage...', { verbose: true });

      // Get list of ALL repositories using gh api with --paginate (includes isArchived for filtering)
      const scopePath = scope === 'organization' ? 'orgs' : 'users';
      const repoListCmd = `gh api ${scopePath}/${owner}/repos --paginate --jq '.[] | {name: .name, owner: .owner.login, isArchived: .archived}'`;
      await log('   📋 Fetching repository list (using --paginate for unlimited pagination)...', { verbose: true });
      await log(`   🔎 Command: ${repoListCmd}`, { verbose: true });
      // Add delay for rate limiting
      await sleeper(2000);
      // #1756: route through execGhWithRetry for transient 5xx + rate-limit
      const { stdout: repoOutput } = await execGhWithRetry(repoListCmd, {
        execOptions: { encoding: 'utf8', env: process.env },
        label: `gh api ${scope} repos (paginated)`,
      });
      // Parse the output line by line, as gh api with --jq outputs one JSON object per line
      const repoLines = repoOutput
        .trim()
        .split('\n')
        .filter(line => line.trim());
      const allRepositories = repoLines.map(line => JSON.parse(line));
      await log(`   📊 Found ${allRepositories.length} repositories`);
      // Filter repositories to only include those owned by the target user/org
      const ownedRepositories = allRepositories.filter(repo => {
        const repoOwner = repo.owner?.login || repo.owner;
        return repoOwner === owner;
      });
      const unownedCount = allRepositories.length - ownedRepositories.length;
      if (unownedCount > 0) {
        await log(`   ⏭️  Skipping ${unownedCount} repository(ies) not owned by ${owner}`);
      }
      // Filter out archived repositories from owned repositories
      const repositories = ownedRepositories.filter(repo => !repo.isArchived);
      const archivedCount = ownedRepositories.length - repositories.length;
      if (archivedCount > 0) {
        await log(`   ⏭️  Skipping ${archivedCount} archived repository(ies)`);
      }
      await log(`   ✅ Processing ${repositories.length} non-archived repositories owned by ${owner}`);
      const collectedIssues = [];
      let processedRepos = 0;
      // Process repositories in batches to avoid overwhelming the API
      for (const repo of repositories) {
        try {
          const repoName = repo.name;
          const ownerName = repo.owner?.login || owner;
          await log(`   🔍 Fetching issues from ${ownerName}/${repoName}...`, { verbose: true });
          // Build the appropriate issue list command
          const labelFilter = fetchAllIssues ? '' : ` --label "${monitorTag}"`;
          const issueCmd = `gh issue list --repo ${ownerName}/${repoName} --state open${labelFilter} --json url,title,number,createdAt`;
          // Add delay between repository requests
          await sleeper(1000);
          const repoIssues = await fetchAllIssuesWithPagination(issueCmd);
          // Add repository information to each issue
          const issuesWithRepo = repoIssues.map(issue => ({
            ...issue,
            repository: { name: repoName, owner: { login: ownerName } },
          }));
          collectedIssues.push(...issuesWithRepo);
          processedRepos++;
          if (issuesWithRepo.length > 0) {
            await log(`   ✅ Found ${issuesWithRepo.length} issues in ${ownerName}/${repoName}`, { verbose: true });
          }
        } catch (repoError) {
          reportError(repoError, { context: 'fetchIssuesFromRepositories', repo: repo.name, operation: 'fetch_repo_issues' });
          await log(`   ⚠️  Failed to fetch issues from ${repo.name}: ${cleanErrorMessage(repoError)}`, { verbose: true });
          // Continue with other repositories
        }
      }
      await log(`   ✅ Repository fallback complete: ${collectedIssues.length} issues from ${processedRepos}/${repositories.length} repositories`);
      return collectedIssues;
    } catch (error) {
      reportError(error, { context: 'fetchIssuesFromRepositories', owner, scope, operation: 'repository_fallback' });
      await log(`   ❌ Repository fallback failed: ${cleanErrorMessage(error)}`, { level: 'error' });
      return [];
    }
  };
}
