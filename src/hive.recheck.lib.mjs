#!/usr/bin/env node
// Library for rechecking issue conditions in hive queue processing

import { log, cleanErrorMessage } from './lib.mjs';
import { batchCheckPullRequestsForIssues, batchCheckArchivedRepositories } from './github.lib.mjs';
import { reportError } from './sentry.lib.mjs';

/**
 * Recheck conditions for an issue right before processing
 * This ensures the issue should still be processed even if conditions changed since queuing
 * @param {string} issueUrl - The URL of the issue to check
 * @param {Object} argv - Command line arguments with configuration
 * @returns {Promise<{shouldProcess: boolean, reason?: string}>}
 */
export async function recheckIssueConditions(issueUrl, argv) {
  try {
    // Extract owner, repo, and issue number from URL
    const urlMatch = issueUrl.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);
    if (!urlMatch) {
      await log(`      ⚠️  Could not parse issue URL: ${issueUrl}`, { verbose: true });
      return { shouldProcess: true }; // Process anyway if we can't parse
    }

    const [, owner, repo, issueNumber] = urlMatch;
    const issueNum = parseInt(issueNumber);

    await log(`      🔍 Rechecking conditions for issue #${issueNum}...`, { verbose: true });

    // Check 1: Verify issue is still open
    try {
      const { execSync } = await import('child_process');
      const issueState = execSync(`gh api repos/${owner}/${repo}/issues/${issueNum} --jq .state`, {
        encoding: 'utf8'
      }).trim();

      if (issueState === 'closed') {
        return {
          shouldProcess: false,
          reason: 'Issue is now closed'
        };
      }
      await log(`      ✅ Issue is still open`, { verbose: true });
    } catch (error) {
      await log(`      ⚠️  Could not check issue state: ${cleanErrorMessage(error)}`, { verbose: true });
      // Continue checking other conditions
    }

    // Check 2: If skipIssuesWithPrs is enabled, verify issue still has no open PRs
    if (argv.skipIssuesWithPrs) {
      const prResults = await batchCheckPullRequestsForIssues(owner, repo, [issueNum]);
      const prInfo = prResults[issueNum];

      if (prInfo && prInfo.openPRCount > 0) {
        return {
          shouldProcess: false,
          reason: `Issue now has ${prInfo.openPRCount} open PR${prInfo.openPRCount > 1 ? 's' : ''}`
        };
      }
      await log(`      ✅ Issue still has no open PRs`, { verbose: true });
    }

    // Check 3: Verify repository is not archived
    const archivedStatusMap = await batchCheckArchivedRepositories([{ owner, name: repo }]);
    const repoKey = `${owner}/${repo}`;

    if (archivedStatusMap[repoKey] === true) {
      return {
        shouldProcess: false,
        reason: 'Repository is now archived'
      };
    }
    await log(`      ✅ Repository is not archived`, { verbose: true });

    await log(`      ✅ All conditions passed, proceeding with processing`, { verbose: true });
    return { shouldProcess: true };

  } catch (error) {
    reportError(error, {
      context: 'recheck_issue_conditions',
      issueUrl,
      operation: 'recheck_conditions'
    });
    await log(`      ⚠️  Error rechecking conditions: ${cleanErrorMessage(error)}`, { level: 'warning' });
    // On error, allow processing to continue (fail open)
    return { shouldProcess: true };
  }
}
