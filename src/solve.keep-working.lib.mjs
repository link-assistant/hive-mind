#!/usr/bin/env node
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

/**
 * Keep-working-until-done module for solve.mjs
 *
 * [EXPERIMENTAL] When --keep-working-until-all-requirements-are-fully-done is
 * enabled, after the main solve (and any other post-processing) completes, this
 * module scans the pull request description, the AI working-session/solution
 * summary, and the markdown documents changed by the pull request for strong
 * indicators that the AI deferred, delayed or postponed work to a future pull
 * request / iteration (e.g. "out of scope", "future work", "deferred",
 * "follow-up PR", "TODO", ...).
 *
 * When such indicators are found, it automatically restarts the AI tool with a
 * prompt instructing it to finish everything in this single pull request, in
 * addition to the concrete detected reasons. It keeps restarting until no
 * indicators remain or until the configured restart limit is reached.
 *
 * By default the restart limit is 5. The limit can be set to a custom number,
 * or to "forever" / "unlimited" / "infinite" / 0 to remove the limit entirely.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1883
 */

// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  await ensureUseM();
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $: __rawDollar$ } = await use('command-stream');
const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
const $ = wrapDollarWithGhRetry(__rawDollar$);

// Import shared library functions
const lib = await import('./lib.mjs');
const { log, cleanErrorMessage } = lib;

// Import shared restart utilities
const restartShared = await import('./solve.restart-shared.lib.mjs');
const { executeToolIteration, isApiError, isUsageLimitReached } = restartShared;

const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

// Pure detection + normalization helpers live in a separate, network-free
// module so they can be unit-tested in isolation (issue #1883).
const detectLib = await import('./solve.keep-working.detect.lib.mjs');
const { DEFAULT_KEEP_WORKING_LIMIT, KEEP_WORKING_PROMPT, DEFERRED_WORK_PATTERNS, isUnlimitedKeepWorking, normalizeKeepWorkingLimit, formatKeepWorkingLimit, detectDeferredWork, detectDeferredWorkInSources, extractAddedLinesFromPatch, buildKeepWorkingFeedback } = detectLib;

// Re-export the pure helpers so existing importers of this module keep working.
export { DEFAULT_KEEP_WORKING_LIMIT, KEEP_WORKING_PROMPT, DEFERRED_WORK_PATTERNS, isUnlimitedKeepWorking, normalizeKeepWorkingLimit, formatKeepWorkingLimit, detectDeferredWork, detectDeferredWorkInSources, buildKeepWorkingFeedback };

/**
 * Collect the text sources to scan for deferred-work indicators:
 *   1. The pull request description (body).
 *   2. The AI working-session / solution summary (passed in-memory).
 *   3. The markdown documents changed by the pull request (added lines only).
 *
 * @param {object} params
 * @returns {Promise<Array<{source: string, text: string}>>}
 */
export const collectDeferredWorkSources = async ({ owner, repo, prNumber, resultSummary }) => {
  const sources = [];

  // 1. Pull request description
  try {
    const prResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber} --jq '.body // ""'`;
    if (prResult.code === 0) {
      const body = prResult.stdout.toString();
      if (body && body.trim()) {
        sources.push({ source: 'pull request description', text: body });
      }
    }
  } catch (error) {
    reportError(error, { context: 'keep_working_collect_pr_body', owner, repo, prNumber, operation: 'fetch_pr_body' });
  }

  // 2. AI working-session / solution summary (in-memory, no token cost)
  if (resultSummary && typeof resultSummary === 'string' && resultSummary.trim()) {
    sources.push({ source: 'AI solution summary', text: resultSummary });
  }

  // 3. Changed markdown documents (scan only added lines from the diff)
  try {
    const filesResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}/files --paginate`;
    if (filesResult.code === 0) {
      const files = JSON.parse(filesResult.stdout.toString() || '[]');
      for (const file of files) {
        const filename = file.filename || '';
        if (!/\.(md|markdown|mdx)$/i.test(filename)) continue;
        if (file.status === 'removed') continue;
        const addedText = extractAddedLinesFromPatch(file.patch);
        if (addedText && addedText.trim()) {
          sources.push({ source: `changed markdown document ${filename}`, text: addedText });
        }
      }
    }
  } catch (error) {
    reportError(error, { context: 'keep_working_collect_md_files', owner, repo, prNumber, operation: 'fetch_pr_files' });
  }

  return sources;
};

/**
 * Runs keep-working restart iterations after the main solve.
 *
 * @param {object} params
 * @param {string} params.issueUrl
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string|number} params.issueNumber
 * @param {string|number} params.prNumber
 * @param {string} params.branchName
 * @param {string} params.tempDir
 * @param {string} [params.workspaceTmpDir]
 * @param {object} params.argv - CLI arguments
 * @param {function} params.cleanupClaudeFile - cleanup function
 * @param {string} [params.resultSummary] - AI solution summary from the last session
 * @returns {Promise<{sessionId, anthropicTotalCostUSD, publicPricingEstimate, pricingInfo}|null>}
 */
