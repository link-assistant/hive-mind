#!/usr/bin/env node

/**
 * Shared utilities for watch mode and auto-restart-until-mergeable mode
 *
 * This module contains common functions used by both:
 * - solve.watch.lib.mjs (--watch mode and temporary auto-restart)
 * - solve.auto-merge.lib.mjs (--auto-merge and --auto-restart-until-mergeable)
 *
 * Functions extracted to reduce duplication and ensure consistent behavior.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1190
 */

// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Import path and fs for cleanup operations
const path = (await use('path')).default;
const fs = (await use('fs')).promises;

// Import shared library functions
const lib = await import('./lib.mjs');
const { log, formatAligned } = lib;

// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

/**
 * Check if PR has been merged
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @returns {Promise<boolean>}
 */
export const checkPRMerged = async (owner, repo, prNumber) => {
  try {
    const prResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.merged'`;
    if (prResult.code === 0) {
      return prResult.stdout.toString().trim() === 'true';
    }
  } catch (error) {
    reportError(error, {
      context: 'check_pr_merged',
      owner,
      repo,
      prNumber,
      operation: 'check_merge_status',
    });
    // If we can't check, assume not merged
    return false;
  }
  return false;
};

/**
 * Check if PR is closed (but not merged)
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @returns {Promise<boolean>}
 */
export const checkPRClosed = async (owner, repo, prNumber) => {
  try {
    const prResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.state'`;
    if (prResult.code === 0) {
      return prResult.stdout.toString().trim() === 'closed';
    }
  } catch (error) {
    reportError(error, {
      context: 'check_pr_closed',
      owner,
      repo,
      prNumber,
      operation: 'check_close_status',
    });
    // If we can't check, assume not closed
    return false;
  }
  return false;
};

/**
 * Clean up .playwright-mcp/ folder to prevent browser automation artifacts
 * from triggering auto-restart (Issue #1124)
 * @param {string} tempDir - Temporary directory path
 * @param {Object} argv - Command line arguments
 */
export const cleanupPlaywrightMcpFolder = async (tempDir, argv = {}) => {
  if (argv.playwrightMcpAutoCleanup !== false) {
    const playwrightMcpDir = path.join(tempDir, '.playwright-mcp');
    try {
      const playwrightMcpExists = await fs
        .stat(playwrightMcpDir)
        .then(() => true)
        .catch(() => false);
      if (playwrightMcpExists) {
        await fs.rm(playwrightMcpDir, { recursive: true, force: true });
        await log('🧹 Cleaned up .playwright-mcp/ folder (browser automation artifacts)', { verbose: true });
      }
    } catch (cleanupError) {
      // Non-critical error, just log and continue
      await log(`⚠️  Could not clean up .playwright-mcp/ folder: ${cleanupError.message}`, { verbose: true });
    }
  }
};

/**
 * Check if there are uncommitted changes in the repository
 * @param {string} tempDir - Temporary directory path
 * @param {Object} argv - Command line arguments (optional)
 * @returns {Promise<boolean>}
 */
export const checkForUncommittedChanges = async (tempDir, argv = {}) => {
  // First, clean up .playwright-mcp/ folder to prevent false positives (Issue #1124)
  await cleanupPlaywrightMcpFolder(tempDir, argv);

  try {
    const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
    if (gitStatusResult.code === 0) {
      const statusOutput = gitStatusResult.stdout.toString().trim();
      return statusOutput.length > 0;
    }
  } catch (error) {
    reportError(error, {
      context: 'check_uncommitted_changes',
      tempDir,
      operation: 'git_status',
    });
    // If we can't check, assume no uncommitted changes
  }
  return false;
};

/**
 * Get uncommitted changes details for display
 * @param {string} tempDir - Temporary directory path
 * @returns {Promise<string[]>}
 */
export const getUncommittedChangesDetails = async tempDir => {
  const changes = [];
  try {
    const gitStatusResult = await $({ cwd: tempDir })`git status --porcelain 2>&1`;
    if (gitStatusResult.code === 0) {
      const statusOutput = gitStatusResult.stdout.toString().trim();
      if (statusOutput) {
        changes.push(...statusOutput.split('\n'));
      }
    }
  } catch (error) {
    reportError(error, {
      context: 'get_uncommitted_changes_details',
      tempDir,
      operation: 'git_status',
    });
  }
  return changes;
};

/**
 * Execute the AI tool (Claude, OpenCode, Codex, Agent) for a restart iteration
 * This is the shared tool execution logic used by both watch mode and auto-restart-until-mergeable mode
 * @param {Object} params - Execution parameters
 * @returns {Promise<Object>} - Tool execution result
 */
