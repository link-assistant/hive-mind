#!/usr/bin/env node

/**
 * Helper functions for the auto-merge module.
 * Extracted from solve.auto-merge.lib.mjs to keep file sizes under the 1500-line limit.
 *
 * Contains:
 * - checkForExistingComment: Deduplication of PR status comments
 * - checkForNonBotComments: Detection of human feedback on PRs
 * - getMergeBlockers: Comprehensive CI/CD status analysis
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1190
 * @see https://github.com/link-assistant/hive-mind/issues/1593
 */

// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $: __rawDollar$ } = await use('command-stream');
const { wrapDollarWithGhRetry } = await import('./github-rate-limit.lib.mjs');
const $ = wrapDollarWithGhRetry(__rawDollar$);
// Import shared library functions
const lib = await import('./lib.mjs');
const { log, formatAligned } = lib;

// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

// Import GitHub merge functions
const githubMergeLib = await import('./github-merge.lib.mjs');
const { checkPRMergeable, checkForBillingLimitError, getDetailedCIStatus, getWorkflowRunsForSha, getWorkflowRunJobsCount, getActiveRepoWorkflows, getCommitDate, checkWorkflowsHavePRTriggers, checkPreviousPRCommitsHadCI, getActivePRWorkflowRuns } = githubMergeLib;

/**
 * Issue #1712: Plain-English meaning of GitHub Actions / check-run statuses, so the
 * verbose log explains itself instead of forcing the user to look up GitHub docs.
 * Returns the same status string suffixed with a parenthetical hint, e.g.
 * "in_progress (currently executing)". Unknown statuses are returned unchanged.
 */
const STATUS_HINTS = {
  in_progress: 'currently executing',
  queued: 'waiting for a runner',
  pending: 'waiting to start',
  waiting: 'blocked on a deployment / approval gate',
  requested: 'requested but not yet picked up',
  completed: 'finished',
};
const CONCLUSION_HINTS = {
  success: 'passed',
  failure: 'failed',
  cancelled: 'cancelled (will be re-triggered if applicable)',
  timed_out: 'timed out',
  skipped: 'skipped (e.g. paths-ignore matched)',
  neutral: 'neutral / informational',
  action_required: 'manual approval required',
  stale: 'stale — superseded by a newer run',
  startup_failure: 'workflow failed to start (likely invalid YAML)',
};
const explainStatus = (status, conclusion) => {
  const statusPart = status ? `${status}${STATUS_HINTS[status] ? ` (${STATUS_HINTS[status]})` : ''}` : 'unknown';
  if (!conclusion) return statusPart;
  const concPart = `${conclusion}${CONCLUSION_HINTS[conclusion] ? ` (${CONCLUSION_HINTS[conclusion]})` : ''}`;
  return `${statusPart} → ${concPart}`;
};
const formatRunLine = run => {
  const status = run.conclusion ? `${run.status}/${run.conclusion}` : run.status;
  return `${run.name} [${status}] — ${run.html_url}`;
};

// Issue #1625: Import centralized session-ending markers so the duplicate-
// search scope for checkForExistingComment() stays in lock-step with the
// markers actually embedded in tool-posted comments.
const toolComments = await import('./tool-comments.lib.mjs');
const { SESSION_ENDING_MARKERS, isToolGeneratedComment, isToolTrackedCommentId, trackToolCommentId } = toolComments;

const externalReviewLimitLib = await import('./external-review-limit.lib.mjs');
const { formatExternalReviewLimitCheck, splitExternalReviewLimitChecks } = externalReviewLimitLib;

/**
 * Issue #1323: Check if a comment with specific content already exists on the PR
 * This prevents duplicate status comments when multiple processes or restarts occur
 *
 * Issue #1584: Only search for duplicates AFTER the last session-ending comment.
 * Previously, this searched the entire PR comment history, which caused false positives
 * when a new working session was started after user feedback — the old "Ready to merge"
 * comment from a previous session would suppress the new one, even though a new session-ending
 * comment had been posted in between. By narrowing the search scope to only comments
 * after the most recent session-ending comment, each working session gets its own deduplication
 * window.
 *
 * Session-ending markers include:
 * - "Now working session is ended" — present in all log upload comments (Solution Draft Log,
 *   Auto-restart Log, Auto-restart-until-mergeable Log, Solution Draft Log (Resumed/Truncated))
 * - "AI Work Session Completed" — posted when logs are not attached to PR
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {string} commentSignature - Unique signature to search for in comment body (e.g., "✅ Ready to merge")
 * @param {boolean} verbose - Enable verbose logging
 * @param {Function} commandRunner - Tagged-template command runner, injectable for tests
 * @returns {Promise<boolean>} - True if a matching comment already exists
 */
