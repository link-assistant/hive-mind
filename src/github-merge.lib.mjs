#!/usr/bin/env node
/**
 * GitHub Merge Queue Library
 *
 * Provides utilities for the /merge command including:
 * - Label management (create/check 'ready' label)
 * - Fetching PRs with 'ready' label
 * - CI/CD status monitoring
 * - Sequential merge execution
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1143
 */

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

// Import GitHub URL parser
import { parseGitHubUrl } from './github.lib.mjs';

// Default label configuration
export const READY_LABEL = {
  name: 'ready',
  description: 'Is ready to be merged',
  color: '0E8A16', // Green color
};

/**
 * Check if 'ready' label exists in repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{exists: boolean, label: Object|null}>}
 */
export async function checkReadyLabelExists(owner, repo, verbose = false) {
  try {
    const { stdout } = await exec(`gh api repos/${owner}/${repo}/labels/${READY_LABEL.name} 2>/dev/null || echo ""`);
    if (stdout.trim()) {
      const label = JSON.parse(stdout.trim());
      // Check if the response is an error (404 Not Found returns JSON with "message" field)
      if (label.message === 'Not Found' || label.status === '404') {
        if (verbose) {
          console.log(`[VERBOSE] /merge: 'ready' label does not exist in ${owner}/${repo}`);
        }
        return { exists: false, label: null };
      }
      // Valid label has a 'name' field
      if (label.name) {
        if (verbose) {
          console.log(`[VERBOSE] /merge: 'ready' label exists in ${owner}/${repo}`);
        }
        return { exists: true, label };
      }
      // Unknown response format, treat as not found
      if (verbose) {
        console.log(`[VERBOSE] /merge: Unexpected response format when checking label in ${owner}/${repo}`);
      }
      return { exists: false, label: null };
    }
    if (verbose) {
      console.log(`[VERBOSE] /merge: 'ready' label does not exist in ${owner}/${repo}`);
    }
    return { exists: false, label: null };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error checking label: ${error.message}`);
    }
    return { exists: false, label: null };
  }
}

/**
 * Create 'ready' label in repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{success: boolean, label: Object|null, error: string|null}>}
 */
export async function createReadyLabel(owner, repo, verbose = false) {
  try {
    // Use gh api with -f flags to pass fields directly (avoids shell heredoc compatibility issues)
    const { stdout } = await exec(`gh api repos/${owner}/${repo}/labels -X POST -H "Accept: application/vnd.github+json" -f name="${READY_LABEL.name}" -f description="${READY_LABEL.description}" -f color="${READY_LABEL.color}"`);
    const label = JSON.parse(stdout.trim());

    if (verbose) {
      console.log(`[VERBOSE] /merge: Created 'ready' label in ${owner}/${repo}`);
    }

    return { success: true, label, error: null };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Failed to create label: ${error.message}`);
    }
    return { success: false, label: null, error: error.message };
  }
}

/**
 * Check if we have admin/write permissions to manage labels
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{canManageLabels: boolean, permission: string|null}>}
 */
