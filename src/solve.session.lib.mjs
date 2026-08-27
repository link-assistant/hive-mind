/**
 * Work session management functionality for solve.mjs
 * Handles starting and ending work sessions, PR status changes, and session comments
 */

// Issue #1625: Use the single source of truth for session-comment marker
// strings. Building comment bodies via these constants guarantees the filter
// in checkForAiCreatedComments() always matches what we actually posted.
import { AI_WORK_SESSION_STARTED_MARKER, AI_WORK_SESSION_COMPLETED_MARKER, AI_WORK_SESSION_RESUMED_MARKER, AUTO_RESUME_ON_LIMIT_RESET_MARKER, AUTO_RESTART_ON_LIMIT_RESET_MARKER, postTrackedComment } from './tool-comments.lib.mjs';

import { wrapDollarWithGhRetry as _wrapDollarWithGhRetry } from './github-rate-limit.lib.mjs'; // rate-limit marker (#1726): gh API calls flow through $ wrapped by caller

// Issue #2123: draft/ready transitions live in one shared module so every session
// start/restart/resume path behaves identically.
import { ensurePullRequestIsDraft, ensurePullRequestIsReady } from './pr-draft-state.lib.mjs';
/**
 * Session type definitions for different work session contexts
 * See: https://github.com/link-assistant/hive-mind/issues/1152
 */
export const SESSION_TYPES = {
  NEW: 'new', // New work session (first time working on PR)
  RESUME: 'resume', // Manual resume (--resume flag)
  AUTO_RESUME: 'auto-resume', // Auto resume on limit reset (maintains context)
  AUTO_RESTART: 'auto-restart', // Auto restart on limit reset (fresh start)
};

/**
 * Get session comment header and description based on session type
 * @param {string} sessionType - One of SESSION_TYPES values
 * @param {Date} timestamp - Session start timestamp
 * @returns {Object} - { emoji, header, description }
 */
function getSessionCommentContent(sessionType, timestamp) {
  const isoTime = timestamp.toISOString();

  switch (sessionType) {
    case SESSION_TYPES.RESUME:
      return {
        emoji: '🔄',
        header: AI_WORK_SESSION_RESUMED_MARKER,
        description: `Resuming automated work session at ${isoTime}\n\nThis session continues from a previous session using the \`--resume\` flag.\n\nThe PR has been converted to draft mode while work is in progress.\n\n_This comment marks the resumption of an AI work session. Please wait for the session to finish, and provide your feedback._`,
      };
    case SESSION_TYPES.AUTO_RESUME:
      return {
        emoji: '⏰',
        header: AUTO_RESUME_ON_LIMIT_RESET_MARKER,
        description: `Auto-resuming automated work session at ${isoTime}\n\nThis session automatically resumed after the usage limit reset, continuing with the previous context preserved.\n\nThe PR has been converted to draft mode while work is in progress.\n\n_This is an auto-resumed session. Please wait for the session to finish, and provide your feedback._`,
      };
    case SESSION_TYPES.AUTO_RESTART:
      return {
        emoji: '🔄',
        header: AUTO_RESTART_ON_LIMIT_RESET_MARKER,
        description: `Auto-restarting automated work session at ${isoTime}\n\nThis session automatically restarted after the usage limit reset (fresh start without previous context).\n\nThe PR has been converted to draft mode while work is in progress.\n\n_This is a fresh restart after limit reset. Please wait for the session to finish, and provide your feedback._`,
      };
    case SESSION_TYPES.NEW:
    default:
      return {
        emoji: '🤖',
        header: AI_WORK_SESSION_STARTED_MARKER,
        description: `Starting automated work session at ${isoTime}\n\nThe PR has been converted to draft mode while work is in progress.\n\n_This comment marks the beginning of an AI work session. Please wait for the session to finish, and provide your feedback._`,
      };
  }
}

/**
 * Post the tracked comment that marks a work-session start.
 *
 * This is separate from startWorkSession because an in-process continuation
 * after a usage-limit wait is already inside a work session: the PR is already
 * draft, but reviewers still need an explicit boundary for the resumed tool
 * execution.
 *
 * @param {Object} options
 * @param {string} options.owner
 * @param {string} options.repo
 * @param {number} options.prNumber
 * @param {Function} options.$
 * @param {Function} options.log
 * @param {Function} options.formatAligned
 * @param {string} options.sessionType
 * @param {Date} [options.timestamp]
 */
export async function postWorkSessionStartComment({ owner, repo, prNumber, $, log, formatAligned, sessionType, timestamp = new Date() }) {
  try {
    const { emoji, header, description } = getSessionCommentContent(sessionType, timestamp);
    const startComment = `${emoji} **${header}**\n\n${description}`;
    const { ok, commentId, stderr } = await postTrackedComment({ $, owner, repo, targetNumber: prNumber, body: startComment });
    if (ok) {
      await log(formatAligned('💬', 'Posted:', `${header} comment${commentId ? ` (id=${commentId})` : ''}`, 2));
    } else {
      await log(`Warning: Could not post work start comment: ${stderr || 'unknown error'}`, { level: 'warning' });
    }
  } catch (error) {
    const sentryLib = await import('./sentry.lib.mjs');
    const { reportError } = sentryLib;
    reportError(error, {
      context: 'post_start_comment',
      owner,
      repo,
      prNumber,
      operation: 'create_pr_comment',
    });
    await log('Warning: Could not post work start comment', { level: 'warning' });
  }
}

