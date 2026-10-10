#!/usr/bin/env node

import { buildClaudeAutonomousResumeCommand, buildClaudeResumeCommand } from './claude.command-builder.lib.mjs';

/**
 * Build a solve.mjs resume command for tools that do not have a first-party interactive
 * resume CLI flow like Claude Code. This keeps the invocation within hive-mind so the
 * original tool selection and working directory can be preserved.
 *
 * Lives in its own module (not solve.results.lib.mjs) so it can be imported from
 * claude.lib.mjs / codex.lib.mjs / gemini.lib.mjs without creating a circular import.
 * See issue #942.
 *
 * @param {Object} options
 * @param {string} options.issueUrl - The issue URL passed to solve.mjs
 * @param {string} options.sessionId - The session ID to resume
 * @param {string|null} [options.tool] - Tool name (codex, opencode, agent, gemini)
 * @param {string|null} [options.model] - Model name to preserve
 * @param {string|null} [options.fallbackModel] - Explicit fallback model to preserve
 * @param {string|null} [options.tempDir] - Working directory to preserve
 * @param {string} [options.nodePath] - Node binary path
 * @param {string} [options.scriptPath] - solve.mjs path
 * @returns {string}
 */
export const buildSolveResumeCommand = ({ issueUrl, sessionId, tool = null, model = null, fallbackModel = null, tempDir = null, nodePath = process.argv[0], scriptPath = process.argv[1] }) => {
  const shellQuote = value => `"${String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
  const args = [shellQuote(scriptPath), shellQuote(issueUrl), '--resume', shellQuote(sessionId)];
  if (tool && tool !== 'claude') args.push('--tool', shellQuote(tool));
  if (model) args.push('--model', shellQuote(model));
  if (fallbackModel) args.push('--fallback-model', shellQuote(fallbackModel));
  if (tempDir) args.push('--working-directory', shellQuote(tempDir));
  return `${shellQuote(nodePath)} ${args.join(' ')}`;
};

/**
 * Resolve the issue/pull request URL solve.mjs was started with.
 *
 * yargs declares the positional as `issue-url` (see solve.config.lib.mjs), so
 * `argv.url` is never set. Reading it left resume hints empty and resume
 * commands null on every failure path. See issue #2843.
 *
 * `argv._` is deliberately not consulted: other commands (review) pass their own
 * argv to the same tool adapters, and their positional is not a solve target.
 *
 * @param {Object|null|undefined} argv - Parsed solve.mjs arguments
 * @returns {string|null}
 */
export const resolveSolveIssueUrl = argv => argv?.['issue-url'] || argv?.issueUrl || null;

/**
 * Build the solve.mjs resume command straight from parsed arguments, or null
 * when there is no session or no URL to resume.
 *
 * @param {Object} options
 * @param {Object} options.argv - Parsed solve.mjs arguments
 * @param {string|null} options.sessionId - The session ID to resume
 * @param {string|null} [options.tempDir] - Working directory to preserve
 * @param {string|null} [options.tool] - Tool name; defaults to argv.tool, then claude
 * @returns {string|null}
 */
export const buildSolveResumeCommandFromArgv = ({ argv, sessionId, tempDir = null, tool = argv?.tool || 'claude' }) => {
  const issueUrl = resolveSolveIssueUrl(argv);
  if (!sessionId || !issueUrl) return null;
  return buildSolveResumeCommand({ issueUrl, sessionId, tool, model: argv?.model, fallbackModel: argv?.fallbackModel, tempDir });
};

/**
 * Lines of the "To continue this session" hint printed when a solve run fails.
 * Claude also gets its own interactive/autonomous commands; every tool gets the
 * solve resume command, which preserves the tool, model and working directory.
 *
 * @param {Object} options
 * @param {Object} options.argv - Parsed solve.mjs arguments
 * @param {string|null} options.sessionId - The session ID to resume
 * @param {string|null} [options.tempDir] - Working directory to preserve
 * @returns {string[]} Empty when there is no session to resume
 */
export const buildFailureResumeHintLines = ({ argv, sessionId, tempDir = null }) => {
  if (!sessionId) return [];
  const lines = ['', '💡 To continue this session:'];
  if ((argv?.tool || 'claude') === 'claude') {
    lines.push(`   Interactive mode:    ${buildClaudeResumeCommand({ tempDir, sessionId, model: argv?.model })}`);
    lines.push(`   Autonomous mode:     ${buildClaudeAutonomousResumeCommand({ tempDir, sessionId, model: argv?.model })}`);
  }
  const solveResumeCmd = buildSolveResumeCommandFromArgv({ argv, sessionId, tempDir });
  if (solveResumeCmd) lines.push(`   Solve resume mode:   ${solveResumeCmd}`);
  lines.push('');
  return lines;
};
