/**
 * PR comment checking utilities for auto-merge and auto-restart workflows.
 * Extracted from solve.auto-merge.lib.mjs for file size management.
 */

// Check if use is already defined globally (when imported from solve.mjs)
// If not, fetch it (when running standalone)
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const use = globalThis.use;

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

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
 * @returns {Promise<boolean>} - True if a matching comment already exists
 */
export const checkForExistingComment = async (owner, repo, prNumber, commentSignature, verbose = false) => {
  try {
    // Fetch all PR comments as JSON to get individual comment bodies in order
    const result = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --jq '[.[].body]' 2>/dev/null`;
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
      // Session-ending markers:
      // - "Now working session is ended" — in all log upload comments
      //   (Solution Draft Log, Auto-restart Log, Auto-restart-until-mergeable Log, etc.)
      // - "AI Work Session Completed" — posted when logs are not attached
      const sessionEndingMarkers = ['Now working session is ended', 'AI Work Session Completed'];
      let searchStartIndex = 0;
      for (let i = commentBodies.length - 1; i >= 0; i--) {
        if (commentBodies[i] && sessionEndingMarkers.some(marker => commentBodies[i].includes(marker))) {
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
 * @returns {Promise<{hasNewComments: boolean, comments: Array}>}
 */
export const checkForNonBotComments = async (owner, repo, prNumber, issueNumber, lastCheckTime, verbose = false) => {
  try {
    // Get current GitHub user to identify which comments are from the bot/hive-mind
    let currentUser = null;
    try {
      const userResult = await $`gh api user --jq .login`;
      if (userResult.code === 0) {
        currentUser = userResult.stdout.toString().trim();
      }
    } catch {
      // If we can't get the current user, continue without filtering
    }

    // Common bot usernames and patterns to filter out
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
      // Check if it's the current user (the bot running hive-mind)
      if (currentUser && login === currentUser) return true;
      // Check against known bot patterns
      return botPatterns.some(pattern => pattern.test(login));
    };

    // Fetch PR conversation comments
    const prCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate`;
    let prComments = [];
    if (prCommentsResult.code === 0 && prCommentsResult.stdout) {
      prComments = JSON.parse(prCommentsResult.stdout.toString() || '[]');
    }

    // Fetch PR review comments (inline code comments)
    const prReviewCommentsResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}/comments --paginate`;
    let prReviewComments = [];
    if (prReviewCommentsResult.code === 0 && prReviewCommentsResult.stdout) {
      prReviewComments = JSON.parse(prReviewCommentsResult.stdout.toString() || '[]');
    }

    // Fetch issue comments if we have an issue number
    let issueComments = [];
    if (issueNumber && issueNumber !== prNumber) {
      const issueCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments --paginate`;
      if (issueCommentsResult.code === 0 && issueCommentsResult.stdout) {
        issueComments = JSON.parse(issueCommentsResult.stdout.toString() || '[]');
      }
    }

    // Combine all comments
    const allComments = [...prComments, ...prReviewComments, ...issueComments];

    // Filter for new comments from non-bot users
    const newNonBotComments = allComments.filter(comment => {
      const commentTime = new Date(comment.created_at);
      const isAfterLastCheck = commentTime > lastCheckTime;
      const isFromNonBot = !isBot(comment.user?.login);

      if (verbose && isAfterLastCheck && isFromNonBot) {
        console.log(`[VERBOSE] New non-bot comment from ${comment.user?.login} at ${comment.created_at}`);
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