export async function checkLabelPermissions(owner, repo, verbose = false) {
  try {
    const { stdout } = await exec(`gh api repos/${owner}/${repo} --jq .permissions`);
    const permissions = JSON.parse(stdout.trim());

    const canManageLabels = permissions.admin === true || permissions.push === true || permissions.maintain === true;

    if (verbose) {
      console.log(`[VERBOSE] /merge: Repository permissions for ${owner}/${repo}: ${JSON.stringify(permissions)}`);
      console.log(`[VERBOSE] /merge: Can manage labels: ${canManageLabels}`);
    }

    return {
      canManageLabels,
      permission: permissions.admin ? 'admin' : permissions.maintain ? 'maintain' : permissions.push ? 'push' : 'read',
    };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error checking permissions: ${error.message}`);
    }
    return { canManageLabels: false, permission: null };
  }
}

/**
 * Ensure 'ready' label exists, creating it if we have permissions
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{success: boolean, created: boolean, error: string|null}>}
 */
export async function ensureReadyLabel(owner, repo, verbose = false) {
  // Check if label already exists
  const { exists } = await checkReadyLabelExists(owner, repo, verbose);
  if (exists) {
    return { success: true, created: false, error: null };
  }

  // Check permissions before trying to create
  const { canManageLabels } = await checkLabelPermissions(owner, repo, verbose);
  if (!canManageLabels) {
    return {
      success: false,
      created: false,
      error: `No permission to create labels in ${owner}/${repo}. Please ask a repository admin to create the 'ready' label.`,
    };
  }

  // Create the label
  const createResult = await createReadyLabel(owner, repo, verbose);
  if (createResult.success) {
    return { success: true, created: true, error: null };
  }

  return { success: false, created: false, error: createResult.error };
}

/**
 * Fetch all open PRs with 'ready' label
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Array<Object>>} Array of PR objects sorted by creation date
 */
export async function fetchReadyPullRequests(owner, repo, verbose = false) {
  try {
    const { stdout } = await exec(`gh pr list --repo ${owner}/${repo} --label "${READY_LABEL.name}" --state open --json number,title,url,createdAt,headRefName,author,mergeable,mergeStateStatus --limit 100`);

    const prs = JSON.parse(stdout.trim() || '[]');

    if (verbose) {
      console.log(`[VERBOSE] /merge: Found ${prs.length} open PRs with 'ready' label in ${owner}/${repo}`);
    }

    // Sort by creation date (oldest first)
    prs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    return prs;
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error fetching PRs: ${error.message}`);
    }
    return [];
  }
}

/**
 * Fetch all open issues with 'ready' label and find their linked PRs
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Array<Object>>} Array of {issue, pr} objects sorted by creation date
 */
export async function fetchReadyIssuesWithPRs(owner, repo, verbose = false) {
  try {
    // Fetch open issues with 'ready' label
    const { stdout: issuesJson } = await exec(`gh issue list --repo ${owner}/${repo} --label "${READY_LABEL.name}" --state open --json number,title,url,createdAt --limit 100`);

    const issues = JSON.parse(issuesJson.trim() || '[]');

    if (verbose) {
      console.log(`[VERBOSE] /merge: Found ${issues.length} open issues with 'ready' label in ${owner}/${repo}`);
    }

    // For each issue, find linked PRs using the closing keyword search
    const result = [];
    for (const issue of issues) {
      try {
        // Search for PRs that reference this issue with closing keywords
        const { stdout: searchJson } = await exec(`gh pr list --repo ${owner}/${repo} --search "in:body closes #${issue.number} OR fixes #${issue.number} OR resolves #${issue.number}" --state open --json number,title,url,createdAt,headRefName,author,mergeable,mergeStateStatus --limit 5`);

        const linkedPRs = JSON.parse(searchJson.trim() || '[]');

        if (linkedPRs.length > 0) {
          // Take the first linked PR (oldest if multiple)
          linkedPRs.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
          result.push({
            issue,
            pr: linkedPRs[0],
            // Use minimum of issue and PR creation dates for sorting
            sortDate: new Date(Math.min(new Date(issue.createdAt), new Date(linkedPRs[0].createdAt))),
          });

          if (verbose) {
            console.log(`[VERBOSE] /merge: Issue #${issue.number} linked to PR #${linkedPRs[0].number}`);
          }
        } else if (verbose) {
          console.log(`[VERBOSE] /merge: Issue #${issue.number} has no linked open PR`);
        }
      } catch (err) {
        if (verbose) {
          console.log(`[VERBOSE] /merge: Error finding linked PR for issue #${issue.number}: ${err.message}`);
        }
      }
    }

    // Sort by the minimum creation date
    result.sort((a, b) => a.sortDate - b.sortDate);

    return result;
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error fetching issues: ${error.message}`);
    }
    return [];
  }
}

/**
 * Get combined list of ready PRs (from both direct PR labels and issue labels)
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Array<Object>>} Array of PR objects with optional issue reference, sorted by creation date
 */
export async function getAllReadyPRs(owner, repo, verbose = false) {
  // Fetch both direct PRs and issue-linked PRs in parallel
  const [directPRs, issueLinkedPRs] = await Promise.all([fetchReadyPullRequests(owner, repo, verbose), fetchReadyIssuesWithPRs(owner, repo, verbose)]);

  // Build a map to deduplicate by PR number
  const prMap = new Map();

  // Add direct PRs
  for (const pr of directPRs) {
    prMap.set(pr.number, {
      pr,
      issue: null,
      sortDate: new Date(pr.createdAt),
    });
  }

  // Add issue-linked PRs (may override if PR is already in map)
  for (const { issue, pr, sortDate } of issueLinkedPRs) {
    const existing = prMap.get(pr.number);
    if (existing) {
      // If PR exists, use the minimum of both sort dates
      existing.issue = issue;
      existing.sortDate = new Date(Math.min(existing.sortDate, sortDate));
    } else {
      prMap.set(pr.number, { pr, issue, sortDate });
    }
  }

  // Convert to array and sort by sortDate
  const result = Array.from(prMap.values());
  result.sort((a, b) => a.sortDate - b.sortDate);

  if (verbose) {
    console.log(`[VERBOSE] /merge: Total unique ready PRs: ${result.length}`);
    for (const { pr, issue } of result) {
      const issueInfo = issue ? ` (linked to issue #${issue.number})` : '';
      console.log(`[VERBOSE] /merge:   PR #${pr.number}: ${pr.title}${issueInfo}`);
    }
  }

  return result;
}

