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

/**
 * Check if a PR body/title indicates it fixes/closes/resolves a specific issue number
 * GitHub auto-closes issues when PR body contains keywords like "fixes #123", "closes #123", "resolves #123"
 * See: https://docs.github.com/en/issues/tracking-your-work-with-issues/linking-a-pull-request-to-an-issue
 * @param {string} text - PR body or title text
 * @param {number} issueNumber - Issue number to check for
 * @returns {boolean} True if the text contains a closing keyword for this issue
 */
export function prClosesIssue(text, issueNumber) {
  if (!text || typeof text !== 'string') {
    return false;
  }

  // GitHub closing keywords (case-insensitive)
  // Supports: fix, fixes, fixed, close, closes, closed, resolve, resolves, resolved
  // Also supports variations with repository prefix like "fixes owner/repo#123"
  const closingKeywords = ['fix', 'fixes', 'fixed', 'close', 'closes', 'closed', 'resolve', 'resolves', 'resolved'];

  // Build regex pattern that matches any of the keywords followed by #N or repo#N
  // Examples matched:
  //   - "fixes #123"
  //   - "Closes #123"
  //   - "RESOLVED #123"
  //   - "fixes owner/repo#123"
  //   - "fix: #123" (common commit style)
  const issueNum = issueNumber.toString();

  for (const keyword of closingKeywords) {
    // Pattern: keyword + optional colon/space + optional repo prefix + # + issue number
    // Must be followed by word boundary (not part of larger number)
    const patterns = [
      // Standard format: "fixes #123"
      new RegExp(`\\b${keyword}\\s*:?\\s*#${issueNum}\\b`, 'i'),
      // With repo prefix: "fixes owner/repo#123"
      new RegExp(`\\b${keyword}\\s*:?\\s*[\\w.-]+/[\\w.-]+#${issueNum}\\b`, 'i'),
    ];

    for (const pattern of patterns) {
      if (pattern.test(text)) {
        return true;
      }
    }
  }

  return false;
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

        // Execute GraphQL query
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync(`gh api graphql -f query='${query}'`, {
          encoding: 'utf8',
          maxBuffer: githubLimits.bufferMaxSize,
          env: process.env,
        });

        const data = JSON.parse(stdout);

        // Process results for this batch
        for (const issueNum of batch) {
          const issueData = data.data?.repository?.[`issue${issueNum}`];
          if (issueData) {
            const linkedPRs = [];

            // Extract linked PRs from timeline items
            // Issue #1094: Only count PRs that explicitly fix/close/resolve this issue
            // This prevents false positives from PRs that only mention issues without solving them
            for (const item of issueData.timelineItems?.nodes || []) {
              if (item?.source && item.source.state === 'OPEN' && !item.source.isDraft) {
                // Check if PR actually closes this issue (has "fixes #N", "closes #N", or "resolves #N")
                const prBody = item.source.body || '';
                const prTitle = item.source.title || '';
                const closesThisIssue = prClosesIssue(prBody, issueNum) || prClosesIssue(prTitle, issueNum);

                if (closesThisIssue) {
                  linkedPRs.push({
                    number: item.source.number,
                    title: item.source.title,
                    state: item.source.state,
                    url: item.source.url,
                  });
                } else {
                  // Log that we're skipping a PR that only mentions the issue
                  await log(`      ℹ️  PR #${item.source.number} mentions issue #${issueNum} but doesn't close it (no fixes/closes/resolves keyword)`, { verbose: true });
                }
              }
            }

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
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);
            const cmd = `gh api repos/${owner}/${repo}/issues/${issueNum}/timeline --paginate --jq '[.[] | select(.event == "cross-referenced" and .source.issue.pull_request != null and .source.issue.state == "open")] | length'`;

            const { stdout } = await execAsync(cmd, { encoding: 'utf8', env: process.env });
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

        // Execute GraphQL query
        const { exec } = await import('child_process');
        const { promisify } = await import('util');
        const execAsync = promisify(exec);
        const { stdout } = await execAsync(`gh api graphql -f query='${query}'`, {
          encoding: 'utf8',
          maxBuffer: githubLimits.bufferMaxSize,
          env: process.env,
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
            const { exec } = await import('child_process');
            const { promisify } = await import('util');
            const execAsync = promisify(exec);
            const cmd = `gh api repos/${repo.owner}/${repo.name} --jq .archived`;

            const { stdout } = await execAsync(cmd, { encoding: 'utf8', env: process.env });
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
  batchCheckPullRequestsForIssues,
  batchCheckArchivedRepositories,
};
