#!/usr/bin/env node

/**
 * Auto-ensure-all-requirements-are-met module for solve.mjs
 * After the main solve completes, restarts the AI tool N times with a
 * requirements-check prompt to verify all requirements are met.
 *
 * Extracted from solve.mjs to keep files under 1500 lines.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1383
 */

// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Import shared library functions
const lib = await import('./lib.mjs');
const { log } = lib;

// Import shared restart utilities
const restartShared = await import('./solve.restart-shared.lib.mjs');
const { executeToolIteration } = restartShared;

/**
 * Runs auto-ensure requirements-check iterations after the main solve.
 *
 * @param {object} params
 * @param {string} params.issueUrl
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string|number} params.issueNumber
 * @param {string|number} params.prNumber
 * @param {string} params.branchName
 * @param {string} params.tempDir
 * @param {object} params.argv - CLI arguments
 * @param {function} params.cleanupClaudeFile - cleanup function
 * @returns {Promise<{sessionId, anthropicTotalCostUSD, publicPricingEstimate, pricingInfo}|null>}
 */
export const runAutoEnsureRequirements = async ({ issueUrl, owner, repo, issueNumber, prNumber, branchName, tempDir, argv, cleanupClaudeFile }) => {
  const autoEnsureCount = argv.autoEnsureAllRequirementsAreMet;
  if (!autoEnsureCount || autoEnsureCount <= 0 || !prNumber) {
    return null;
  }

  await log('');
  await log(`🔍 AUTO-ENSURE: Starting ${autoEnsureCount} requirements-check restart(s)`);
  await log('   Will restart the AI tool to verify all requirements are met');
  await log('');

  // Get PR merge state status for the iterations
  let currentMergeStateStatus = null;
  try {
    const prStateResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.mergeStateStatus'`;
    if (prStateResult.code === 0) {
      currentMergeStateStatus = prStateResult.stdout.toString().trim();
    }
  } catch {
    // Ignore errors getting merge state
  }

  let sessionId;
  let anthropicTotalCostUSD;
  let publicPricingEstimate;
  let pricingInfo;

  for (let ensureIteration = 1; ensureIteration <= autoEnsureCount; ensureIteration++) {
    await log(`🔄 AUTO-ENSURE iteration ${ensureIteration}/${autoEnsureCount}: Restarting to verify requirements...`);

    const ensureFeedbackLines = ['', '='.repeat(60), '🔍 AUTO-ENSURE REQUIREMENTS CHECK:', '='.repeat(60), '', 'We need to ensure all changes are correct, consistent, validated, tested, logged and fully meet all discussed requirements (check issue description and all comments in issue and in pull request). Ensure all CI/CD checks pass.', ''];

    const ensureResult = await executeToolIteration({
      issueUrl,
      owner,
      repo,
      issueNumber,
      prNumber,
      branchName,
      tempDir,
      mergeStateStatus: currentMergeStateStatus,
      feedbackLines: ensureFeedbackLines,
      argv: {
        ...argv,
        promptEnsureAllRequirementsAreMet: true,
        // Prevent recursive auto-ensure
        autoEnsureAllRequirementsAreMet: 0,
      },
    });

    // Update session data from ensure restart
    if (ensureResult) {
      if (ensureResult.sessionId) sessionId = ensureResult.sessionId;
      if (ensureResult.anthropicTotalCostUSD) anthropicTotalCostUSD = ensureResult.anthropicTotalCostUSD;
      if (ensureResult.publicPricingEstimate) publicPricingEstimate = ensureResult.publicPricingEstimate;
      if (ensureResult.pricingInfo) pricingInfo = ensureResult.pricingInfo;
    }

    await log(`✅ AUTO-ENSURE iteration ${ensureIteration}/${autoEnsureCount} complete`);
    await log('');
  }

  // Clean up CLAUDE.md/.gitkeep after ensure restarts
  await cleanupClaudeFile(tempDir, branchName, null, argv);

  return { sessionId, anthropicTotalCostUSD, publicPricingEstimate, pricingInfo };
};

export default { runAutoEnsureRequirements };
