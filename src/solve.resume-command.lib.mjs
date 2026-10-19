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
 * @param {string[]} [options.extraArgs] - Every other original solve option to replay (issue #3190)
 * @param {string} [options.nodePath] - Node binary path
 * @param {string} [options.scriptPath] - solve.mjs path
 * @returns {string}
 */
export const buildSolveResumeCommand = ({ issueUrl, sessionId, tool = null, model = null, fallbackModel = null, tempDir = null, extraArgs = [], nodePath = process.argv[0], scriptPath = process.argv[1] }) => {
  const shellQuote = value => `"${String(value).replace(/[\\"$`]/g, '\\$&')}"`;
  const args = [shellQuote(scriptPath), shellQuote(issueUrl), '--resume', shellQuote(sessionId)];
  if (tool && tool !== 'claude') args.push('--tool', shellQuote(tool));
  if (model) args.push('--model', shellQuote(model));
  if (fallbackModel) args.push('--fallback-model', shellQuote(fallbackModel));
  if (tempDir) args.push('--working-directory', shellQuote(tempDir));
  // Issue #3190: without the user's other options (--auto-merge, --think, ...) a
  // manual resume would silently run with different settings.
  for (const arg of Array.isArray(extraArgs) ? extraArgs : []) args.push(/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg) ? arg : shellQuote(arg));
  return `${shellQuote(nodePath)} ${args.join(' ')}`;
};

/**
 * Issue #2843: yargs stores solve's positional as `issue-url` (and `_[0]`); `argv.url`
 * is never set, so reading it left non-Claude failures without a resume command.
 *
 * @param {Object} argv - Parsed solve arguments
 * @returns {string|null}
 */
export const resolveSolveIssueUrl = argv => argv?.['issue-url'] || argv?.issueUrl || argv?._?.[0] || null;

/**
 * Solve resume command for the current run, or null without a URL or session.
 *
 * @param {Object} options
 * @param {Object} options.argv - Parsed solve arguments
 * @param {string|null} [options.issueUrl] - The run's resolved issue URL (defaults to the one in argv)
 * @param {string|null} options.sessionId - The session ID to resume
 * @param {string|null} [options.tool] - Tool name (defaults to argv.tool, then claude)
 * @param {string|null} [options.tempDir] - Working directory to preserve
 * @returns {string|null}
 */
export const buildSolveResumeCommandFromArgv = ({ argv, issueUrl = null, sessionId, tool = null, tempDir = null }) => {
  const url = issueUrl || resolveSolveIssueUrl(argv);
  if (!url || !sessionId) return null;
  return buildSolveResumeCommand({ issueUrl: url, sessionId, tool: tool || argv?.tool || 'claude', model: argv?.model, fallbackModel: argv?.fallbackModel, tempDir, extraArgs: argv?._solveResumeExtraArgs });
};
