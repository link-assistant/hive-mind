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
  // Default keep-alive for the headless Claude process between stream-json
  // turns. Claude Code exits after this many ms with no new input once it
  // has replied, so new PR comments have a window to flow in as additional
  // user messages. Issue #817.
  DEFAULT_EXIT_AFTER_STOP_DELAY_MS: 60_000,
  // Signature to identify system-generated comments
  SYSTEM_COMMENT_SIGNATURES: ['## 🚀 Session Started', '## 💬 Assistant Response', '## 💻 Tool: ', '## 📝 Tool: ', '## 📖 Tool: ', '## ✏️ Tool: ', '## 🔍 Tool: ', '## 🔎 Tool: ', '## 🌐 Tool: ', '## 📋 Tool: ', '## 🎯 Tool: ', '## 📓 Tool: ', '## 🔧 Tool: ', '## ✅ Tool Result:', '## ❌ Tool Result:', '## ✅ Session Complete', '## ❌ Session Failed', '## ❓ Unrecognized Event:', '📄 Raw JSON', '🤖 Generated with [Claude Code]', '🤖 AI-Powered Solution Draft', '*This PR was created automatically by the AI issue solver*'],
};

/**
 * Check if a comment body is system-generated (from interactive mode)
 *
 * @param {string} body - Comment body to check
 * @returns {boolean} True if the comment is system-generated
 */
const isSystemComment = body => {
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
const formatFeedbackForClaude = feedbackText => {
  const message = {
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `[USER FEEDBACK FROM PR COMMENT]\n\n${feedbackText}\n\n[END OF USER FEEDBACK - Please address this feedback in your current work]`,
        },
      ],
    },
  };
  return JSON.stringify(message);
};

/**
 * Build the first stream-json user frame for a Claude Code headless session.
 *
 * Issue #817: When --accept-incomming-comments-as-input is enabled, solve
 * spawns Claude with `--input-format stream-json` and a pipe stdin. The
 * initial user prompt must therefore be delivered as a NDJSON frame rather
 * than via `-p`. This matches the pattern from the reference gist
 * `claude-stream-persistent.mjs`.
 *
 * @param {string} promptText - The initial user prompt
 * @param {Object} [options]
 * @param {string} [options.sessionId] - Optional session_id to stamp on the frame
 * @returns {string} NDJSON-ready JSON string (no trailing newline)
 */
const buildInitialUserFrame = (promptText, options = {}) => {
  const frame = {
    type: 'user',
    message: {
      role: 'user',
      content: [{ type: 'text', text: String(promptText ?? '') }],
    },
    parent_tool_use_id: null,
  };
  if (options.sessionId) frame.session_id = options.sessionId;
  return JSON.stringify(frame);
};

/**
 * Write one NDJSON frame into a live Claude stdin stream.
 *
 * Returns true on a successful write, false when the stream is missing or
 * closed. Never throws — callers just log and continue. Internal helper used
 * by both the comment-polling loop and `streamInitialPrompt`.
 *
 * @param {Object} stream - A writable stream (child.stdin)
 * @param {string} jsonFrame - A single JSON frame (no trailing newline)
 * @param {Function} [logFn] - Optional logger
 * @param {boolean} [verbose=false]
 * @returns {Promise<boolean>}
 * @private
 */
