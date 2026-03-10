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

// Issue #1413: Import ready tag sync, timeline, and label constant from separate module
// to keep this file under the 1500 line limit
import { syncReadyTags, getLinkedPRsFromTimeline, READY_LABEL } from './github-merge-ready-sync.lib.mjs';
export { syncReadyTags, getLinkedPRsFromTimeline, READY_LABEL };

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

    // Issue #1304: If no checks exist yet, treat as pending
    // This handles the race condition where CI hasn't started yet after a commit is pushed.
    // An empty array would otherwise pass all checks due to JavaScript's vacuous truth
    // ([].every(fn) returns true for any fn).
    if (allChecks.length === 0) {
      if (verbose) {
        console.log(`[VERBOSE] /merge: PR #${prNumber} has no CI checks yet - treating as pending`);
      }
      return {
        status: 'pending',
        checks: [],
        allPassed: false,
        hasPending: true,
      };
    }

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
 *
 * Issue #1339: GitHub computes mergeability asynchronously. The first request may return
 * mergeable: null and mergeStateStatus: 'UNKNOWN' while the computation is in progress.
 * We retry up to 3 times with a 5-second delay between attempts to handle this case.
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{mergeable: boolean, reason: string|null}>}
 */
export async function checkPRMergeable(owner, repo, prNumber, verbose = false) {
  // Issue #1339: GitHub computes mergeability asynchronously. When mergeStateStatus is
  // 'UNKNOWN', it means GitHub hasn't calculated the merge state yet. Retry a few times.
  const MAX_UNKNOWN_RETRIES = 3;
  const UNKNOWN_RETRY_DELAY_MS = 5000;

  for (let attempt = 0; attempt < MAX_UNKNOWN_RETRIES; attempt++) {
    try {
      const { stdout } = await exec(`gh pr view ${prNumber} --repo ${owner}/${repo} --json mergeable,mergeStateStatus`);
      const pr = JSON.parse(stdout.trim());

      // Issue #1339: If mergeStateStatus is 'UNKNOWN', GitHub is still computing.
      // Wait and retry instead of immediately skipping the PR.
      if (pr.mergeStateStatus === 'UNKNOWN' || pr.mergeable === null) {
        if (attempt < MAX_UNKNOWN_RETRIES - 1) {
          if (verbose) {
            console.log(`[VERBOSE] /merge: PR #${prNumber} mergeability is UNKNOWN (attempt ${attempt + 1}/${MAX_UNKNOWN_RETRIES}), retrying in ${UNKNOWN_RETRY_DELAY_MS / 1000}s...`);
          }
          await new Promise(resolve => setTimeout(resolve, UNKNOWN_RETRY_DELAY_MS));
          continue;
        }
        // All retries exhausted, still UNKNOWN - treat as not mergeable
        if (verbose) {
          console.log(`[VERBOSE] /merge: PR #${prNumber} mergeability still UNKNOWN after ${MAX_UNKNOWN_RETRIES} attempts`);
        }
        return { mergeable: false, reason: `Merge state: UNKNOWN (GitHub could not compute mergeability after ${MAX_UNKNOWN_RETRIES} attempts)` };
      }

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

  // Should not reach here, but return safe default
  return { mergeable: false, reason: 'Merge state: UNKNOWN' };
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

/**
 * Get active workflow runs on a specific branch
 * Issue #1307: Used to check if there are any in-progress or queued runs on the target branch
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branch - Branch name (default: main)
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{runs: Array<Object>, hasActiveRuns: boolean, count: number}>}
 */
export async function getActiveBranchRuns(owner, repo, branch = 'main', verbose = false) {
  try {
    // Query for in_progress and queued runs on the specified branch
    const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?branch=${branch}&per_page=10" --jq '[.workflow_runs[] | select(.status=="in_progress" or .status=="queued")] | map({id: .id, name: .name, status: .status, created_at: .created_at, html_url: .html_url})'`);

    const runs = JSON.parse(stdout.trim() || '[]');

    if (verbose) {
      console.log(`[VERBOSE] /merge: Found ${runs.length} active runs on ${owner}/${repo} branch ${branch}`);
      for (const run of runs) {
        console.log(`[VERBOSE] /merge:   - Run #${run.id}: ${run.name} (${run.status})`);
      }
    }

    return {
      runs,
      hasActiveRuns: runs.length > 0,
      count: runs.length,
    };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error checking active runs on ${branch}: ${error.message}`);
    }
    return {
      runs: [],
      hasActiveRuns: false,
      count: 0,
    };
  }
}

/**
 * Wait for all active workflow runs on a branch to complete
 * Issue #1307: Ensures all CI runs on target branch are complete before merging
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} branch - Branch name (default: main)
 * @param {Object} options - Wait options
 * @param {number} options.timeout - Maximum wait time in ms (default: 45 minutes)
 * @param {number} options.pollInterval - Polling interval in ms (default: 30 seconds)
 * @param {Function} options.onStatusUpdate - Callback for status updates
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{success: boolean, waitedForRuns: boolean, completedRuns: number, error: string|null}>}
 */
export async function waitForBranchCI(owner, repo, branch = 'main', options = {}, verbose = false) {
  const { timeout = 45 * 60 * 1000, pollInterval = 30 * 1000, onStatusUpdate = null } = options;

  const startTime = Date.now();
  let totalWaitedRuns = 0;

  if (verbose) {
    console.log(`[VERBOSE] /merge: Checking for active CI runs on ${owner}/${repo} branch ${branch}...`);
  }

  while (Date.now() - startTime < timeout) {
    let activeRuns;
    try {
      activeRuns = await getActiveBranchRuns(owner, repo, branch, verbose);
    } catch (error) {
      // Log and continue on errors
      console.error(`[ERROR] /merge: Error checking branch CI: ${error.message}`);
      await new Promise(resolve => setTimeout(resolve, pollInterval));
      continue;
    }

    if (onStatusUpdate) {
      try {
        await onStatusUpdate({
          hasActiveRuns: activeRuns.hasActiveRuns,
          count: activeRuns.count,
          runs: activeRuns.runs,
          elapsedMs: Date.now() - startTime,
        });
      } catch (callbackError) {
        // Log callback errors but continue
        console.error(`[ERROR] /merge: Status update callback failed: ${callbackError.message}`);
      }
    }

    if (!activeRuns.hasActiveRuns) {
      if (verbose) {
        console.log(`[VERBOSE] /merge: No active CI runs on ${branch} branch. Ready to proceed.`);
      }
      return {
        success: true,
        waitedForRuns: totalWaitedRuns > 0,
        completedRuns: totalWaitedRuns,
        error: null,
      };
    }

    totalWaitedRuns = Math.max(totalWaitedRuns, activeRuns.count);

    if (verbose) {
      const elapsedSec = Math.round((Date.now() - startTime) / 1000);
      console.log(`[VERBOSE] /merge: Waiting for ${activeRuns.count} active runs on ${branch}... (${elapsedSec}s elapsed)`);
    }

    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  // Timeout reached
  const finalCheck = await getActiveBranchRuns(owner, repo, branch, verbose);
  if (finalCheck.hasActiveRuns) {
    return {
      success: false,
      waitedForRuns: true,
      completedRuns: totalWaitedRuns - finalCheck.count,
      error: `Timeout waiting for ${finalCheck.count} CI runs on ${branch} branch`,
    };
  }

  return {
    success: true,
    waitedForRuns: totalWaitedRuns > 0,
    completedRuns: totalWaitedRuns,
    error: null,
  };
}

/**
 * Get the default branch for a repository
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<string>} Default branch name (e.g., 'main' or 'master')
 */
export async function getDefaultBranch(owner, repo, verbose = false) {
  try {
    const { stdout } = await exec(`gh api repos/${owner}/${repo} --jq '.default_branch'`);
    const branch = stdout.trim();

    if (verbose) {
      console.log(`[VERBOSE] /merge: Default branch for ${owner}/${repo}: ${branch}`);
    }

    return branch || 'main';
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error getting default branch, falling back to 'main': ${error.message}`);
    }
    return 'main';
  }
}

/**
 * Get annotations for a check run
 * Issue #1314: Used to detect billing limit errors
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} checkRunId - Check run ID
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Array<Object>>} Array of annotation objects
 */
export async function getCheckRunAnnotations(owner, repo, checkRunId, verbose = false) {
  try {
    const { stdout } = await exec(`gh api repos/${owner}/${repo}/check-runs/${checkRunId}/annotations 2>/dev/null || echo "[]"`);
    const annotations = JSON.parse(stdout.trim() || '[]');

    if (verbose) {
      console.log(`[VERBOSE] /merge: Check run ${checkRunId} has ${annotations.length} annotations`);
    }

    return annotations;
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error fetching annotations for check run ${checkRunId}: ${error.message}`);
    }
    return [];
  }
}

/**
 * Check if repository is private
 * Issue #1314: Used to determine behavior when billing limits are reached
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{isPrivate: boolean, visibility: string|null}>}
 */
export async function getRepoVisibility(owner, repo, verbose = false) {
  try {
    const { stdout } = await exec(`gh api repos/${owner}/${repo} --jq '{isPrivate: .private, visibility: .visibility}'`);
    const info = JSON.parse(stdout.trim());

    if (verbose) {
      console.log(`[VERBOSE] /merge: Repository ${owner}/${repo} visibility: ${info.visibility}, private: ${info.isPrivate}`);
    }

    return {
      isPrivate: info.isPrivate === true,
      visibility: info.visibility || null,
    };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error checking repository visibility: ${error.message}`);
    }
    // Assume private if we can't determine (safer default)
    return { isPrivate: true, visibility: null };
  }
}

