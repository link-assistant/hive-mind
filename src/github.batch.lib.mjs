#!/usr/bin/env node
// GitHub batch operations using GraphQL

// Check if use is already defined (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

// Import dependencies
import { log, cleanErrorMessage } from './lib.mjs';
import { githubLimits, timeouts } from './config.lib.mjs';
import { prClosesIssue } from './github-linking.lib.mjs';

import { wrapDollarWithGhRetry as _wrapDollarWithGhRetry, execGhWithRetry } from './github-rate-limit.lib.mjs'; // rate-limit marker (#1726): gh API calls flow through $ wrapped by caller. execGhWithRetry adds transient-network retry (#1756).
export { prClosesIssue };

/**
 * Extract open pull requests that are linked to an issue with closing keywords.
 * Draft pull requests are still open in-progress solution drafts, so they must
 * count for /hive --skip-issues-with-prs.
 * @param {Object} issueData - GraphQL issue node with timelineItems
 * @param {number} issueNum - Issue number to check
 * @param {Function} logger - Async logger, defaults to shared log helper
 * @returns {Promise<Array<Object>>} Linked open PRs that close the issue
 */
export async function extractLinkedPullRequestsForIssue(issueData, issueNum, logger = log) {
  const linkedPRs = [];

  for (const item of issueData.timelineItems?.nodes || []) {
    if (item?.source && item.source.state === 'OPEN') {
      // Check if PR actually closes this issue (has "fixes #N", "closes #N", or "resolves #N")
      const prBody = item.source.body || '';
      const prTitle = item.source.title || '';
      const closesThisIssue = prClosesIssue(prBody, issueNum) || prClosesIssue(prTitle, issueNum);

      if (closesThisIssue) {
        linkedPRs.push({
          number: item.source.number,
          title: item.source.title,
          state: item.source.state,
          isDraft: Boolean(item.source.isDraft),
          url: item.source.url,
        });
      } else {
        // Log that we're skipping a PR that only mentions the issue
        await logger(`      ℹ️  PR #${item.source.number} mentions issue #${issueNum} but doesn't close it (no fixes/closes/resolves keyword)`, { verbose: true });
      }
    }
  }

  return linkedPRs;
}

/**
 * Batch fetch pull request information for multiple issues using GraphQL
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {Array<number>} issueNumbers - Array of issue numbers to check
 * @returns {Promise<Object>} Object mapping issue numbers to their linked PRs
 */
export async function batchCheckPullRequestsForIssues(owner, repo, issueNumbers) {
  try {
    if (!issueNumbers || issueNumbers.length === 0) {
      return {};
    }

    await log(`   🔍 Batch checking PRs for ${issueNumbers.length} issues using GraphQL...`, { verbose: true });

    // GraphQL has complexity limits, so batch in groups of 50
    const BATCH_SIZE = 50;
    const results = {};

    for (let i = 0; i < issueNumbers.length; i += BATCH_SIZE) {
      const batch = issueNumbers.slice(i, i + BATCH_SIZE);

      // Build GraphQL query for this batch
      // Issue #1094: Include PR body to check for "fixes/closes/resolves #N" keywords
      // This prevents false positives from PRs that only mention issues without solving them
      const query = `
        query GetPullRequestsForIssues {
          repository(owner: "${owner}", name: "${repo}") {
            ${batch
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
                        body
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

      try {
        // Add small delay between batches to respect rate limits
        if (i > 0) {
          await log('   ⏰ Waiting 2 seconds before next batch...', { verbose: true });
          await new Promise(resolve => setTimeout(resolve, timeouts.githubRepoDelay));
        }

        // Execute GraphQL query (#1756: route through execGhWithRetry for transient 5xx + rate-limit)
        const { stdout } = await execGhWithRetry(`gh api graphql -f query='${query}'`, {
          execOptions: {
            encoding: 'utf8',
            maxBuffer: githubLimits.bufferMaxSize,
            env: process.env,
          },
          label: 'gh api graphql (batch PR check)',
        });

        const data = JSON.parse(stdout);

        // Process results for this batch
        for (const issueNum of batch) {
          const issueData = data.data?.repository?.[`issue${issueNum}`];
          if (issueData) {
            // Extract linked PRs from timeline items, including draft PRs.
            // Issue #1094: Only count PRs that explicitly fix/close/resolve this issue
            // This prevents false positives from PRs that only mention issues without solving them
            // Issue #1760: Draft PRs are still active solution drafts and must block duplicate work
            const linkedPRs = await extractLinkedPullRequestsForIssue(issueData, issueNum);

            results[issueNum] = {
              title: issueData.title,
              state: issueData.state,
              openPRCount: linkedPRs.length,
              linkedPRs: linkedPRs,
            };
          } else {
            // Issue not found or error
            results[issueNum] = {
              openPRCount: 0,
              linkedPRs: [],
              error: 'Issue not found',
            };
          }
        }

        await log(`   ✅ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(issueNumbers.length / BATCH_SIZE)} processed (${batch.length} issues)`, { verbose: true });
      } catch (batchError) {
        await log(`   ⚠️  GraphQL batch query failed: ${cleanErrorMessage(batchError)}`, { level: 'warning' });

        // Fall back to individual REST API calls for this batch
        await log('   🔄 Falling back to REST API for batch...', { verbose: true });

        for (const issueNum of batch) {
          try {
            const cmd = `gh api repos/${owner}/${repo}/issues/${issueNum}/timeline --paginate --jq '[.[] | select(.event == "cross-referenced" and .source.issue.pull_request != null and .source.issue.state == "open")] | length'`;

            // #1756: route REST fallback through execGhWithRetry for transient 5xx + rate-limit
            const { stdout } = await execGhWithRetry(cmd, {
              execOptions: { encoding: 'utf8', env: process.env },
              label: `gh api timeline (issue #${issueNum})`,
            });
            const openPrCount = parseInt(stdout.trim()) || 0;

            results[issueNum] = {
              openPRCount: openPrCount,
              linkedPRs: [], // REST API doesn't give us PR details easily
            };
          } catch (restError) {
            results[issueNum] = {
              openPRCount: 0,
              linkedPRs: [],
              error: cleanErrorMessage(restError),
            };
          }
        }
      }
    }

    // Log summary
    const totalIssues = issueNumbers.length;
    const issuesWithPRs = Object.values(results).filter(r => r.openPRCount > 0).length;
    await log(`   📊 Batch PR check complete: ${issuesWithPRs}/${totalIssues} issues have open PRs`, { verbose: true });

    return results;
  } catch (error) {
    await log(`   ❌ Batch PR check failed: ${cleanErrorMessage(error)}`, { level: 'error' });
    return {};
  }
}

