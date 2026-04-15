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

// Configuration constants
const CONFIG = {
  // Minimum time between comments to avoid rate limiting (in ms)
  MIN_COMMENT_INTERVAL: 5000,
  // Maximum lines to show before truncation kicks in
  MAX_LINES_BEFORE_TRUNCATION: 50,
  // Lines to keep at start when truncating
  LINES_TO_KEEP_START: 20,
  // Lines to keep at end when truncating
  LINES_TO_KEEP_END: 20,
  // Maximum JSON depth for raw JSON display
  MAX_JSON_DEPTH: 10,
};

// Import sanitizeUnicode from the shared module so that the same logic is used
// everywhere: in the interactive-mode PR-comment path and in the regular
// Claude output parsing path (claude.lib.mjs).
// See: https://github.com/link-assistant/hive-mind/issues/1324
import { sanitizeUnicode } from './unicode-sanitization.lib.mjs';

// Use child_process.spawn for stdin-based API calls to avoid shell quoting
// issues with large/complex comment bodies containing backticks, quotes, etc.
// IMPORTANT: We use spawn (not execFile) because promisify(execFile) silently
// ignores the `input` option — only the sync variants (execFileSync, execSync,
// spawnSync) support `input`. Using execFile with `input` causes `gh api --input -`
// to hang forever waiting for stdin, which blocks the stream processing loop and
// prevents interactive mode from working at all.
// See: https://github.com/link-assistant/hive-mind/issues/1458
// See: https://github.com/link-assistant/hive-mind/issues/1532
import { spawn } from 'node:child_process';

/**
 * Spawn a child process with stdin piping support.
 * Unlike promisify(execFile), this correctly writes `input` to the child's
 * stdin before closing it, so commands like `gh api --input -` work.
 *
 * @param {string} command - The command to run
 * @param {string[]} args - Command arguments
 * @param {Object} [options] - Options
 * @param {string} [options.input] - Data to write to stdin
 * @param {number} [options.maxBuffer=1048576] - Max stdout/stderr buffer size
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
const execFileAsync = (command, args, options = {}) => {
  return new Promise((resolve, reject) => {
    const { input, maxBuffer = 1024 * 1024, ...spawnOpts } = options;
    const child = spawn(command, args, { ...spawnOpts, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    let stdoutLen = 0;
    let stderrLen = 0;
    child.stdout.on('data', chunk => {
      const str = chunk.toString();
      stdoutLen += str.length;
      if (stdoutLen <= maxBuffer) stdout += str;
    });
    child.stderr.on('data', chunk => {
      const str = chunk.toString();
      stderrLen += str.length;
      if (stderrLen <= maxBuffer) stderr += str;
    });
    child.on('error', reject);
    child.on('close', code => {
      if (code !== 0) {
        const err = new Error(`Command failed: ${command} ${args.join(' ')}\n${stderr}`);
        err.code = code;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
      } else {
        resolve({ stdout, stderr });
      }
    });
    if (input != null) {
      child.stdin.write(input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
};

/**
 * Truncate content in the middle, keeping start and end
 * This helps show context while reducing size for large outputs
 *
 * The result is always passed through sanitizeUnicode() so that a truncation
 * point that falls inside a UTF-16 surrogate pair never produces invalid JSON.
 * See: https://github.com/link-assistant/hive-mind/issues/1324
 *
 * @param {string} content - Content to potentially truncate
 * @param {Object} options - Truncation options
 * @param {number} [options.maxLines=50] - Maximum lines before truncation
 * @param {number} [options.keepStart=20] - Lines to keep at start
 * @param {number} [options.keepEnd=20] - Lines to keep at end
 * @returns {string} Truncated, Unicode-sanitized content with ellipsis indicator
 */
const truncateMiddle = (content, options = {}) => {
  const { maxLines = CONFIG.MAX_LINES_BEFORE_TRUNCATION, keepStart = CONFIG.LINES_TO_KEEP_START, keepEnd = CONFIG.LINES_TO_KEEP_END } = options;

  if (!content || typeof content !== 'string') {
    return content || '';
  }

  const lines = content.split('\n');
  if (lines.length <= maxLines) {
    return sanitizeUnicode(content);
  }

  const startLines = lines.slice(0, keepStart);
  const endLines = lines.slice(-keepEnd);
  // Show the actual line number range that was omitted (1-based)
  const omitStart = keepStart + 1;
  const omitEnd = lines.length - keepEnd;

  return sanitizeUnicode([...startLines, '', `... [${omitStart}-${omitEnd} lines are omitted] ...`, '', ...endLines].join('\n'));
};

