#!/usr/bin/env node
/**
 * Bidirectional Interactive Mode Library
 *
 * [EXPERIMENTAL] This module provides bidirectional real-time communication during Claude execution.
 * It monitors PR comments for user feedback and queues it for injection into the running Claude session.
 *
 * Key features:
 * - Monitors GitHub PR comments for new user feedback
 * - Queues feedback messages for injection into Claude's stdin
 * - Works with Claude CLI's --input-format stream-json mode
 * - Filters out system-generated comments (from interactive mode itself)
 *
 * Usage:
 *   const { createBidirectionalHandler } = await import('./bidirectional-interactive.lib.mjs');
 *   const handler = createBidirectionalHandler({ owner, repo, prNumber, $ });
 *   await handler.startMonitoring();
 *   // Later...
 *   const feedback = handler.getQueuedFeedback();
 *
 * @module bidirectional-interactive.lib.mjs
 * @experimental
 */

// Configuration constants
const CONFIG = {
  // Minimum time between comment checks to avoid rate limiting (in ms)
  MIN_POLL_INTERVAL: 10000,
  // Default poll interval (in ms)
  DEFAULT_POLL_INTERVAL: 15000,
  // Maximum queued feedback messages
  MAX_QUEUE_SIZE: 50,
  // Signature to identify system-generated comments
  SYSTEM_COMMENT_SIGNATURES: [
    '## 🚀 Session Started',
    '## 💬 Assistant Response',
    '## 💻 Tool: ',
    '## 📝 Tool: ',
    '## 📖 Tool: ',
    '## ✏️ Tool: ',
    '## 🔍 Tool: ',
    '## 🔎 Tool: ',
    '## 🌐 Tool: ',
    '## 📋 Tool: ',
    '## 🎯 Tool: ',
    '## 📓 Tool: ',
    '## 🔧 Tool: ',
    '## ✅ Tool Result:',
    '## ❌ Tool Result:',
    '## ✅ Session Complete',
    '## ❌ Session Failed',
    '## ❓ Unrecognized Event:',
    '📄 Raw JSON',
    '🤖 Generated with [Claude Code]',
    '🤖 AI-Powered Solution Draft',
    '*This PR was created automatically by the AI issue solver*'
  ]
};

/**
 * Check if a comment body is system-generated (from interactive mode)
 *
 * @param {string} body - Comment body to check
 * @returns {boolean} True if the comment is system-generated
 */
const isSystemComment = (body) => {
  if (!body || typeof body !== 'string') {
    return false;
  }
  return CONFIG.SYSTEM_COMMENT_SIGNATURES.some(sig => body.includes(sig));
};

/**
 * Format a user feedback message for Claude CLI's stream-json input
 *
 * @param {string} feedbackText - The user's feedback text
 * @returns {string} JSON string ready to write to Claude's stdin
 */
const formatFeedbackForClaude = (feedbackText) => {
  const message = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `[USER FEEDBACK FROM PR COMMENT]\n\n${feedbackText}\n\n[END OF USER FEEDBACK - Please address this feedback in your current work]`
        }
      ]
    }
  };
  return JSON.stringify(message);
};

/**
 * Creates a bidirectional interactive mode handler
 *
 * @param {Object} options - Handler configuration
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number} options.prNumber - Pull request number
 * @param {Function} options.$ - command-stream $ function
 * @param {Function} options.log - Logging function
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @param {number} [options.pollInterval=15000] - Interval between comment checks (ms)
 * @returns {Object} Handler object with monitoring methods
 */