/**
 * Batch check if repositories are archived using GraphQL
 * This is more efficient than checking each repository individually
 * @param {Array<{owner: string, name: string}>} repositories - Array of repository objects with owner and name
 * @returns {Promise<Object>} Object mapping "owner/repo" to isArchived boolean
 */
export async function batchCheckArchivedRepositories(repositories) {
  try {
    if (!repositories || repositories.length === 0) {
      return {};
    }

    await log(`   🔍 Batch checking archived status for ${repositories.length} repositories...`, { verbose: true });

    // GraphQL has complexity limits, so batch in groups of 50
    const BATCH_SIZE = 50;
    const results = {};

    for (let i = 0; i < repositories.length; i += BATCH_SIZE) {
      const batch = repositories.slice(i, i + BATCH_SIZE);

      // Build GraphQL query for this batch
      const queryFields = batch
        .map(
          (repo, index) => `
        repo${index}: repository(owner: "${repo.owner}", name: "${repo.name}") {
          nameWithOwner
          isArchived
        }`
        )
        .join('\n');

      const query = `
        query CheckArchivedStatus {
          ${queryFields}
        }
      `;

      try {
        // Add small delay between batches to respect rate limits
        if (i > 0) {
          await log('   ⏰ Waiting 2 seconds before next batch...', { verbose: true });
          await new Promise(resolve => setTimeout(resolve, timeouts.githubRepoDelay));
        }

        // Execute GraphQL query (#1756: route through execGhWithRetry for transient 5xx + rate-limit)
        const { stdout } = await execGhWithRetry(`gh api graphql -f query='${query}'`, {
          execOptions: {
            encoding: 'utf8',
            maxBuffer: githubLimits.bufferMaxSize,
            env: process.env,
          },
          label: 'gh api graphql (batch archived check)',
        });

        const data = JSON.parse(stdout);

        // Process results for this batch
        batch.forEach((repo, index) => {
          const repoData = data.data?.[`repo${index}`];
          if (repoData) {
            const repoKey = `${repo.owner}/${repo.name}`;
            results[repoKey] = repoData.isArchived;
          }
        });

        await log(`   ✅ Batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(repositories.length / BATCH_SIZE)} processed (${batch.length} repositories)`, { verbose: true });
      } catch (batchError) {
        await log(`   ⚠️  GraphQL batch query failed: ${cleanErrorMessage(batchError)}`, { level: 'warning' });

        // Fall back to individual REST API calls for this batch
        await log('   🔄 Falling back to REST API for batch...', { verbose: true });

        for (const repo of batch) {
          try {
            const cmd = `gh api repos/${repo.owner}/${repo.name} --jq .archived`;

            // #1756: route REST fallback through execGhWithRetry for transient 5xx + rate-limit
            const { stdout } = await execGhWithRetry(cmd, {
              execOptions: { encoding: 'utf8', env: process.env },
              label: `gh api repos (${repo.owner}/${repo.name})`,
            });
            const isArchived = stdout.trim() === 'true';

            const repoKey = `${repo.owner}/${repo.name}`;
            results[repoKey] = isArchived;
          } catch {
            // If we can't check, assume it's not archived (safer to include than exclude)
            const repoKey = `${repo.owner}/${repo.name}`;
            results[repoKey] = false;
            await log(`   ⚠️  Could not check ${repoKey}, assuming not archived`, { verbose: true });
          }
        }
      }
    }

    // Log summary
    const archivedCount = Object.values(results).filter(isArchived => isArchived).length;
    await log(`   📊 Batch archived check complete: ${archivedCount}/${repositories.length} repositories are archived`, { verbose: true });

    return results;
  } catch (error) {
    await log(`   ❌ Batch archived check failed: ${cleanErrorMessage(error)}`, { level: 'error' });
    return {};
  }
}

// Export all functions as default object too
export default {
  prClosesIssue,
  extractLinkedPullRequestsForIssue,
  batchCheckPullRequestsForIssues,
  batchCheckArchivedRepositories,
};
