#!/usr/bin/env node
/**
 * GitHub Merge — Linked Issue Close Helper
 *
 * Issue #1895: After merging a PR, GitHub only auto-closes the linked issue when
 * the PR targeted the repository's default branch. For PRs merged into a
 * non-default branch (e.g. a stacked / sub-issue branch), the linked issue stays
 * open even though the PR body contains a valid `Fixes #N` keyword. This helper
 * closes the linked issue explicitly in that case.
 *
 * Extracted from github-merge.lib.mjs to keep that file under the 1500-line
 * limit (same rationale as the Issue #1413 ready-sync split).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1895
 */

import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

import { githubLimits } from './config.lib.mjs';
import { ghWithRateLimitRetry } from './github-rate-limit.lib.mjs';
import { extractLinkedIssueNumber } from './github-linking.lib.mjs';
import { classifyIssueLinkStatus } from './github-issue-auto-close.lib.mjs';
import { getDefaultBranch } from './github-merge.lib.mjs';

const execRaw = promisify(execCallback);

// Issue #1726: keep every gh call rate-limit safe (mirrors github-merge.lib.mjs).
const exec = (cmd, opts = {}) =>
  ghWithRateLimitRetry(() => execRaw(cmd, { maxBuffer: githubLimits.bufferMaxSize, ...opts }), {
    label: `gh exec (${cmd.split(/\s+/).slice(0, 3).join(' ')})`,
  });

/**
 * After merging a PR, explicitly close the linked issue when GitHub will not
 * auto-close it (i.e. the PR targeted a non-default branch).
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Merged pull request number
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{closed: boolean, skipped: boolean, reason: string, issueNumber?: number}>}
 */
export async function closeLinkedIssueIfNotAutoClosed(owner, repo, prNumber, verbose = false) {
  try {
    const { stdout: prJson } = await exec(`gh pr view ${prNumber} --repo ${owner}/${repo} --json baseRefName,body,title`);
    const pr = JSON.parse(prJson.trim() || '{}');
    const baseBranch = pr.baseRefName || null;
    const prBody = pr.body || '';
    const prTitle = pr.title || '';

    const issueNumber = extractLinkedIssueNumber(prBody) || extractLinkedIssueNumber(prTitle);
    if (!issueNumber) {
      if (verbose) console.log(`[VERBOSE] /merge: PR #${prNumber} has no closing keyword; no issue to close`);
      return { closed: false, skipped: true, reason: 'no-linked-issue' };
    }

    const defaultBranch = await getDefaultBranch(owner, repo, verbose);
    const status = classifyIssueLinkStatus({ prBody, prTitle, issueNumber, owner, repo, baseBranch, defaultBranch });

    if (status.autoCloses !== false) {
      // GitHub handles it (default branch) or branch info is unknown.
      if (verbose) console.log(`[VERBOSE] /merge: Issue #${issueNumber} will be handled by GitHub (base '${baseBranch}', default '${defaultBranch}')`);
      return { closed: false, skipped: true, reason: status.autoCloses === true ? 'github-auto-closes' : 'unknown-branch', issueNumber: Number(issueNumber) };
    }

    // Skip if already closed.
    try {
      const { stdout: issueJson } = await exec(`gh issue view ${issueNumber} --repo ${owner}/${repo} --json state`);
      const issue = JSON.parse(issueJson.trim() || '{}');
      if (String(issue.state).toUpperCase() === 'CLOSED') {
        if (verbose) console.log(`[VERBOSE] /merge: Issue #${issueNumber} already closed`);
        return { closed: false, skipped: true, reason: 'already-closed', issueNumber: Number(issueNumber) };
      }
    } catch {
      // If state lookup fails, fall through and attempt the close.
    }

    const comment = `Closed by #${prNumber}, which targeted the non-default branch \`${baseBranch}\` (repository default: \`${defaultBranch}\`).\n\nGitHub only auto-closes linked issues for pull requests merged into the default branch, so hive-mind closed this issue explicitly after the merge.\n\n_Automated by hive-mind ([#1895](https://github.com/link-assistant/hive-mind/issues/1895))._`;
    await exec(`gh issue close ${issueNumber} --repo ${owner}/${repo} --reason completed --comment ${JSON.stringify(comment)}`);
    if (verbose) console.log(`[VERBOSE] /merge: Closed issue #${issueNumber} explicitly (PR #${prNumber} merged into non-default branch '${baseBranch}')`);
    return { closed: true, skipped: false, reason: 'closed-explicitly', issueNumber: Number(issueNumber) };
  } catch (error) {
    if (verbose) console.log(`[VERBOSE] /merge: Error closing linked issue for PR #${prNumber}: ${error.message}`);
    return { closed: false, skipped: false, reason: 'exception', error: error.message };
  }
}

export default { closeLinkedIssueIfNotAutoClosed };