/**
 * Check CI/CD status for a PR
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{status: string, checks: Array<Object>, allPassed: boolean, hasPending: boolean}>}
 */
export async function checkPRCIStatus(owner, repo, prNumber, verbose = false) {
  try {
    // Get the PR's head SHA
    const { stdout: prJson } = await exec(`gh pr view ${prNumber} --repo ${owner}/${repo} --json headRefOid`);
    const prData = JSON.parse(prJson.trim());
    const sha = prData.headRefOid;

    // Get check runs for this SHA
    const { stdout: checksJson } = await exec(`gh api repos/${owner}/${repo}/commits/${sha}/check-runs --paginate --jq '.check_runs'`);
    const checkRuns = JSON.parse(checksJson.trim() || '[]');

    // Get commit statuses (some CI systems use status API instead of checks API)
    const { stdout: statusJson } = await exec(`gh api repos/${owner}/${repo}/commits/${sha}/status --jq '.statuses'`);
    const statuses = JSON.parse(statusJson.trim() || '[]');

    // Combine both check runs and statuses
    const allChecks = [
      ...checkRuns.map(check => ({
        name: check.name,
        status: check.status,
        conclusion: check.conclusion,
        type: 'check_run',
      })),
      ...statuses.map(status => ({
        name: status.context,
        status: status.state === 'pending' ? 'in_progress' : 'completed',
        conclusion: status.state === 'pending' ? null : status.state === 'success' ? 'success' : status.state === 'failure' ? 'failure' : status.state,
        type: 'status',
      })),
    ];

    const hasPending = allChecks.some(c => c.status !== 'completed' || c.conclusion === null);
    const allPassed = !hasPending && allChecks.every(c => c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral');
    const hasFailed = allChecks.some(c => c.conclusion === 'failure' || c.conclusion === 'cancelled' || c.conclusion === 'timed_out');

    let status;
    if (hasPending) {
      status = 'pending';
    } else if (allPassed) {
      status = 'success';
    } else if (hasFailed) {
      status = 'failure';
    } else {
      status = 'unknown';
    }

    if (verbose) {
      console.log(`[VERBOSE] /merge: PR #${prNumber} CI status: ${status}`);
      console.log(`[VERBOSE] /merge:   Checks: ${allChecks.length}, Passed: ${allPassed}, Pending: ${hasPending}`);
      for (const check of allChecks) {
        console.log(`[VERBOSE] /merge:     - ${check.name}: ${check.status}/${check.conclusion}`);
      }
    }

    return {
      status,
      checks: allChecks,
      allPassed,
      hasPending,
    };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error checking CI status: ${error.message}`);
    }
    return {
      status: 'unknown',
      checks: [],
      allPassed: false,
      hasPending: false,
    };
  }
}

/**
 * Check if PR is mergeable
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{mergeable: boolean, reason: string|null}>}
 */
export async function checkPRMergeable(owner, repo, prNumber, verbose = false) {
  try {
    const { stdout } = await exec(`gh pr view ${prNumber} --repo ${owner}/${repo} --json mergeable,mergeStateStatus`);
    const pr = JSON.parse(stdout.trim());

    const mergeable = pr.mergeable === 'MERGEABLE';
    let reason = null;

    if (!mergeable) {
      switch (pr.mergeStateStatus) {
        case 'BLOCKED':
          reason = 'PR is blocked (possibly by branch protection rules)';
          break;
        case 'BEHIND':
          reason = 'PR branch is behind the base branch';
          break;
        case 'DIRTY':
          reason = 'PR has merge conflicts';
          break;
        case 'UNSTABLE':
          reason = 'PR has failing required status checks';
          break;
        case 'DRAFT':
          reason = 'PR is a draft';
          break;
        default:
          reason = `Merge state: ${pr.mergeStateStatus || 'unknown'}`;
      }
    }

    if (verbose) {
      console.log(`[VERBOSE] /merge: PR #${prNumber} mergeable: ${mergeable}, state: ${pr.mergeStateStatus}`);
    }

    return { mergeable, reason };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error checking mergeability: ${error.message}`);
    }
    return { mergeable: false, reason: error.message };
  }
}

/**
 * Check if the authenticated user has write/merge permissions on the repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{canMerge: boolean, permission: string|null}>}
 */
export async function checkMergePermissions(owner, repo, verbose = false) {
  try {
    const { stdout } = await exec(`gh api repos/${owner}/${repo} --jq '.permissions'`);
    const permissions = JSON.parse(stdout.trim());

    const canMerge = permissions.admin === true || permissions.maintain === true || permissions.push === true;

    if (verbose) {
      console.log(`[VERBOSE] /merge: Merge permissions for ${owner}/${repo}: push=${permissions.push}, admin=${permissions.admin}, maintain=${permissions.maintain}`);
      console.log(`[VERBOSE] /merge: Can merge: ${canMerge}`);
    }

    return {
      canMerge,
      permission: permissions.admin ? 'admin' : permissions.maintain ? 'maintain' : permissions.push ? 'push' : 'read',
    };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error checking merge permissions: ${error.message}`);
    }
    return { canMerge: false, permission: null };
  }
}

