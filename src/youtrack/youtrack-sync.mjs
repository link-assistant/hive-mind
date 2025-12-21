#!/usr/bin/env node

/**
 * YouTrack to GitHub Issue Synchronization Module
 *
 * This module syncs YouTrack issues to GitHub, creating GitHub issues that:
 * - Include the YouTrack ID in the title for automatic linking
 * - Can be processed by solve.mjs normally
 * - Result in PRs that YouTrack will automatically link back
 */

// Import YouTrack functions
const youTrackLib = await import('./youtrack.lib.mjs');
const {
  fetchYouTrackIssues
} = youTrackLib;

/**
 * Find existing GitHub issue for a YouTrack issue
 * @param {string} youTrackId - The YouTrack issue ID (e.g., "2-3606")
 * @param {string} owner - GitHub repository owner
 * @param {string} repo - GitHub repository name
 * @param {Object} $ - Command execution function
 * @returns {Object|null} GitHub issue if found
 */
export async function findGitHubIssueForYouTrack(youTrackId, owner, repo, $) {
  try {
    // Search for both open and closed issues with the YouTrack ID in the title
    // This prevents creating duplicates even if an issue was closed
    const searchResult = await $`gh api search/issues --jq '.items' -X GET -f q="repo:${owner}/${repo} \"${youTrackId}\" in:title is:issue"`;

    if (searchResult.code !== 0) {
      return null;
    }

    const issues = JSON.parse(searchResult.stdout.toString().trim() || '[]');

    // Find exact match (YouTrack ID should be in brackets or at start)
    // Return the first matching issue (prefer open issues)
    const openIssue = issues.find(issue =>
      issue.state === 'open' && (issue.title.includes(`[${youTrackId}]`) || issue.title.startsWith(`${youTrackId}:`))
    );

    if (openIssue) return openIssue;

    // If no open issue, check for closed issues to prevent duplicates
    const closedIssue = issues.find(issue =>
      issue.state === 'closed' && (issue.title.includes(`[${youTrackId}]`) || issue.title.startsWith(`${youTrackId}:`))
    );

    return closedIssue || null;
  } catch {
    return null;
  }
}

/**
 * Create or update GitHub issue from YouTrack issue
 * @param {Object} youTrackIssue - YouTrack issue object
 * @param {string} owner - GitHub repository owner
 * @param {string} repo - GitHub repository name
 * @param {Object} youTrackConfig - YouTrack configuration
 * @param {Object} $ - Command execution function
 * @param {Function} log - Logging function
 * @returns {Object} Created or updated GitHub issue
 */
