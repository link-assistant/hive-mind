#!/usr/bin/env node
/**
 * Interactive Mode Library
 *
 * [EXPERIMENTAL] This module provides real-time PR comment updates during tool execution.
 * It parses Claude or Codex JSON output and posts relevant events as GitHub PR comments.
 *
 * Supported Claude JSON event types:
 * - system.init: Session initialization
 * - system.task_started: Agent subtask started (Issue #1450)
 * - system.task_progress: Agent subtask progress update (Issue #1450)
 * - system.task_notification: Agent subtask completed/failed (Issue #1450)
 * - system.thinking_tokens: Accumulated thinking progress (Issue #1900)
 * - system.status / system.compact_boundary / system.task_updated: Status lifecycle events (Issue #1900)
 * - assistant (text): AI text responses
 * - assistant (tool_use): Tool invocations
 * - user (tool_result): Tool execution results
 * - result: Session completion
 * - rate_limit_event: Rate limit info (silently logged, Issue #1450)
 * - unrecognized: Any unknown event types
 *
 * Features:
 * - Full GitHub markdown support with collapsible sections
 * - Smart content truncation (keeps start and end, removes middle)
 * - Collapsed raw JSON in each comment for debugging
 * - Rate limiting and comment queue management
 *
 * Usage:
 *   const { createInteractiveHandler } = await import('./interactive-mode.lib.mjs');
 *   const handler = createInteractiveHandler({ owner, repo, prNumber, $ });
 *   await handler.processEvent(jsonObject);
 *
 * @module interactive-mode.lib.mjs
 * @experimental
 */

import { CONFIG, createCollapsible, createRawJsonSection, createRedactedRawJsonSection, escapeMarkdown, execFileAsync, formatCost, formatDuration, getToolIcon, safeJsonStringify, sanitizeUnicode, truncateMiddle } from './interactive-mode.shared.lib.mjs';
import { createCodexEventHandlers } from './interactive-codex-events.lib.mjs';
import { createSystemLifecycleHandlers } from './interactive-system-events.lib.mjs';
// Issue #1843: turn base64 image tool-results into inline PR-comment images.
import { createImageRenderer, extractImagePayload, isImageNode } from './interactive-image-render.lib.mjs';
import { formatInteractiveMcpServersList, getInteractiveMcpDiagnostics } from './interactive-mcp-status.lib.mjs';
// Issue #1625: track interactive-mode comment IDs so they're excluded from
// the "did the AI post anything?" check in checkForAiCreatedComments().
// Use the session-started marker as the single source of truth for the
// header string, keeping posting and filtering in lock-step.
import { INTERACTIVE_SESSION_STARTED_MARKER, trackToolCommentId } from './tool-comments.lib.mjs';
// Issue #1745: every comment body posted by the AI bridge MUST flow through
// sanitizeCommentBody() before leaving the process. The leak in
// xlab2016/space_db_private#20 happened because raw bash-tool stdout
// (including TELEGRAM_BOT_TOKEN=...) was published verbatim. See
// docs/case-studies/issue-1745/analysis.md for the full timeline.
import { containsKnownToken, getAllKnownLocalTokens, sanitizeCommentBody } from './token-sanitization.lib.mjs';
import { reportInteractiveLeak } from './telegram-leak-notifier.lib.mjs';

