#!/usr/bin/env node

/**
 * Live updates monitoring module for solve.mjs
 *
 * This module monitors for issue/comment updates during Claude execution
 * and enables the bot to react to changes in real-time.
 *
 * Related to issue #723: Bot should react to issue updates and new comments
 * while already working on implementation.
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
const { log, cleanErrorMessage, formatAligned } = lib;

// Import Sentry integration
const sentryLib = await import('./sentry.lib.mjs');
const { reportError } = sentryLib;

/**
 * Stores the state of issue/PR at the start of monitoring
 * Used to detect changes during execution
 */
class UpdatesState {
  constructor() {
    this.issueBodyHash = null;
    this.issueTitleHash = null;
    this.issueUpdatedAt = null;
    this.lastCommentId = null;
    this.lastCommentCount = 0;
    this.prBodyHash = null;
    this.prTitleHash = null;
    this.prUpdatedAt = null;
    this.lastPrCommentId = null;
    this.lastPrCommentCount = 0;
  }
}

/**
 * Simple hash function for detecting content changes
 * @param {string} str - String to hash
 * @returns {number} Hash value
 */
const simpleHash = (str) => {
  if (!str) return 0;
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return hash;
};

/**
 * Capture the initial state of issue and PR for comparison
 * @param {Object} params - Parameters
 * @returns {UpdatesState} Initial state
 */
export const captureInitialState = async (params) => {
  const { owner, repo, issueNumber, prNumber, argv } = params;
  const state = new UpdatesState();

  try {
    // Capture issue state
    if (issueNumber) {
      const issueResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}`;
      if (issueResult.code === 0) {
        const issueData = JSON.parse(issueResult.stdout.toString());
        state.issueBodyHash = simpleHash(issueData.body || '');
        state.issueTitleHash = simpleHash(issueData.title || '');
        state.issueUpdatedAt = issueData.updated_at;

        // Get last comment ID
        const commentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments --jq 'last.id // 0'`;
        if (commentsResult.code === 0) {
          state.lastCommentId = parseInt(commentsResult.stdout.toString().trim()) || 0;
        }

        // Get comment count
        const countResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments --jq 'length'`;
        if (countResult.code === 0) {
          state.lastCommentCount = parseInt(countResult.stdout.toString().trim()) || 0;
        }

        if (argv && argv.verbose) {
          await log('   📊 Initial issue state captured:', { verbose: true });
          await log(`      Title hash: ${state.issueTitleHash}`, { verbose: true });
          await log(`      Body hash: ${state.issueBodyHash}`, { verbose: true });
          await log(`      Last comment ID: ${state.lastCommentId}`, { verbose: true });
          await log(`      Comment count: ${state.lastCommentCount}`, { verbose: true });
        }
      }
    }

    // Capture PR state if applicable
    if (prNumber) {
      const prResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}`;
      if (prResult.code === 0) {
        const prData = JSON.parse(prResult.stdout.toString());
        state.prBodyHash = simpleHash(prData.body || '');
        state.prTitleHash = simpleHash(prData.title || '');
        state.prUpdatedAt = prData.updated_at;

        // Get last PR comment ID (PR conversation comments)
        const prCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --jq 'last.id // 0'`;
        if (prCommentsResult.code === 0) {
          state.lastPrCommentId = parseInt(prCommentsResult.stdout.toString().trim()) || 0;
        }

        // Get PR comment count
        const prCountResult = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --jq 'length'`;
        if (prCountResult.code === 0) {
          state.lastPrCommentCount = parseInt(prCountResult.stdout.toString().trim()) || 0;
        }

        if (argv && argv.verbose) {
          await log('   📊 Initial PR state captured:', { verbose: true });
          await log(`      Title hash: ${state.prTitleHash}`, { verbose: true });
          await log(`      Body hash: ${state.prBodyHash}`, { verbose: true });
          await log(`      Last PR comment ID: ${state.lastPrCommentId}`, { verbose: true });
          await log(`      PR comment count: ${state.lastPrCommentCount}`, { verbose: true });
        }
      }
    }
  } catch (error) {
    reportError(error, {
      context: 'capture_initial_state',
      issueNumber,
      prNumber,
      operation: 'capture_initial_state'
    });
    if (argv && argv.verbose) {
      await log(`   ⚠️  Error capturing initial state: ${cleanErrorMessage(error)}`, { verbose: true });
    }
  }

  return state;
};