/**
 * Merge a pull request
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {Object} options - Merge options
 * @param {string} options.mergeMethod - Merge method: 'merge', 'squash', or 'rebase' (default: 'merge')
 *                                       Note: Must specify one method when running non-interactively.
 *                                       See Issue #1269 for details.
 * @param {boolean} options.squash - DEPRECATED: Use mergeMethod: 'squash' instead
 * @param {boolean} options.deleteAfter - Whether to delete branch after merge (default: false)
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
export async function mergePullRequest(owner, repo, prNumber, options = {}, verbose = false) {
  const { mergeMethod = 'merge', squash = false, deleteAfter = false } = options;

  try {
    let mergeArgs = `--repo ${owner}/${repo}`;

    // Issue #1269: gh pr merge requires --merge, --squash, or --rebase when running non-interactively
    // We must always specify a merge method to prevent the command from hanging or failing
    if (squash || mergeMethod === 'squash') {
      mergeArgs += ' --squash';
    } else if (mergeMethod === 'rebase') {
      mergeArgs += ' --rebase';
    } else {
      // Default to --merge for standard merge commits
      mergeArgs += ' --merge';
    }

    if (deleteAfter) {
      mergeArgs += ' --delete-branch';
    }

    const { stdout } = await exec(`gh pr merge ${prNumber} ${mergeArgs}`);

    if (verbose) {
      console.log(`[VERBOSE] /merge: Successfully merged PR #${prNumber}`);
      if (stdout) console.log(`[VERBOSE] /merge: stdout: ${stdout.trim()}`);
    }

    return { success: true, error: null };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Failed to merge PR #${prNumber}: ${error.message}`);
    }
    return { success: false, error: error.message };
  }
}

/**
 * Wait for CI/CD to complete with polling
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {Object} options - Wait options
 * @param {number} options.timeout - Maximum wait time in ms (default: 30 minutes)
 * @param {number} options.pollInterval - Polling interval in ms (default: 30 seconds)
 * @param {Function} options.onStatusUpdate - Callback for status updates
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{success: boolean, status: string, error: string|null}>}
 */
