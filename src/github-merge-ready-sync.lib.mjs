#!/usr/bin/env node
/**
 * GitHub Merge Ready Tag Sync Library
 *
 * Provides utilities for syncing 'ready' tags between linked PRs and issues,
 * and for finding genuinely linked PRs via the GitHub issue timeline API.
 * Split from github-merge.lib.mjs to maintain file size limits.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1413
 */

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

import { extractLinkedIssueNumber } from './github-linking.lib.mjs';

// READY_LABEL is also exported from github-merge.lib.mjs (which re-exports it from here)
export const READY_LABEL = {
  name: 'ready',
  description: 'Is ready to be merged',
  color: '0E8A16', // Green color
};

/**
 * Add a label to a GitHub issue or pull request
 * @param {'issue'|'pr'} type - Whether to add to issue or PR
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} number - Issue or PR number
 * @param {string} labelName - Label name to add
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
async function addLabel(type, owner, repo, number, labelName, verbose = false) {
  const cmd = type === 'issue' ? 'issue' : 'pr';
  try {
    await exec(`gh ${cmd} edit ${number} --repo ${owner}/${repo} --add-label "${labelName}"`);
    if (verbose) console.log(`[VERBOSE] /merge: Added '${labelName}' label to ${type} #${number}`);
    return { success: true, error: null };
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] /merge: Failed to add label to ${type} #${number}: ${error.message}`);
    return { success: false, error: error.message };
  }
}

/**
 * Get open PRs that are genuinely linked to an issue via GitHub's issue timeline.
 *
 * Issue #1413: This replaces the previous full-text body search approach which
 * caused false positives. For example, a search for `fixes #1411` would incorrectly
 * match PR #843 because its body contained the string `1411→` as a source code line
 * number in a code snippet — not as an issue closing reference.
 *
 * The GitHub issue timeline API returns `cross-referenced` events for PRs that
 * explicitly close the issue using GitHub's reserved keywords (fixes/closes/resolves).
 * This is the same data GitHub uses to auto-close issues when PRs are merged, so
 * it reliably identifies genuine closing references.
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} issueNumber - Issue number to find linked PRs for
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Array<{number: number, title: string}>>} Array of open PRs that close this issue
 */
export async function getLinkedPRsFromTimeline(owner, repo, issueNumber, verbose = false) {
  try {
    const { stdout: timelineJson } = await exec(`gh api repos/${owner}/${repo}/issues/${issueNumber}/timeline --paginate`);
    const timeline = JSON.parse(timelineJson.trim() || '[]');

    // Extract cross-referenced events where the source is an open PR
    // (source.issue.pull_request != null means the source is a PR, not a plain issue)
    const linkedPRNumbers = new Set();
    const linkedPRs = [];

    for (const event of timeline) {
      if (event.event === 'cross-referenced' && event.source?.issue?.pull_request != null && event.source?.issue?.state === 'open') {
        const prNumber = event.source.issue.number;
        if (!linkedPRNumbers.has(prNumber)) {
          linkedPRNumbers.add(prNumber);
          linkedPRs.push({
            number: prNumber,
            title: event.source.issue.title || '',
          });
        }
      }
    }

    if (verbose) {
      console.log(`[VERBOSE] /merge: Issue #${issueNumber} has ${linkedPRs.length} genuinely linked open PR(s) via timeline`);
      for (const pr of linkedPRs) {
        console.log(`[VERBOSE] /merge:   PR #${pr.number}: ${pr.title}`);
      }
    }

    return linkedPRs;
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error fetching timeline for issue #${issueNumber}: ${error.message}`);
    }
    return [];
  }
}

/**
 * Sync 'ready' tags between linked pull requests and issues
 *
 * Issue #1367: Before building the merge queue, ensure that:
 * 1. If a PR has 'ready' label and is clearly linked to an issue (via standard GitHub
 *    keywords in the PR body/title), the issue also gets 'ready' label.
 * 2. If an issue has 'ready' label and has a clearly linked open PR, the PR also gets
 *    'ready' label.
 *
 * This ensures the final list of ready PRs reflects all ready work, regardless of
 * where the 'ready' label was originally applied.
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{synced: number, errors: number, details: Array<Object>}>}
 */