/**
 * Check for updates since initial state
 * @param {Object} params - Parameters
 * @param {UpdatesState} initialState - Initial state to compare against
 * @returns {Object} Update detection result
 */
export const checkForUpdates = async (params, initialState) => {
  const { owner, repo, issueNumber, prNumber, currentUser, argv } = params;

  const updates = {
    hasUpdates: false,
    issueEdited: false,
    newIssueComments: [],
    prEdited: false,
    newPrComments: [],
    updateSummary: []
  };

  try {
    // Check issue updates
    if (issueNumber) {
      const issueResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}`;
      if (issueResult.code === 0) {
        const issueData = JSON.parse(issueResult.stdout.toString());
        const currentBodyHash = simpleHash(issueData.body || '');
        const currentTitleHash = simpleHash(issueData.title || '');

        // Check if issue was edited
        if (currentBodyHash !== initialState.issueBodyHash ||
            currentTitleHash !== initialState.issueTitleHash) {
          updates.issueEdited = true;
          updates.hasUpdates = true;
          updates.updateSummary.push('Issue description/title was edited');
        }

        // Check for new comments
        const commentsResult = await $`gh api repos/${owner}/${repo}/issues/${issueNumber}/comments`;
        if (commentsResult.code === 0) {
          const comments = JSON.parse(commentsResult.stdout.toString());

          // Filter for new comments (ID > last known)
          const newComments = comments.filter(comment => {
            const isNew = comment.id > initialState.lastCommentId;
            // Filter out bot's own comments
            const isNotSelf = !currentUser || comment.user.login !== currentUser;
            return isNew && isNotSelf;
          });

          if (newComments.length > 0) {
            updates.newIssueComments = newComments;
            updates.hasUpdates = true;
            updates.updateSummary.push(`${newComments.length} new comment(s) on issue`);
          }
        }
      }
    }

    // Check PR updates
    if (prNumber) {
      const prResult = await $`gh api repos/${owner}/${repo}/pulls/${prNumber}`;
      if (prResult.code === 0) {
        const prData = JSON.parse(prResult.stdout.toString());
        const currentBodyHash = simpleHash(prData.body || '');
        const currentTitleHash = simpleHash(prData.title || '');

        // Check if PR was edited
        if (currentBodyHash !== initialState.prBodyHash ||
            currentTitleHash !== initialState.prTitleHash) {
          updates.prEdited = true;
          updates.hasUpdates = true;
          updates.updateSummary.push('Pull request description/title was edited');
        }

        // Check for new PR comments
        const prCommentsResult = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments`;
        if (prCommentsResult.code === 0) {
          const comments = JSON.parse(prCommentsResult.stdout.toString());

          // Filter for new comments (ID > last known)
          const newComments = comments.filter(comment => {
            const isNew = comment.id > initialState.lastPrCommentId;
            // Filter out bot's own comments
            const isNotSelf = !currentUser || comment.user.login !== currentUser;
            return isNew && isNotSelf;
          });

          if (newComments.length > 0) {
            updates.newPrComments = newComments;
            updates.hasUpdates = true;
            updates.updateSummary.push(`${newComments.length} new comment(s) on PR`);
          }
        }
      }
    }

    if (argv && argv.verbose && updates.hasUpdates) {
      await log('   🔔 Updates detected:', { verbose: true });
      for (const summary of updates.updateSummary) {
        await log(`      • ${summary}`, { verbose: true });
      }
    }

  } catch (error) {
    reportError(error, {
      context: 'check_for_updates',
      issueNumber,
      prNumber,
      operation: 'check_for_updates'
    });
    if (argv && argv.verbose) {
      await log(`   ⚠️  Error checking for updates: ${cleanErrorMessage(error)}`, { verbose: true });
    }
  }

  return updates;
};