/**
 * Safely stringify JSON with depth limit and circular reference handling.
 * String values are passed through sanitizeUnicode() so that orphaned UTF-16
 * surrogates (which can appear after persisted-output truncation) never reach
 * JSON.stringify() and cause a 400 API error.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1324
 *
 * @param {any} obj - Object to stringify
 * @param {number} [indent=2] - Indentation spaces
 * @returns {string} Formatted JSON string with sanitized Unicode
 */
const safeJsonStringify = (obj, indent = 2) => {
  const seen = new WeakSet();
  return JSON.stringify(
    obj,
    (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return '[Circular]';
        }
        seen.add(value);
      }
      if (typeof value === 'string') {
        return sanitizeUnicode(value);
      }
      return value;
    },
    indent
  );
};

/**
 * Create a collapsible section in GitHub markdown
 *
 * @param {string} summary - Summary text shown when collapsed
 * @param {string} content - Content shown when expanded
 * @param {boolean} [startOpen=false] - Whether to start expanded
 * @returns {string} GitHub markdown details block
 */
const createCollapsible = (summary, content, startOpen = false) => {
  const openAttr = startOpen ? ' open' : '';
  return `<details${openAttr}>
<summary>${summary}</summary>

${content}

</details>`;
};

/**
 * Create a collapsible raw JSON section
 * Always wraps data in an array for consistent merging
 *
 * @param {Object|Array} data - JSON data to display (will be wrapped in array if not already)
 * @returns {string} Collapsible JSON block
 */
const createRawJsonSection = data => {
  // Ensure data is always an array at root level for easier merging
  const dataArray = Array.isArray(data) ? data : [data];
  const jsonContent = truncateMiddle(safeJsonStringify(dataArray, 2), {
    maxLines: 100,
    keepStart: 40,
    keepEnd: 40,
  });
  return createCollapsible('📄 Raw JSON', '```json\n' + jsonContent + '\n```');
};

/**
 * Format duration from milliseconds to human-readable string
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration (e.g., "12m 7s")
 */
const formatDuration = ms => {
  if (!ms || ms < 0) return 'unknown';

  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`;
  } else {
    return `${seconds}s`;
  }
};

/**
 * Format cost to USD string
 *
 * @param {number} cost - Cost in USD
 * @returns {string} Formatted cost (e.g., "$1.60")
 */
const formatCost = cost => {
  if (typeof cost !== 'number' || isNaN(cost)) return 'unknown';
  return `$${cost.toFixed(2)}`;
};

/**
 * Escape special markdown characters in text
 *
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
const escapeMarkdown = text => {
  if (!text || typeof text !== 'string') return '';
  // Escape backticks that would break code blocks
  return text.replace(/```/g, '\\`\\`\\`');
};

/**
 * Get tool icon based on tool name
 *
 * @param {string} toolName - Name of the tool
 * @returns {string} Emoji icon
 */