export async function syncReadyTags(owner, repo, verbose = false) {
  const synced = [];
  const errors = [];

  if (verbose) {
    console.log(`[VERBOSE] /merge: Syncing 'ready' tags for ${owner}/${repo}...`);
  }

  try {
    // Fetch open PRs with 'ready' label (including body for link detection)
    const { stdout: prsJson } = await exec(`gh pr list --repo ${owner}/${repo} --label "${READY_LABEL.name}" --state open --json number,title,body,labels --limit 100`);
    const readyPRs = JSON.parse(prsJson.trim() || '[]');

    if (verbose) {
      console.log(`[VERBOSE] /merge: Found ${readyPRs.length} open PRs with 'ready' label for tag sync`);
    }

    // Fetch open issues with 'ready' label
    const { stdout: issuesJson } = await exec(`gh issue list --repo ${owner}/${repo} --label "${READY_LABEL.name}" --state open --json number,title --limit 100`);
    const readyIssues = JSON.parse(issuesJson.trim() || '[]');

    if (verbose) {
      console.log(`[VERBOSE] /merge: Found ${readyIssues.length} open issues with 'ready' label for tag sync`);
    }

    // Build a set of issue numbers that already have 'ready'
    const readyIssueNumbers = new Set(readyIssues.map(i => String(i.number)));

    // Step 1: For each PR with 'ready', find linked issue and sync label to it
    for (const pr of readyPRs) {
      try {
        const prBody = pr.body || '';
        const linkedIssueNumber = extractLinkedIssueNumber(prBody);

        if (!linkedIssueNumber) {
          if (verbose) {
            console.log(`[VERBOSE] /merge: PR #${pr.number} has no linked issue (no closing keyword in body)`);
          }
          continue;
        }

        if (readyIssueNumbers.has(String(linkedIssueNumber))) {
          if (verbose) {
            console.log(`[VERBOSE] /merge: Issue #${linkedIssueNumber} already has 'ready' label (linked from PR #${pr.number})`);
          }
          continue;
        }

        // Issue doesn't have 'ready' label yet - add it
        if (verbose) {
          console.log(`[VERBOSE] /merge: PR #${pr.number} has 'ready', adding to linked issue #${linkedIssueNumber}`);
        }

        const result = await addLabel('issue', owner, repo, linkedIssueNumber, READY_LABEL.name, verbose);
        if (result.success) {
          synced.push({ type: 'pr-to-issue', prNumber: pr.number, issueNumber: Number(linkedIssueNumber) });
          // Mark this issue as now having 'ready' so we don't process it again
          readyIssueNumbers.add(String(linkedIssueNumber));
        } else {
          errors.push({ type: 'pr-to-issue', prNumber: pr.number, issueNumber: Number(linkedIssueNumber), error: result.error });
        }
      } catch (err) {
        if (verbose) {
          console.log(`[VERBOSE] /merge: Error syncing label from PR #${pr.number}: ${err.message}`);
        }
        errors.push({ type: 'pr-to-issue', prNumber: pr.number, error: err.message });
      }
    }

    // Build a set of PR numbers that already have 'ready'
    const readyPRNumbers = new Set(readyPRs.map(p => String(p.number)));

    // Step 2: For each issue with 'ready', find linked PRs and sync label to them
    for (const issue of readyIssues) {
      try {
        // Issue #1413: Use the GitHub issue timeline API to find PRs that genuinely
        // close this issue via closing keywords. This avoids false positives from
        // full-text search, which can match PRs that contain the issue number as a
        // source code line number (e.g. "1411→  await log(...)") rather than as a
        // real closing reference.
        const linkedPRs = await getLinkedPRsFromTimeline(owner, repo, issue.number, verbose);

        for (const linkedPR of linkedPRs) {
          if (readyPRNumbers.has(String(linkedPR.number))) {
            if (verbose) {
              console.log(`[VERBOSE] /merge: PR #${linkedPR.number} already has 'ready' label (linked from issue #${issue.number})`);
            }
            continue;
          }

          // PR doesn't have 'ready' label yet - add it
          if (verbose) {
            console.log(`[VERBOSE] /merge: Issue #${issue.number} has 'ready', adding to linked PR #${linkedPR.number}`);
          }

          const result = await addLabel('pr', owner, repo, linkedPR.number, READY_LABEL.name, verbose);
          if (result.success) {
            synced.push({ type: 'issue-to-pr', issueNumber: issue.number, prNumber: linkedPR.number });
            // Mark this PR as now having 'ready'
            readyPRNumbers.add(String(linkedPR.number));
          } else {
            errors.push({ type: 'issue-to-pr', issueNumber: issue.number, prNumber: linkedPR.number, error: result.error });
          }
        }
      } catch (err) {
        if (verbose) {
          console.log(`[VERBOSE] /merge: Error syncing label from issue #${issue.number}: ${err.message}`);
        }
        errors.push({ type: 'issue-to-pr', issueNumber: issue.number, error: err.message });
      }
    }
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error during tag sync: ${error.message}`);
    }
    errors.push({ type: 'fetch', error: error.message });
  }

  if (verbose) {
    console.log(`[VERBOSE] /merge: Tag sync complete. Synced: ${synced.length}, Errors: ${errors.length}`);
  }

  return {
    synced: synced.length,
    errors: errors.length,
    details: synced,
    errorDetails: errors,
  };
}