export const createBidirectionalHandler = (options) => {
  const {
    owner,
    repo,
    prNumber,
    $,
    log,
    verbose = false,
    pollInterval = CONFIG.DEFAULT_POLL_INTERVAL
  } = options;

  // State tracking for the handler
  const state = {
    isMonitoring: false,
    lastCheckedCommentId: null,
    lastCheckedTimestamp: null,
    feedbackQueue: [],
    pollIntervalId: null,
    processedCommentIds: new Set(),
    totalCommentsProcessed: 0,
    totalFeedbackQueued: 0
  };

  /**
   * Fetch recent comments from the PR
   * @returns {Promise<Array>} Array of comment objects
   * @private
   */
  const fetchRecentComments = async () => {
    if (!prNumber || !owner || !repo) {
      if (verbose) {
        await log('⚠️ Bidirectional mode: Cannot fetch comments - missing PR info', { verbose: true });
      }
      return [];
    }

    try {
      // Fetch comments using gh api with pagination, sorted by created_at desc
      const result = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --jq '[.[] | {id: .id, body: .body, created_at: .created_at, user: .user.login}] | sort_by(.created_at) | reverse'`;
      const comments = JSON.parse(result.stdout.toString());
      return comments;
    } catch (error) {
      if (verbose) {
        await log(`⚠️ Bidirectional mode: Failed to fetch comments: ${error.message}`, { verbose: true });
      }
      return [];
    }
  };

  /**
   * Check for new user comments and queue them as feedback
   * @private
   */
  const checkForNewComments = async () => {
    if (!state.isMonitoring) {
      return;
    }

    try {
      const comments = await fetchRecentComments();

      if (comments.length === 0) {
        return;
      }

      // Filter for new comments we haven't processed yet
      for (const comment of comments) {
        // Skip if already processed
        if (state.processedCommentIds.has(comment.id)) {
          continue;
        }

        // Skip if this is a system-generated comment
        if (isSystemComment(comment.body)) {
          state.processedCommentIds.add(comment.id);
          continue;
        }

        // This is a new user comment - queue it as feedback
        if (state.feedbackQueue.length < CONFIG.MAX_QUEUE_SIZE) {
          state.feedbackQueue.push({
            id: comment.id,
            body: comment.body,
            user: comment.user,
            created_at: comment.created_at,
            formattedMessage: formatFeedbackForClaude(comment.body)
          });
          state.totalFeedbackQueued++;

          if (verbose) {
            await log(`📥 Bidirectional mode: Queued feedback from @${comment.user} (comment #${comment.id})`, { verbose: true });
          }
        } else {
          if (verbose) {
            await log(`⚠️ Bidirectional mode: Feedback queue full, skipping comment #${comment.id}`, { verbose: true });
          }
        }

        state.processedCommentIds.add(comment.id);
        state.totalCommentsProcessed++;
      }
    } catch (error) {
      if (verbose) {
        await log(`⚠️ Bidirectional mode: Error checking comments: ${error.message}`, { verbose: true });
      }
    }
  };

  /**
   * Start monitoring PR comments for user feedback
   *
   * @returns {Promise<void>}
   */
  const startMonitoring = async () => {
    if (state.isMonitoring) {
      if (verbose) {
        await log('ℹ️ Bidirectional mode: Already monitoring', { verbose: true });
      }
      return;
    }

    if (!prNumber || !owner || !repo) {
      if (verbose) {
        await log('⚠️ Bidirectional mode: Cannot start monitoring - missing PR info', { verbose: true });
      }
      return;
    }

    state.isMonitoring = true;

    // Do initial check
    await checkForNewComments();

    // Set up polling interval
    const interval = Math.max(pollInterval, CONFIG.MIN_POLL_INTERVAL);
    state.pollIntervalId = setInterval(async () => {
      await checkForNewComments();
    }, interval);

    if (verbose) {
      await log(`🔌 Bidirectional mode: Started monitoring PR #${prNumber} (polling every ${interval / 1000}s)`, { verbose: true });
    }
  };

  /**
   * Stop monitoring PR comments
   *
   * @returns {Promise<void>}
   */
  const stopMonitoring = async () => {
    if (!state.isMonitoring) {
      return;
    }

    state.isMonitoring = false;

    if (state.pollIntervalId) {
      clearInterval(state.pollIntervalId);
      state.pollIntervalId = null;
    }

    if (verbose) {
      await log(`🔌 Bidirectional mode: Stopped monitoring (processed ${state.totalCommentsProcessed} comments, queued ${state.totalFeedbackQueued} feedback)`, { verbose: true });
    }
  };

  /**
   * Get next queued feedback message (FIFO)
   * Does not remove from queue - use acknowledgeFeedback() after processing
   *
   * @returns {Object|null} Next feedback object or null if queue is empty
   */
  const peekFeedback = () => {
    if (state.feedbackQueue.length === 0) {
      return null;
    }
    return state.feedbackQueue[0];
  };

  /**
   * Get and remove next queued feedback message (FIFO)
   *
   * @returns {Object|null} Next feedback object or null if queue is empty
   */
  const popFeedback = () => {
    if (state.feedbackQueue.length === 0) {
      return null;
    }
    return state.feedbackQueue.shift();
  };

  /**
   * Get all queued feedback messages without removing them
   *
   * @returns {Array} Array of queued feedback objects
   */
  const getAllQueuedFeedback = () => {
    return [...state.feedbackQueue];
  };

  /**
   * Check if there is any queued feedback
   *
   * @returns {boolean} True if there is queued feedback
   */
  const hasFeedback = () => {
    return state.feedbackQueue.length > 0;
  };

  /**
   * Get the count of queued feedback messages
   *
   * @returns {number} Number of queued feedback messages
   */
  const getFeedbackCount = () => {
    return state.feedbackQueue.length;
  };

  /**
   * Clear all queued feedback
   */
  const clearFeedbackQueue = () => {
    state.feedbackQueue = [];
  };

  /**
   * Mark a specific comment ID as already processed
   * Useful for filtering out comments that existed before monitoring started
   *
   * @param {number} commentId - Comment ID to mark as processed
   */
  const markCommentAsProcessed = (commentId) => {
    state.processedCommentIds.add(commentId);
  };

  /**
   * Initialize with existing comment IDs to skip
   * Call this before startMonitoring() to avoid processing old comments
   *
   * @param {Array<number>} commentIds - Array of comment IDs to skip
   */
  const initializeWithExistingComments = (commentIds) => {
    for (const id of commentIds) {
      state.processedCommentIds.add(id);
    }
  };

  /**
   * Fetch and mark all existing comments as processed
   * Call this before startMonitoring() to only get new comments
   *
   * @returns {Promise<number>} Number of existing comments marked
   */
  const initializeFromCurrentComments = async () => {
    const comments = await fetchRecentComments();
    for (const comment of comments) {
      state.processedCommentIds.add(comment.id);
    }
    if (verbose) {
      await log(`📋 Bidirectional mode: Initialized with ${comments.length} existing comments`, { verbose: true });
    }
    return comments.length;
  };

  /**
   * Get current handler state (for debugging)
   *
   * @returns {Object} Current state
   */
  const getState = () => ({
    isMonitoring: state.isMonitoring,
    feedbackQueueLength: state.feedbackQueue.length,
    processedCommentCount: state.processedCommentIds.size,
    totalCommentsProcessed: state.totalCommentsProcessed,
    totalFeedbackQueued: state.totalFeedbackQueued
  });

  return {
    startMonitoring,
    stopMonitoring,
    peekFeedback,
    popFeedback,
    getAllQueuedFeedback,
    hasFeedback,
    getFeedbackCount,
    clearFeedbackQueue,
    markCommentAsProcessed,
    initializeWithExistingComments,
    initializeFromCurrentComments,
    getState,
    // Expose for testing
    _internal: {
      checkForNewComments,
      fetchRecentComments,
      isSystemComment,
      formatFeedbackForClaude
    }
  };
};

