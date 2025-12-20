/**
 * Work session management functionality for solve.mjs
 * Handles starting and ending work sessions, PR status changes, and session comments
 */

export async function startWorkSession({
  isContinueMode,
  prNumber,
  argv,
  log,
  formatAligned,
  $
}) {
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
        operation: 'pr_status_change'
      });
      await log('Warning: Could not check/convert PR draft status', { level: 'warning' });
    }

    // Post a comment marking the start of work session
    try {
      const startComment = `🤖 **AI Work Session Started**\n\nStarting automated work session at ${workStartTime.toISOString()}\n\nThe PR has been converted to draft mode while work is in progress.\n\n_This comment marks the beginning of an AI work session. Please wait working session to finish, and provide your feedback._`;
      const commentResult = await $`gh pr comment ${prNumber} --repo ${global.owner}/${global.repo} --body ${startComment}`;
      if (commentResult.code === 0) {
        await log(formatAligned('💬', 'Posted:', 'Work session start comment', 2));
      }
    } catch (error) {
      const sentryLib = await import('./sentry.lib.mjs');
      const { reportError } = sentryLib;
      reportError(error, {
        context: 'post_start_comment',
        prNumber,
        operation: 'create_pr_comment'
      });
      await log('Warning: Could not post work start comment', { level: 'warning' });
    }
  }

  return workStartTime;
}

export async function endWorkSession({
  isContinueMode,
  prNumber,
  argv,
  log,
  formatAligned,
  $,
  logsAttached = false
}) {
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
          operation: 'create_pr_comment'
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
        operation: 'pr_status_change'
      });
      await log('Warning: Could not convert PR to ready status', { level: 'warning' });
    }
  }
}