export const runKeepWorkingUntilDone = async ({ issueUrl, owner, repo, issueNumber, prNumber, branchName, tempDir, workspaceTmpDir, argv, cleanupClaudeFile, resultSummary }) => {
  const limit = normalizeKeepWorkingLimit(argv.keepWorkingUntilAllRequirementsAreFullyDone);
  if (!limit || !prNumber) {
    return null;
  }

  await log('');
  await log(`🔁 KEEP-WORKING: Scanning for deferred / delayed / out-of-scope work (limit: ${formatKeepWorkingLimit(limit)} restart(s))`);
  await log('   Sources: pull request description, AI solution summary, changed markdown documents');
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
  let lastResultSummary = resultSummary;
  let consecutiveErrors = 0;
  // Hard safety cap even in "unlimited" mode, to avoid spinning forever on
  // repeated failures (issue #1883: "limit it with 5 auto-restarts ... in case
  // of errors"). Only consecutive errors count toward this cap.
  const MAX_CONSECUTIVE_ERRORS = 3;

  let iteration = 0;
  while (true) {
    // Gather and scan sources fresh on every iteration.
    let sources;
    try {
      sources = await collectDeferredWorkSources({ owner, repo, prNumber, resultSummary: lastResultSummary });
    } catch (error) {
      reportError(error, { context: 'keep_working_collect_sources', owner, repo, prNumber, operation: 'collect_sources' });
      await log(`⚠️  KEEP-WORKING: Could not collect sources: ${cleanErrorMessage(error)}`, { level: 'warning' });
      break;
    }

    const detections = detectDeferredWorkInSources(sources);

    if (detections.length === 0) {
      if (iteration === 0) {
        await log('✅ KEEP-WORKING: No deferred / delayed / out-of-scope work detected. Nothing to restart for.');
      } else {
        await log(`✅ KEEP-WORKING: No more deferred work detected after ${iteration} restart(s). All requirements appear to be fully done.`);
      }
      break;
    }

    if (iteration >= limit) {
      await log(`🛑 KEEP-WORKING: Reached restart limit (${formatKeepWorkingLimit(limit)}) but ${detections.length} deferred-work indicator(s) still detected.`);
      await log('   Stopping to avoid an unbounded loop. Increase the limit (or use "forever"/"unlimited") to keep going.');
      for (const detection of detections.slice(0, 10)) {
        await log(`   • [${detection.label}] in ${detection.source}: "${detection.snippet}"`);
      }
      break;
    }

    iteration++;
    await log('');
    await log(`🔁 KEEP-WORKING iteration ${iteration}/${formatKeepWorkingLimit(limit)}: ${detections.length} deferred-work indicator(s) detected, restarting...`);
    for (const detection of detections.slice(0, 10)) {
      await log(`   • [${detection.label}] in ${detection.source}: "${detection.snippet}"`);
    }

    // Issue #1572 pattern: sync local branch with remote before each iteration
    try {
      const pullResult = await $({ cwd: tempDir })`git pull origin ${branchName} 2>&1`;
      if (pullResult.code === 0) {
        await log(`   Synced local branch ${branchName} from remote`, { verbose: true });
      } else {
        await log(`   Warning: git pull failed (code ${pullResult.code}); continuing with local state`, { level: 'warning' });
      }
    } catch (error) {
      reportError(error, { context: 'keep_working_git_pull', branchName, operation: 'git_pull' });
      await log(`   Warning: git pull error: ${cleanErrorMessage(error)}`, { level: 'warning' });
    }

    const feedbackLines = buildKeepWorkingFeedback(detections, iteration, limit);

    const iterationResult = await executeToolIteration({
      issueUrl,
      owner,
      repo,
      issueNumber,
      prNumber,
      branchName,
      tempDir,
      workspaceTmpDir,
      mergeStateStatus: currentMergeStateStatus,
      feedbackLines,
      argv: {
        ...argv,
        // Reinforce the "finish everything now" guidance in the system prompt.
        promptEnsureAllRequirementsAreMet: true,
        // Prevent recursive keep-working inside the restart iteration.
        keepWorkingUntilAllRequirementsAreFullyDone: 0,
      },
    });

    // Update session data from the restart.
    if (iterationResult) {
      if (iterationResult.sessionId) sessionId = iterationResult.sessionId;
      if (iterationResult.anthropicTotalCostUSD) anthropicTotalCostUSD = iterationResult.anthropicTotalCostUSD;
      if (iterationResult.publicPricingEstimate) publicPricingEstimate = iterationResult.publicPricingEstimate;
      if (iterationResult.pricingInfo) pricingInfo = iterationResult.pricingInfo;
      if (iterationResult.result) lastResultSummary = iterationResult.result;
    }

    // Issue #1883: cap consecutive errors so we don't spin forever (especially
    // important in "unlimited" mode).
    if (isUsageLimitReached(iterationResult)) {
      await log('🛑 KEEP-WORKING: Usage limit reached during restart. Stopping keep-working loop.');
      break;
    }
    if (isApiError(iterationResult)) {
      consecutiveErrors++;
      await log(`⚠️  KEEP-WORKING: API error during restart (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS} consecutive).`, { level: 'warning' });
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        await log('🛑 KEEP-WORKING: Too many consecutive errors. Stopping keep-working loop.');
        break;
      }
    } else {
      consecutiveErrors = 0;
    }

    await log(`✅ KEEP-WORKING iteration ${iteration}/${formatKeepWorkingLimit(limit)} complete`);
    await log('');
  }

  // Clean up CLAUDE.md/.gitkeep after restarts
  try {
    await cleanupClaudeFile(tempDir, branchName, null, argv);
  } catch (error) {
    reportError(error, { context: 'keep_working_cleanup', branchName, operation: 'cleanup_claude_file' });
  }

  if (iteration === 0) return null;
  return { sessionId, anthropicTotalCostUSD, publicPricingEstimate, pricingInfo };
};

export default {
  DEFAULT_KEEP_WORKING_LIMIT,
  KEEP_WORKING_PROMPT,
  DEFERRED_WORK_PATTERNS,
  isUnlimitedKeepWorking,
  normalizeKeepWorkingLimit,
  formatKeepWorkingLimit,
  detectDeferredWork,
  detectDeferredWorkInSources,
  collectDeferredWorkSources,
  buildKeepWorkingFeedback,
  runKeepWorkingUntilDone,
};