const getToolIcon = toolName => {
  const icons = {
    Bash: '💻',
    Read: '📖',
    Write: '✏️',
    Edit: '📝',
    Glob: '🔍',
    Grep: '🔎',
    WebFetch: '🌐',
    WebSearch: '🔍',
    TodoWrite: '📋',
    ToolSearch: '🔍',
    Task: '🎯',
    Agent: '🤖',
    NotebookEdit: '📓',
    default: '🔧',
  };
  return icons[toolName] || icons.default;
};

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
  const { owner, repo, prNumber, log, verbose = false, execFile: execFileFn } = options;
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
    // Issue #1472: Diagnostic counters for tracking comment posting success/failure
    eventsProcessed: 0,
    commentsAttempted: 0,
    commentsPosted: 0,
    commentsFailed: 0,
    editsAttempted: 0,
    editsSucceeded: 0,
    editsFailed: 0,
  };

  /**
   * Post a comment to the PR (with rate limiting)
   * @param {string} body - Comment body
   * @param {string} [toolId] - Optional tool ID for tracking pending tool calls
   * @param {string} [taskId] - Optional task ID for tracking pending agent tasks
   * @returns {Promise<string|null>} Comment ID if successful, null if queued or failed
   * @private
   */
  const postComment = async (body, toolId = null, taskId = null) => {
    if (!prNumber || !owner || !repo) {
      if (verbose) {
        await log('⚠️ Interactive mode: Cannot post comment - missing PR info', { verbose: true });
      }
      return null;
    }

    const now = Date.now();
    const timeSinceLastComment = now - state.lastCommentTime;

    if (timeSinceLastComment < CONFIG.MIN_COMMENT_INTERVAL) {
      // Queue the comment for later with toolId/taskId for tracking
      state.commentQueue.push({ body, toolId, taskId });
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
      const jsonPayload = JSON.stringify({ body });
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

      if (verbose) {
        await log(`✅ Interactive mode: Comment posted${commentId ? ` (ID: ${commentId})` : ''} (body: ${body.length} chars)`, { verbose: true });
      }
      return commentId;
    } catch (error) {
      state.commentsFailed++;
      // Issue #1472: Always log comment failures (not just verbose) — silent failures cause zero-comment bugs
      await log(`⚠️ Interactive mode: Failed to post comment: ${error.message} (body: ${body.length} chars)`);
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

    state.editsAttempted++;
    try {
      // Edit comment via gh api with stdin to avoid shell quoting issues
      // with complex markdown bodies containing backticks, quotes, etc.
      // See: https://github.com/link-assistant/hive-mind/issues/1458
      const apiUrl = `repos/${owner}/${repo}/issues/comments/${commentId}`;
      const jsonPayload = JSON.stringify({ body });
      await runGhApi('gh', ['api', apiUrl, '-X', 'PATCH', '--input', '-'], {
        input: jsonPayload,
        maxBuffer: 10 * 1024 * 1024, // 10MB
      });
      state.editsSucceeded++;
      if (verbose) {
        await log(`✅ Interactive mode: Comment ${commentId} updated (body: ${body.length} chars, payload: ${jsonPayload.length} chars)`, { verbose: true });
      }
      return true;
    } catch (error) {
      state.editsFailed++;
      await log(`⚠️ Interactive mode: Failed to edit comment ${commentId}: ${error.message} (body: ${body.length} chars)`);
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
        const { body, toolId, taskId } = queueItem;
        // Post the comment (don't pass toolId/taskId to avoid re-queueing)
        const commentId = await postComment(body);

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
    const mcpServersList = mcpServers.length > 0 ? mcpServers.map(s => `\`${s.name}\` (${s.status || 'unknown'})`).join(', ') : '_None_';

    // Format slash commands
    const slashCommands = data.slash_commands || [];
    const slashCommandsList = slashCommands.length > 0 ? slashCommands.map(c => `\`/${c}\``).join(', ') : '_None_';

    // Format agents
    const agents = data.agents || [];
    const agentsList = agents.length > 0 ? agents.map(a => `\`${a}\``).join(', ') : '_None_';

    const comment = `## 🚀 Interactive session started

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
    let inputDisplay = '';
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

---

${createRawJsonSection([toolData, data])}`;

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

---

${createRawJsonSection(data)}`;

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

  const handleCodexThreadStarted = async data => {
    if (state.sessionId) return;

    state.sessionId = data.thread_id || data.session_id || null;
    state.startTime = Date.now();

    const comment = `## 🚀 Interactive session started

| Property | Value |
|----------|-------|
| **Session ID** | \`${state.sessionId || 'unknown'}\` |
| **Model** | \`${data.model || 'unknown'}\` |
| **Tool** | \`codex\` |

---

${createRawJsonSection(data)}`;

    await postComment(comment);
  };

  const handleCodexAgentMessage = async data => {
    const text = data.item?.text;
    if (typeof text !== 'string' || !text.trim()) return;
    await handleAssistantText(data, text);
  };

  const handleCodexTodoList = async data => {
    const items = Array.isArray(data.item?.items) ? data.item.items : [];
    const todosPreview = items.length > 0 ? items.map(todo => `- [${todo?.completed ? 'x' : ' '}] ${todo?.text || ''}`).join('\n') : '_No tasks_';
    const completedCount = items.filter(todo => todo?.completed).length;

    const comment = `## 📋 Codex todo list

${createCollapsible(`📋 Todos (${completedCount}/${items.length} items)`, todosPreview, true)}

---

${createRawJsonSection(data)}`;

    await postComment(comment);
  };

  const handleCodexCommandExecution = async data => {
    const item = data.item || {};
    const command = item.command || '';
    const output = item.aggregated_output || '';
    const status = item.status || (data.type === 'item.completed' ? 'completed' : data.type === 'item.updated' ? 'updated' : 'started');
    const body = `## 💻 Codex command execution

**Status:** \`${status}\`
${command ? '\n' + createCollapsible('📋 Executed command', '```bash\n' + escapeMarkdown(command) + '\n```', true) : ''}
${output ? '\n\n' + createCollapsible('📤 Output', '```\n' + escapeMarkdown(truncateMiddle(output, { maxLines: 60, keepStart: 25, keepEnd: 25 })) + '\n```', true) : ''}

---

${createRawJsonSection(data)}`;
    await postComment(body);
  };

  const handleCodexMcpToolCall = async data => {
    const item = data.item || {};
    const summary = [`**Server:** \`${item.server || 'unknown'}\``, `**Tool:** \`${item.tool || 'unknown'}\``, `**Status:** \`${item.status || 'unknown'}\``].join('\n');
    const details = item.arguments != null ? createCollapsible('📥 Arguments', '```json\n' + safeJsonStringify(item.arguments, 2) + '\n```', true) : '';
    const resultSection = item.result != null ? '\n\n' + createCollapsible('📤 Result', '```json\n' + safeJsonStringify(item.result, 2) + '\n```', false) : '';
    const errorSection = item.error != null ? '\n\n' + createCollapsible('❌ Error', '```json\n' + safeJsonStringify(item.error, 2) + '\n```', true) : '';

    await postComment(`## 🔌 Codex MCP tool call

${summary}
${details}${resultSection}${errorSection}

---

${createRawJsonSection(data)}`);
  };

  const handleCodexWebSearch = async data => {
    const item = data.item || {};
    await postComment(`## 🌐 Codex web search

**Query:** ${escapeMarkdown(item.query || 'unknown')}
${item.action ? `\n**Action:** \`${item.action}\`` : ''}

---

${createRawJsonSection(data)}`);
  };

  const handleCodexFileChange = async data => {
    const item = data.item || {};
    const changes = Array.isArray(item.changes) ? item.changes.map(change => `- \`${change?.kind || 'change'}\` ${change?.path || ''}`).join('\n') : '_No changes listed_';
    await postComment(`## 📝 Codex file changes

**Status:** \`${item.status || 'unknown'}\`
${createCollapsible('📄 Files', changes, true)}

---

${createRawJsonSection(data)}`);
  };

  const handleCodexCollabToolCall = async data => {
    const item = data.item || {};
    const prompt = item.prompt || item.description || `${item.tool || 'collab_tool_call'} via codex`;
    await postComment(`## 🤝 Codex collab/sub-agent call

**Tool:** \`${item.tool || 'unknown'}\`
**Status:** \`${item.status || 'unknown'}\`
${createCollapsible('📝 Prompt', escapeMarkdown(truncateMiddle(prompt, { maxLines: 30, keepStart: 12, keepEnd: 12 })), true)}

---

${createRawJsonSection(data)}`);
  };

  const handleCodexTurnCompleted = async data => {
    const usage = data.usage || {};
    let usageSection = '| Type | Count |\n|------|-------|\n';
    usageSection += `| Input | ${(usage.input_tokens || 0).toLocaleString()} |\n`;
    usageSection += `| Cache Read | ${(usage.cached_input_tokens || 0).toLocaleString()} |\n`;
    usageSection += `| Output | ${(usage.output_tokens || 0).toLocaleString()} |\n`;

    await postComment(`## ✅ Codex turn completed

### 📊 Token Usage

${usageSection}

---

${createRawJsonSection(data)}`);
  };

  const handleCodexError = async data => {
    const message = data.message || data.error?.message || 'Unknown Codex error';
    await postComment(`## ❌ Codex error

${createCollapsible('View error', escapeMarkdown(message), true)}

---

${createRawJsonSection(data)}`);
  };

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
 * @param {string} tool - Tool name (claude, opencode, codex)
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

  // Check PR requirement
  // Note: This should be called after PR is created/determined
  // The actual PR number check happens during execution

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
