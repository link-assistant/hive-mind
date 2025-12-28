#!/usr/bin/env node

/**
 * Claude CLI Command Builder Library
 *
 * This module provides utilities for building Claude-specific CLI commands.
 * These builders are specifically designed for the Claude Code CLI tool (--tool claude)
 * and help generate consistent, copy-pasteable commands using the pattern:
 *
 *   (cd "/path/to/workdir" && claude --resume <session-id>)
 *
 * This is the same pattern used by --auto-continue-on-limit-reset and allows users to:
 * 1. Resume sessions directly using Claude CLI (not through solve.mjs)
 * 2. Investigate issues interactively in the working directory
 * 3. Continue work after usage limits reset
 *
 * Functions:
 * - buildClaudeResumeCommand: Generate `(cd ... && claude --resume ...)` command
 * - buildClaudeInitialCommand: Generate `(cd ... && claude ...)` command for new sessions
 *
 * Related issue: https://github.com/link-assistant/hive-mind/issues/942
 */

/**
 * Build the Claude CLI resume command with the (cd ... && claude --resume ...) pattern
 *
 * This generates a copy-pasteable command that users can execute directly
 * to resume a Claude session in interactive mode. This is the same pattern
 * used by --auto-continue-on-limit-reset.
 *
 * The command includes all necessary flags to match how the original session was run:
 * - --resume <sessionId>: Resume from the specified session
 * - --model <model>: Use the same model as the original session (optional)
 *
 * Note: This function is specifically designed for Claude CLI (--tool claude)
 * and should only be used when the tool is 'claude' or undefined (defaults to claude).
 *
 * @param {Object} options - Options for building the command
 * @param {string} options.tempDir - The working directory (e.g., /tmp/gh-issue-solver-...)
 * @param {string} options.sessionId - The session ID to resume
 * @param {string} options.claudePath - Path to the claude CLI binary (defaults to 'claude')
 * @param {string} [options.model] - The model to use (e.g., 'sonnet', 'opus', 'claude-sonnet-4-20250514')
 * @returns {string} - The full resume command with (cd ... && claude --resume ...) pattern
 */
export const buildClaudeResumeCommand = ({ tempDir, sessionId, claudePath = 'claude', model }) => {
  let args = `--resume ${sessionId}`;

  if (model) {
    args += ` --model ${model}`;
  }

  return `(cd "${tempDir}" && ${claudePath} ${args})`;
};

/**
 * Build the Claude CLI initial command with the (cd ... && claude ...) pattern
 *
 * This generates the command pattern used when starting a new Claude session.
 * Useful for documentation and debugging purposes.
 *
 * Note: This function is specifically designed for Claude CLI (--tool claude)
 * and should only be used when the tool is 'claude' or undefined (defaults to claude).
 *
 * @param {Object} options - Options for building the command
 * @param {string} options.tempDir - The working directory (e.g., /tmp/gh-issue-solver-...)
 * @param {string} options.claudePath - Path to the claude CLI binary (defaults to 'claude')
 * @param {string} [options.model] - The model to use
 * @param {boolean} [options.verbose] - Whether to include --verbose flag
 * @returns {string} - The command pattern (cd ... && claude ...)
 */
export const buildClaudeInitialCommand = ({ tempDir, claudePath = 'claude', model, verbose = false }) => {
  let args = '--output-format stream-json --dangerously-skip-permissions';

  if (verbose) {
    args += ' --verbose';
  }

  if (model) {
    args += ` --model ${model}`;
  }

  return `(cd "${tempDir}" && ${claudePath} ${args})`;
};

// Export default object for compatibility
export default {
  buildClaudeResumeCommand,
  buildClaudeInitialCommand,
};
