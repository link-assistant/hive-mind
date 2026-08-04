#!/usr/bin/env node

/**
 * Generate minimal prompt for auto-restart with session resume
 * This module provides functions to create lightweight prompts for auto-restart
 * that assume the AI has full context from the previous session
 *
 * Part of the cost optimization feature for issue #661
 * @see case-studies/issue-661-session-resume-cost-optimization/
 */

import { QUIET_PROBE } from './quiet-probe.lib.mjs';

// Note: This module does not import $ directly
// Functions receive $ as a parameter from the calling module
// This ensures consistent command executor usage across the codebase

/**
 * Generate minimal prompt for auto-restart with session resume
 * This prompt assumes the AI has full context from the previous session
 * Target: ~500 tokens (compared to 50k-200k in full context)
 *
 * @param {string} tempDir - Working directory
 * @param {object} $ - Command executor
 * @returns {Promise<string>} Minimal restart prompt
 */
export const generateMinimalRestartPrompt = async (tempDir, $) => {
  // Get uncommitted changes
  const gitStatus = await $({ cwd: tempDir })`git status --porcelain`;
  const uncommittedFiles = gitStatus.stdout.toString().trim();

  // Get brief diff summaries (not full diffs to keep the prompt minimal)
  // Issue #2135: `mirror: false` - the summaries go into the prompt below, so
  // echoing them into the log only duplicates them into the attached log file.
  const gitDiffStat = await $({ cwd: tempDir, ...QUIET_PROBE })`git diff --stat`;
  const unstagedDiffSummary = gitDiffStat.stdout.toString().trim();
  const gitCachedDiffStat = await $({ cwd: tempDir, ...QUIET_PROBE })`git diff --cached --stat`;
  const stagedDiffSummary = gitCachedDiffStat.stdout.toString().trim();
  const summarySections = [];
  if (unstagedDiffSummary) summarySections.push(`Unstaged changes:\n${unstagedDiffSummary}`);
  if (stagedDiffSummary) summarySections.push(`Staged changes:\n${stagedDiffSummary}`);
  const diffSummary = summarySections.join('\n\n') || 'No tracked-file diff summary available.';

  // Count changes
  const fileCount = uncommittedFiles.split('\n').filter(line => line.trim()).length;

  return `🔄 Auto-restart: resume the previous session and handle its uncommitted changes.

Uncommitted files (${fileCount}):
${uncommittedFiles}

Changes summary:
${diffSummary}

Please review these changes and commit them with an appropriate commit message.
Follow the repository's commit message conventions from previous commits.`;
};

/**
 * Generate full context prompt (fallback when resume fails or not enabled)
 * This is used when session resume is not available or failed
 *
 * @param {string} issueUrl - Issue URL
 * @param {string} issueBody - Issue description
 * @param {number} prNumber - PR number
 * @param {Array<string>} feedbackLines - Feedback from reviewers
 * @param {string} tempDir - Working directory
 * @param {object} $ - Command executor
 * @returns {Promise<string>} Full restart prompt
 */
export const generateFullRestartPrompt = async (issueUrl, issueBody, prNumber, feedbackLines, tempDir, $) => {
  // Get uncommitted changes with full diff
  const gitStatus = await $({ cwd: tempDir })`git status --porcelain`;
  const uncommittedFiles = gitStatus.stdout.toString().trim();

  // Issue #2135: `mirror: false`. This is the working tree's whole diff and it
  // is embedded in the prompt below; mirroring it wrote a second copy into the
  // session log, which is attached to the pull request and (with
  // --development-log) committed into the branch the diff is taken from.
  const gitDiff = await $({ cwd: tempDir, ...QUIET_PROBE })`git diff`;
  const fullDiff = gitDiff.stdout.toString();

  let prompt = `
Continuing work on issue: ${issueUrl}

Previous session completed but left uncommitted changes.
  `.trim();

  if (feedbackLines && feedbackLines.length > 0) {
    prompt += `\n\nFeedback from reviewers:\n${feedbackLines.join('\n')}`;
  }

  prompt += `\n\nUncommitted changes:\n${uncommittedFiles}\n\nFull diff:\n${fullDiff}`;

  prompt += '\n\nPlease review these changes and commit them appropriately.';

  return prompt;
};