export async function syncYouTrackIssueToGitHub(youTrackIssue, owner, repo, youTrackConfig, $, log) {
  const youTrackId = youTrackIssue.id;
  const youTrackUrl = youTrackIssue.url || `${youTrackConfig.url}/issue/${youTrackId}`;

  // Format title with YouTrack ID for automatic linking
  // Format: "[PROJECT-123] Original Title" or "PROJECT-123: Original Title"
  const ghTitle = `[${youTrackId}] ${youTrackIssue.summary}`;

  // Build issue body with YouTrack details
  const ghBody = `## YouTrack Issue

**ID:** ${youTrackId}
**Link:** ${youTrackUrl}
**Stage:** ${youTrackIssue.customFields?.find(f => f.name === 'Stage')?.value?.name || 'Unknown'}

## Description

${youTrackIssue.description || 'No description provided.'}

---
*This issue is automatically synchronized from YouTrack. Any commits or PRs that reference \`${youTrackId}\` will be automatically linked in YouTrack.*

**Note:** To process this issue, ensure the 'help wanted' label exists in your repository.`;

  // Check if issue already exists
  const existingIssue = await findGitHubIssueForYouTrack(youTrackId, owner, repo, $);

  if (existingIssue) {
    // If issue is closed, skip it (don't recreate or update)
    if (existingIssue.state === 'closed') {
      await log(`   ⏭️ Skipping ${youTrackId} - GitHub issue #${existingIssue.number} is closed`);
      return existingIssue;
    }

    // Update existing open issue if title or body changed
    const needsUpdate = existingIssue.title !== ghTitle || existingIssue.body !== ghBody;

    if (needsUpdate) {
      await log(`   📝 Updating issue #${existingIssue.number} for ${youTrackId}...`);

      const updateResult = await $`gh issue edit ${existingIssue.number} --repo ${owner}/${repo} --title "${ghTitle}" --body "${ghBody}"`;

      if (updateResult.code === 0) {
        await log(`   ✅ Updated issue #${existingIssue.number}`);
      } else {
        await log(`   ⚠️ Failed to update issue #${existingIssue.number}`, { level: 'warning' });
      }
    } else {
      await log(`   ✓ Issue #${existingIssue.number} already up to date for ${youTrackId}`);
    }

    // Ensure help wanted label is applied
    const hasLabel = existingIssue.labels?.some(l => l.name === 'help wanted');
    if (!hasLabel) {
      try {
        await $`gh issue edit ${existingIssue.number} --repo ${owner}/${repo} --add-label "help wanted"`;
        await log(`   🏷️ Added 'help wanted' label to #${existingIssue.number}`);
      } catch {
        // Silently skip if label doesn't exist
        await log('   ⚠️ Could not add \'help wanted\' label (may not exist in repo)', { verbose: true });
      }
    }

    return existingIssue;
  } else {
    // Create new issue
    await log(`   ➕ Creating GitHub issue for ${youTrackId}...`);

    try {
      const createResult = await $`gh issue create --repo ${owner}/${repo} --title "${ghTitle}" --body "${ghBody}" --label "help wanted"`;

      if (createResult.code === 0) {
        const issueUrl = createResult.stdout.toString().trim();
        const issueNumber = issueUrl.match(/\/issues\/(\d+)/)?.[1];
        await log(`   ✅ Created issue #${issueNumber} for ${youTrackId}`);
        await log(`   📍 URL: ${issueUrl}`);

        return {
          number: issueNumber,
          title: ghTitle,
          body: ghBody,
          html_url: issueUrl
        };
      } else {
        await log(`   ❌ Failed to create issue for ${youTrackId}`, { level: 'error' });
        return null;
      }
    } catch (error) {
      await log(`   ❌ Error creating issue: ${error.message}`, { level: 'error' });
      return null;
    }
  }
}

/**
 * Sync all YouTrack issues to GitHub
 * @param {Object} youTrackConfig - YouTrack configuration
 * @param {string} owner - GitHub repository owner
 * @param {string} repo - GitHub repository name
 * @param {Object} $ - Command execution function
 * @param {Function} log - Logging function
 * @returns {Array} Array of GitHub issues (created or updated)
 */
export async function syncYouTrackToGitHub(youTrackConfig, owner, repo, $, log) {
  await log('\n🔄 Syncing YouTrack issues to GitHub...');
  await log(`   📍 YouTrack: ${youTrackConfig.url}`);
  await log(`   📋 Project: ${youTrackConfig.projectCode}`);
  await log(`   📌 Stage: "${youTrackConfig.stage}"`);
  await log(`   🎯 Target: ${owner}/${repo}`);

  // Fetch YouTrack issues
  const youTrackIssues = await fetchYouTrackIssues(youTrackConfig);

  if (!youTrackIssues || youTrackIssues.length === 0) {
    await log(`   ℹ️ No issues found in YouTrack with stage "${youTrackConfig.stage}"`);
    return [];
  }

  await log(`   📊 Found ${youTrackIssues.length} issue(s) to sync`);

  // Sync each issue to GitHub
  const githubIssues = [];
  for (const ytIssue of youTrackIssues) {
    const ghIssue = await syncYouTrackIssueToGitHub(ytIssue, owner, repo, youTrackConfig, $, log);
    if (ghIssue) {
      githubIssues.push({
        ...ghIssue,
        youtrackId: ytIssue.id,
        youtrackUrl: `${youTrackConfig.url}/issue/${ytIssue.idReadable}`
      });
    }
  }

  await log(`   ✅ Sync complete: ${githubIssues.length} issues ready in GitHub`);

  return githubIssues;
}

/**
 * Convert synced GitHub issues to format expected by hive.mjs
 * @param {Array} githubIssues - Array of GitHub issues with YouTrack metadata
 * @returns {Array} Issues in hive.mjs format
 */
export function formatIssuesForHive(githubIssues) {
  return githubIssues.map(issue => ({
    number: issue.number,
    title: issue.title,
    html_url: issue.html_url,
    labels: issue.labels || [{ name: 'help-wanted' }],
    youtrackId: issue.youtrackId,
    youtrackUrl: issue.youtrackUrl
  }));
}