export const executeToolIteration = async params => {
  const { issueUrl, owner, repo, issueNumber, prNumber, branchName, tempDir, mergeStateStatus, feedbackLines, argv } = params;

  // Import necessary modules for tool execution
  const memoryCheck = await import('./memory-check.mjs');
  const { getResourceSnapshot } = memoryCheck;

  let toolResult;
  if (argv.tool === 'opencode') {
    // Use OpenCode
    const opencodeExecLib = await import('./opencode.lib.mjs');
    const { executeOpenCode } = opencodeExecLib;
    const opencodePath = argv.opencodePath || 'opencode';

    toolResult = await executeOpenCode({
      issueUrl,
      issueNumber,
      prNumber,
      prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
      branchName,
      tempDir,
      isContinueMode: true,
      mergeStateStatus,
      forkedRepo: argv.fork,
      feedbackLines,
      owner,
      repo,
      argv,
      log,
      formatAligned,
      getResourceSnapshot,
      opencodePath,
      $,
    });
  } else if (argv.tool === 'codex') {
    // Use Codex
    const codexExecLib = await import('./codex.lib.mjs');
    const { executeCodex } = codexExecLib;
    const codexPath = argv.codexPath || 'codex';

    toolResult = await executeCodex({
      issueUrl,
      issueNumber,
      prNumber,
      prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
      branchName,
      tempDir,
      isContinueMode: true,
      mergeStateStatus,
      forkedRepo: argv.fork,
      feedbackLines,
      forkActionsUrl: null,
      owner,
      repo,
      argv,
      log,
      setLogFile: () => {},
      getLogFile: () => '',
      formatAligned,
      getResourceSnapshot,
      codexPath,
      $,
    });
  } else if (argv.tool === 'agent') {
    // Use Agent
    const agentExecLib = await import('./agent.lib.mjs');
    const { executeAgent } = agentExecLib;
    const agentPath = argv.agentPath || 'agent';

    toolResult = await executeAgent({
      issueUrl,
      issueNumber,
      prNumber,
      prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
      branchName,
      tempDir,
      isContinueMode: true,
      mergeStateStatus,
      forkedRepo: argv.fork,
      feedbackLines,
      forkActionsUrl: null,
      owner,
      repo,
      argv,
      log,
      formatAligned,
      getResourceSnapshot,
      agentPath,
      $,
    });
  } else {
    // Use Claude (default)
    const claudeExecLib = await import('./claude.lib.mjs');
    const { executeClaude, checkPlaywrightMcpAvailability } = claudeExecLib;
    const claudePath = argv.claudePath || 'claude';

    // Check for Playwright MCP availability if using Claude tool
    if (argv.tool === 'claude' || !argv.tool) {
      if (argv.promptPlaywrightMcp) {
        const playwrightMcpAvailable = await checkPlaywrightMcpAvailability();
        if (playwrightMcpAvailable) {
          await log('🎭 Playwright MCP detected - enabling browser automation hints', { verbose: true });
        } else {
          await log('ℹ️  Playwright MCP not detected - browser automation hints will be disabled', { verbose: true });
          argv.promptPlaywrightMcp = false;
        }
      } else {
        await log('ℹ️  Playwright MCP explicitly disabled via --no-prompt-playwright-mcp', { verbose: true });
      }
    }

    toolResult = await executeClaude({
      issueUrl,
      issueNumber,
      prNumber,
      prUrl: `https://github.com/${owner}/${repo}/pull/${prNumber}`,
      branchName,
      tempDir,
      isContinueMode: true,
      mergeStateStatus,
      forkedRepo: argv.fork,
      feedbackLines,
      owner,
      repo,
      argv,
      log,
      formatAligned,
      getResourceSnapshot,
      claudePath,
      $,
    });
  }

  return toolResult;
};

/**
 * Build standard instructions for auto-restart modes
 * These instructions ensure the AI agent addresses all aspects needed for mergeability
 * @returns {string[]} Array of instruction lines
 */
export const buildAutoRestartInstructions = () => {
  return ['', '='.repeat(60), '🎯 AUTO-RESTART MODE INSTRUCTIONS:', '='.repeat(60), '', 'Ensure to get latest version of default branch to make all conflicts resolved if present.', 'Ensure you comply with all CI/CD check requirements, and they pass.', 'Ensure all changes are correct, consistent and fully meet all discussed requirements', '(check issue description and all comments in issue and in pull request).', ''];
};

/**
 * Build feedback lines for uncommitted changes
 * @param {string[]} changes - Array of uncommitted change lines from git status
 * @param {number} restartCount - Current restart iteration number
 * @param {number} maxIterations - Maximum restart iterations
 * @returns {string[]} Array of feedback lines
 */
export const buildUncommittedChangesFeedback = (changes, restartCount = 0, maxIterations = 0) => {
  const feedbackLines = [];
  const iterationInfo = maxIterations > 0 ? ` (Auto-restart ${restartCount}/${maxIterations})` : '';

  feedbackLines.push('');
  feedbackLines.push(`⚠️ UNCOMMITTED CHANGES DETECTED${iterationInfo}:`);
  feedbackLines.push('The following uncommitted changes were found in the repository:');
  feedbackLines.push('');

  for (const line of changes) {
    feedbackLines.push(`  ${line}`);
  }

  feedbackLines.push('');
  feedbackLines.push('IMPORTANT: You MUST handle these uncommitted changes by either:');
  feedbackLines.push('1. COMMITTING them if they are part of the solution (git add + git commit + git push)');
  feedbackLines.push('2. REVERTING them if they are not needed (git checkout -- <file> or git clean -fd)');
  feedbackLines.push('');
  feedbackLines.push('DO NOT leave uncommitted changes behind. The session will auto-restart until all changes are resolved.');

  return feedbackLines;
};

/**
 * Check if a tool result indicates an API error
 * @param {Object} toolResult - Tool execution result
 * @returns {boolean}
 */
export const isApiError = toolResult => {
  if (!toolResult || !toolResult.result) return false;

  const errorPatterns = ['API Error:', 'not_found_error', 'authentication_error', 'invalid_request_error'];

  return errorPatterns.some(pattern => toolResult.result.includes(pattern));
};

export default {
  checkPRMerged,
  checkPRClosed,
  cleanupPlaywrightMcpFolder,
  checkForUncommittedChanges,
  getUncommittedChangesDetails,
  executeToolIteration,
  buildAutoRestartInstructions,
  buildUncommittedChangesFeedback,
  isApiError,
};
