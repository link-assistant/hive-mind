#!/usr/bin/env node

/**
 * Claude CLI Command Builder Library
 *
 * This module provides utilities for building Claude-specific CLI commands.
 * These builders are specifically designed for the Claude Code CLI tool (--tool claude)
 * and help generate consistent, copy-pasteable commands for:
 *
 * 1. buildInitialCommand: Generate the full solve.mjs command for initial execution
 * 2. buildResumeCommand: Generate the full solve.mjs command for resuming a session
 *
 * Both functions preserve all relevant CLI options from the original invocation,
 * ensuring that the generated commands can be copied and executed exactly as intended.
 *
 * Related issue: https://github.com/link-assistant/hive-mind/issues/942
 */

/**
 * Get the default model for a given tool
 * @param {string} tool - The tool name (claude, opencode, codex, agent)
 * @returns {string} - The default model for that tool
 */
export const getDefaultModelForTool = tool => {
  switch (tool) {
    case 'opencode':
      return 'grok-code-fast-1';
    case 'codex':
      return 'gpt-5';
    case 'agent':
      return 'grok-code';
    case 'claude':
    default:
      return 'sonnet';
  }
};

/**
 * Build common CLI arguments that are shared between initial and resume commands
 *
 * @param {Object} argv - The parsed command line arguments
 * @param {boolean} shouldAttachLogs - Whether --attach-logs was used
 * @returns {string[]} - Array of CLI arguments
 */
const buildCommonArgs = (argv, shouldAttachLogs = false) => {
  const args = [];

  // Model: only add if not default for the tool
  const tool = argv.tool || 'claude';
  const defaultModel = getDefaultModelForTool(tool);
  if (argv.model && argv.model !== defaultModel) {
    args.push('--model', argv.model);
  }

  // Verbose mode
  if (argv.verbose) {
    args.push('--verbose');
  }

  // Fork mode
  if (argv.fork) {
    args.push('--fork');
  }

  // Attach logs
  if (shouldAttachLogs || argv.attachLogs || argv['attach-logs']) {
    args.push('--attach-logs');
  }

  // Auto-continue on limit reset
  if (argv.autoContinueOnLimitReset) {
    args.push('--auto-continue-on-limit-reset');
  }

  // Tool: only add if not default (claude)
  if (argv.tool && argv.tool !== 'claude') {
    args.push('--tool', argv.tool);
  }

  // Auto-cleanup: only add if explicitly set to false
  if (argv.autoCleanup === false) {
    args.push('--no-auto-cleanup');
  }

  // Watch mode
  if (argv.watch) {
    args.push('--watch');
  }

  // Think level
  if (argv.think) {
    args.push('--think', argv.think);
  }

  // Auto-resume on errors
  if (argv.autoResumeOnErrors) {
    args.push('--auto-resume-on-errors');
  }

  // Auto-commit uncommitted changes
  if (argv.autoCommitUncommittedChanges) {
    args.push('--auto-commit-uncommitted-changes');
  }

  // Interactive mode
  if (argv.interactiveMode) {
    args.push('--interactive-mode');
  }

  // Tokens budget stats
  if (argv.tokensBudgetStats) {
    args.push('--tokens-budget-stats');
  }

  return args;
};

/**
 * Build the full solve.mjs initial command with all relevant options preserved
 * This generates the command that would be used to start a new session.
 *
 * Note: This function is specifically designed for Claude CLI (--tool claude)
 * and should only be used when the tool is 'claude' or undefined (defaults to claude).
 *
 * @param {Object} options - Options for building the command
 * @param {string} options.issueUrl - The issue/PR URL
 * @param {Object} options.argv - The parsed command line arguments
 * @param {boolean} [options.shouldAttachLogs] - Whether --attach-logs was used
 * @returns {string} - The full initial command
 */
export const buildInitialCommand = ({ issueUrl, argv, shouldAttachLogs = false }) => {
  const commandArgs = ['solve.mjs', `"${issueUrl}"`];

  // Add all common arguments
  const commonArgs = buildCommonArgs(argv, shouldAttachLogs);
  commandArgs.push(...commonArgs);

  return commandArgs.join(' ');
};

/**
 * Build the full solve.mjs resume command with all relevant options preserved
 * This matches the command that would be used by --auto-continue-on-limit-reset
 *
 * Note: This function is specifically designed for Claude CLI (--tool claude)
 * and should only be used when the tool is 'claude' or undefined (defaults to claude).
 *
 * @param {Object} options - Options for building the command
 * @param {string} options.issueUrl - The issue/PR URL
 * @param {string} options.sessionId - The session ID to resume
 * @param {Object} options.argv - The parsed command line arguments
 * @param {boolean} [options.shouldAttachLogs] - Whether --attach-logs was used
 * @returns {string} - The full resume command
 */
export const buildResumeCommand = ({ issueUrl, sessionId, argv, shouldAttachLogs = false }) => {
  const resumeArgs = ['solve.mjs', `"${issueUrl}"`, '--resume', sessionId];

  // Add all common arguments
  const commonArgs = buildCommonArgs(argv, shouldAttachLogs);
  resumeArgs.push(...commonArgs);

  return resumeArgs.join(' ');
};

/**
 * Check if the current tool is Claude CLI
 * This helper function determines if the command builders should be used
 *
 * @param {Object} argv - The parsed command line arguments
 * @returns {boolean} - True if the tool is Claude CLI (or default)
 */
export const isClaudeTool = argv => {
  const tool = argv.tool || 'claude';
  return tool === 'claude';
};

// Export default object for compatibility
export default {
  buildInitialCommand,
  buildResumeCommand,
  isClaudeTool,
  getDefaultModelForTool,
};
