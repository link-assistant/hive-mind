#!/usr/bin/env node
/**
 * Interactive Mode Library
 *
 * [EXPERIMENTAL] This module provides real-time PR comment updates during Claude execution.
 * It parses Claude CLI's NDJSON output and posts relevant events as GitHub PR comments.
 *
 * Supported JSON event types:
 * - system.init: Session initialization
 * - assistant (text): AI text responses
 * - assistant (tool_use): Tool invocations
 * - user (tool_result): Tool execution results
 * - result: Session completion
 *
 * Usage:
 *   const { createInteractiveHandler } = await import('./interactive-mode.lib.mjs');
 *   const handler = createInteractiveHandler({ owner, repo, prNumber, $ });
 *   await handler.processEvent(jsonObject);
 *
 * @module interactive-mode.lib.mjs
 * @experimental
 */

/**
 * Creates an interactive mode handler for processing Claude CLI events
 *
 * @param {Object} options - Handler configuration
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number} options.prNumber - Pull request number
 * @param {Function} options.$ - command-stream $ function
 * @param {Function} options.log - Logging function
 * @param {boolean} [options.verbose=false] - Enable verbose logging
 * @returns {Object} Handler object with event processing methods
 */
export const createInteractiveHandler = (options) => {
  const { owner, repo, prNumber, $, log, verbose = false } = options;

  // State tracking for the handler
  const state = {
    sessionId: null,
    messageCount: 0,
    toolUseCount: 0,
    lastCommentTime: 0,
    commentQueue: [],
    isProcessing: false
  };

  // Minimum time between comments to avoid rate limiting (in ms)
  const MIN_COMMENT_INTERVAL = 5000;

  /**
   * Post a comment to the PR (with rate limiting)
   * @param {string} body - Comment body
   * @private
   */
  const postComment = async (body) => {
    if (!prNumber || !owner || !repo) {
      if (verbose) {
        await log('⚠️ Interactive mode: Cannot post comment - missing PR info', { verbose: true });
      }
      return;
    }

    const now = Date.now();
    const timeSinceLastComment = now - state.lastCommentTime;

    if (timeSinceLastComment < MIN_COMMENT_INTERVAL) {
      // Queue the comment for later
      state.commentQueue.push(body);
      if (verbose) {
        await log(`📝 Interactive mode: Comment queued (${state.commentQueue.length} in queue)`, { verbose: true });
      }
      return;
    }

    try {
      await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${body}`;
      state.lastCommentTime = Date.now();
      if (verbose) {
        await log('✅ Interactive mode: Comment posted', { verbose: true });
      }
    } catch (error) {
      if (verbose) {
        await log(`⚠️ Interactive mode: Failed to post comment: ${error.message}`, { verbose: true });
      }
    }
  };

  /**
   * Process queued comments
   * @private
   */
  const processQueue = async () => {
    if (state.isProcessing || state.commentQueue.length === 0) {
      return;
    }

    state.isProcessing = true;

    while (state.commentQueue.length > 0) {
      const now = Date.now();
      const timeSinceLastComment = now - state.lastCommentTime;

      if (timeSinceLastComment < MIN_COMMENT_INTERVAL) {
        // Wait until we can post
        await new Promise(resolve => setTimeout(resolve, MIN_COMMENT_INTERVAL - timeSinceLastComment));
      }

      const body = state.commentQueue.shift();
      if (body) {
        await postComment(body);
      }
    }

    state.isProcessing = false;
  };

  /**
   * Handle system.init event
   * @param {Object} data - Event data
   */
  const handleSystemInit = async (data) => {
    state.sessionId = data.session_id;

    // TODO: Implement comment posting for session init
    // Example format:
    // 🚀 **Session Started**
    // - Session ID: `xxx`
    // - Working directory: `/tmp/...`
    // - Available tools: Read, Edit, ...

    if (verbose) {
      await log(`🔌 Interactive mode: Session initialized (${state.sessionId})`, { verbose: true });
    }
  };

  /**
   * Handle assistant text event
   * @param {Object} data - Event data
   * @param {string} text - The text content
   */
  const handleAssistantText = async (data, text) => {
    state.messageCount++;

    // TODO: Implement comment posting for assistant text
    // Consider:
    // - Batching multiple text chunks
    // - Truncating very long texts
    // - Formatting with markdown

    if (verbose) {
      await log(`💬 Interactive mode: Assistant text (${text.length} chars)`, { verbose: true });
    }
  };

  /**
   * Handle assistant tool_use event
   * @param {Object} data - Event data
   * @param {Object} toolUse - Tool use details
   */
  const handleToolUse = async (data, toolUse) => {
    state.toolUseCount++;

    // TODO: Implement comment posting for tool use
    // Example format:
    // 🔧 **Using tool: Bash**
    // ```
    // gh issue view ...
    // ```

    if (verbose) {
      await log(`🔧 Interactive mode: Tool use - ${toolUse.name}`, { verbose: true });
    }
  };

  /**
   * Handle user tool_result event
   * @param {Object} data - Event data
   * @param {Object} toolResult - Tool result details
   */
  const handleToolResult = async (data, toolResult) => {
    // TODO: Implement comment posting for tool results
    // Consider:
    // - Collapsible sections for large outputs
    // - Truncating very long results
    // - Showing success/failure status

    if (verbose) {
      const contentLength = toolResult.content?.length || 0;
      await log(`📋 Interactive mode: Tool result (${contentLength} chars)`, { verbose: true });
    }
  };

  /**
   * Handle result event (session complete)
   * @param {Object} data - Event data
   */
  const handleResult = async (data) => {
    // TODO: Implement comment posting for session result
    // Example format for success:
    // ✅ **Session Complete**
    // - Duration: 12m 7s
    // - Turns: 68
    // - Cost: $1.60
    //
    // Example format for error:
    // ❌ **Session Failed**
    // - Error: Session limit reached
    // - Resets: 10am

    if (verbose) {
      const status = data.is_error ? 'error' : 'success';
      await log(`🏁 Interactive mode: Session ${status}`, { verbose: true });
    }
  };

  /**
   * Process a single JSON event from Claude CLI
   *
   * @param {Object} data - Parsed JSON object from Claude CLI output
   * @returns {Promise<void>}
   */
  const processEvent = async (data) => {
    if (!data || !data.type) {
      return;
    }

    switch (data.type) {
      case 'system':
        if (data.subtype === 'init') {
          await handleSystemInit(data);
        }
        break;

      case 'assistant':
        if (data.message && data.message.content) {
          const content = Array.isArray(data.message.content)
            ? data.message.content
            : [data.message.content];

          for (const item of content) {
            if (item.type === 'text' && item.text) {
              await handleAssistantText(data, item.text);
            } else if (item.type === 'tool_use') {
              await handleToolUse(data, item);
            }
          }
        }
        break;

      case 'user':
        if (data.message && data.message.content) {
          const content = Array.isArray(data.message.content)
            ? data.message.content
            : [data.message.content];

          for (const item of content) {
            if (item.type === 'tool_result') {
              await handleToolResult(data, item);
            }
          }
        }
        break;

      case 'result':
        await handleResult(data);
        break;

      default:
        if (verbose) {
          await log(`❓ Interactive mode: Unknown event type: ${data.type}`, { verbose: true });
        }
    }

    // Process any queued comments
    await processQueue();
  };

  /**
   * Flush any remaining queued comments
   * Should be called at the end of a session
   *
   * @returns {Promise<void>}
   */
  const flush = async () => {
    await processQueue();
  };

  /**
   * Get current handler state (for debugging)
   *
   * @returns {Object} Current state
   */
  const getState = () => ({ ...state });

  return {
    processEvent,
    flush,
    getState
  };
};

/**
 * Check if interactive mode is supported for the given tool
 *
 * @param {string} tool - Tool name (claude, opencode, codex)
 * @returns {boolean} Whether interactive mode is supported
 */
export const isInteractiveModeSupported = (tool) => {
  // Currently only supported for Claude
  return tool === 'claude';
};

/**
 * Validate interactive mode configuration
 *
 * @param {Object} argv - Parsed command line arguments
 * @param {Function} log - Logging function
 * @returns {Promise<boolean>} Whether configuration is valid
 */
export const validateInteractiveModeConfig = async (argv, log) => {
  if (!argv.interactiveMode) {
    return true; // Not enabled, nothing to validate
  }

  // Check tool support
  if (!isInteractiveModeSupported(argv.tool)) {
    await log(`⚠️ --interactive-mode is only supported for --tool claude (current: ${argv.tool})`, { level: 'warning' });
    await log('   Interactive mode will be disabled for this session.', { level: 'warning' });
    return false;
  }

  // Check PR requirement
  // Note: This should be called after PR is created/determined
  // The actual PR number check happens during execution

  await log('🔌 Interactive mode: ENABLED (experimental)', { level: 'info' });
  await log('   Claude output will be posted as PR comments in real-time.', { level: 'info' });

  return true;
};

// Export all functions
export default {
  createInteractiveHandler,
  isInteractiveModeSupported,
  validateInteractiveModeConfig
};