/**
 * Start a work session and post appropriate comment
 * @param {Object} options - Session options
 * @param {boolean} options.isContinueMode - Whether this is a continue mode session
 * @param {number} options.prNumber - PR number
 * @param {Object} options.argv - Command line arguments
 * @param {Function} options.log - Logging function
 * @param {Function} options.formatAligned - Alignment formatting function
 * @param {Function} options.$ - Command execution function
 * @param {string} [options.sessionType='new'] - One of SESSION_TYPES values
 */
export async function startWorkSession({ isContinueMode, prNumber, argv, log, formatAligned, $, sessionType = SESSION_TYPES.NEW }) {
  // Record work start time and convert PR to draft.
  //
  // Issue #2123: the draft conversion used to be gated behind `argv.watch || argv.autoContinue`,
  // so plain `--resume`/continue-mode sessions left the PR marked "ready for review" while the
  // AI was still working on it. Any continue-mode session with a PR now converts it to draft.
  const workStartTime = new Date();
  const shouldPostSessionComment = argv.watch || argv.autoContinue;
  if (isContinueMode && prNumber) {
    await log(`\n${formatAligned('🚀', 'Starting work session:', workStartTime.toISOString())}`);

    const { reportError } = await import('./sentry.lib.mjs');
    await ensurePullRequestIsDraft({
      owner: global.owner,
      repo: global.repo,
      prNumber,
      $,
      log,
      formatAligned,
      reason: `session start: ${sessionType}`,
      reportError,
    });
  }

  if (isContinueMode && prNumber && shouldPostSessionComment) {
    // Post a comment marking the start of work session with appropriate header based on session type.
    // Issue #1625: Use postTrackedComment so the comment ID is registered in-memory and can be
    // excluded from the "did the AI post anything?" check in checkForAiCreatedComments().
    await postWorkSessionStartComment({
      owner: global.owner,
      repo: global.repo,
      prNumber,
      $,
      log,
      formatAligned,
      sessionType,
      timestamp: workStartTime,
    });
  }

  return workStartTime;
}

export async function endWorkSession({ isContinueMode, prNumber, argv, log, formatAligned, $, logsAttached = false }) {
  // Post end work session comment and convert PR back to ready for review.
  //
  // Issue #2123: the ready conversion mirrors startWorkSession's draft conversion, so it must
  // run for every continue-mode session, not only for --watch/--auto-continue ones.
  //
  // Issue #2182: the `isContinueMode` gate is deliberately gone from the ready conversion.
  // A session that created the pull request itself (isContinueMode === false) can still leave
  // it in draft — either because the AI opened it as a draft, or because an auto-restart
  // iteration converted it — and hive-mind, not the AI, owns putting it back. In the reported
  // run isContinueMode was false for the whole process, so this function did nothing and the
  // PR stayed a draft while --auto-merge retried the merge 2692 times over 4d 12h.
  // Session *comments* stay gated: they are about --watch/--auto-continue reporting, not state.
  if (prNumber) {
    const workEndTime = new Date();
    const shouldPostSessionComment = isContinueMode && (argv.watch || argv.autoContinue);
    await log(`\n${formatAligned('🏁', 'Ending work session:', workEndTime.toISOString())}`);

    // Only post end comment if logs were NOT already attached
    // The attachLogToGitHub comment already serves as finishing status with "Now working session is ended" text
    if (shouldPostSessionComment && !logsAttached) {
      // Post a comment marking the end of work session.
      // Issue #1625: Track the comment ID so it won't be mistaken for AI-authored content.
      try {
        const endComment = `🤖 **${AI_WORK_SESSION_COMPLETED_MARKER}**\n\nWork session ended at ${workEndTime.toISOString()}\n\nThe PR will be converted back to ready for review.\n\n_This comment marks the end of an AI work session. New comments after this time will be considered as feedback._`;
        const { ok, commentId, stderr } = await postTrackedComment({ $, owner: global.owner, repo: global.repo, targetNumber: prNumber, body: endComment });
        if (ok) {
          await log(formatAligned('💬', 'Posted:', `Work session end comment${commentId ? ` (id=${commentId})` : ''}`, 2));
        } else {
          await log(`Warning: Could not post work end comment: ${stderr || 'unknown error'}`, { level: 'warning' });
        }
      } catch (error) {
        const sentryLib = await import('./sentry.lib.mjs');
        const { reportError } = sentryLib;
        reportError(error, {
          context: 'post_end_comment',
          prNumber,
          operation: 'create_pr_comment',
        });
        await log('Warning: Could not post work end comment', { level: 'warning' });
      }
    } else if (shouldPostSessionComment) {
      await log(formatAligned('ℹ️', 'Skipping:', 'End comment (logs already attached with session end message)', 2));
    }

    // Convert PR back to ready for review (issue #2123: shared implementation).
    // This is the invariant of the whole draft/ready state machine: a finished working
    // session never leaves a pull request in draft (issue #2182).
    const { reportError } = await import('./sentry.lib.mjs');
    await ensurePullRequestIsReady({
      owner: global.owner,
      repo: global.repo,
      prNumber,
      $,
      log,
      formatAligned,
      reason: 'session end',
      reportError,
    });
  }
}
