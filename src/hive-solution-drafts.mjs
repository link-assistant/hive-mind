/**
 * Solution Drafts Display Module
 *
 * This module handles the display of completed issues with their linked pull requests.
 * Extracted from hive.mjs to maintain file size limits.
 */

/**
 * Lists all completed issues with their solution drafts (PRs)
 * @param {Object} issueQueue - The issue queue containing completed issues
 * @param {Function} log - Logging function
 * @param {Function} batchCheckPullRequestsForIssues - Function to batch check PRs for issues
 */
export async function listSolutionDrafts(issueQueue, log, batchCheckPullRequestsForIssues) {
  if (!issueQueue.completed || issueQueue.completed.length === 0) {
    return;
  }

  await log('\n📋 Issues with solution drafts:');

  // Group completed issues by repository
  const issuesByRepo = {};
  for (const issueUrl of issueQueue.completed) {
    const urlMatch = issueUrl.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (urlMatch) {
      const [, issueOwner, issueRepo, issueNumber] = urlMatch;
      const repoKey = `${issueOwner}/${issueRepo}`;

      if (!issuesByRepo[repoKey]) {
        issuesByRepo[repoKey] = {
          owner: issueOwner,
          repo: issueRepo,
          issues: []
        };
      }

      issuesByRepo[repoKey].issues.push({
        number: parseInt(issueNumber),
        url: issueUrl
      });
    }
  }

  // Fetch PR information for each repository
  for (const repoData of Object.values(issuesByRepo)) {
    const issueNumbers = repoData.issues.map(i => i.number);
    const prResults = await batchCheckPullRequestsForIssues(repoData.owner, repoData.repo, issueNumbers);

    // Display issues with their PRs
    for (const issueData of repoData.issues) {
      const prInfo = prResults[issueData.number];
      if (prInfo && prInfo.linkedPRs && prInfo.linkedPRs.length > 0) {
        // Show issue with its linked PRs
        await log(`   - ${issueData.url}`);
        for (const pr of prInfo.linkedPRs) {
          await log(`     → PR #${pr.number}: ${pr.url}`);
        }
      } else {
        // Issue completed but no PR found
        await log(`   - ${issueData.url} (no PR found)`);
      }
    }
  }
}