export async function waitForCI(owner, repo, prNumber, options = {}, verbose = false) {
  const {
    timeout = 30 * 60 * 1000,
    pollInterval = 30 * 1000,
    onStatusUpdate = null,
    // Issue #1269: Add timeout for callback to prevent infinite blocking
    callbackTimeout = 60 * 1000, // 1 minute max for callback
  } = options;

  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    let ciStatus;
    try {
      ciStatus = await checkPRCIStatus(owner, repo, prNumber, verbose);
    } catch (error) {
      // Issue #1269: Log and continue on CI check errors instead of crashing
      console.error(`[ERROR] /merge: Error checking CI status for PR #${prNumber}: ${error.message}`);
      verbose && console.error(`[VERBOSE] /merge: CI check error details:`, error);
      // Wait and retry
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      continue;
    }

    if (onStatusUpdate) {
      // Issue #1269: Wrap callback with timeout to prevent infinite blocking
      try {
        await Promise.race([onStatusUpdate(ciStatus), new Promise((_, reject) => setTimeout(() => reject(new Error(`Callback timeout after ${callbackTimeout}ms`)), callbackTimeout))]);
      } catch (callbackError) {
        // Issue #1269: Log callback errors but continue processing
        console.error(`[ERROR] /merge: Status update callback failed for PR #${prNumber}: ${callbackError.message}`);
        verbose && console.error(`[VERBOSE] /merge: Callback error details:`, callbackError);
        // Continue processing even if callback fails - don't let UI issues block merging
      }
    }

    if (ciStatus.status === 'success') {
      return { success: true, status: 'success', error: null };
    }

    if (ciStatus.status === 'failure') {
      return { success: false, status: 'failure', error: 'CI checks failed' };
    }

    if (ciStatus.status === 'pending') {
      if (verbose) {
        console.log(`[VERBOSE] /merge: Waiting for CI... (${Math.round((Date.now() - startTime) / 1000)}s elapsed)`);
      }
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      continue;
    }

    // Unknown status - wait and retry
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  return { success: false, status: 'timeout', error: 'CI check timeout exceeded' };
}

/**
 * Parse and validate a repository URL for the merge command
 * @param {string} url - Repository URL
 * @returns {{valid: boolean, owner: string|null, repo: string|null, error: string|null}}
 */
export function parseRepositoryUrl(url) {
  const parsed = parseGitHubUrl(url);

  if (!parsed.valid) {
    return { valid: false, owner: null, repo: null, error: parsed.error };
  }

  // Accept repo, issues_list, pulls_list, or organization URLs
  if (parsed.type === 'repo' || parsed.type === 'issues_list' || parsed.type === 'pulls_list') {
    return { valid: true, owner: parsed.owner, repo: parsed.repo, error: null };
  }

  if (parsed.type === 'user' || parsed.type === 'organization') {
    return {
      valid: false,
      owner: parsed.owner,
      repo: null,
      error: 'URL points to a user/organization. Please provide a specific repository URL.',
    };
  }

  return {
    valid: false,
    owner: parsed.owner,
    repo: parsed.repo,
    error: `URL type '${parsed.type}' is not supported for merge queue. Please provide a repository URL.`,
  };
}

export default {
  READY_LABEL,
  checkReadyLabelExists,
  createReadyLabel,
  checkLabelPermissions,
  ensureReadyLabel,
  fetchReadyPullRequests,
  fetchReadyIssuesWithPRs,
  getAllReadyPRs,
  checkPRCIStatus,
  checkPRMergeable,
  checkMergePermissions,
  mergePullRequest,
  waitForCI,
  parseRepositoryUrl,
};