/**
 * Known billing limit error message pattern
 * Issue #1314: This is the exact message GitHub uses for billing/spending limit errors
 */
export const BILLING_LIMIT_ERROR_PATTERN = 'The job was not started because recent account payments have failed or your spending limit needs to be increased';

/**
 * Check if CI failure is due to billing/spending limits
 * Issue #1314: Detects when GitHub Actions jobs fail due to billing issues rather than code problems
 *
 * Detection criteria:
 * 1. Job has conclusion='failure'
 * 2. Job has empty steps array (no steps were executed)
 * 3. Job has runner_id=0 or null (no runner was assigned)
 * 4. Annotation contains the billing limit error message
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{isBillingLimitError: boolean, message: string|null, affectedJobs: string[], allJobsAffected: boolean}>}
 */
export async function checkForBillingLimitError(owner, repo, prNumber, verbose = false) {
  try {
    // Get the PR's head SHA
    const { stdout: prJson } = await exec(`gh pr view ${prNumber} --repo ${owner}/${repo} --json headRefOid`);
    const prData = JSON.parse(prJson.trim());
    const sha = prData.headRefOid;

    // Get workflow runs for this SHA
    const { stdout: runsJson } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?head_sha=${sha}&per_page=10" --jq '.workflow_runs[].id'`);
    const runIds = runsJson.trim().split('\n').filter(Boolean);

    if (verbose) {
      console.log(`[VERBOSE] /merge: Found ${runIds.length} workflow runs for PR #${prNumber} at SHA ${sha.substring(0, 7)}`);
    }

    const affectedJobs = [];
    let totalJobs = 0;

    // Check each workflow run's jobs
    for (const runId of runIds) {
      try {
        const { stdout: jobsJson } = await exec(`gh api repos/${owner}/${repo}/actions/runs/${runId}/jobs --jq '.jobs'`);
        const jobs = JSON.parse(jobsJson.trim() || '[]');

        for (const job of jobs) {
          totalJobs++;

          // Check for billing limit indicators:
          // 1. Conclusion is failure
          // 2. Steps array is empty (no steps were executed)
          // 3. Runner ID is 0 or null (no runner was assigned)
          const hasNoSteps = !job.steps || job.steps.length === 0;
          const hasNoRunner = job.runner_id === 0 || job.runner_id === null;

          if (job.conclusion === 'failure' && hasNoSteps && hasNoRunner) {
            // Fetch annotations to confirm billing limit error
            const annotations = await getCheckRunAnnotations(owner, repo, job.id, verbose);

            const billingAnnotation = annotations.find(a => a.message?.includes(BILLING_LIMIT_ERROR_PATTERN));

            if (billingAnnotation) {
              affectedJobs.push(job.name);

              if (verbose) {
                console.log(`[VERBOSE] /merge: Job "${job.name}" (ID: ${job.id}) failed due to billing limits`);
              }
            }
          }
        }
      } catch (error) {
        if (verbose) {
          console.log(`[VERBOSE] /merge: Error checking jobs for run ${runId}: ${error.message}`);
        }
      }
    }

    const isBillingLimitError = affectedJobs.length > 0;
    const allJobsAffected = totalJobs > 0 && affectedJobs.length === totalJobs;

    if (verbose && isBillingLimitError) {
      console.log(`[VERBOSE] /merge: Billing limit detected - ${affectedJobs.length}/${totalJobs} jobs affected`);
    }

    return {
      isBillingLimitError,
      message: isBillingLimitError ? BILLING_LIMIT_ERROR_PATTERN : null,
      affectedJobs,
      allJobsAffected,
    };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error checking for billing limit: ${error.message}`);
    }
    return {
      isBillingLimitError: false,
      message: null,
      affectedJobs: [],
      allJobsAffected: false,
    };
  }
}

/**
 * Re-run all jobs in a workflow run
 * Issue #1314: Used to re-trigger CI jobs that were cancelled or not started
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} runId - Workflow run ID
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
export async function rerunWorkflowRun(owner, repo, runId, verbose = false) {
  try {
    await exec(`gh api repos/${owner}/${repo}/actions/runs/${runId}/rerun -X POST`);
    // GitHub returns 201 on success
    if (verbose) {
      console.log(`[VERBOSE] /merge: Successfully triggered re-run for workflow ${runId}`);
    }
    return { success: true, error: null };
  } catch (error) {
    // exec throws when command exits non-zero (e.g., 404 Not Found)
    const errorMessage = error.stderr?.trim() || error.stdout?.trim() || error.message;
    if (verbose) {
      console.log(`[VERBOSE] /merge: Failed to re-run workflow ${runId}: ${errorMessage}`);
    }
    return { success: false, error: errorMessage };
  }
}

/**
 * Re-run only failed jobs in a workflow run
 * Issue #1314: More targeted than full re-run, only retries failed jobs
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} runId - Workflow run ID
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
export async function rerunFailedJobs(owner, repo, runId, verbose = false) {
  try {
    await exec(`gh api repos/${owner}/${repo}/actions/runs/${runId}/rerun-failed-jobs -X POST`);
    // GitHub returns 201 on success
    if (verbose) {
      console.log(`[VERBOSE] /merge: Successfully triggered re-run of failed jobs for workflow ${runId}`);
    }
    return { success: true, error: null };
  } catch (error) {
    const errorMessage = error.stderr?.trim() || error.stdout?.trim() || error.message;
    if (verbose) {
      console.log(`[VERBOSE] /merge: Failed to re-run failed jobs for workflow ${runId}: ${errorMessage}`);
    }
    return { success: false, error: errorMessage };
  }
}

/**
 * Get detailed CI status for a PR, distinguishing between different non-success states
 * Issue #1314: Enhanced version that separates cancelled, queued, and billing-limited states
 *
 * Possible returned statuses:
 * - 'success': All checks passed
 * - 'failure': Some checks failed (genuine code failures, timed_out, or action_required)
 * - 'cancelled': Some checks were cancelled or stale (need re-triggering)
 * - 'pending': Some checks are still running, queued, waiting, or requested
 * - 'billing_limit': Failures are due to billing/spending limits (determined by caller)
 * - 'no_checks': No CI checks found yet (race condition after push)
 * - 'unknown': Unable to determine status
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Object>} Detailed CI status object
 */
export async function getDetailedCIStatus(owner, repo, prNumber, verbose = false) {
  try {
    // Get the PR's head SHA
    const { stdout: prJson } = await exec(`gh pr view ${prNumber} --repo ${owner}/${repo} --json headRefOid`);
    const prData = JSON.parse(prJson.trim());
    const sha = prData.headRefOid;

    // Get check runs for this SHA
    const { stdout: checksJson } = await exec(`gh api repos/${owner}/${repo}/commits/${sha}/check-runs --paginate --jq '.check_runs'`);
    const checkRuns = JSON.parse(checksJson.trim() || '[]');

    // Get commit statuses
    const { stdout: statusJson } = await exec(`gh api repos/${owner}/${repo}/commits/${sha}/status --jq '.statuses'`);
    const statuses = JSON.parse(statusJson.trim() || '[]');

    // Build detailed checks list
    const allChecks = [
      ...checkRuns.map(check => ({
        name: check.name,
        status: check.status, // queued, in_progress, completed
        conclusion: check.conclusion, // success, failure, cancelled, timed_out, skipped, neutral, action_required, stale, null
        type: 'check_run',
        id: check.id,
      })),
      ...statuses.map(status => ({
        name: status.context,
        status: status.state === 'pending' ? 'in_progress' : 'completed',
        conclusion: status.state === 'pending' ? null : status.state === 'success' ? 'success' : status.state === 'failure' ? 'failure' : status.state,
        type: 'status',
        id: null,
      })),
    ];

    // No checks yet
    if (allChecks.length === 0) {
      if (verbose) {
        console.log(`[VERBOSE] /merge: PR #${prNumber} has no CI checks yet - treating as no_checks`);
      }
      return {
        status: 'no_checks',
        checks: [],
        sha,
        hasFailures: false,
        hasCancelled: false,
        hasStale: false,
        hasPending: false,
        hasQueued: false,
        allPassed: false,
        failedChecks: [],
        cancelledChecks: [],
        staleChecks: [],
        pendingChecks: [],
        queuedChecks: [],
        passedChecks: [],
      };
    }

    // Categorize checks
    // Note: GitHub check run conclusions include: success, failure, cancelled, timed_out, skipped,
    // neutral, action_required, stale, null (not yet completed)
    // GitHub check run statuses include: queued, in_progress, completed, waiting, requested, pending
    const passedChecks = allChecks.filter(c => c.conclusion === 'success' || c.conclusion === 'skipped' || c.conclusion === 'neutral');
    const failedChecks = allChecks.filter(c => c.conclusion === 'failure' || c.conclusion === 'timed_out' || c.conclusion === 'action_required');
    const cancelledChecks = allChecks.filter(c => c.conclusion === 'cancelled');
    const staleChecks = allChecks.filter(c => c.conclusion === 'stale');
    const pendingChecks = allChecks.filter(c => (c.status === 'in_progress' || c.status === 'waiting' || c.status === 'requested' || c.status === 'pending') && c.conclusion === null);
    const queuedChecks = allChecks.filter(c => c.status === 'queued' && c.conclusion === null);

    const hasFailures = failedChecks.length > 0;
    const hasCancelled = cancelledChecks.length > 0;
    const hasStale = staleChecks.length > 0;
    const hasPending = pendingChecks.length > 0;
    const hasQueued = queuedChecks.length > 0;
    const allPassed = !hasFailures && !hasCancelled && !hasStale && !hasPending && !hasQueued && passedChecks.length === allChecks.length;

    // Determine overall status
    let status;
    if (allPassed) {
      status = 'success';
    } else if (hasPending || hasQueued) {
      // Some checks are still running, queued, or waiting for a runner - wait for completion
      status = 'pending';
    } else if (hasStale && !hasFailures && !hasCancelled) {
      // Stale checks need to be re-triggered (similar to cancelled)
      status = 'cancelled';
    } else if (hasFailures && !hasCancelled && !hasStale) {
      status = 'failure';
    } else if ((hasCancelled || hasStale) && !hasFailures) {
      status = 'cancelled';
    } else if (hasFailures && (hasCancelled || hasStale)) {
      // Mixed: some failed, some cancelled/stale - report as failure (the failures need attention)
      status = 'failure';
    } else {
      status = 'unknown';
    }

    if (verbose) {
      console.log(`[VERBOSE] /merge: PR #${prNumber} detailed CI status: ${status}`);
      console.log(`[VERBOSE] /merge:   Total: ${allChecks.length}, Passed: ${passedChecks.length}, Failed: ${failedChecks.length}, Cancelled: ${cancelledChecks.length}, Stale: ${staleChecks.length}, Pending: ${pendingChecks.length}, Queued: ${queuedChecks.length}`);
    }

    return {
      status,
      checks: allChecks,
      sha,
      hasFailures,
      hasCancelled,
      hasStale,
      hasPending,
      hasQueued,
      allPassed,
      failedChecks,
      cancelledChecks,
      staleChecks,
      pendingChecks,
      queuedChecks,
      passedChecks,
    };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error getting detailed CI status: ${error.message}`);
    }
    return {
      status: 'unknown',
      checks: [],
      sha: null,
      hasFailures: false,
      hasCancelled: false,
      hasStale: false,
      hasPending: false,
      hasQueued: false,
      allPassed: false,
      failedChecks: [],
      cancelledChecks: [],
      staleChecks: [],
      pendingChecks: [],
      queuedChecks: [],
      passedChecks: [],
    };
  }
}

/**
 * Get workflow run IDs for a specific commit SHA
 * Issue #1314: Helper to find workflow runs to re-trigger
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} sha - Commit SHA
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Array<{id: number, status: string, conclusion: string|null, name: string, html_url: string}>>}
 */
export async function getWorkflowRunsForSha(owner, repo, sha, verbose = false) {
  try {
    const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?head_sha=${sha}&per_page=20" --jq '[.workflow_runs[] | {id: .id, status: .status, conclusion: .conclusion, name: .name, html_url: .html_url}]'`);
    const runs = JSON.parse(stdout.trim() || '[]');

    if (verbose) {
      console.log(`[VERBOSE] /merge: Found ${runs.length} workflow runs for SHA ${sha.substring(0, 7)}`);
      for (const run of runs) {
        console.log(`[VERBOSE] /merge:   - ${run.name} (${run.id}): status=${run.status}, conclusion=${run.conclusion}`);
      }
    }

    return runs;
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error fetching workflow runs for SHA ${sha}: ${error.message}`);
    }
    return [];
  }
}

/**
 * Get the count of active (enabled) GitHub Actions workflows in a repository
 * Issue #1363: Used to distinguish between "no CI configured" and "CI hasn't started yet"
 *
 * When a repo has NO workflows, no_checks means no CI configured.
 * When a repo HAS workflows, no_checks means CI checks haven't started yet (race condition).
 *
 * Issue #1399: GitHub Pages deployment workflows (path: "dynamic/pages/...") are excluded
 * because they only run on the default branch after merge, never on PR branches. Counting
 * them as "CI workflows" causes an infinite loop waiting for check-runs that never appear.
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{count: number, hasWorkflows: boolean, workflows: Array<{id: number, name: string, state: string, path: string}>}>}
 */
export async function getActiveRepoWorkflows(owner, repo, verbose = false) {
  try {
    const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/workflows" --jq '[.workflows[] | select(.state == "active")] | map({id: .id, name: .name, state: .state, path: .path})'`);
    const allWorkflows = JSON.parse(stdout.trim() || '[]');

    // Issue #1399: Filter out GitHub Pages deployment workflows.
    // These have path "dynamic/pages/pages-build-deployment" and only run on the
    // default branch after merge — they never produce check-runs on PR branches.
    // Including them causes an infinite loop when waiting for PR CI checks.
    const workflows = allWorkflows.filter(wf => !wf.path.startsWith('dynamic/pages/'));

    if (verbose) {
      console.log(`[VERBOSE] /merge: Found ${allWorkflows.length} active workflows in ${owner}/${repo} (${workflows.length} PR-relevant after filtering out GitHub Pages deployment workflows)`);
      for (const wf of allWorkflows) {
        const filtered = wf.path.startsWith('dynamic/pages/');
        console.log(`[VERBOSE] /merge:   - ${wf.name} (${wf.id}): ${wf.state}, path=${wf.path}${filtered ? ' [excluded: GitHub Pages deployment]' : ''}`);
      }
    }

    return {
      count: workflows.length,
      hasWorkflows: workflows.length > 0,
      workflows,
    };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error fetching workflows for ${owner}/${repo}: ${error.message}`);
    }
    // On error, assume no workflows (safer: avoids false positives in the no-CI case)
    return {
      count: 0,
      hasWorkflows: false,
      workflows: [],
    };
  }
}

// Issue #1341: Import and re-export post-merge CI functions from separate module
// to keep this file under the 1500 line limit
import { waitForCommitCI, checkBranchCIHealth, getMergeCommitSha } from './github-merge-ci.lib.mjs';
export { waitForCommitCI, checkBranchCIHealth, getMergeCommitSha };

export default {
  READY_LABEL,
  checkReadyLabelExists,
  createReadyLabel,
  checkLabelPermissions,
  ensureReadyLabel,
  fetchReadyPullRequests,
  fetchReadyIssuesWithPRs,
  getAllReadyPRs,
  // Issue #1367: Sync 'ready' tags between linked PRs and issues
  syncReadyTags,
  checkPRCIStatus,
  checkPRMergeable,
  checkMergePermissions,
  mergePullRequest,
  waitForCI,
  parseRepositoryUrl,
  // Issue #1307: New exports for target branch CI waiting
  getActiveBranchRuns,
  waitForBranchCI,
  getDefaultBranch,
  // Issue #1314: Billing limit detection
  getCheckRunAnnotations,
  getRepoVisibility,
  checkForBillingLimitError,
  BILLING_LIMIT_ERROR_PATTERN,
  // Issue #1314: Enhanced CI status and re-run capabilities
  getDetailedCIStatus,
  rerunWorkflowRun,
  rerunFailedJobs,
  getWorkflowRunsForSha,
  // Issue #1341: Post-merge CI waiting and branch health checking
  waitForCommitCI,
  checkBranchCIHealth,
  getMergeCommitSha,
  // Issue #1363: Detect active workflows to distinguish "no CI" from race condition
  getActiveRepoWorkflows,
  // Issue #1413: Use issue timeline to find genuinely linked PRs (avoids false positives from text search)
  getLinkedPRsFromTimeline,
};