/**
 * Format updates into feedback lines for Claude
 * @param {Object} updates - Update detection result
 * @returns {string[]} Formatted feedback lines
 */
export const formatUpdatesAsFeedback = (updates) => {
  const feedbackLines = [];

  if (!updates.hasUpdates) {
    return feedbackLines;
  }

  feedbackLines.push('');
  feedbackLines.push('🔔 LIVE UPDATES DETECTED DURING EXECUTION:');
  feedbackLines.push('The following changes occurred while you were working:');
  feedbackLines.push('');

  if (updates.issueEdited) {
    feedbackLines.push('📝 ISSUE EDITED:');
    feedbackLines.push('   The issue description or title was modified.');
    feedbackLines.push('   Please re-read the issue to check for important updates.');
    feedbackLines.push('');
  }

  if (updates.newIssueComments.length > 0) {
    feedbackLines.push(`💬 NEW ISSUE COMMENTS (${updates.newIssueComments.length}):`);
    for (const comment of updates.newIssueComments) {
      const author = comment.user.login;
      const createdAt = new Date(comment.created_at).toISOString();
      const bodyPreview = (comment.body || '').substring(0, 200);
      feedbackLines.push(`   From @${author} at ${createdAt}:`);
      feedbackLines.push(`   "${bodyPreview}${comment.body.length > 200 ? '...' : ''}"`);
      feedbackLines.push('');
    }
  }

  if (updates.prEdited) {
    feedbackLines.push('📝 PULL REQUEST EDITED:');
    feedbackLines.push('   The PR description or title was modified.');
    feedbackLines.push('   Check if there are new requirements or feedback to address.');
    feedbackLines.push('');
  }

  if (updates.newPrComments.length > 0) {
    feedbackLines.push(`💬 NEW PR COMMENTS (${updates.newPrComments.length}):`);
    for (const comment of updates.newPrComments) {
      const author = comment.user.login;
      const createdAt = new Date(comment.created_at).toISOString();
      const bodyPreview = (comment.body || '').substring(0, 200);
      feedbackLines.push(`   From @${author} at ${createdAt}:`);
      feedbackLines.push(`   "${bodyPreview}${comment.body.length > 200 ? '...' : ''}"`);
      feedbackLines.push('');
    }
  }

  feedbackLines.push('⚠️  IMPORTANT: Please review these updates and adjust your work accordingly.');
  feedbackLines.push('   You may need to pause current work and address the new feedback first.');
  feedbackLines.push('');

  return feedbackLines;
};

/**
 * Live updates monitor class
 * Runs in parallel with Claude execution and checks for updates periodically
 */
export class LiveUpdatesMonitor {
  constructor(params) {
    this.owner = params.owner;
    this.repo = params.repo;
    this.issueNumber = params.issueNumber;
    this.prNumber = params.prNumber;
    this.argv = params.argv;
    this.checkInterval = params.checkInterval || 30000; // Default 30 seconds
    this.onUpdateDetected = params.onUpdateDetected || null;

    this.initialState = null;
    this.currentUser = null;
    this.isRunning = false;
    this.intervalId = null;
    this.updates = null;
    this.checkCount = 0;
  }

