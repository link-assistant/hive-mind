/**
 * Work session management functionality for solve.mjs
 * Handles starting and ending work sessions, PR status changes, and session comments
 */

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
        header: 'AI Work Session Resumed',
        description: `Resuming automated work session at ${isoTime}\n\nThis session continues from a previous session using the \`--resume\` flag.\n\nThe PR has been converted to draft mode while work is in progress.\n\n_This comment marks the resumption of an AI work session. Please wait for the session to finish, and provide your feedback._`,
      };
    case SESSION_TYPES.AUTO_RESUME:
      return {
        emoji: '⏰',
        header: 'Auto Resume (on limit reset)',
        description: `Auto-resuming automated work session at ${isoTime}\n\nThis session automatically resumed after the usage limit reset, continuing with the previous context preserved.\n\nThe PR has been converted to draft mode while work is in progress.\n\n_This is an auto-resumed session. Please wait for the session to finish, and provide your feedback._`,
      };
    case SESSION_TYPES.AUTO_RESTART:
      return {
        emoji: '🔄',
        header: 'Auto Restart (on limit reset)',
        description: `Auto-restarting automated work session at ${isoTime}\n\nThis session automatically restarted after the usage limit reset (fresh start without previous context).\n\nThe PR has been converted to draft mode while work is in progress.\n\n_This is a fresh restart after limit reset. Please wait for the session to finish, and provide your feedback._`,
      };
    case SESSION_TYPES.NEW:
    default:
      return {
        emoji: '🤖',
        header: 'AI Work Session Started',
        description: `Starting automated work session at ${isoTime}\n\nThe PR has been converted to draft mode while work is in progress.\n\n_This comment marks the beginning of an AI work session. Please wait for the session to finish, and provide your feedback._`,
      };
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
  // Record work start time and convert PR to draft if in continue/watch mode
  const workStartTime = new Date();
  if (isContinueMode && prNumber && (argv.watch || argv.autoContinue)) {
    await log(`\n${formatAligned('🚀', 'Starting work session:', workStartTime.toISOString())}`);

    // Convert PR back to draft if not already
    try {
      const prStatusResult = await $`gh pr view ${prNumber} --repo ${global.owner}/${global.repo} --json isDraft --jq .isDraft`;
      if (prStatusResult.code === 0) {
        const isDraft = prStatusResult.stdout.toString().trim() === 'true';
        if (!isDraft) {
          await log(formatAligned('📝', 'Converting PR:', 'Back to draft mode...', 2));
          const convertResult = await $`gh pr ready ${prNumber} --repo ${global.owner}/${global.repo} --undo`;
          if (convertResult.code === 0) {
            await log(formatAligned('✅', 'PR converted:', 'Now in draft mode', 2));
          } else {
            await log('Warning: Could not convert PR to draft', { level: 'warning' });
          }
        } else {
          await log(formatAligned('✅', 'PR status:', 'Already in draft mode', 2));
        }
      }
    } catch (error) {
      const sentryLib = await import('./sentry.lib.mjs');
      const { reportError } = sentryLib;
      reportError(error, {
        context: 'convert_pr_to_draft',
        prNumber,
        operation: 'pr_status_change',
      });
      await log('Warning: Could not check/convert PR draft status', { level: 'warning' });
    }

    // Post a comment marking the start of work session with appropriate header based on session type
    try {
      const { emoji, header, description } = getSessionCommentContent(sessionType, workStartTime);
      const startComment = `${emoji} **${header}**\n\n${description}`;
      const commentResult = await $`gh pr comment ${prNumber} --repo ${global.owner}/${global.repo} --body ${startComment}`;
      if (commentResult.code === 0) {
        await log(formatAligned('💬', 'Posted:', `${header} comment`, 2));
      }
    } catch (error) {
      const sentryLib = await import('./sentry.lib.mjs');
      const { reportError } = sentryLib;
      reportError(error, {
        context: 'post_start_comment',
        prNumber,
        operation: 'create_pr_comment',
      });
      await log('Warning: Could not post work start comment', { level: 'warning' });
    }
  }

  return workStartTime;
}

export async function endWorkSession({ isContinueMode, prNumber, argv, log, formatAligned, $, logsAttached = false }) {
  // Post end work session comment and convert PR back to ready if in continue mode
  if (isContinueMode && prNumber && (argv.watch || argv.autoContinue)) {
    const workEndTime = new Date();
    await log(`\n${formatAligned('🏁', 'Ending work session:', workEndTime.toISOString())}`);

    // Only post end comment if logs were NOT already attached
    // The attachLogToGitHub comment already serves as finishing status with "Now working session is ended" text
    if (!logsAttached) {
      // Post a comment marking the end of work session
      try {
        const endComment = `🤖 **AI Work Session Completed**\n\nWork session ended at ${workEndTime.toISOString()}\n\nThe PR will be converted back to ready for review.\n\n_This comment marks the end of an AI work session. New comments after this time will be considered as feedback._`;
        const commentResult = await $`gh pr comment ${prNumber} --repo ${global.owner}/${global.repo} --body ${endComment}`;
        if (commentResult.code === 0) {
          await log(formatAligned('💬', 'Posted:', 'Work session end comment', 2));
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
    } else {
      await log(formatAligned('ℹ️', 'Skipping:', 'End comment (logs already attached with session end message)', 2));
    }

    // Convert PR back to ready for review
    try {
      const prStatusResult = await $`gh pr view ${prNumber} --repo ${global.owner}/${global.repo} --json isDraft --jq .isDraft`;
      if (prStatusResult.code === 0) {
        const isDraft = prStatusResult.stdout.toString().trim() === 'true';
        if (isDraft) {
          await log(formatAligned('🔀', 'Converting PR:', 'Back to ready for review...', 2));
          const convertResult = await $`gh pr ready ${prNumber} --repo ${global.owner}/${global.repo}`;
          if (convertResult.code === 0) {
            await log(formatAligned('✅', 'PR converted:', 'Ready for review', 2));
          } else {
            await log('Warning: Could not convert PR to ready', { level: 'warning' });
          }
        } else {
          await log(formatAligned('✅', 'PR status:', 'Already ready for review', 2));
        }
      }
    } catch (error) {
      const sentryLib = await import('./sentry.lib.mjs');
      const { reportError } = sentryLib;
      reportError(error, {
        context: 'convert_pr_to_ready',
        prNumber,
        operation: 'pr_status_change',
      });
      await log('Warning: Could not convert PR to ready status', { level: 'warning' });
    }
  }
}
