#!/usr/bin/env node

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
