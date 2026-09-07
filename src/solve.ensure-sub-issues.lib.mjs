#!/usr/bin/env node
import { QUIET_PROBE } from './quiet-probe.lib.mjs';
import { ensureUseM } from './use-m-bootstrap.lib.mjs';

/**
 * `--ensure-all-sub-issues-addressed` restart loop for solve.mjs (issue #2212).
 *
 * After the main solve completes, this module lists the GitHub native
 * sub-issues of the issue being solved and checks that the pull request
 * description closes every one of them with a reference GitHub actually
 * recognizes. When references are missing it restarts the AI tool, asking it to
 * double check that each of those sub-issues was really addressed in this single
 * pull request and to add the missing closing references. It keeps restarting
 * until nothing is missing or the configured restart limit is reached.
 *
 * This is what makes `/solve <repository-url>` safe: the combined issue's
 * sub-issues are exactly the repository's open issues, so the check guarantees
 * the single pull request lists all of them and closes them on merge.
 *
 * The pure detection helpers live in `solve.ensure-sub-issues.detect.lib.mjs`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2212
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

const lib = await import('./lib.mjs');
const { log, cleanErrorMessage } = lib;

const restartShared = await import('./solve.restart-shared.lib.mjs');
const { executeToolIteration, isApiError, isUsageLimitReached } = restartShared;

const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

const detectLib = await import('./solve.ensure-sub-issues.detect.lib.mjs');
const { DEFAULT_ENSURE_SUB_ISSUES_LIMIT, ENSURE_SUB_ISSUES_PROMPT, buildEnsureSubIssuesFeedback, buildMissingReferenceBlock, findMissingSubIssueReferences, formatEnsureSubIssuesLimit, normalizeEnsureSubIssuesLimit, normalizeSubIssueEntry } = detectLib;

// Re-export the pure helpers so importers only need this module.
export { DEFAULT_ENSURE_SUB_ISSUES_LIMIT, ENSURE_SUB_ISSUES_PROMPT, buildEnsureSubIssuesFeedback, buildMissingReferenceBlock, findMissingSubIssueReferences, formatEnsureSubIssuesLimit, normalizeEnsureSubIssuesLimit, normalizeSubIssueEntry };

/**
 * Hard cap on consecutive AI errors, so "unlimited" cannot spin forever.
 * Mirrors the keep-working loop (issue #1883).
 */
const MAX_CONSECUTIVE_ERRORS = 3;

/**
 * List the GitHub native sub-issues of an issue.
 *
 * `--paginate` is required: the endpoint returns 30 entries per page by default
 * and a parent may have up to 100 sub-issues.
 *
 * @param {object} params
 * @returns {Promise<Array<object>>}
 */
export const fetchSubIssues = async ({ owner, repo, issueNumber }) => {
  // Issue #2135: `mirror: false` — the payload is inspected here, not shown.
  const result = await $(QUIET_PROBE)`gh api repos/${owner}/${repo}/issues/${issueNumber}/sub_issues --paginate`;
  if (result.code !== 0) {
    const output = (result.stderr || result.stdout || '').toString().trim();
    throw new Error(output || `gh api sub_issues exited with code ${result.code}`);
  }
  const parsed = JSON.parse(result.stdout.toString() || '[]');
  return Array.isArray(parsed) ? parsed : [];
};

/**
 * Fetch the pull request description (and title, so a closing reference placed
 * in the title is honored too).
 *
 * @param {object} params
 * @returns {Promise<string>}
 */
export const fetchPullRequestText = async ({ owner, repo, prNumber }) => {
  // Issue #2135: `mirror: false` — the body can be very large.
  const result = await $(QUIET_PROBE)`gh api repos/${owner}/${repo}/pulls/${prNumber}`;
  if (result.code !== 0) {
    const output = (result.stderr || result.stdout || '').toString().trim();
    throw new Error(output || `gh api pulls exited with code ${result.code}`);
  }
  const pr = JSON.parse(result.stdout.toString() || '{}');
  // The title is included on purpose: a closing reference is recognized by
  // GitHub in the pull request title as well as in its description.
  return [pr.title || '', pr.body || ''].join('\n\n');
};

/**
 * Runs the `--ensure-all-sub-issues-addressed` restart iterations.
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
 * @param {object} params.argv
 * @param {function} params.cleanupClaudeFile
 * @returns {Promise<{sessionId, anthropicTotalCostUSD, publicPricingEstimate, pricingInfo}|null>}
 */
