#!/usr/bin/env node
/**
 * GitHub Merge Queue CI Signal Helpers
 *
 * Helpers for distinguishing genuine "CI not triggered" from race conditions in
 * the auto-merge loop. Split from github-merge.lib.mjs to keep that file under
 * the 1500-line CI limit (issue #1690 push).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1480
 * @see https://github.com/link-assistant/hive-mind/issues/1503
 * @see https://github.com/link-assistant/hive-mind/issues/1690
 */

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';
import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';

const execRaw = promisify(execCallback);
// Issue #1726: rate-limit safe gh wrapper.
const exec = (cmd, opts) =>
  ghWithRateLimitRetry(() => execRaw(cmd, opts), {
    label: `gh exec (${cmd.split(/\s+/).slice(0, 3).join(' ')})`,
  });

/**
 * Get the committed date of a specific commit from GitHub API
 * Issue #1480: Used to determine how recently a commit was pushed, to distinguish between
 * "CI not yet registered in API" (race condition) and "CI definitively not triggered"
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {string} sha - Commit SHA
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{date: Date|null, ageSeconds: number|null}>}
 */
export async function getCommitDate(owner, repo, sha, verbose = false) {
  try {
    const { stdout } = await exec(`gh api repos/${owner}/${repo}/commits/${sha} --jq '.commit.committer.date'`);
    const dateStr = stdout.trim();
    if (!dateStr) {
      return { date: null, ageSeconds: null };
    }
    const commitDate = new Date(dateStr);
    const ageSeconds = Math.floor((Date.now() - commitDate.getTime()) / 1000);
    if (verbose) {
      console.log(`[VERBOSE] /merge: Commit ${sha.substring(0, 7)} date: ${dateStr} (${ageSeconds}s ago)`);
    }
    return { date: commitDate, ageSeconds };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error fetching commit date for ${sha}: ${error.message}`);
    }
    return { date: null, ageSeconds: null };
  }
}

/**
 * Check if any previous commits in a PR had workflow runs triggered.
 * Issue #1480: If earlier commits in the same PR triggered CI, we should expect CI
 * for the HEAD commit too (unless conditions changed). This provides an additional
 * signal that CI should be expected and avoids false "CI not triggered" conclusions.
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {string} headSha - Current HEAD SHA (to exclude from check)
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{hadPreviousCI: boolean, previousCommitsWithCI: number, totalPreviousCommits: number}>}
 */
export async function checkPreviousPRCommitsHadCI(owner, repo, prNumber, headSha, verbose = false) {
  try {
    // Get all commits in the PR
    const { stdout: commitsJson } = await exec(`gh api "repos/${owner}/${repo}/pulls/${prNumber}/commits" --paginate --jq '[.[].sha]'`);
    const allShas = JSON.parse(commitsJson.trim() || '[]');

    // Exclude the current HEAD SHA
    const previousShas = allShas.filter(sha => sha !== headSha);

    if (previousShas.length === 0) {
      if (verbose) {
        console.log(`[VERBOSE] /merge: PR #${prNumber} has no previous commits to check for CI history`);
      }
      return { hadPreviousCI: false, previousCommitsWithCI: 0, totalPreviousCommits: 0 };
    }

    // Check the most recent previous commits (limit to last 3 to avoid excessive API calls)
    const commitsToCheck = previousShas.slice(-3);
    let commitsWithCI = 0;

    for (const sha of commitsToCheck) {
      try {
        const { stdout } = await exec(`gh api "repos/${owner}/${repo}/actions/runs?head_sha=${sha}&per_page=100" --paginate --slurp`);
        const count = JSON.parse(stdout.trim() || '[]').reduce((sum, page) => sum + (page.workflow_runs?.length || 0), 0);
        if (count > 0) {
          commitsWithCI++;
        }
      } catch {
        // Skip errors for individual commits
      }
    }

    const hadPreviousCI = commitsWithCI > 0;

    if (verbose) {
      console.log(`[VERBOSE] /merge: PR #${prNumber} previous CI history: ${commitsWithCI}/${commitsToCheck.length} checked commits had workflow runs (total PR commits: ${allShas.length})`);
    }

    return { hadPreviousCI, previousCommitsWithCI: commitsWithCI, totalPreviousCommits: previousShas.length };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error checking previous PR commits CI history: ${error.message}`);
    }
    return { hadPreviousCI: false, previousCommitsWithCI: 0, totalPreviousCommits: 0 };
  }
}

/**
 * Check if any workflow files in the repository have PR-related triggers
 * Issue #1480: Used as additional signal to determine if CI should run on PRs.
 * Parses .github/workflows/*.yml files from the repository content API.
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{hasPRTriggers: boolean, hasWorkflowFiles: boolean, workflows: Array<{name: string, triggers: string[]}>}>}
 */
export async function checkWorkflowsHavePRTriggers(owner, repo, verbose = false, ref = null) {
  try {
    // Issue #1503: Support querying workflow files from a specific branch (ref)
    const refParam = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    // List workflow files in .github/workflows/ (uses ref if provided, otherwise default branch)
    const { stdout: listJson } = await exec(`gh api "repos/${owner}/${repo}/contents/.github/workflows${refParam}" --paginate --jq '[.[] | select(.name | test("\\\\.(yml|yaml)$")) | {name: .name, download_url: .download_url, path: .path}]' 2>/dev/null`);
    const files = JSON.parse(listJson.trim() || '[]');

    if (files.length === 0) {
      if (verbose) console.log(`[VERBOSE] /merge: No workflow files in ${owner}/${repo}/.github/workflows/`);
      return { hasPRTriggers: false, hasWorkflowFiles: false, workflows: [] };
    }

    const prTriggerPatterns = [/\bon:\s*\n\s+pull_request/m, /\bon:\s*\[.*pull_request.*\]/m, /\bon:\s*pull_request\b/m, /\bpull_request_target\b/m];
    const pushTriggerPatterns = [/\bon:\s*\n\s+push/m, /\bon:\s*\[.*push.*\]/m, /\bon:\s*push\b/m];
    // Issue #1503: Non-PR triggers for diagnostics (won't produce check-runs on PRs)
    const nonPROnlyTriggerPatterns = [/\bworkflow_dispatch\b/m, /\bschedule\b/m, /\brepository_dispatch\b/m, /\bworkflow_call\b/m];

    const results = [];

    for (const file of files) {
      try {
        // Issue #1503: Fetch file content using same ref parameter for branch-specific workflows
        const { stdout: contentJson } = await exec(`gh api "repos/${owner}/${repo}/contents/${file.path}${refParam}" --jq '.content'`);
        const content = Buffer.from(contentJson.trim().replace(/"/g, ''), 'base64').toString('utf-8');

        const triggers = [];
        if (prTriggerPatterns.some(p => p.test(content))) {
          triggers.push('pull_request');
        }
        if (pushTriggerPatterns.some(p => p.test(content))) {
          triggers.push('push');
        }
        // Issue #1503: Track non-PR triggers for diagnostics
        const nonPRTriggers = nonPROnlyTriggerPatterns.filter(p => p.test(content)).map(p => p.source.replace(/\\b/g, ''));

        if (triggers.length > 0) {
          results.push({ name: file.name, triggers });
        }

        if (verbose) {
          console.log(`[VERBOSE] /merge: Workflow ${file.name}: pr_triggers=[${triggers.join(', ')}], non_pr_triggers=[${nonPRTriggers.join(', ')}]`);
        }
      } catch (fileError) {
        if (verbose) {
          console.log(`[VERBOSE] /merge: Error reading workflow file ${file.name}: ${fileError.message}`);
        }
      }
    }

    const hasPRTriggers = results.length > 0;

    if (verbose) {
      console.log(`[VERBOSE] /merge: ${results.length}/${files.length} workflow files have PR/push triggers`);
    }

    return { hasPRTriggers, hasWorkflowFiles: true, workflows: results };
  } catch (error) {
    if (verbose) {
      console.log(`[VERBOSE] /merge: Error checking workflow PR triggers: ${error.message}`);
    }
    // On error, assume workflows might have PR triggers (safer: avoids false positives)
    return { hasPRTriggers: true, hasWorkflowFiles: true, workflows: [] };
  }
}