export const checkForExistingComment = async (owner, repo, prNumber, commentSignature, verbose = false, commandRunner = $) => {
  try {
    // Fetch every PR comment page so long threads don't scope deduplication to
    // a stale first-page session-ending marker.
    const result = await commandRunner`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate --jq '[.[].body]' 2>/dev/null`;
    if (result.code === 0 && result.stdout) {
      const rawOutput = result.stdout.toString().trim();
      if (!rawOutput) return false;

      let commentBodies;
      try {
        commentBodies = JSON.parse(rawOutput);
      } catch {
        // Fallback: if JSON parsing fails, fall back to simple string search
        if (verbose) {
          console.log('[VERBOSE] Failed to parse comment bodies as JSON, falling back to full-history search');
        }
        return rawOutput.includes(commentSignature);
      }

      if (!Array.isArray(commentBodies) || commentBodies.length === 0) return false;

      // Issue #1584: Find the index of the last session-ending comment.
      // Only search for the signature in comments AFTER that index.
      // Session-ending markers indicate the end of a working session,
      // so any "Ready to merge" before it belongs to a previous session.
      //
      // Issue #1625: Session-ending markers are now imported from
      // tool-comments.lib.mjs (single source of truth for all markers).
      let searchStartIndex = 0;
      for (let i = commentBodies.length - 1; i >= 0; i--) {
        if (commentBodies[i] && SESSION_ENDING_MARKERS.some(marker => commentBodies[i].includes(marker))) {
          searchStartIndex = i + 1;
          if (verbose) {
            console.log(`[VERBOSE] Found last session-ending comment at index ${i}, searching from index ${searchStartIndex}`);
          }
          break;
        }
      }

      // Search only in comments after the last session-ending comment
      for (let i = searchStartIndex; i < commentBodies.length; i++) {
        if (commentBodies[i] && commentBodies[i].includes(commentSignature)) {
          if (verbose) {
            console.log(`[VERBOSE] Found existing comment with signature: "${commentSignature}" at index ${i} (after last session-ending comment)`);
          }
          return true;
        }
      }

      if (verbose && searchStartIndex > 0) {
        console.log(`[VERBOSE] No matching comment found after last session-ending comment (searched ${commentBodies.length - searchStartIndex} comments)`);
      }
    }
  } catch (error) {
    // If check fails, allow posting to avoid silent failures
    if (verbose) {
      console.log(`[VERBOSE] Failed to check for existing comment: ${error.message}`);
    }
  }
  return false;
};

/**
 * Check for new comments from non-bot users since last commit
 *
 * Same-account comments are only considered feedback when
 * `trustAuthenticatedUserComments` is true. Keep the default false for callers
 * that may run while an AI tool is still active: those tools can post through
 * the authenticated GitHub account.
 *
 * @param {Function} commandRunner - Tagged-template command runner, injectable for tests
 * @param {Object} options - Comment classification options
 * @param {boolean} options.trustAuthenticatedUserComments - True only when the caller knows the AI tool is not running
 * @returns {Promise<{hasNewComments: boolean, comments: Array}>}
 */
export const checkForNonBotComments = async (owner, repo, prNumber, issueNumber, lastCheckTime, verbose = false, commandRunner = $, options = {}) => {
  try {
    const { trustAuthenticatedUserComments = false } = options;

    // Get current GitHub user to identify which comments are from the bot/hive-mind
    let currentUser = null;
    try {
      const userResult = await commandRunner`gh api user --jq .login`;
      if (userResult.code === 0) {
        currentUser = userResult.stdout.toString().trim();
      }
    } catch {
      // If we can't get the current user, continue without filtering
    }

    // Common bot usernames and patterns to filter out.
    // Issue #1821: In same-account operation, humans and AI tools can both
    // post through the authenticated account. The safe default treats that
    // account as tool-owned; auto-restart-until-mergeable opts in to trusting
    // same-account comments only while no AI tool execution is active, and
    // still filters tool-generated comments by tracked IDs and marker strings.
    // Note: Patterns use word boundaries or end-of-string to avoid false positives
    // (e.g., "claudeuser" should NOT match as a bot)
    const botPatterns = [
      /\[bot\]$/i, // Any username ending with [bot]
      /^github-actions$/i, // GitHub Actions
      /^dependabot$/i, // Dependabot
      /^renovate$/i, // Renovate
      /^codecov$/i, // Codecov
      /^netlify$/i, // Netlify
      /^vercel$/i, // Vercel
      /^hive-?mind$/i, // Hive Mind (with or without hyphen)
      /^claude$/i, // Claude (exact match only)
      /^copilot$/i, // GitHub Copilot
    ];

    const isBot = login => {
      if (!login) return false;
      // Check against known bot patterns
      return botPatterns.some(pattern => pattern.test(login));
    };

    const isToolComment = comment => isToolTrackedCommentId(comment.id) || isToolGeneratedComment(comment.body);

    // Fetch PR conversation comments
    const prCommentsResult = await commandRunner`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate`;
    let prComments = [];
    if (prCommentsResult.code === 0 && prCommentsResult.stdout) {
      prComments = JSON.parse(prCommentsResult.stdout.toString() || '[]');
    }

    // Fetch PR review comments (inline code comments)
    const prReviewCommentsResult = await commandRunner`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`;
    let prReviewComments = [];
    if (prReviewCommentsResult.code === 0 && prReviewCommentsResult.stdout) {
      prReviewComments = JSON.parse(prReviewCommentsResult.stdout.toString() || '[]');
    }

    // Fetch issue comments if we have an issue number
    let issueComments = [];
    if (issueNumber && issueNumber !== prNumber) {
      const issueCommentsResult = await commandRunner`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments --paginate`;
      if (issueCommentsResult.code === 0 && issueCommentsResult.stdout) {
        issueComments = JSON.parse(issueCommentsResult.stdout.toString() || '[]');
      }
    }

    // Combine all comments
    const allComments = [...prComments, ...prReviewComments, ...issueComments];

    // Filter for new comments from non-bot users. Automated hive-mind/tool
    // comments are excluded by marker/ID, including comments posted by the
    // authenticated user during the current or a previous process.
    const newNonBotComments = allComments.filter(comment => {
      const commentTime = new Date(comment.created_at);
      const isAfterLastCheck = commentTime > lastCheckTime;
      const login = comment.user?.login;
      const isFromAuthenticatedUser = Boolean(currentUser && login === currentUser);
      const isFromTool = isToolComment(comment);
      const isFromAuthenticatedUserToolContext = isFromAuthenticatedUser && !trustAuthenticatedUserComments;
      const isFromBot = isBot(login) || isFromAuthenticatedUserToolContext;
      const isFromNonBot = !isFromBot && !isFromTool;

      if (verbose && isAfterLastCheck && isFromTool) {
        console.log(`[VERBOSE] Skipping tool-generated comment from ${login} at ${comment.created_at}`);
      } else if (verbose && isAfterLastCheck && isFromAuthenticatedUserToolContext) {
        console.log(`[VERBOSE] Skipping authenticated-user comment from ${login} at ${comment.created_at} because same-account feedback is not trusted in this context`);
      } else if (verbose && isAfterLastCheck && isFromBot) {
        console.log(`[VERBOSE] Skipping bot comment from ${login} at ${comment.created_at}`);
      } else if (verbose && isAfterLastCheck && isFromNonBot) {
        const sameAccountSuffix = currentUser && login === currentUser ? ' (authenticated user)' : '';
        console.log(`[VERBOSE] New non-bot comment from ${login}${sameAccountSuffix} at ${comment.created_at}`);
      }

      return isAfterLastCheck && isFromNonBot;
    });

    return {
      hasNewComments: newNonBotComments.length > 0,
      comments: newNonBotComments,
    };
  } catch (error) {
    reportError(error, {
      context: 'check_non_bot_comments',
      owner,
      repo,
      prNumber,
      operation: 'fetch_comments',
    });
    return { hasNewComments: false, comments: [] };
  }
};