  /**
   * Start monitoring for updates
   */
  async start() {
    if (this.isRunning) {
      return;
    }

    // Get current user to filter out own comments
    try {
      const userResult = await $`gh api user --jq .login`;
      if (userResult.code === 0) {
        this.currentUser = userResult.stdout.toString().trim();
      }
    } catch {
      // Continue without user filtering if we can't get the user
    }

    // Capture initial state
    this.initialState = await captureInitialState({
      owner: this.owner,
      repo: this.repo,
      issueNumber: this.issueNumber,
      prNumber: this.prNumber,
      argv: this.argv
    });

    this.isRunning = true;
    this.checkCount = 0;

    await log(`${formatAligned('👁️', 'Live updates monitor:', 'STARTED')}`);
    await log(formatAligned('', 'Check interval:', `${this.checkInterval / 1000} seconds`, 2));
    await log(formatAligned('', 'Monitoring:', `Issue #${this.issueNumber || 'N/A'}, PR #${this.prNumber || 'N/A'}`, 2));

    // Start periodic checking
    this.intervalId = setInterval(async () => {
      await this._checkOnce();
    }, this.checkInterval);
  }

  /**
   * Perform a single check for updates
   */
  async _checkOnce() {
    if (!this.isRunning || !this.initialState) {
      return;
    }

    this.checkCount++;

    try {
      const updates = await checkForUpdates({
        owner: this.owner,
        repo: this.repo,
        issueNumber: this.issueNumber,
        prNumber: this.prNumber,
        currentUser: this.currentUser,
        argv: this.argv
      }, this.initialState);

      if (updates.hasUpdates) {
        this.updates = updates;
        await log('');
        await log(`${formatAligned('🔔', 'LIVE UPDATE DETECTED!', '')}`);
        for (const summary of updates.updateSummary) {
          await log(formatAligned('', '•', summary, 2));
        }
        await log('');

        // Call the update handler if provided
        if (this.onUpdateDetected) {
          await this.onUpdateDetected(updates);
        }

        // Update initial state to avoid duplicate notifications
        this.initialState = await captureInitialState({
          owner: this.owner,
          repo: this.repo,
          issueNumber: this.issueNumber,
          prNumber: this.prNumber,
          argv: this.argv
        });
      } else if (this.argv && this.argv.verbose && this.checkCount % 5 === 0) {
        // Log every 5th check in verbose mode to show the monitor is running
        await log(`   👁️  Live update check #${this.checkCount}: No updates`, { verbose: true });
      }
    } catch (error) {
      reportError(error, {
        context: 'live_updates_check',
        checkCount: this.checkCount,
        operation: 'periodic_update_check'
      });
    }
  }

  /**
   * Stop monitoring
   */
  async stop() {
    if (!this.isRunning) {
      return;
    }

    this.isRunning = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    await log(`${formatAligned('👁️', 'Live updates monitor:', 'STOPPED')}`);
    await log(formatAligned('', 'Total checks performed:', `${this.checkCount}`, 2));
  }

  /**
   * Get the latest detected updates
   * @returns {Object|null} Latest updates or null
   */
  getLatestUpdates() {
    return this.updates;
  }

  /**
   * Check if any updates were detected
   * @returns {boolean} True if updates were detected
   */
  hasUpdates() {
    return this.updates !== null && this.updates.hasUpdates;
  }

  /**
   * Get updates formatted as feedback lines for Claude
   * @returns {string[]} Feedback lines
   */
  getUpdatesAsFeedback() {
    if (!this.updates) {
      return [];
    }
    return formatUpdatesAsFeedback(this.updates);
  }

  /**
   * Clear the updates after they have been processed
   */
  clearUpdates() {
    this.updates = null;
  }
}

/**
 * Create and start a live updates monitor
 * @param {Object} params - Parameters for the monitor
 * @returns {LiveUpdatesMonitor} The monitor instance
 */
export const createLiveUpdatesMonitor = async (params) => {
  const monitor = new LiveUpdatesMonitor(params);
  await monitor.start();
  return monitor;
};

// Export all functions as default object too
export default {
  UpdatesState,
  captureInitialState,
  checkForUpdates,
  formatUpdatesAsFeedback,
  LiveUpdatesMonitor,
  createLiveUpdatesMonitor
};