export const runEnsureAllSubIssuesAddressed = async ({ issueUrl, owner, repo, issueNumber, prNumber, branchName, tempDir, workspaceTmpDir, argv, cleanupClaudeFile }) => {
  const limit = normalizeEnsureSubIssuesLimit(argv.ensureAllSubIssuesAddressed ?? argv['ensure-all-sub-issues-addressed']);
  if (!limit || !prNumber || !issueNumber) {
    return null;
  }

  await log('');
  await log(`🧩 ENSURE-SUB-ISSUES: Verifying the pull request description closes every sub-issue of #${issueNumber} (limit: ${formatEnsureSubIssuesLimit(limit)} restart(s))`);

  let subIssues;
  try {
    subIssues = await fetchSubIssues({ owner, repo, issueNumber });
  } catch (error) {
    reportError(error, { context: 'ensure_sub_issues_fetch', owner, repo, issueNumber, operation: 'fetch_sub_issues' });
    await log(`⚠️  ENSURE-SUB-ISSUES: Could not list sub-issues: ${cleanErrorMessage(error)}`, { level: 'warning' });
    return null;
  }

  if (subIssues.length === 0) {
    await log(`✅ ENSURE-SUB-ISSUES: Issue #${issueNumber} has no sub-issues. Nothing to verify.`);
    return null;
  }

  await log(`   Sub-issues to verify: ${subIssues.length}`);

  // Merge state is only used to enrich the restart prompt; a failure here is
  // never a reason to skip the check.
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
  let consecutiveErrors = 0;
  let iteration = 0;

  while (true) {
    let prText;
    try {
      prText = await fetchPullRequestText({ owner, repo, prNumber });
    } catch (error) {
      reportError(error, { context: 'ensure_sub_issues_fetch_pr', owner, repo, prNumber, operation: 'fetch_pr_body' });
      await log(`⚠️  ENSURE-SUB-ISSUES: Could not read the pull request description: ${cleanErrorMessage(error)}`, { level: 'warning' });
      break;
    }

    const { missing, total } = findMissingSubIssueReferences({ text: prText, subIssues, owner, repo });

    if (missing.length === 0) {
      if (iteration === 0) {
        await log(`✅ ENSURE-SUB-ISSUES: All ${total} sub-issue(s) are closed by the pull request description.`);
      } else {
        await log(`✅ ENSURE-SUB-ISSUES: All ${total} sub-issue(s) are closed by the pull request description after ${iteration} restart(s).`);
      }
      break;
    }

    if (iteration >= limit) {
      await log(`🛑 ENSURE-SUB-ISSUES: Reached the restart limit (${formatEnsureSubIssuesLimit(limit)}) with ${missing.length}/${total} sub-issue(s) still missing a closing reference.`);
      for (const subIssue of missing.slice(0, 20)) {
        await log(`   • #${subIssue.number}${subIssue.title ? ` — ${subIssue.title}` : ''}`);
      }
      await log('   Add these lines to the pull request description to close them on merge:');
      await log(buildMissingReferenceBlock(missing, { owner, repo }));
      break;
    }

    iteration++;
    await log('');
    await log(`🔁 ENSURE-SUB-ISSUES iteration ${iteration}/${formatEnsureSubIssuesLimit(limit)}: ${missing.length}/${total} sub-issue(s) missing a closing reference, restarting...`);
    for (const subIssue of missing.slice(0, 20)) {
      await log(`   • #${subIssue.number}${subIssue.title ? ` — ${subIssue.title}` : ''}`);
    }

    // Issue #1572 pattern: sync the local branch with remote before restarting.
    try {
      const pullResult = await $({ cwd: tempDir })`git pull origin ${branchName} 2>&1`;
      if (pullResult.code === 0) {
        await log(`   Synced local branch ${branchName} from remote`, { verbose: true });
      } else {
        await log(`   Warning: git pull failed (code ${pullResult.code}); continuing with local state`, { level: 'warning' });
      }
    } catch (error) {
      reportError(error, { context: 'ensure_sub_issues_git_pull', branchName, operation: 'git_pull' });
      await log(`   Warning: git pull error: ${cleanErrorMessage(error)}`, { level: 'warning' });
    }

    const feedbackLines = buildEnsureSubIssuesFeedback({ missing, total, iteration, limit, owner, repo, issueNumber });

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
        promptEnsureAllRequirementsAreMet: true,
        // Prevent recursion inside the restart iteration.
        ensureAllSubIssuesAddressed: 0,
        'ensure-all-sub-issues-addressed': 0,
      },
    });

    if (iterationResult) {
      if (iterationResult.sessionId) sessionId = iterationResult.sessionId;
      if (iterationResult.anthropicTotalCostUSD) anthropicTotalCostUSD = iterationResult.anthropicTotalCostUSD;
      if (iterationResult.publicPricingEstimate) publicPricingEstimate = iterationResult.publicPricingEstimate;
      if (iterationResult.pricingInfo) pricingInfo = iterationResult.pricingInfo;
    }

    if (isUsageLimitReached(iterationResult)) {
      await log('🛑 ENSURE-SUB-ISSUES: Usage limit reached during restart. Stopping.');
      break;
    }
    if (isApiError(iterationResult)) {
      consecutiveErrors++;
      await log(`⚠️  ENSURE-SUB-ISSUES: API error during restart (${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS} consecutive).`, { level: 'warning' });
      if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
        await log('🛑 ENSURE-SUB-ISSUES: Too many consecutive errors. Stopping.');
        break;
      }
    } else {
      consecutiveErrors = 0;
    }

    await log(`✅ ENSURE-SUB-ISSUES iteration ${iteration}/${formatEnsureSubIssuesLimit(limit)} complete`);
    await log('');
  }

  try {
    await cleanupClaudeFile?.(tempDir, branchName, null, argv);
  } catch (error) {
    reportError(error, { context: 'ensure_sub_issues_cleanup', branchName, operation: 'cleanup_claude_file' });
  }

  if (iteration === 0) return null;
  return { sessionId, anthropicTotalCostUSD, publicPricingEstimate, pricingInfo };
};

export default {
  DEFAULT_ENSURE_SUB_ISSUES_LIMIT,
  ENSURE_SUB_ISSUES_PROMPT,
  fetchSubIssues,
  fetchPullRequestText,
  findMissingSubIssueReferences,
  normalizeEnsureSubIssuesLimit,
  formatEnsureSubIssuesLimit,
  runEnsureAllSubIssuesAddressed,
};