/**
 * Issue #1827: Compute the next monotonic check-window cutoff for the
 * auto-restart-until-mergeable loop. The cutoff must never move backwards:
 * after an AI session, lastCheckTime is set to a moment *after* the agent's own
 * comments, so rewinding it to the iteration's start time (captured before the
 * AI ran) would re-detect those comments as new feedback — the root cause of
 * the restart loop in #1827. Returns whichever timestamp is later.
 *
 * @param {Date} lastCheckTime - current cutoff
 * @param {Date} candidate - proposed new cutoff (usually the iteration start time)
 * @returns {Date} the later of the two timestamps
 */
export const nextMonotonicCheckTime = (lastCheckTime, candidate) => {
  if (!(lastCheckTime instanceof Date)) return candidate;
  if (!(candidate instanceof Date)) return lastCheckTime;
  return candidate.getTime() > lastCheckTime.getTime() ? candidate : lastCheckTime;
};

/**
 * Issue #1827: Register every comment authored by the authenticated GitHub
 * account during an AI working session as a tool-generated comment.
 *
 * During a session, the AI agent can post free-form status comments through the
 * authenticated account (e.g. "✅ CI now green", "✅ Verification pass"). These
 * are NOT routed through postTrackedComment(), so their IDs were never captured,
 * and they match none of the tool markers. Once issue #1821 made the watch loop
 * trust same-account comments as human feedback, the very next iteration
 * re-detected these comments as fresh feedback and triggered an endless
 * auto-restart loop until the limit was hit.
 *
 * Because the authenticated account is busy running the AI for the whole
 * session window, any comment it authored within that window is the tool's own,
 * not human feedback. Tracking those IDs makes checkForNonBotComments filter
 * them by ID regardless of timestamps — a defense that also survives clock skew
 * between the local clock and GitHub's `created_at` (which a purely
 * time-based cutoff cannot).
 *
 * @param {string} owner - Repository owner
 * @param {string} repo - Repository name
 * @param {number} prNumber - Pull request number
 * @param {number} issueNumber - Issue number (may equal prNumber)
 * @param {Date|string|number} sinceTime - Start of the session window
 * @param {Function} commandRunner - Tagged-template command runner, injectable for tests
 * @param {Object} options
 * @param {boolean} [options.verbose=false]
 * @param {string} [options.currentUser] - Pre-resolved authenticated login (skips the `gh api user` call)
 * @returns {Promise<string[]>} Newly tracked comment IDs (as strings)
 */