const writeFrameToStdin = async (stream, jsonFrame, logFn, verbose = false) => {
  if (!stream || typeof stream.write !== 'function') return false;
  if (stream.destroyed || stream.writableEnded || stream.closed) return false;
  try {
    stream.write(`${jsonFrame}\n`);
    return true;
  } catch (err) {
    if (logFn && verbose) {
      try {
        await logFn(`⚠️ Bidirectional mode: Failed to write to Claude stdin: ${err.message}`, { verbose: true });
      } catch {
        /* ignore logger errors */
      }
    }
    return false;
  }
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
 * @param {boolean} [options.excludeOwnComments=false] - Exclude comments authored by the same GitHub user that solve runs as (prevents "talking to yourself")
 * @returns {Object} Handler object with monitoring methods
 */
export const createBidirectionalHandler = options => {
  const { owner, repo, prNumber, $, log, verbose = false, pollInterval = CONFIG.DEFAULT_POLL_INTERVAL, excludeOwnComments = false } = options;
  // Resolved lazily on first check, cached for the lifetime of the handler
  let ownUserLogin = null;
  let ownUserResolved = false;
  const resolveOwnUserLogin = async () => {
    if (ownUserResolved) return ownUserLogin;
    try {
      const result = await $`gh api user --jq .login`;
      ownUserLogin = (result.stdout?.toString() || '').trim() || null;
    } catch (error) {
      if (verbose) {
        await log(`⚠️ Bidirectional mode: Could not resolve current gh user: ${error.message}`, { verbose: true });
      }
      ownUserLogin = null;
    }
    ownUserResolved = true;
    return ownUserLogin;
  };

  // State tracking for the handler
  const state = {
    isMonitoring: false,
    lastCheckedCommentId: null,
    lastCheckedTimestamp: null,
    feedbackQueue: [],
    pollIntervalId: null,
    processedCommentIds: new Set(),
    totalCommentsProcessed: 0,
    totalFeedbackQueued: 0,
    // Issue #817: Writable stdin of the live Claude process. When set, new
    // non-system comments are written directly as NDJSON frames rather than
    // only accumulated in feedbackQueue.
    claudeStdin: null,
    totalFeedbackStreamed: 0,
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
      // Fetch comments using gh api with pagination (GitHub defaults to 30/page), sorted by created_at desc
      const result = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --paginate --jq '[.[] | {id: .id, body: .body, created_at: .created_at, user: .user.login}] | sort_by(.created_at) | reverse'`;
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

      // Resolve current user login once if we need to exclude own comments
      const ownLogin = excludeOwnComments ? await resolveOwnUserLogin() : null;

      // Filter for new comments we haven't processed yet
      for (const comment of comments) {
        // Skip if already processed
        if (state.processedCommentIds.has(comment.id)) {
          continue;
        }

        // Skip if this is a system-generated comment (comments generated by our own solve command)
        if (isSystemComment(comment.body)) {
          state.processedCommentIds.add(comment.id);
          continue;
        }

        // Issue #817: Optionally skip comments authored by the same GitHub user that solve runs as
        if (excludeOwnComments && ownLogin && comment.user === ownLogin) {
          if (verbose) {
            await log(`⏭️ Bidirectional mode: Skipping comment #${comment.id} from own user @${ownLogin} (--exclude-all-own-incomming-comments-from-input)`, { verbose: true });
          }
          state.processedCommentIds.add(comment.id);
          continue;
        }

        // This is a new user comment - queue it as feedback
        if (state.feedbackQueue.length < CONFIG.MAX_QUEUE_SIZE) {
          const formattedMessage = formatFeedbackForClaude(comment.body);
          state.feedbackQueue.push({
            id: comment.id,
            body: comment.body,
            user: comment.user,
            created_at: comment.created_at,
            formattedMessage,
          });
          state.totalFeedbackQueued++;

          if (verbose) {
            await log(`📥 Bidirectional mode: Queued feedback from @${comment.user} (comment #${comment.id})`, { verbose: true });
          }

          // Issue #817: If we have a live Claude stdin attached, stream the
          // comment as an NDJSON frame right now so Claude can pick it up on
          // the next turn. This is the core of "real JSON streaming input"
          // requested in the issue and the reference gist.
          if (state.claudeStdin) {
            const streamed = await writeFrameToStdin(state.claudeStdin, formattedMessage, log, verbose);
            if (streamed) {
              state.totalFeedbackStreamed++;
              if (verbose) {
                await log(`📤 Bidirectional mode: Streamed feedback from @${comment.user} (comment #${comment.id}) into Claude stdin`, { verbose: true });
              }
            }
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
  const markCommentAsProcessed = commentId => {
    state.processedCommentIds.add(commentId);
  };

  /**
   * Initialize with existing comment IDs to skip
   * Call this before startMonitoring() to avoid processing old comments
   *
   * @param {Array<number>} commentIds - Array of comment IDs to skip
   */
  const initializeWithExistingComments = commentIds => {
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
   * Attach a live Claude stdin stream to the handler.
   *
   * Issue #817: Once attached, every new non-system comment detected by the
   * polling loop is also written to this stream as a NDJSON `user` frame.
   * Safe to call before or after monitoring starts.
   *
   * @param {Object} stream - Writable stream (child.stdin)
   */
  const attachClaudeStdin = stream => {
    state.claudeStdin = stream || null;
  };

  /**
   * Detach the Claude stdin stream. After this call, comments are only queued.
   */
  const detachClaudeStdin = () => {
    state.claudeStdin = null;
  };

  /**
   * Stream the initial user prompt as a stream-json frame into the attached
   * Claude stdin. Use this when running Claude with `--input-format stream-json`.
   *
   * @param {string} promptText
   * @param {Object} [options]
   * @param {string} [options.sessionId]
   * @returns {Promise<boolean>} Whether the write succeeded
   */
  const streamInitialPrompt = async (promptText, options = {}) => {
    if (!state.claudeStdin) return false;
    const frame = buildInitialUserFrame(promptText, options);
    return writeFrameToStdin(state.claudeStdin, frame, log, verbose);
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
    totalFeedbackQueued: state.totalFeedbackQueued,
    totalFeedbackStreamed: state.totalFeedbackStreamed,
    isStreamingAttached: !!state.claudeStdin,
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
    attachClaudeStdin,
    detachClaudeStdin,
    streamInitialPrompt,
    getState,
    // Expose for testing
    _internal: {
      checkForNewComments,
      fetchRecentComments,
      isSystemComment,
      formatFeedbackForClaude,
      buildInitialUserFrame,
      writeFrameToStdin,
    },
  };
};

/**
 * Check if bidirectional interactive mode is supported for the given tool
 *
 * @param {string} tool - Tool name (claude, opencode, codex)
 * @returns {boolean} Whether bidirectional interactive mode is supported
 */
export const isBidirectionalModeSupported = tool => {
  // Currently only supported for Claude due to --input-format stream-json support
  return tool === 'claude';
};

/**
 * Apply bidirectional interactive mode composition and validation.
 *
 * Semantics (Issue #817):
 * - --bidirectional-interactive-mode is a convenience flag that automatically enables
 *   --interactive-mode, --accept-incomming-comments-as-input and
 *   --exclude-all-own-incomming-comments-from-input.
 * - Individual flags can still be used on their own (e.g. --interactive-mode with
 *   --accept-incomming-comments-as-input but without --exclude-all-own-..., which lets
 *   the same GitHub user "talk to themself").
 * - All three flags default to disabled and the behavior is experimental.
 *
 * @param {Object} argv - Parsed command line arguments (mutated in place)
 * @param {Function} log - Logging function
 * @returns {Promise<boolean>} Whether configuration is valid for the chosen tool
 */
export const validateBidirectionalModeConfig = async (argv, log) => {
  // Composition: --bidirectional-interactive-mode implies the three experimental flags.
  if (argv.bidirectionalInteractiveMode) {
    if (!argv.interactiveMode) argv.interactiveMode = true;
    if (!argv.acceptIncommingCommentsAsInput) argv.acceptIncommingCommentsAsInput = true;
    if (!argv.excludeAllOwnIncommingCommentsFromInput) argv.excludeAllOwnIncommingCommentsFromInput = true;
  }

  // Nothing more to validate if no incoming-comment acceptance is requested
  if (!argv.acceptIncommingCommentsAsInput) return true;

  // Tool support: currently only Claude (uses --input-format stream-json)
  if (!isBidirectionalModeSupported(argv.tool)) {
    await log(`⚠️ --accept-incomming-comments-as-input is only supported for --tool claude (current: ${argv.tool})`, { level: 'warning' });
    await log('   Incoming-comment acceptance will be disabled for this session.', { level: 'warning' });
    argv.acceptIncommingCommentsAsInput = false;
    argv.excludeAllOwnIncommingCommentsFromInput = false;
    return false;
  }

  await log('🔌 Bidirectional Interactive Mode: ENABLED (experimental)', { level: 'info' });
  await log(`   accept-incomming-comments-as-input: true${argv.excludeAllOwnIncommingCommentsFromInput ? ', exclude-all-own-incomming-comments-from-input: true' : ''}`, { level: 'info' });
  await log('   PR comments will be monitored and queued as feedback for Claude.', { level: 'info' });

  return true;
};

/**
 * Set up the bidirectional handler for an execution. Returns `null` when the
 * feature is not requested or PR info is missing — callers can treat a null
 * return as "no-op".
 *
 * @param {Object} params
 * @param {Object} params.argv - Parsed CLI args (expects `acceptIncommingCommentsAsInput`,
 *   `excludeAllOwnIncommingCommentsFromInput`, `verbose`).
 * @param {string} params.owner
 * @param {string} params.repo
 * @param {string|number} params.prNumber
 * @param {Function} params.$ - command-stream tagged template
 * @param {Function} params.log
 * @returns {Promise<Object|null>} Started handler or null when inactive.
 */
export const setupBidirectionalHandler = async ({ argv, owner, repo, prNumber, $, log }) => {
  if (!argv.acceptIncommingCommentsAsInput) return null;
  if (!owner || !repo || !prNumber) {
    await log('⚠️ Bidirectional mode: Disabled - missing PR info (owner/repo/prNumber)', { verbose: true });
    return null;
  }
  await log('🔌 Bidirectional mode: Creating handler to accept incoming PR comments as Claude input', { verbose: true });
  const handler = createBidirectionalHandler({
    owner,
    repo,
    prNumber,
    $,
    log,
    verbose: argv.verbose,
    pollInterval: 15000,
    excludeOwnComments: !!argv.excludeAllOwnIncommingCommentsFromInput,
  });
  await handler.initializeFromCurrentComments();
  await handler.startMonitoring();
  await log('🔌 Bidirectional mode: Started monitoring PR comments for feedback', { verbose: true });
  return handler;
};

/**
 * Attach a live Claude process to the handler so new comments stream into
 * its stdin as NDJSON frames. Also writes the initial user prompt as the
 * first frame so the run starts normally. Issue #817.
 *
 * Safe to call with a null handler (no-op). Logs diagnostics but never throws.
 *
 * @param {Object|null} handler - Handler from setupBidirectionalHandler, or null
 * @param {Object} execCommand - command-stream ProcessRunner with `streams.stdin`
 * @param {string} prompt - Initial user prompt text
 * @param {Function} log
 * @param {boolean} [verbose=false]
 * @returns {Promise<boolean>} Whether streaming input is active
 */
export const attachStreamingInput = async (handler, execCommand, prompt, log, verbose = false) => {
  if (!handler || !execCommand) return false;
  try {
    const stdinStream = await execCommand.streams.stdin;
    if (!stdinStream) {
      if (verbose) await log('⚠️ Bidirectional mode: Could not acquire Claude stdin stream; falling back to queued-only feedback.', { verbose: true });
      return false;
    }
    handler.attachClaudeStdin(stdinStream);
    const ok = await handler.streamInitialPrompt(prompt);
    if (verbose) await log(`🔌 Bidirectional mode: Streaming input ${ok ? 'ENABLED' : 'FAILED'} (wrote initial user frame to Claude stdin).`, { verbose: true });
    return ok;
  } catch (attachError) {
    await log(`⚠️ Bidirectional mode: Failed to attach stdin (${attachError.message}); continuing without live streaming.`, { verbose: true });
    return false;
  }
};

/**
 * Stop the handler, flush its queue, and log a summary. Safe to call with a
 * null handler (returns an empty array).
 *
 * @param {Object|null} handler - Handler returned by setupBidirectionalHandler, or null.
 * @param {Function} log
 * @returns {Promise<Array>} Queued feedback messages (possibly empty).
 */
export const finalizeBidirectionalHandler = async (handler, log) => {
  if (!handler) return [];
  try {
    handler.detachClaudeStdin?.();
    await handler.stopMonitoring();
    const state = handler.getState();
    const queuedFeedback = handler.getAllQueuedFeedback();
    if (queuedFeedback.length > 0) {
      await log(`\n📥 Bidirectional mode: ${queuedFeedback.length} feedback message(s) received during execution`, { level: 'info' });
      for (const feedback of queuedFeedback) {
        await log(`   • From @${feedback.user}: ${feedback.body.substring(0, 100)}${feedback.body.length > 100 ? '...' : ''}`, { level: 'info' });
      }
      if (state.totalFeedbackStreamed > 0) {
        await log(`   📤 ${state.totalFeedbackStreamed} of these were streamed live into Claude stdin.`, { level: 'info' });
      } else {
        await log('   💡 This feedback will be available for the next continuation of this task.', { level: 'info' });
      }
    } else {
      await log('📊 Bidirectional mode: No new feedback received during execution', { verbose: true });
    }
    await log(`📊 Bidirectional mode stats: ${state.totalCommentsProcessed} comments processed, ${state.totalFeedbackQueued} feedback queued, ${state.totalFeedbackStreamed} streamed into Claude stdin`, { verbose: true });
    return queuedFeedback;
  } catch (bidirectionalError) {
    await log(`⚠️ Bidirectional mode cleanup error: ${bidirectionalError.message}`, { verbose: true });
    return [];
  }
};

// Export utilities for testing
export const utils = {
  isSystemComment,
  formatFeedbackForClaude,
  buildInitialUserFrame,
  writeFrameToStdin,
  CONFIG,
};

// Export all functions
export default {
  createBidirectionalHandler,
  isBidirectionalModeSupported,
  validateBidirectionalModeConfig,
  setupBidirectionalHandler,
  finalizeBidirectionalHandler,
  utils,
};