/**
 * Check if bidirectional interactive mode is supported for the given tool
 *
 * @param {string} tool - Tool name (claude, opencode, codex)
 * @returns {boolean} Whether bidirectional interactive mode is supported
 */
export const isBidirectionalModeSupported = (tool) => {
  // Currently only supported for Claude due to --input-format stream-json support
  return tool === 'claude';
};

/**
 * Validate bidirectional interactive mode configuration
 *
 * @param {Object} argv - Parsed command line arguments
 * @param {Function} log - Logging function
 * @returns {Promise<boolean>} Whether configuration is valid
 */
export const validateBidirectionalModeConfig = async (argv, log) => {
  if (!argv.bidirectionalInteractive) {
    return true; // Not enabled, nothing to validate
  }

  // Check tool support
  if (!isBidirectionalModeSupported(argv.tool)) {
    await log(`⚠️ --bidirectional-interactive is only supported for --tool claude (current: ${argv.tool})`, { level: 'warning' });
    await log('   Bidirectional interactive mode will be disabled for this session.', { level: 'warning' });
    return false;
  }

  // Bidirectional mode requires interactive-mode to be enabled
  if (!argv.interactiveMode) {
    await log('⚠️ --bidirectional-interactive requires --interactive-mode to be enabled', { level: 'warning' });
    await log('   Enabling --interactive-mode automatically.', { level: 'warning' });
    argv.interactiveMode = true;
  }

  await log('🔌 Bidirectional Interactive Mode: ENABLED (experimental)', { level: 'info' });
  await log('   PR comments will be monitored and queued as feedback for Claude.', { level: 'info' });

  return true;
};

// Export utilities for testing
export const utils = {
  isSystemComment,
  formatFeedbackForClaude,
  CONFIG
};

// Export all functions
export default {
  createBidirectionalHandler,
  isBidirectionalModeSupported,
  validateBidirectionalModeConfig,
  utils
};