export const trackAuthenticatedUserCommentsSince = async (owner, repo, prNumber, issueNumber, sinceTime, commandRunner = $, options = {}) => {
  const { verbose = false, currentUser: providedUser } = options;
  const trackedIds = [];

  try {
    let currentUser = providedUser || null;
    if (!currentUser) {
      try {
        const userResult = await commandRunner`gh api user --jq .login`;
        if (userResult.code === 0) {
          currentUser = userResult.stdout.toString().trim();
        }
      } catch {
        // Without the authenticated login we cannot attribute comments; bail out.
      }
    }
    if (!currentUser) return trackedIds;

    const since = sinceTime instanceof Date ? sinceTime : new Date(sinceTime);

    const fetchComments = async path => {
      try {
        const result = await commandRunner`gh api ${path} --paginate`;
        if (result.code === 0 && result.stdout) {
          return JSON.parse(result.stdout.toString() || '[]');
        }
      } catch {
        // Ignore fetch/parse failures for an individual endpoint.
      }
      return [];
    };

    const prComments = await fetchComments(`repos/${owner}/${repo}/issues/${prNumber}/comments`);
    const prReviewComments = await fetchComments(`repos/${owner}/${repo}/pulls/${prNumber}/comments`);
    let issueComments = [];
    if (issueNumber && issueNumber !== prNumber) {
      issueComments = await fetchComments(`repos/${owner}/${repo}/issues/${issueNumber}/comments`);
    }

    const allComments = [...prComments, ...prReviewComments, ...issueComments];
    for (const comment of allComments) {
      const login = comment.user?.login;
      if (!login || login !== currentUser) continue;
      // Inclusive lower bound: a comment posted at the exact session start is
      // still the tool's own. created_at uses GitHub's clock, so allow equality.
      const createdAt = new Date(comment.created_at);
      if (createdAt < since) continue;
      if (isToolTrackedCommentId(comment.id)) continue;
      trackToolCommentId(comment.id);
      trackedIds.push(String(comment.id));
      if (verbose) {
        console.log(`[VERBOSE] Tracking authenticated-user session comment ${comment.id} from ${login} at ${comment.created_at}`);
      }
    }
  } catch (error) {
    reportError(error, {
      context: 'track_authenticated_user_comments',
      owner,
      repo,
      prNumber,
      operation: 'track_session_comments',
    });
  }

  return trackedIds;
};

/**
 * Get the reasons why PR is not mergeable
 * Issue #1314: Comprehensive CI/CD status handling covering all possible states:
 * - success: All CI passed → no blocker
 * - failure: Genuine code failures → restart AI
 * - cancelled: Manually cancelled or workflow cancelled → re-trigger, don't restart AI
 * - pending/queued: Still running or waiting for runner → wait, don't restart AI
 * - billing_limit: Billing/spending limit reached → stop (private) or wait (public)
 * - no_checks: No CI checks yet (race condition) → wait
 */