/**
 * Creates an interactive mode handler for processing Claude/Codex CLI events
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
export const createInteractiveHandler = options => {
  const {
    owner,
    repo,
    prNumber,
    log,
    verbose = false,
    execFile: execFileFn,
    // Issue #1745: dangerous-skip flags. All default to false; passing them
    // through lets the operator opt out of pattern-based sanitization (for
    // controlled debugging in private repos) while keeping active-token
    // masking on by default.
    skipOutputSanitization = false,
    skipActiveTokensOutputSanitization = false,
    // Pre-existing user content carve-out (issue body / non-bot comments /
    // pre-existing code). When provided, sanitizer leaves these tokens untouched.
    excludeTokens = [],
    // Issue #1843: when true (default), base64 tool-result images are embedded
    // inline; when false they degrade to a metadata note. See createImageRenderer.
    imageUploadEnabled = true,
    mediaRef,
    imageUploader: injectedImageUploader,
  } = options;
  // Use injected execFile for testability, or the real one by default
  const runGhApi = execFileFn || execFileAsync;

  // State tracking for the handler
  const state = {
    sessionId: null,
    messageCount: 0,
    toolUseCount: 0,
    toolResultCount: 0,
    lastCommentTime: 0,
    // Queue stores objects with body and optional toolId for tracking
    // { body: string, toolId?: string }
    commentQueue: [],
    isProcessing: false,
    startTime: Date.now(),
    // Track pending tool calls for merging with results
    // Map of tool_use_id -> { commentId, toolData, inputDisplay, toolName, toolIcon, commentIdPromise, resolveCommentId }
    // commentId may be null initially if comment is queued; commentIdPromise resolves when comment is posted
    pendingToolCalls: new Map(),
    // Simple map of tool_use_id -> { toolName, toolIcon } for standalone tool results
    // This is preserved even after pendingToolCalls entry is deleted
    toolUseRegistry: new Map(),
    // Track active agent tasks for progress update deduplication
    // Map of task_id -> { commentId, toolUseId, description, commentIdPromise, resolveCommentId }
    pendingTasks: new Map(),
    // Track consecutive thinking-token events so high-frequency model progress
    // edits one live comment instead of posting hundreds of PR comments.
    activeThinking: null,
    // Issue #1472: Diagnostic counters for tracking comment posting success/failure
    eventsProcessed: 0,
    commentsAttempted: 0,
    commentsPosted: 0,
    commentsFailed: 0,
    editsAttempted: 0,
    editsSucceeded: 0,
    editsFailed: 0,
  };

  const imageRenderer = createImageRenderer({ owner, repo, prNumber, mediaRef, log, verbose, execFile: execFileFn, enabled: imageUploadEnabled, uploader: injectedImageUploader, state }); // Issue #1843

  /**
   * Sanitize a comment body and warn the chat owner when a known-local token
   * was about to be published. Issue #1745. The returned string is what we
   * actually send to GitHub.
   *
   * @param {string} body
   * @returns {Promise<string>} sanitized body
   * @private
   */
  const sanitizeAndWarn = async body => {
    if (typeof body !== 'string' || body.length === 0) return body;

    let knownTokens;
    try {
      knownTokens = await getAllKnownLocalTokens();
    } catch (err) {
      // Best-effort: if token lookup fails, fall back to regex/secretlint only.
      knownTokens = [];
      if (verbose) {
        await log(`⚠️ Interactive mode: getAllKnownLocalTokens failed: ${err.message}`, { verbose: true });
      }
    }

    let hits;
    try {
      hits = await containsKnownToken(body, knownTokens);
    } catch {
      hits = [];
    }

    let sanitized;
    try {
      sanitized = await sanitizeCommentBody(body, {
        knownTokens,
        skipOutputSanitization,
        skipActiveTokensOutputSanitization,
        excludeTokens,
      });
    } catch (err) {
      await log(`⚠️ Interactive mode: sanitizeCommentBody failed: ${err.message} — falling back to raw body MASKED`);
      // Fail closed: if sanitization fails entirely, drop the body to a safe
      // placeholder rather than leaking. Better to lose detail than secrets.
      sanitized = '[redacted: sanitization failed]';
    }

    if (hits.length > 0) {
      await log(`🚨 Interactive mode: known-local token(s) detected in outbound comment — sanitizer masked them. Sources: ${hits.map(h => h.source).join(', ')}`);
      try {
        await reportInteractiveLeak({
          owner,
          repo,
          prNumber,
          tokenHits: hits,
          log,
        });
      } catch (err) {
        if (verbose) {
          await log(`⚠️ Interactive mode: leak notifier failed: ${err.message}`, { verbose: true });
        }
      }
    }

    return sanitized;
  };

  /**
   * Post a comment to the PR (with rate limiting)
   * @param {string} body - Comment body
   * @param {string} [toolId] - Optional tool ID for tracking pending tool calls
   * @param {string} [taskId] - Optional task ID for tracking pending agent tasks
   * @param {Function} [onPosted] - Optional callback invoked with the posted comment ID
   * @returns {Promise<string|null>} Comment ID if successful, null if queued or failed
   * @private
   */
  const postComment = async (body, toolId = null, taskId = null, onPosted = null) => {
    if (!prNumber || !owner || !repo) {
      if (verbose) {
        await log('⚠️ Interactive mode: Cannot post comment - missing PR info', { verbose: true });
      }
      return null;
    }

    // Issue #1745: sanitize BEFORE rate-limit queuing so queued bodies are
    // also safe (the queue persists across reconnects).
    const safeBody = await sanitizeAndWarn(body);

    const now = Date.now();
    const timeSinceLastComment = now - state.lastCommentTime;

    if (timeSinceLastComment < CONFIG.MIN_COMMENT_INTERVAL) {
      // Queue the comment for later with toolId/taskId for tracking
      state.commentQueue.push({ body: safeBody, toolId, taskId, onPosted });
      if (verbose) {
        await log(`📝 Interactive mode: Comment queued (${state.commentQueue.length} in queue)${toolId ? ` [tool: ${toolId}]` : ''}${taskId ? ` [task: ${taskId}]` : ''}`, { verbose: true });
      }
      return null;
    }

    state.commentsAttempted++;
    try {
      // Post comment via gh api with stdin to avoid shell quoting issues
      // with complex markdown bodies containing backticks, quotes, etc.
      // See: https://github.com/link-assistant/hive-mind/issues/1458
      const apiUrl = `repos/${owner}/${repo}/issues/${prNumber}/comments`;
      const jsonPayload = JSON.stringify({ body: safeBody });
      const { stdout } = await runGhApi('gh', ['api', apiUrl, '-X', 'POST', '--input', '-'], {
        input: jsonPayload,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      state.lastCommentTime = Date.now();
      state.commentsPosted++;

      // Extract comment ID from the API response JSON
      let commentId = null;
      try {
        const response = JSON.parse(stdout);
        commentId = response.id ? String(response.id) : null;
      } catch {
        // Fallback: try to extract from URL pattern
        const match = stdout.match(/issuecomment-(\d+)|"id":\s*(\d+)/);
        commentId = match ? match[1] || match[2] : null;
      }

      // Issue #1625: register this comment ID in the shared in-memory tracking
      // set so --auto-attach-solution-summary correctly excludes it from the
      // AI-authored-comment check. Tracking is a no-op when commentId is null.
      trackToolCommentId(commentId);

      if (commentId && typeof onPosted === 'function') {
        try {
          await onPosted(commentId);
        } catch (error) {
          if (verbose) {
            await log(`⚠️ Interactive mode: post-comment callback failed for ${commentId}: ${error.message}`, { verbose: true });
          }
        }
      }

      if (verbose) {
        await log(`✅ Interactive mode: Comment posted${commentId ? ` (ID: ${commentId})` : ''} (body: ${safeBody.length} chars)`, { verbose: true });
      }
      return commentId;
    } catch (error) {
      state.commentsFailed++;
      // Issue #1472: Always log comment failures (not just verbose) — silent failures cause zero-comment bugs
      await log(`⚠️ Interactive mode: Failed to post comment: ${error.message} (body: ${safeBody.length} chars)`);
      return null;
    }
  };

  /**
   * Edit an existing comment on the PR
   * @param {string} commentId - Comment ID to edit
   * @param {string} body - New comment body
   * @returns {Promise<boolean>} True if successful
   * @private
   */
  const editComment = async (commentId, body) => {
    if (!prNumber || !owner || !repo || !commentId) {
      if (verbose) {
        await log('⚠️ Interactive mode: Cannot edit comment - missing info', { verbose: true });
      }
      return false;
    }

    // Issue #1745: sanitize before sending. editComment is the path that
    // leaked TELEGRAM_BOT_TOKEN in xlab2016/space_db_private#20.
    const safeBody = await sanitizeAndWarn(body);

    state.editsAttempted++;
    try {
      // Edit comment via gh api with stdin to avoid shell quoting issues
      // with complex markdown bodies containing backticks, quotes, etc.
      // See: https://github.com/link-assistant/hive-mind/issues/1458
      const apiUrl = `repos/${owner}/${repo}/issues/comments/${commentId}`;
      const jsonPayload = JSON.stringify({ body: safeBody });
      await runGhApi('gh', ['api', apiUrl, '-X', 'PATCH', '--input', '-'], {
        input: jsonPayload,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      state.editsSucceeded++;
      if (verbose) {
        await log(`✅ Interactive mode: Comment ${commentId} updated (body: ${safeBody.length} chars, payload: ${jsonPayload.length} chars)`, { verbose: true });
      }
      return true;
    } catch (error) {
      state.editsFailed++;
      await log(`⚠️ Interactive mode: Failed to edit comment ${commentId}: ${error.message} (body: ${safeBody.length} chars)`);
      return false;
    }
  };

  /**
   * Process queued comments
   * When a queued comment is posted, if it has an associated toolId,
   * update the pending tool call with the new comment ID
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

      if (timeSinceLastComment < CONFIG.MIN_COMMENT_INTERVAL) {
        // Wait until we can post
        await new Promise(resolve => setTimeout(resolve, CONFIG.MIN_COMMENT_INTERVAL - timeSinceLastComment));
      }

      const queueItem = state.commentQueue.shift();
      if (queueItem) {
        const { body, toolId, taskId, onPosted } = queueItem;
        // Post the comment (don't pass toolId/taskId to avoid re-queueing)
        const commentId = await postComment(body, null, null, onPosted);

        // If this was a tool use comment, update the pending call with the comment ID
        if (toolId && commentId) {
          const pendingCall = state.pendingToolCalls.get(toolId);
          if (pendingCall) {
            pendingCall.commentId = commentId;
            // Resolve the promise so tool_result handler can proceed
            if (pendingCall.resolveCommentId) {
              pendingCall.resolveCommentId(commentId);
            }
            if (verbose) {
              await log(`📋 Interactive mode: Updated pending tool call ${toolId} with comment ID ${commentId}`, {
                verbose: true,
              });
            }
          }
        }

        // If this was a task comment, update the pending task with the comment ID
        // Fix: task comments previously lost their commentId when queued, causing
        // task_notification edits to fail and leaving tasks stuck at "⏳ Running..."
        // See: https://github.com/link-assistant/hive-mind/issues/1576
        if (taskId && commentId) {
          const pendingTask = state.pendingTasks.get(taskId);
          if (pendingTask) {
            pendingTask.commentId = commentId;
            if (pendingTask.resolveCommentId) {
              pendingTask.resolveCommentId(commentId);
            }
            if (verbose) {
              await log(`📋 Interactive mode: Updated pending task ${taskId} with comment ID ${commentId}`, {
                verbose: true,
              });
            }
          }
        }
      }
    }

    state.isProcessing = false;
  };

  /**
   * Handle system.init event
   * @param {Object} data - Event data
   */
  const handleSystemInit = async data => {
    // Guard against duplicate init events (e.g., when a late task_notification
    // arrives after the result event and triggers a new conversation turn)
    // See: https://github.com/link-assistant/hive-mind/issues/1458
    if (state.sessionId) {
      if (verbose) {
        await log(`⚠️ Interactive mode: Ignoring duplicate system.init event (session already initialized: ${state.sessionId})`, { verbose: true });
      }
      return;
    }

    state.sessionId = data.session_id;
    state.startTime = Date.now();

    const tools = data.tools || [];
    const toolsList = tools.length > 0 ? tools.map(t => `\`${t}\``).join(', ') : '_No tools available_';

    // Format MCP servers
    const mcpServers = data.mcp_servers || [];
    const mcpServersList = formatInteractiveMcpServersList(mcpServers);
    const mcpDiagnostics = getInteractiveMcpDiagnostics(mcpServers, tools);
    const mcpDiagnosticsBlock = mcpDiagnostics.length > 0 ? `\n${mcpDiagnostics.map(message => `> ${message}`).join('\n')}\n` : '';

    // Format slash commands
    const slashCommands = data.slash_commands || [];
    const slashCommandsList = slashCommands.length > 0 ? slashCommands.map(c => `\`/${c}\``).join(', ') : '_None_';

    // Format agents
    const agents = data.agents || [];
    const agentsList = agents.length > 0 ? agents.map(a => `\`${a}\``).join(', ') : '_None_';

    const comment = `## 🚀 ${INTERACTIVE_SESSION_STARTED_MARKER}

| Property | Value |
|----------|-------|
| **Session ID** | \`${data.session_id || 'unknown'}\` |
| **Model** | \`${data.model || 'unknown'}\` |
| **Claude Code Version** | \`${data.claude_code_version || 'unknown'}\` |
| **Permission Mode** | \`${data.permissionMode || 'unknown'}\` |
| **Working Directory** | \`${data.cwd || 'unknown'}\` |
| **Available Tools** | ${toolsList} |
| **MCP Servers** | ${mcpServersList} |
| **Slash Commands** | ${slashCommandsList} |
| **Agents** | ${agentsList} |
${mcpDiagnosticsBlock}

---

${createRawJsonSection(data)}`;

    await postComment(comment);

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

    // Truncate very long text responses
    const displayText = truncateMiddle(text, {
      maxLines: 80,
      keepStart: 35,
      keepEnd: 35,
    });

    // Simple format: just the message and collapsed Raw JSON
    const comment = `${displayText}

---

${createRawJsonSection(data)}`;

    await postComment(comment);

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

    const toolName = toolUse.name || 'Unknown';
    const toolIcon = getToolIcon(toolName);
    const toolId = toolUse.id || 'unknown';

    // Register this tool use for potential standalone result rendering
    state.toolUseRegistry.set(toolId, { toolName, toolIcon });

    // Format tool input based on tool type
    let inputDisplay;
    const input = toolUse.input || {};

    if (toolName === 'Bash' && input.command) {
      const truncatedCommand = truncateMiddle(input.command, {
        maxLines: 30,
        keepStart: 12,
        keepEnd: 12,
      });
      inputDisplay = createCollapsible('📋 Executed command', '```bash\n' + escapeMarkdown(truncatedCommand) + '\n```', true);
    } else if (toolName === 'Read' && input.file_path) {
      inputDisplay = `**File:** \`${input.file_path}\``;
      if (input.offset || input.limit) {
        inputDisplay += `\n**Range:** offset=${input.offset || 0}, limit=${input.limit || 'all'}`;
      }
    } else if (toolName === 'Write' && input.file_path) {
      inputDisplay = `**File:** \`${input.file_path}\``;
      if (input.content) {
        const truncatedContent = truncateMiddle(input.content, {
          maxLines: 30,
          keepStart: 12,
          keepEnd: 12,
        });
        // Format content as diff with + prefix and line numbers for added lines
        const diffContent = truncatedContent
          .split('\n')
          .map((line, i) => `+${String(i + 1).padStart(4)} | ${line}`)
          .join('\n');
        inputDisplay += '\n\n' + createCollapsible('📄 Change', '```diff\n' + escapeMarkdown(diffContent) + '\n```', true);
      }
    } else if (toolName === 'Edit' && input.file_path) {
      inputDisplay = `**File:** \`${input.file_path}\``;
      if (input.old_string && input.new_string) {
        const truncatedOld = truncateMiddle(input.old_string, { maxLines: 15, keepStart: 6, keepEnd: 6 });
        const truncatedNew = truncateMiddle(input.new_string, { maxLines: 15, keepStart: 6, keepEnd: 6 });
        // Format as unified diff with - for removed lines and + for added lines, with line numbers
        const diffOld = truncatedOld
          .split('\n')
          .map((line, i) => `-${String(i + 1).padStart(4)} | ${line}`)
          .join('\n');
        const diffNew = truncatedNew
          .split('\n')
          .map((line, i) => `+${String(i + 1).padStart(4)} | ${line}`)
          .join('\n');
        inputDisplay += '\n\n' + createCollapsible('🔄 Change', '```diff\n' + escapeMarkdown(diffOld + '\n' + diffNew) + '\n```', true);
      }
    } else if ((toolName === 'Glob' || toolName === 'Grep') && input.pattern) {
      inputDisplay = `**Pattern:** \`${input.pattern}\``;
      if (input.path) inputDisplay += `\n**Path:** \`${input.path}\``;
    } else if (toolName === 'WebFetch' && input.url) {
      inputDisplay = `**URL:** ${input.url}`;
      if (input.prompt) inputDisplay += `\n**Prompt:** ${input.prompt}`;
    } else if (toolName === 'WebSearch' && input.query) {
      inputDisplay = `**Query:** ${input.query}`;
    } else if (toolName === 'TodoWrite' && input.todos) {
      // Show up to 30 todos, skip items in the middle if more
      const MAX_TODOS_DISPLAY = 30;
      const todos = input.todos;
      let todosPreview;

      if (todos.length <= MAX_TODOS_DISPLAY) {
        // Show all todos if 30 or fewer
        todosPreview = todos.map(t => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.content}`).join('\n');
      } else {
        // Show first 15, "...and N more" in middle, then last 15
        const KEEP_START = 15;
        const KEEP_END = 15;
        const skipped = todos.length - KEEP_START - KEEP_END;

        const startTodos = todos.slice(0, KEEP_START).map(t => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.content}`);
        const endTodos = todos.slice(-KEEP_END).map(t => `- [${t.status === 'completed' ? 'x' : ' '}] ${t.content}`);

        todosPreview = [...startTodos, `- _...and ${skipped} more_`, ...endTodos].join('\n');
      }

      const completedCount = todos.filter(t => t.status === 'completed').length;
      inputDisplay = createCollapsible(`📋 Todos (${completedCount}/${todos.length} items)`, todosPreview, true);
    } else if (toolName === 'Task') {
      inputDisplay = `**Description:** ${input.description || 'N/A'}`;
      if (input.prompt) {
        const truncatedPrompt = truncateMiddle(input.prompt, { maxLines: 20, keepStart: 8, keepEnd: 8 });
        inputDisplay += '\n\n' + createCollapsible('📝 Prompt', truncatedPrompt, true);
      }
    } else if (toolName === 'ToolSearch') {
      inputDisplay = `**Query:** \`${input.query || 'N/A'}\``;
      if (input.max_results) inputDisplay += `\n**Max Results:** ${input.max_results}`;
    } else {
      // Generic input display
      const inputJson = truncateMiddle(safeJsonStringify(input, 2), {
        maxLines: 30,
        keepStart: 12,
        keepEnd: 12,
      });
      inputDisplay = createCollapsible('📥 Input', '```json\n' + inputJson + '\n```');
    }

    // Post the tool use comment and store info for merging with result later
    const comment = `## ${toolIcon} ${toolName} tool use

${inputDisplay}

_⏳ Waiting for result..._

---

${createRawJsonSection(data)}`;

    // Create a promise that will resolve with the comment ID
    // This handles both immediate posting and queued posting
    let resolveCommentId;
    const commentIdPromise = new Promise(resolve => {
      resolveCommentId = resolve;
    });

    // Store pending tool call BEFORE posting to ensure it's tracked
    // even if the comment gets queued
    state.pendingToolCalls.set(toolId, {
      commentId: null, // Will be set when comment is actually posted
      commentIdPromise,
      resolveCommentId,
      toolData: data,
      inputDisplay,
      toolName,
      toolIcon,
    });

    // Post the comment, passing toolId for queue tracking
    const commentId = await postComment(comment, toolId);

    // If posted immediately (not queued), update the pending call and resolve the promise
    if (commentId) {
      const pendingCall = state.pendingToolCalls.get(toolId);
      if (pendingCall) {
        pendingCall.commentId = commentId;
        resolveCommentId(commentId);
      }
    }
    // If queued (commentId is null), processQueue will update it later

    if (verbose) {
      await log(`🔧 Interactive mode: Tool use - ${toolName}${commentId ? ` (comment: ${commentId})` : ' (queued)'}`, {
        verbose: true,
      });
    }
  };

  /**
   * Handle user tool_result event
   * @param {Object} data - Event data
   * @param {Object} toolResult - Tool result details
   */
  const handleToolResult = async (data, toolResult) => {
    state.toolResultCount++;

    const toolUseId = toolResult.tool_use_id || 'unknown';
    const isError = toolResult.is_error || false;
    const statusIcon = isError ? '❌' : '✅';
    const statusText = isError ? 'Error' : 'Success';

    // Get content - can be string or array
    let content = '';
    if (typeof toolResult.content === 'string') {
      content = toolResult.content;
    } else if (Array.isArray(toolResult.content)) {
      content = toolResult.content
        .map(c => {
          if (typeof c === 'string') return c;
          if (c.type === 'text') return c.text || '';
          // Issue #1843: image bytes render in the section below, not the fence.
          if (isImageNode(c)) return `_[image: ${extractImagePayload(c).mediaType}]_`;
          return safeJsonStringify(c);
        })
        .join('\n');
    }

    // Truncate large outputs
    const truncatedContent = truncateMiddle(content, {
      maxLines: 60,
      keepStart: 25,
      keepEnd: 25,
    });

    // Issue #1843: render images this result read/produced (used by both paths).
    const imagesSection = await imageRenderer.section([toolResult.content, data.tool_use_result], imageRenderer.toolLabel(toolUseId));
    const imagesBlock = imagesSection ? `${imagesSection}\n\n` : '';

    // Check if we have a pending tool call to merge with
    const pendingCall = state.pendingToolCalls.get(toolUseId);

    if (pendingCall) {
      const { toolData, inputDisplay, toolName, toolIcon, commentIdPromise } = pendingCall;
      let { commentId } = pendingCall;

      // If comment ID is not yet available (comment was queued), wait for it
      // But use a timeout to avoid blocking forever
      if (!commentId && commentIdPromise) {
        // First, try to flush the queue — the tool_use comment may still be
        // waiting for rate-limit clearance. Processing it here avoids the 30s
        // timeout that previously caused many comments to stay stuck on
        // "Waiting for result...".
        // See: https://github.com/link-assistant/hive-mind/issues/1458
        if (state.commentQueue.length > 0) {
          if (verbose) {
            await log(`🔄 Interactive mode: Flushing comment queue (${state.commentQueue.length} items) before waiting for tool use comment`, {
              verbose: true,
            });
          }
          // Temporarily reset isProcessing to allow processQueue to run
          const wasProcessing = state.isProcessing;
          state.isProcessing = false;
          await processQueue();
          state.isProcessing = wasProcessing;
        }

        // Check again after queue flush
        commentId = pendingCall.commentId;

        if (!commentId) {
          if (verbose) {
            await log(`⏳ Interactive mode: Waiting for tool use comment to be posted (tool: ${toolUseId})`, {
              verbose: true,
            });
          }
          // Wait for the comment to be posted (with 30 second timeout)
          const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 30000));
          commentId = await Promise.race([commentIdPromise, timeoutPromise]);

          if (!commentId) {
            if (verbose) {
              await log('⚠️ Interactive mode: Timeout waiting for tool use comment, posting result separately', {
                verbose: true,
              });
            }
          }
        }
      }

      if (commentId) {
        // Create merged comment with both call and result
        const mergedComment = `## ${toolIcon} ${toolName} tool use

${inputDisplay}

${createCollapsible(`📤 Output (${statusIcon} ${statusText.toLowerCase()})`, '```\n' + escapeMarkdown(truncatedContent) + '\n```', true)}

${imagesBlock}---

${createRedactedRawJsonSection([toolData, data])}`;

        // Edit the existing comment
        const editSuccess = await editComment(commentId, mergedComment);

        if (editSuccess) {
          state.pendingToolCalls.delete(toolUseId);
          if (verbose) {
            await log(`📋 Interactive mode: Tool result merged into comment ${commentId} (${content.length} chars)`, {
              verbose: true,
            });
          }
          return;
        }
        // If edit failed, fall through to posting new comment
        if (verbose) {
          await log(`⚠️ Interactive mode: Failed to edit comment ${commentId}, posting result separately`, {
            verbose: true,
          });
        }
      }

      // Clean up the pending call since we're posting separately
      state.pendingToolCalls.delete(toolUseId);
    }

    // Post as new comment if no pending call or edit failed
    // Look up tool name from registry for better header
    const registryEntry = state.toolUseRegistry.get(toolUseId);
    const standaloneToolName = registryEntry?.toolName;
    const standaloneToolIcon = registryEntry?.toolIcon || '🔧';
    const standaloneHeader = standaloneToolName ? `${standaloneToolIcon} ${standaloneToolName} tool result` : 'Tool result';

    const comment = `## ${standaloneHeader}

${createCollapsible(`📤 Output (${statusIcon} ${statusText.toLowerCase()})`, '```\n' + escapeMarkdown(truncatedContent) + '\n```', true)}

${imagesBlock}---

${createRedactedRawJsonSection(data)}`;

    await postComment(comment);

    if (verbose) {
      const contentLength = content.length;
      await log(`📋 Interactive mode: Tool result posted as separate comment (${contentLength} chars)`, {
        verbose: true,
      });
    }
  };

  /**
   * Handle result event (session complete)
   * @param {Object} data - Event data
   */
  const handleResult = async data => {
    const isError = data.is_error || false;
    const statusIcon = isError ? '❌' : '✅';
    const statusText = isError ? 'Interactive session failed' : 'Interactive session completed';

    // Format result text
    const resultText = data.result || '_No result message_';
    const truncatedResult = truncateMiddle(resultText, {
      maxLines: 50,
      keepStart: 20,
      keepEnd: 20,
    });

    // Build stats table
    let statsTable = '| Metric | Value |\n|--------|-------|\n';
    statsTable += `| **Status** | ${statusText} |\n`;
    statsTable += `| **Session ID** | \`${data.session_id || 'unknown'}\` |\n`;

    if (data.duration_ms) {
      statsTable += `| **Duration** | ${formatDuration(data.duration_ms)} |\n`;
    }
    if (data.duration_api_ms) {
      statsTable += `| **API Time** | ${formatDuration(data.duration_api_ms)} |\n`;
    }
    if (data.num_turns) {
      statsTable += `| **Turns** | ${data.num_turns} |\n`;
    }
    if (typeof data.total_cost_usd === 'number') {
      statsTable += `| **Cost** | ${formatCost(data.total_cost_usd)} |\n`;
    }

    // Usage breakdown — prefer modelUsage (cumulative per-model totals including sub-agents)
    // over usage (which only contains last-iteration tokens and is misleading).
    // See: https://github.com/link-assistant/hive-mind/issues/1576
    let usageSection = '';
    if (data.modelUsage && Object.keys(data.modelUsage).length > 0) {
      usageSection = '\n### 📊 Token Usage (by model)\n\n';
      for (const [model, mu] of Object.entries(data.modelUsage)) {
        usageSection += `**${model}:**\n\n| Type | Count |\n|------|-------|\n`;
        if (mu.inputTokens) usageSection += `| Input | ${mu.inputTokens.toLocaleString()} |\n`;
        if (mu.outputTokens) usageSection += `| Output | ${mu.outputTokens.toLocaleString()} |\n`;
        if (mu.cacheCreationInputTokens) usageSection += `| Cache Creation | ${mu.cacheCreationInputTokens.toLocaleString()} |\n`;
        if (mu.cacheReadInputTokens) usageSection += `| Cache Read | ${mu.cacheReadInputTokens.toLocaleString()} |\n`;
        if (typeof mu.costUSD === 'number') usageSection += `| Cost | ${formatCost(mu.costUSD)} |\n`;
        usageSection += '\n';
      }
    } else if (data.usage) {
      const u = data.usage;
      usageSection = '\n### 📊 Token Usage\n\n| Type | Count |\n|------|-------|\n';
      if (u.input_tokens) usageSection += `| Input | ${u.input_tokens.toLocaleString()} |\n`;
      if (u.output_tokens) usageSection += `| Output | ${u.output_tokens.toLocaleString()} |\n`;
      if (u.cache_creation_input_tokens) usageSection += `| Cache Creation | ${u.cache_creation_input_tokens.toLocaleString()} |\n`;
      if (u.cache_read_input_tokens) usageSection += `| Cache Read | ${u.cache_read_input_tokens.toLocaleString()} |\n`;
    }

    const comment = `## ${statusIcon} ${statusText}

${statsTable}
${usageSection}

### 📝 Result

${createCollapsible('View Result', truncatedResult, !isError)}

---

${createRawJsonSection(data)}`;

    await postComment(comment);

    if (verbose) {
      await log(`🏁 Interactive mode: Session ${statusText.toLowerCase()}`, { verbose: true });
    }
  };

  /**
   * Handle system.task_started event (Agent subtask started)
   * Creates a progress comment that will be updated by task_progress events
   * @param {Object} data - Event data
   */
  const handleTaskStarted = async data => {
    const taskId = data.task_id;
    const toolUseId = data.tool_use_id || '';
    const description = data.description || 'Agent task';
    const taskType = data.task_type || 'unknown';
    const agentId = data.agent_id || taskId;

    // Create a promise for the comment ID (handles queued comments)
    let resolveCommentId;
    const commentIdPromise = new Promise(resolve => {
      resolveCommentId = resolve;
    });

    // Build prompt preview if available
    let promptSection = '';
    if (data.prompt) {
      const truncatedPrompt = truncateMiddle(data.prompt, { maxLines: 15, keepStart: 6, keepEnd: 6 });
      promptSection = '\n\n' + createCollapsible('📝 Task prompt', truncatedPrompt, true);
    }

    const comment = `## 🤖🔀 Agent task: ${escapeMarkdown(description)}

| Property | Value |
|----------|-------|
| **Agent ID** | \`${agentId}\` |
| **Task ID** | \`${taskId || 'unknown'}\` |
| **Type** | \`${taskType}\` |
| **Status** | ⏳ Running... |
${promptSection}

---

${createRawJsonSection(data)}`;

    // Track this task BEFORE posting
    state.pendingTasks.set(taskId, {
      commentId: null,
      commentIdPromise,
      resolveCommentId,
      toolUseId,
      description,
      agentId,
      lastProgressDescription: description,
      progressCount: 0,
      allEvents: [data],
    });

    const commentId = await postComment(comment, null, taskId);

    if (commentId) {
      const pendingTask = state.pendingTasks.get(taskId);
      if (pendingTask) {
        pendingTask.commentId = commentId;
        resolveCommentId(commentId);
      }
    }

    if (verbose) {
      await log(`🤖 Interactive mode: Agent task started - ${description} (task: ${taskId})`, { verbose: true });
    }
  };

  /**
   * Handle system.task_progress event (Agent subtask progress update)
   * Updates the existing task comment instead of creating a new one
   * @param {Object} data - Event data
   */
  const handleTaskProgress = async data => {
    const taskId = data.task_id;
    const description = data.description || 'Working...';
    const lastToolName = data.last_tool_name || '';
    const usage = data.usage || {};

    const pendingTask = state.pendingTasks.get(taskId);

    if (pendingTask) {
      pendingTask.progressCount++;
      pendingTask.lastProgressDescription = description;
      pendingTask.allEvents.push(data);

      let commentId = pendingTask.commentId;

      // Wait for comment ID if not yet available — flush queue first to avoid timeout
      if (!commentId && pendingTask.commentIdPromise) {
        if (state.commentQueue.length > 0) {
          const wasProcessing = state.isProcessing;
          state.isProcessing = false;
          await processQueue();
          state.isProcessing = wasProcessing;
        }
        commentId = pendingTask.commentId;
        if (!commentId) {
          const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 15000));
          commentId = await Promise.race([pendingTask.commentIdPromise, timeoutPromise]);
        }
      }

      if (commentId) {
        // Build progress steps list from accumulated events, marking with agent ID
        const agentTag = pendingTask.agentId ? `\`[${pendingTask.agentId}]\`` : '';
        const progressSteps = pendingTask.allEvents
          .filter(e => e.subtype === 'task_progress')
          .map(e => {
            const toolIcon = e.last_tool_name ? getToolIcon(e.last_tool_name) : '🔄';
            return `- 🔀 ${agentTag} ${toolIcon} ${e.description || 'Working...'}`;
          })
          .join('\n');

        const durationText = usage.duration_ms ? formatDuration(usage.duration_ms) : '';
        const toolUsesText = usage.tool_uses ? `${usage.tool_uses} tool calls` : '';
        const statsText = [durationText, toolUsesText].filter(Boolean).join(' | ');

        const updatedComment = `## 🤖🔀 Agent task: ${escapeMarkdown(pendingTask.description)}

| Property | Value |
|----------|-------|
| **Agent ID** | \`${pendingTask.agentId || taskId}\` |
| **Task ID** | \`${taskId}\` |
| **Status** | ⏳ Running... |
| **Progress** | ${pendingTask.progressCount} updates |
${statsText ? `| **Stats** | ${statsText} |\n` : ''}
${createCollapsible(`📋 Progress steps (${pendingTask.progressCount})`, progressSteps, true)}

---

${createRawJsonSection(pendingTask.allEvents.slice(-3))}`;

        await editComment(commentId, updatedComment);
      }
    } else {
      // No pending task found - this can happen if task_started was missed
      // Just log it silently rather than creating an unrecognized comment
      if (verbose) {
        await log(`🤖 Interactive mode: Task progress for unknown task ${taskId}: ${description}`, { verbose: true });
      }
    }

    if (verbose) {
      await log(`🤖 Interactive mode: Task progress - ${description} (task: ${taskId}, tool: ${lastToolName})`, { verbose: true });
    }
  };

  /**
   * Handle system.task_notification event (Agent subtask completed/failed)
   * Updates the existing task comment with final status
   * @param {Object} data - Event data
   */
  const handleTaskNotification = async data => {
    const taskId = data.task_id;
    const status = data.status || 'unknown';
    const summary = data.summary || data.description || 'Task finished';
    const usage = data.usage || {};
    const isCompleted = status === 'completed';
    const statusIcon = isCompleted ? '✅' : '❌';
    const statusText = isCompleted ? 'Completed' : status.charAt(0).toUpperCase() + status.slice(1);

    const pendingTask = state.pendingTasks.get(taskId);

    if (pendingTask) {
      pendingTask.allEvents.push(data);

      let commentId = pendingTask.commentId;

      // Wait for comment ID if not yet available — flush queue first to avoid timeout
      if (!commentId && pendingTask.commentIdPromise) {
        if (state.commentQueue.length > 0) {
          const wasProcessing = state.isProcessing;
          state.isProcessing = false;
          await processQueue();
          state.isProcessing = wasProcessing;
        }
        commentId = pendingTask.commentId;
        if (!commentId) {
          const timeoutPromise = new Promise(resolve => setTimeout(() => resolve(null), 15000));
          commentId = await Promise.race([pendingTask.commentIdPromise, timeoutPromise]);
        }
      }

      if (commentId) {
        // Build final progress steps list, marking with agent ID
        const agentTag = pendingTask.agentId ? `\`[${pendingTask.agentId}]\`` : '';
        const progressSteps = pendingTask.allEvents
          .filter(e => e.subtype === 'task_progress')
          .map(e => {
            const toolIcon = e.last_tool_name ? getToolIcon(e.last_tool_name) : '🔄';
            return `- 🔀 ${agentTag} ${toolIcon} ${e.description || 'Working...'}`;
          })
          .join('\n');

        const durationText = usage.duration_ms ? formatDuration(usage.duration_ms) : '';
        const toolUsesText = usage.tool_uses ? `${usage.tool_uses} tool calls` : '';
        const tokensText = usage.total_tokens ? `${usage.total_tokens.toLocaleString()} tokens` : '';
        const statsText = [durationText, toolUsesText, tokensText].filter(Boolean).join(' | ');

        const updatedComment = `## 🤖🔀 Agent task: ${escapeMarkdown(pendingTask.description)}

| Property | Value |
|----------|-------|
| **Agent ID** | \`${pendingTask.agentId || taskId}\` |
| **Task ID** | \`${taskId}\` |
| **Status** | ${statusIcon} ${statusText} |
| **Summary** | ${escapeMarkdown(summary)} |
${statsText ? `| **Stats** | ${statsText} |\n` : ''}
${progressSteps ? createCollapsible(`📋 Progress steps (${pendingTask.progressCount})`, progressSteps) : ''}

---

${createRawJsonSection([pendingTask.allEvents[0], data])}`;

        await editComment(commentId, updatedComment);
      }

      // Clean up
      state.pendingTasks.delete(taskId);
    } else {
      // Post as standalone if no pending task
      const agentId = data.agent_id || taskId;
      const comment = `## 🤖🔀 Agent task ${statusIcon} ${statusText}

| **Agent ID** | \`${agentId}\` |
|---|---|
**Summary:** ${escapeMarkdown(summary)}

---

${createRawJsonSection(data)}`;

      await postComment(comment);
    }

    if (verbose) {
      await log(`🤖 Interactive mode: Task ${statusText.toLowerCase()} - ${summary} (task: ${taskId})`, {
        verbose: true,
      });
    }
  };

  const { handleThinkingTokens, finalizeThinkingGroup, handleSystemStatus, handleCompactBoundary, handleTaskUpdated } = createSystemLifecycleHandlers({
    state,
    owner,
    repo,
    prNumber,
    log,
    verbose,
    postComment,
    editComment,
    processQueue,
    handleTaskProgress,
    handleTaskNotification,
  });

  /**
   * Handle rate_limit_event (silently logged, no comment created)
   * @param {Object} data - Event data
   */
  const handleRateLimitEvent = async data => {
    // Rate limit events are internal/informational - log but don't create a PR comment
    if (verbose) {
      const info = data.rate_limit_info || {};
      await log(`⏱️ Interactive mode: Rate limit event - status: ${info.status || 'unknown'}, type: ${info.rateLimitType || 'unknown'}`, { verbose: true });
    }
  };

  const { handleCodexThreadStarted, handleCodexAgentMessage, handleCodexTodoList, handleCodexCommandExecution, handleCodexMcpToolCall, handleCodexWebSearch, handleCodexFileChange, handleCodexCollabToolCall, handleCodexTurnCompleted, handleCodexError } = createCodexEventHandlers({
    state,
    postComment,
    handleAssistantText,
    imageRenderer,
  });

  /**
   * Handle unrecognized event types
   * @param {Object} data - Event data
   */
  const handleUnrecognized = async data => {
    const eventType = data.type || 'unknown';
    const subtype = data.subtype ? `.${data.subtype}` : '';

    const comment = `## ❓ Unrecognized Event: \`${eventType}${subtype}\`

This event type is not yet supported by interactive mode.

${createRawJsonSection(data)}`;

    await postComment(comment);

    if (verbose) {
      await log(`❓ Interactive mode: Unrecognized event type: ${eventType}${subtype}`, { verbose: true });
    }
  };

  /**
   * Process a single JSON event from Claude or Codex CLI
   *
   * @param {Object} data - Parsed JSON object from Claude CLI output
   * @returns {Promise<void>}
   */
  const processEvent = async data => {
    if (!data || typeof data !== 'object') {
      return;
    }
    state.eventsProcessed++;

    const isThinkingTokenEvent = data.type === 'system' && data.subtype === 'thinking_tokens';
    if (!isThinkingTokenEvent) {
      await finalizeThinkingGroup();
    }

    // Handle events without type as unrecognized
    if (!data.type) {
      await handleUnrecognized(data);
      return;
    }

    switch (data.type) {
      case 'system':
        if (data.subtype === 'init') {
          await handleSystemInit(data);
        } else if (data.subtype === 'task_started') {
          await handleTaskStarted(data);
        } else if (data.subtype === 'task_progress') {
          await handleTaskProgress(data);
        } else if (data.subtype === 'task_notification') {
          await handleTaskNotification(data);
        } else if (data.subtype === 'thinking_tokens') {
          await handleThinkingTokens(data);
        } else if (data.subtype === 'status') {
          await handleSystemStatus(data);
        } else if (data.subtype === 'compact_boundary') {
          await handleCompactBoundary(data);
        } else if (data.subtype === 'task_updated') {
          await handleTaskUpdated(data);
        } else {
          // Unknown system subtype
          await handleUnrecognized(data);
        }
        break;

      case 'rate_limit_event':
        await handleRateLimitEvent(data);
        break;

      case 'assistant':
        if (data.message && data.message.content) {
          const content = Array.isArray(data.message.content) ? data.message.content : [data.message.content];

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
          const content = Array.isArray(data.message.content) ? data.message.content : [data.message.content];

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

      case 'thread.started':
        await handleCodexThreadStarted(data);
        break;

      case 'turn.completed':
        await handleCodexTurnCompleted(data);
        break;

      case 'error':
        await handleCodexError(data);
        break;

      case 'item.started':
      case 'item.updated':
      case 'item.completed': {
        const itemType = data.item?.type;
        if (itemType === 'agent_message') {
          await handleCodexAgentMessage(data);
        } else if (itemType === 'todo_list') {
          await handleCodexTodoList(data);
        } else if (itemType === 'command_execution') {
          await handleCodexCommandExecution(data);
        } else if (itemType === 'mcp_tool_call') {
          await handleCodexMcpToolCall(data);
        } else if (itemType === 'web_search') {
          await handleCodexWebSearch(data);
        } else if (itemType === 'file_change') {
          await handleCodexFileChange(data);
        } else if (itemType === 'collab_tool_call') {
          await handleCodexCollabToolCall(data);
        } else if (itemType === 'error') {
          await handleCodexError(data.item);
        }
        break;
      }

      default:
        await handleUnrecognized(data);
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
    await finalizeThinkingGroup();
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
    getState,
    imageUploader: imageRenderer.uploader, // Issue #1843: exposed for callers/tests.
    // Expose individual handlers for testing
    _handlers: {
      handleSystemInit,
      handleAssistantText,
      handleToolUse,
      handleToolResult,
      handleResult,
      handleTaskStarted,
      handleTaskProgress,
      handleTaskNotification,
      handleThinkingTokens,
      finalizeThinkingGroup,
      handleSystemStatus,
      handleCompactBoundary,
      handleTaskUpdated,
      handleRateLimitEvent,
      handleUnrecognized,
      handleCodexThreadStarted,
      handleCodexAgentMessage,
      handleCodexTodoList,
      handleCodexCommandExecution,
      handleCodexMcpToolCall,
      handleCodexWebSearch,
      handleCodexFileChange,
      handleCodexCollabToolCall,
      handleCodexTurnCompleted,
      handleCodexError,
    },
  };
};

/**
 * Check if interactive mode is supported for the given tool
 *
 * @param {string} tool - Tool name (claude, opencode, codex, agent, gemini)
 * @returns {boolean} Whether interactive mode is supported
 */
export const isInteractiveModeSupported = tool => {
  return tool === 'claude' || tool === 'codex';
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
    await log(`⚠️ --interactive-mode is only supported for --tool claude and --tool codex (current: ${argv.tool})`, {
      level: 'warning',
    });
    await log('   Interactive mode will be disabled for this session.', { level: 'warning' });
    return false;
  }

  await log('🔌 Interactive mode: ENABLED (experimental)', { level: 'info' });
  await log(`   ${argv.tool || 'claude'} output will be posted as PR comments in real-time.`, { level: 'info' });

  return true;
};

// Export utilities for testing
export const utils = {
  sanitizeUnicode,
  truncateMiddle,
  safeJsonStringify,
  createCollapsible,
  createRawJsonSection,
  formatDuration,
  formatCost,
  escapeMarkdown,
  getToolIcon,
  execFileAsync,
  CONFIG,
};

// Export all functions
export default {
  createInteractiveHandler,
  isInteractiveModeSupported,
  validateInteractiveModeConfig,
  utils,
};