export const getMergeBlockers = async (owner, repo, prNumber, verbose = false, checkCount = 1, prBranchRef = null) => {
  const blockers = [];

  // Use detailed CI status to distinguish between all possible states
  const ciStatus = await getDetailedCIStatus(owner, repo, prNumber, verbose);

  if (ciStatus.status === 'no_checks') {
    // No CI checks exist yet - this could be:
    // 1. A race condition after push (checks haven't started yet) - wait
    // 2. A repository with no CI/CD configured at all - should be mergeable immediately
    // 3. CI workflows exist but were not triggered for this commit (fork PR, paths-ignore, etc.)
    //
    // Issue #1345: Distinguish by checking the PR's mergeability status.
    // If GitHub says the PR is MERGEABLE (mergeStateStatus === 'CLEAN'),
    // then no CI is required and we should not block indefinitely.
    // Otherwise (e.g. mergeStateStatus === 'BLOCKED'), treat as pending race condition.
    const earlyMergeStatus = await checkPRMergeable(owner, repo, prNumber, verbose);
    if (earlyMergeStatus.mergeable) {
      // Issue #1363: Before concluding "no CI configured", verify the repo actually
      // has no active GitHub Actions workflows. If workflows exist but no checks have
      // started yet, this is a race condition (GitHub takes ~10-30s to register checks
      // after a push), NOT a "no CI configured" situation.
      //
      // This fixes a false positive where a repo with CI workflows but WITHOUT branch
      // protection (required status checks) would be declared "no CI configured" because:
      // - mergeStateStatus=CLEAN (no required checks to block it)
      // - check_runs=[] (CI hasn't started yet — race condition)
      const repoWorkflows = await getActiveRepoWorkflows(owner, repo, verbose);
      if (repoWorkflows.hasWorkflows) {
        // Repo HAS workflows — but were they triggered for this commit?
        // Issue #1442: Use the GitHub Actions workflow runs API to definitively check
        // if any workflow runs were triggered for this PR's HEAD SHA. This avoids
        // the need for timeout-based detection:
        //   - workflow_runs.length > 0 → genuine race condition (CI started, check-runs not yet registered)
        //   - workflow_runs.length === 0 → CI was NOT triggered (fork PR, paths-ignore, etc.)
        const workflowRuns = await getWorkflowRunsForSha(owner, repo, ciStatus.sha, verbose);
        if (workflowRuns.length > 0) {
          // Issue #1466: Check if ALL workflow runs are completed without producing check-runs.
          // This happens when workflows require manual approval (first-time fork contributors,
          // deployment approvals) — they complete with conclusion=action_required but never
          // create check-runs. Waiting for check-runs in this case is an infinite loop.
          //
          // Also covers other non-executing conclusions: cancelled, stale workflows that
          // completed without producing check-runs won't produce them in the future either.
          const allRunsCompleted = workflowRuns.every(r => r.status === 'completed');
          const allRunsNonExecuting = allRunsCompleted && workflowRuns.every(r => r.conclusion === 'action_required' || r.conclusion === 'cancelled' || r.conclusion === 'stale' || r.conclusion === 'skipped');

          if (allRunsNonExecuting) {
            // All workflow runs completed without executing jobs — check-runs will never appear.
            // Treat the same as "CI not triggered" to avoid infinite waiting.
            const conclusions = [...new Set(workflowRuns.map(r => r.conclusion))].join(', ');
            if (verbose) {
              await log(`[VERBOSE] /merge: PR #${prNumber} has ${workflowRuns.length} workflow run(s) for SHA ${ciStatus.sha.substring(0, 7)}, but all completed without executing (conclusions: ${conclusions}) — check-runs will never appear`);
            }
            await log(formatAligned('ℹ️', 'CI workflows completed without executing:', `${conclusions} (${workflowRuns.map(r => r.name).join(', ')})`, 2));
            return { blockers, ciStatus, noCiConfigured: false, noCiTriggered: true, workflowRunConclusions: conclusions };
          }

          // Issue #1690: Detect invalid workflow files (e.g. YAML/expression errors).
          // When a workflow file fails to parse, GitHub creates a workflow_run with
          // status=completed and conclusion=failure (or startup_failure / timed_out)
          // but NEVER instantiates any jobs. Such runs will never produce check-runs,
          // so the auto-merge loop would otherwise wait forever for "the genuine race
          // condition" to resolve.
          //
          // Distinguish by querying the jobs API: real failures have jobs > 0 (and the
          // failed jobs would already be visible as check-runs); invalid workflow files
          // have jobs === 0. We only check failed/timed-out completed runs to keep the
          // additional API calls bounded.
          const failedCompletedRuns = workflowRuns.filter(r => r.status === 'completed' && (r.conclusion === 'failure' || r.conclusion === 'startup_failure' || r.conclusion === 'timed_out'));
          if (failedCompletedRuns.length > 0) {
            const invalidWorkflowRuns = [];
            for (const run of failedCompletedRuns) {
              const jobsCount = await getWorkflowRunJobsCount(owner, repo, run.id, verbose);
              if (jobsCount === 0) {
                invalidWorkflowRuns.push(run);
              }
            }
            if (invalidWorkflowRuns.length > 0) {
              // Treat as a real CI failure so the auto-restart loop restarts the AI
              // and propagates the error back instead of waiting forever.
              if (verbose) {
                await log(`[VERBOSE] /merge: PR #${prNumber} has ${invalidWorkflowRuns.length} workflow run(s) that completed with no jobs — workflow files likely invalid`);
                for (const run of invalidWorkflowRuns) {
                  await log(`[VERBOSE] /merge:   - ${run.name} (${run.id}): conclusion=${run.conclusion}, jobs=0, url=${run.html_url}`);
                }
              }
              const failureLabels = invalidWorkflowRuns.map(r => `${r.path || r.name} (${r.conclusion})`);
              await log(formatAligned('❌', 'Invalid workflow file(s):', failureLabels.join(', '), 2));
              blockers.push({
                type: 'ci_failure',
                message: 'CI/CD workflow file is invalid — no jobs were instantiated',
                details: invalidWorkflowRuns.map(r => `${r.path || r.name} — see ${r.html_url}`),
              });
              // Continue to the mergeability check below so other blockers are surfaced too.
              const mergeStatus = await checkPRMergeable(owner, repo, prNumber, verbose);
              if (!mergeStatus.mergeable) {
                blockers.push({
                  type: 'not_mergeable',
                  message: mergeStatus.reason || 'PR is not mergeable',
                  details: [],
                });
              }
              return { blockers, ciStatus, noCiConfigured: false, noCiTriggered: false };
            }
          }

          // Some workflow runs are still in progress or produced results — genuine race condition
          // Issue #1712: User-facing blocker `details` carry the run URL + status so the
          // top-level "⏳ Waiting for CI:" line is self-explanatory. Verbose listing is
          // produced by `getWorkflowRunsForSha(..., verbose=true)` above — do NOT print the
          // same run list twice. Here we only emit the one-line summary that explains
          // *why* we're still waiting (race vs. real run).
          const commitUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}/commits/${ciStatus.sha}`;
          if (verbose) {
            await log(`[VERBOSE] /merge: ${workflowRuns.length} workflow run(s) registered for PR #${prNumber} HEAD ${commitUrl} — waiting for them to publish check-runs (race condition between workflow_run and check_runs APIs, typically ~30–120 s)`);
          }

          // Also surface any active workflow runs on OLDER PR commits, so the user's view of
          // the GitHub Actions tab (which shows yellow dots for every commit) reconciles
          // with the log. These are NOT blockers — GitHub's concurrency group cancels them
          // when a new commit is pushed — but listing them stops the user from worrying that
          // the watcher is missing them.
          const activeAcrossCommits = await getActivePRWorkflowRuns(owner, repo, prNumber, ciStatus.sha, verbose, getWorkflowRunsForSha);
          if (verbose && activeAcrossCommits.otherActive > 0) {
            await log(`[VERBOSE] /merge: ${activeAcrossCommits.otherActive} additional active workflow run(s) on older commits of PR #${prNumber} (these are not blockers — GitHub's concurrency group will cancel them):`);
            for (const group of activeAcrossCommits.groups) {
              if (group.isHead) continue;
              const olderCommitUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}/commits/${group.sha}`;
              await log(`[VERBOSE] /merge:   on ${olderCommitUrl}:`);
              for (const run of group.runs) {
                await log(`[VERBOSE] /merge:     - ${formatRunLine(run)} — ${explainStatus(run.status, run.conclusion)}`);
              }
            }
          }

          blockers.push({
            type: 'ci_pending',
            message: `Waiting for ${workflowRuns.length} workflow run(s) on HEAD ${commitUrl} to publish check-runs`,
            details: workflowRuns.map(formatRunLine),
          });
        } else {
          // No workflow runs for this SHA — but this could be a race condition!
          // Issue #1480: GitHub Actions workflow runs take 30-120 seconds to appear in the
          // API after a push. The previous fix (issue #1442) assumed 0 workflow runs meant
          // "CI definitively NOT triggered", but this caused false positive "Ready to merge"
          // when checked too soon after a push.
          //
          // Multi-layer defense (Issue #1480 enhanced):
          // Layer 1: Grace period — check commit age
          // Layer 2: Workflow file parsing — check .github/workflows for PR triggers
          // Layer 3: Previous commit CI history — check if earlier PR commits had CI runs
          const WORKFLOW_RUN_GRACE_PERIOD_SECONDS = 120; // 2 minutes — generous to cover slow GitHub API registration
          const commitInfo = await getCommitDate(owner, repo, ciStatus.sha, verbose);

          // Issue #1480: Parse workflow files for PR triggers (used in both grace period and post-grace checks)
          const prTriggers = await checkWorkflowsHavePRTriggers(owner, repo, verbose, prBranchRef);

          // Issue #1480: If .github/workflows folder doesn't exist or has no workflow files,
          // that's a definitive signal — no CI/CD will execute, skip grace period entirely
          if (!prTriggers.hasWorkflowFiles) {
            if (verbose) {
              await log(`[VERBOSE] /merge: PR #${prNumber} repo has no workflow files in .github/workflows/ — CI definitively not configured at file level`);
            }
            return { blockers, ciStatus, noCiConfigured: false, noCiTriggered: true };
          }

          if (prTriggers.hasPRTriggers) {
            // Issue #1480 (enhanced): Workflows have PR/push triggers but no runs yet.
            // This is almost certainly a race condition — GitHub takes 30-120s to register
            // workflow runs after a push. We MUST wait regardless of commit age, because
            // commit date reflects authoring time, NOT push time.
            //
            // The commit may have been authored hours ago but pushed just now (rebased branches,
            // amended commits, cherry-picks). Using commit age as a proxy for push age caused
            // false positives in Case 1 of Issue #1480.
            //
            // Safety valve: after MAX_NO_RUNS_CHECKS consecutive checks (typically 5 × 60s = 5 min),
            // conclude CI was not triggered. This handles cases like paths-ignore excluding all
            // changed files, conditional workflows that don't match, etc.
            const MAX_NO_RUNS_CHECKS = 5;
            if (checkCount >= MAX_NO_RUNS_CHECKS) {
              // Issue #1503 (enhanced): Before concluding CI was not triggered, check if
              // previous commits in this PR had CI runs. If they did, CI should be expected
              // for the current commit too — extend waiting with a higher threshold.
              const MAX_NO_RUNS_CHECKS_WITH_CI_HISTORY = 10;
              if (checkCount < MAX_NO_RUNS_CHECKS_WITH_CI_HISTORY) {
                const previousCI = await checkPreviousPRCommitsHadCI(owner, repo, prNumber, ciStatus.sha, verbose);
                if (previousCI.hadPreviousCI) {
                  // Previous commits had CI — this commit should too, keep waiting
                  await log(formatAligned('⚠️', 'CI history signal:', `${previousCI.previousCommitsWithCI} previous commit(s) had CI runs — extending wait (check ${checkCount}/${MAX_NO_RUNS_CHECKS_WITH_CI_HISTORY})`, 2));
                  blockers.push({
                    type: 'ci_pending',
                    message: `CI/CD workflow runs have not appeared yet — previous commits had CI runs, extending wait (check ${checkCount}/${MAX_NO_RUNS_CHECKS_WITH_CI_HISTORY})`,
                    details: prTriggers.workflows.map(w => w.name),
                  });
                  return { blockers, ciStatus, noCiConfigured: false, noCiTriggered: false };
                }
              }
              // We've waited long enough (and no CI history signal) — CI was genuinely not triggered
              if (verbose) {
                await log(formatAligned('ℹ️', 'CI not triggered:', `No workflow runs after ${checkCount} consecutive checks — concluding CI was not triggered`, 2));
              }
              return { blockers, ciStatus, noCiConfigured: false, noCiTriggered: true };
            }

            if (verbose) {
              await log(formatAligned('⏳', 'Waiting for CI:', `No workflow runs for SHA ${ciStatus.sha.substring(0, 7)}, but workflows have PR/push triggers (${prTriggers.workflows.map(w => w.name).join(', ')}) — check ${checkCount}/${MAX_NO_RUNS_CHECKS}, commit age: ${commitInfo.ageSeconds ?? 'unknown'}s`, 2));
            }
            blockers.push({
              type: 'ci_pending',
              message: `CI/CD workflow runs have not appeared yet — workflows have PR/push triggers (${prTriggers.workflows.map(w => w.name).join(', ')}), waiting for GitHub to register workflow runs (check ${checkCount}/${MAX_NO_RUNS_CHECKS})`,
              details: prTriggers.workflows.map(w => w.name),
            });
          } else if (commitInfo.ageSeconds !== null && commitInfo.ageSeconds < WORKFLOW_RUN_GRACE_PERIOD_SECONDS) {
            // No PR triggers found in workflow files, but commit is still recent — be safe and wait
            if (verbose) {
              await log(`[VERBOSE] /merge: No PR/push triggers found in workflow files, but commit is only ${commitInfo.ageSeconds}s old — waiting to be safe`);
            }
            blockers.push({
              type: 'ci_pending',
              message: `CI/CD workflow runs have not appeared yet — commit is ${commitInfo.ageSeconds}s old, waiting for GitHub to register workflow runs (grace period: ${WORKFLOW_RUN_GRACE_PERIOD_SECONDS}s)`,
              details: [],
            });
          } else {
            // No PR triggers AND commit is old enough — CI was definitively NOT triggered
            // Issue #1442: Fork PRs needing maintainer approval, paths-ignore filtering,
            // workflow conditions not matching, etc. all result in zero workflow runs.
            if (verbose) {
              await log(`[VERBOSE] /merge: PR #${prNumber} has no CI checks and no workflow runs for SHA ${ciStatus.sha.substring(0, 7)} (commit age: ${commitInfo.ageSeconds ?? 'unknown'}s, no PR/push triggers in workflow files) — CI was not triggered`);
            }
            return { blockers, ciStatus, noCiConfigured: false, noCiTriggered: true };
          }
        }
      } else {
        // Repo has NO workflows — this is truly "no CI configured"
        // PR is already mergeable with no CI checks configured.
        // Do NOT add a ci_pending blocker. The mergeability check below will also
        // confirm this is mergeable, so blockers will be empty → PR IS MERGEABLE path.
        if (verbose) {
          await log(`[VERBOSE] /merge: PR #${prNumber} has no CI checks and repo has no active workflows - no CI/CD configured`);
        }
        // Return early with no CI blocker, mergeability already confirmed
        return { blockers, ciStatus, noCiConfigured: true };
      }
    } else {
      // PR is not yet mergeable despite no checks - treat as pending race condition
      blockers.push({
        type: 'ci_pending',
        message: 'CI/CD checks have not started yet (waiting for checks to appear)',
        details: [],
      });
    }
  } else if (ciStatus.status === 'success') {
    // Issue #1480: Cross-validate "success" with workflow runs API.
    // A fast external check (e.g., CodeFactor) can register and pass before the main CI
    // pipeline starts, causing getDetailedCIStatus to return 'success' prematurely.
    // We must verify that all expected workflow runs have actually completed.
    const workflowRuns = await getWorkflowRunsForSha(owner, repo, ciStatus.sha, verbose);

    if (workflowRuns.length > 0) {
      // Workflow runs exist — check if any are still running
      const incompleteRuns = workflowRuns.filter(r => r.status !== 'completed');
      if (incompleteRuns.length > 0) {
        // Some workflow runs are still in progress — more check-runs may appear
        if (verbose) {
          await log(`[VERBOSE] /merge: PR #${prNumber} CI status is 'success' (${ciStatus.passedChecks.length} checks passed), but ${incompleteRuns.length} workflow run(s) still in progress — waiting for completion`);
        }
        blockers.push({
          type: 'ci_pending',
          message: `CI checks show success (${ciStatus.passedChecks.length} passed) but ${incompleteRuns.length} workflow run(s) still in progress — waiting for all to complete`,
          details: incompleteRuns.map(r => r.name),
        });
      }
      // All workflow runs completed — the check-runs we see are the final set, trust the 'success' status
    } else {
      // No workflow runs for this SHA — the passed checks are from external services only
      // (e.g., CodeFactor, Codecov). Check if the repo has workflows that should produce runs.
      const repoWorkflows = await getActiveRepoWorkflows(owner, repo, verbose);
      if (repoWorkflows.hasWorkflows) {
        const prTriggers = await checkWorkflowsHavePRTriggers(owner, repo, verbose, prBranchRef);
        if (prTriggers.hasPRTriggers) {
          // Repo has workflows with PR triggers but no runs yet — CI hasn't started
          // This is the exact scenario from Case 2 of Issue #1480
          //
          // Safety valve: after MAX_NO_RUNS_CHECKS consecutive checks, trust the external checks
          const MAX_NO_RUNS_CHECKS = 5;
          if (checkCount >= MAX_NO_RUNS_CHECKS) {
            if (verbose) {
              await log(`[VERBOSE] /merge: PR #${prNumber} CI 'success' with ${ciStatus.passedChecks.length} external checks, no workflow runs after ${checkCount} checks — trusting external checks`);
            }
            // Fall through — trust the success status from external checks
          } else {
            if (verbose) {
              await log(`[VERBOSE] /merge: PR #${prNumber} CI status is 'success' (${ciStatus.passedChecks.length} external checks), but repo has PR-triggered workflows with 0 workflow runs — likely race condition (check ${checkCount}/${MAX_NO_RUNS_CHECKS})`);
            }
            // Wait for GitHub Actions to register workflow runs
            blockers.push({
              type: 'ci_pending',
              message: `CI shows ${ciStatus.passedChecks.length} passed check(s) from external services, but repo has PR-triggered workflows that haven't started yet — waiting for GitHub Actions to register (check ${checkCount}/${MAX_NO_RUNS_CHECKS})`,
              details: prTriggers.workflows.map(w => w.name),
            });
          }
        }
      }
      // No repo workflows → external checks are the only CI, trust the 'success' status
    }
  } else if (ciStatus.status === 'pending') {
    // CI is still running or queued - wait for completion
    const pendingChecks = [...ciStatus.pendingChecks, ...ciStatus.queuedChecks];
    const pendingDetails = pendingChecks.map(c => {
      const statusPart = c.status ? ` [${c.status}]` : '';
      const urlPart = c.html_url ? ` — ${c.html_url}` : '';
      return `${c.name}${statusPart}${urlPart}`;
    });
    if (verbose) {
      // Issue #1712: One concise line + a per-check entry that includes a plain-English
      // explanation of the status. We do NOT also call getWorkflowRunsForSha here — the
      // detailed CI status already covers the same data via check-runs.
      const commitUrl = `https://github.com/${owner}/${repo}/pull/${prNumber}/commits/${ciStatus.sha}`;
      await log(`[VERBOSE] /merge: ${pendingChecks.length} check-run(s) still running/queued on PR #${prNumber} HEAD ${commitUrl}:`);
      for (const c of pendingChecks) {
        const url = c.html_url ? ` — ${c.html_url}` : '';
        await log(`[VERBOSE] /merge:   - ${c.name}: ${explainStatus(c.status, c.conclusion)}${url}`);
      }
    }
    blockers.push({
      type: 'ci_pending',
      message: 'CI/CD checks are still running or queued',
      details: pendingDetails,
    });
  } else if (ciStatus.status === 'cancelled') {
    // All non-passed checks are cancelled or stale (no genuine failures)
    // First check if this is actually a billing limit issue (billing-limited jobs may appear as cancelled)
    const billingCheck = await checkForBillingLimitError(owner, repo, prNumber, verbose);
    if (billingCheck.isBillingLimitError) {
      blockers.push({
        type: 'billing_limit',
        message: 'GitHub Actions billing/spending limit reached',
        details: billingCheck.affectedJobs,
        allJobsAffected: billingCheck.allJobsAffected,
        billingMessage: billingCheck.message,
      });
    } else {
      // These need to be re-triggered, NOT treated as AI-fixable failures
      const cancelledOrStaleChecks = [...ciStatus.cancelledChecks, ...(ciStatus.staleChecks || [])];
      const cancelledDetails = cancelledOrStaleChecks.map(c => {
        const concPart = c.conclusion ? ` [${c.conclusion}]` : '';
        const urlPart = c.html_url ? ` — ${c.html_url}` : '';
        return `${c.name}${concPart}${urlPart}`;
      });
      blockers.push({
        type: 'ci_cancelled',
        message: 'CI/CD checks were cancelled or became stale',
        details: cancelledDetails,
        sha: ciStatus.sha,
      });
    }
  } else if (ciStatus.status === 'failure') {
    // Some checks genuinely failed - check if it's billing limits first
    const billingCheck = await checkForBillingLimitError(owner, repo, prNumber, verbose);

    if (billingCheck.isBillingLimitError) {
      blockers.push({
        type: 'billing_limit',
        message: 'GitHub Actions billing/spending limit reached',
        details: billingCheck.affectedJobs,
        allJobsAffected: billingCheck.allJobsAffected,
        billingMessage: billingCheck.message,
      });
    } else {
      // Check if there are also cancelled/stale checks alongside failures
      const cancelledOrStaleChecks = [...(ciStatus.hasCancelled ? ciStatus.cancelledChecks : []), ...((ciStatus.hasStale && ciStatus.staleChecks) || [])];
      if (cancelledOrStaleChecks.length > 0) {
        blockers.push({
          type: 'ci_cancelled',
          message: 'Some CI/CD checks were cancelled or became stale (will be re-triggered)',
          details: cancelledOrStaleChecks.map(c => c.name),
          sha: ciStatus.sha,
        });
      }
      const { limitedChecks, actionableFailedChecks } = splitExternalReviewLimitChecks(ciStatus.failedChecks);
      if (limitedChecks.length > 0) {
        blockers.push({
          type: 'external_review_limit',
          message: 'External review check was not executed because credits/rate limits are exhausted',
          details: limitedChecks.map(formatExternalReviewLimitCheck),
          checks: limitedChecks,
        });
      }
      if (actionableFailedChecks.length > 0) {
        blockers.push({
          type: 'ci_failure',
          message: 'CI/CD checks are failing',
          details: actionableFailedChecks.map(c => c.name),
        });
      }
    }
  } else if (ciStatus.status === 'unknown') {
    // Unable to determine CI status - treat as pending to be safe
    // Do NOT treat as mergeable (which would be incorrect)
    blockers.push({
      type: 'ci_pending',
      message: 'CI/CD status could not be determined (will retry)',
      details: [],
    });
  }

  // Check mergeability
  const mergeStatus = await checkPRMergeable(owner, repo, prNumber, verbose);
  if (!mergeStatus.mergeable) {
    blockers.push({
      type: 'not_mergeable',
      message: mergeStatus.reason || 'PR is not mergeable',
      details: [],
    });
  }

  return { blockers, ciStatus, noCiConfigured: false, noCiTriggered: false };
};

export default {
  checkForExistingComment,
  checkForNonBotComments,
  getMergeBlockers,
};
