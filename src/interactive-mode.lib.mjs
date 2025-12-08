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
  MAX_JSON_DEPTH: 10
};

/**
 * Truncate content in the middle, keeping start and end
 * This helps show context while reducing size for large outputs
 *
 * @param {string} content - Content to potentially truncate
 * @param {Object} options - Truncation options
 * @param {number} [options.maxLines=50] - Maximum lines before truncation
 * @param {number} [options.keepStart=20] - Lines to keep at start
 * @param {number} [options.keepEnd=20] - Lines to keep at end
 * @returns {string} Truncated content with ellipsis indicator
 */
const truncateMiddle = (content, options = {}) => {
  const {
    maxLines = CONFIG.MAX_LINES_BEFORE_TRUNCATION,
    keepStart = CONFIG.LINES_TO_KEEP_START,
    keepEnd = CONFIG.LINES_TO_KEEP_END
  } = options;

  if (!content || typeof content !== 'string') {
    return content || '';
  }

  const lines = content.split('\n');
  if (lines.length <= maxLines) {
    return content;
  }

  const startLines = lines.slice(0, keepStart);
  const endLines = lines.slice(-keepEnd);
  const removedCount = lines.length - keepStart - keepEnd;

  return [
    ...startLines,
    '',
    `... [${removedCount} lines truncated] ...`,
    '',
    ...endLines
  ].join('\n');
};

/**
 * Safely stringify JSON with depth limit and circular reference handling
 *
 * @param {any} obj - Object to stringify
 * @param {number} [indent=2] - Indentation spaces
 * @returns {string} Formatted JSON string
 */
const safeJsonStringify = (obj, indent = 2) => {
  const seen = new WeakSet();
  return JSON.stringify(obj, (key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) {
        return '[Circular]';
      }
      seen.add(value);
    }
    return value;
  }, indent);
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
const createRawJsonSection = (data) => {
  // Ensure data is always an array at root level for easier merging
  const dataArray = Array.isArray(data) ? data : [data];
  const jsonContent = truncateMiddle(safeJsonStringify(dataArray, 2), {
    maxLines: 100,
    keepStart: 40,
    keepEnd: 40
  });
  return createCollapsible(
    '📄 Raw JSON',
    '```json\n' + jsonContent + '\n```'
  );
};

/**
 * Format duration from milliseconds to human-readable string
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Formatted duration (e.g., "12m 7s")
 */
const formatDuration = (ms) => {
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
const formatCost = (cost) => {
  if (typeof cost !== 'number' || isNaN(cost)) return 'unknown';
  return `$${cost.toFixed(2)}`;
};

/**
 * Escape special markdown characters in text
 *
 * @param {string} text - Text to escape
 * @returns {string} Escaped text
 */
const escapeMarkdown = (text) => {
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
const getToolIcon = (toolName) => {
  const icons = {
    'Bash': '💻',
    'Read': '📖',
    'Write': '✏️',
    'Edit': '📝',
    'Glob': '🔍',
    'Grep': '🔎',
    'WebFetch': '🌐',
    'WebSearch': '🔍',
    'TodoWrite': '📋',
    'Task': '🎯',
    'NotebookEdit': '📓',
    'default': '🔧'
  };
  return icons[toolName] || icons.default;
};

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
    toolUseRegistry: new Map()
  };

  /**
   * Post a comment to the PR (with rate limiting)
   * @param {string} body - Comment body
   * @param {string} [toolId] - Optional tool ID for tracking pending tool calls
   * @returns {Promise<string|null>} Comment ID if successful, null if queued or failed
   * @private
   */
  const postComment = async (body, toolId = null) => {
    if (!prNumber || !owner || !repo) {
      if (verbose) {
        await log('⚠️ Interactive mode: Cannot post comment - missing PR info', { verbose: true });
      }
      return null;
    }

    const now = Date.now();
    const timeSinceLastComment = now - state.lastCommentTime;

    if (timeSinceLastComment < CONFIG.MIN_COMMENT_INTERVAL) {
      // Queue the comment for later with toolId for tracking
      state.commentQueue.push({ body, toolId });
      if (verbose) {
        await log(`📝 Interactive mode: Comment queued (${state.commentQueue.length} in queue)${toolId ? ` [tool: ${toolId}]` : ''}`, { verbose: true });
      }
      return null;
    }

    try {
      // Post comment and capture the output to get the comment URL/ID
      const result = await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body ${body}`;
      state.lastCommentTime = Date.now();

      // Extract comment ID from the result (gh outputs the comment URL)
      // Format: https://github.com/owner/repo/pull/123#issuecomment-1234567890
      // Note: command-stream returns stdout as a Buffer, so we need to call .toString()
      const output = result.stdout?.toString() || result.toString() || '';
      const match = output.match(/issuecomment-(\d+)/);
      const commentId = match ? match[1] : null;

      if (verbose) {
        await log(`✅ Interactive mode: Comment posted${commentId ? ` (ID: ${commentId})` : ''}`, { verbose: true });
      }
      return commentId;
    } catch (error) {
      if (verbose) {
        await log(`⚠️ Interactive mode: Failed to post comment: ${error.message}`, { verbose: true });
      }
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

    try {
      await $`gh api repos/${owner}/${repo}/issues/comments/${commentId} -X PATCH -f body=${body}`;
      if (verbose) {
        await log(`✅ Interactive mode: Comment ${commentId} updated`, { verbose: true });
      }
      return true;
    } catch (error) {
      if (verbose) {
        await log(`⚠️ Interactive mode: Failed to edit comment: ${error.message}`, { verbose: true });
      }
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
        const { body, toolId } = queueItem;
        // Post the comment (don't pass toolId to avoid re-queueing)
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
              await log(`📋 Interactive mode: Updated pending tool call ${toolId} with comment ID ${commentId}`, { verbose: true });
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
  const handleSystemInit = async (data) => {
    state.sessionId = data.session_id;
    state.startTime = Date.now();

    const tools = data.tools || [];
    const toolsList = tools.length > 0
      ? tools.map(t => `\`${t}\``).join(', ')
      : '_No tools available_';

    // Format MCP servers
    const mcpServers = data.mcp_servers || [];
    const mcpServersList = mcpServers.length > 0
      ? mcpServers.map(s => `\`${s.name}\` (${s.status || 'unknown'})`).join(', ')
      : '_None_';

    // Format slash commands
    const slashCommands = data.slash_commands || [];
    const slashCommandsList = slashCommands.length > 0
      ? slashCommands.map(c => `\`/${c}\``).join(', ')
      : '_None_';

    // Format agents
    const agents = data.agents || [];
    const agentsList = agents.length > 0
      ? agents.map(a => `\`${a}\``).join(', ')
      : '_None_';

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
      keepEnd: 35
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
        keepEnd: 12
      });
      inputDisplay = createCollapsible(
        '📋 Executed command',
        '```bash\n' + escapeMarkdown(truncatedCommand) + '\n```',
        true
      );
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
          keepEnd: 12
        });
        // Format content as diff with + prefix for added lines
        const diffContent = truncatedContent.split('\n').map(line => `+ ${line}`).join('\n');
        inputDisplay += '\n\n' + createCollapsible(
          '📄 Content',
          '```diff\n' + escapeMarkdown(diffContent) + '\n```'
        );
      }
    } else if (toolName === 'Edit' && input.file_path) {
      inputDisplay = `**File:** \`${input.file_path}\``;
      if (input.old_string && input.new_string) {
        const truncatedOld = truncateMiddle(input.old_string, { maxLines: 15, keepStart: 6, keepEnd: 6 });
        const truncatedNew = truncateMiddle(input.new_string, { maxLines: 15, keepStart: 6, keepEnd: 6 });
        // Format as unified diff with - for removed lines and + for added lines
        const diffOld = truncatedOld.split('\n').map(line => `- ${line}`).join('\n');
        const diffNew = truncatedNew.split('\n').map(line => `+ ${line}`).join('\n');
        inputDisplay += '\n\n' + createCollapsible(
          '🔄 Change',
          '```diff\n' + escapeMarkdown(diffOld + '\n' + diffNew) + '\n```',
          true
        );
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

        todosPreview = [
          ...startTodos,
          `- _...and ${skipped} more_`,
          ...endTodos
        ].join('\n');
      }

      inputDisplay = createCollapsible(
        `📋 Todos (${todos.length} items)`,
        todosPreview,
        true
      );
    } else if (toolName === 'Task') {
      inputDisplay = `**Description:** ${input.description || 'N/A'}`;
      if (input.prompt) {
        const truncatedPrompt = truncateMiddle(input.prompt, { maxLines: 20, keepStart: 8, keepEnd: 8 });
        inputDisplay += '\n\n' + createCollapsible('📝 Prompt', truncatedPrompt);
      }
    } else {
      // Generic input display
      const inputJson = truncateMiddle(safeJsonStringify(input, 2), {
        maxLines: 30,
        keepStart: 12,
        keepEnd: 12
      });
      inputDisplay = createCollapsible(
        '📥 Input',
        '```json\n' + inputJson + '\n```'
      );
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
    const commentIdPromise = new Promise((resolve) => {
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
      toolIcon
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
      await log(`🔧 Interactive mode: Tool use - ${toolName}${commentId ? ` (comment: ${commentId})` : ' (queued)'}`, { verbose: true });
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
      content = toolResult.content.map(c => {
        if (typeof c === 'string') return c;
        if (c.type === 'text') return c.text || '';
        return safeJsonStringify(c);
      }).join('\n');
    }

    // Truncate large outputs
    const truncatedContent = truncateMiddle(content, {
      maxLines: 60,
      keepStart: 25,
      keepEnd: 25
    });

    // Check if we have a pending tool call to merge with
    const pendingCall = state.pendingToolCalls.get(toolUseId);

    if (pendingCall) {
      const { toolData, inputDisplay, toolName, toolIcon, commentIdPromise } = pendingCall;
      let { commentId } = pendingCall;

      // If comment ID is not yet available (comment was queued), wait for it
      // But use a timeout to avoid blocking forever
      if (!commentId && commentIdPromise) {
        if (verbose) {
          await log(`⏳ Interactive mode: Waiting for tool use comment to be posted (tool: ${toolUseId})`, { verbose: true });
        }
        // Wait for the comment to be posted (with 30 second timeout)
        const timeoutPromise = new Promise((resolve) => setTimeout(() => resolve(null), 30000));
        commentId = await Promise.race([commentIdPromise, timeoutPromise]);

        if (!commentId) {
          if (verbose) {
            await log('⚠️ Interactive mode: Timeout waiting for tool use comment, posting result separately', { verbose: true });
          }
        }
      }

      if (commentId) {
        // Create merged comment with both call and result
        const mergedComment = `## ${toolIcon} ${toolName} tool use

${inputDisplay}

${createCollapsible(
  `📤 Output (${statusIcon} ${statusText.toLowerCase()})`,
  '```\n' + escapeMarkdown(truncatedContent) + '\n```',
  true
)}

---

${createRawJsonSection([toolData, data])}`;

        // Edit the existing comment
        const editSuccess = await editComment(commentId, mergedComment);

        if (editSuccess) {
          state.pendingToolCalls.delete(toolUseId);
          if (verbose) {
            await log(`📋 Interactive mode: Tool result merged into comment ${commentId} (${content.length} chars)`, { verbose: true });
          }
          return;
        }
        // If edit failed, fall through to posting new comment
        if (verbose) {
          await log(`⚠️ Interactive mode: Failed to edit comment ${commentId}, posting result separately`, { verbose: true });
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
    const standaloneHeader = standaloneToolName
      ? `${standaloneToolIcon} ${standaloneToolName} tool result`
      : 'Tool result';

    const comment = `## ${standaloneHeader}

${createCollapsible(
  `📤 Output (${statusIcon} ${statusText.toLowerCase()})`,
  '```\n' + escapeMarkdown(truncatedContent) + '\n```',
  true
)}

---

${createRawJsonSection(data)}`;

    await postComment(comment);

    if (verbose) {
      const contentLength = content.length;
      await log(`📋 Interactive mode: Tool result posted as separate comment (${contentLength} chars)`, { verbose: true });
    }
  };

  /**
   * Handle result event (session complete)
   * @param {Object} data - Event data
   */
  const handleResult = async (data) => {
    const isError = data.is_error || false;
    const statusIcon = isError ? '❌' : '✅';
    const statusText = isError ? 'Session Failed' : 'Session Complete';

    // Format result text
    const resultText = data.result || '_No result message_';
    const truncatedResult = truncateMiddle(resultText, {
      maxLines: 50,
      keepStart: 20,
      keepEnd: 20
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

    // Usage breakdown if available
    let usageSection = '';
    if (data.usage) {
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
   * Handle unrecognized event types
   * @param {Object} data - Event data
   */
  const handleUnrecognized = async (data) => {
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
   * Process a single JSON event from Claude CLI
   *
   * @param {Object} data - Parsed JSON object from Claude CLI output
   * @returns {Promise<void>}
   */
  const processEvent = async (data) => {
    if (!data || typeof data !== 'object') {
      return;
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
        } else {
          // Unknown system subtype
          await handleUnrecognized(data);
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
      handleUnrecognized
    }
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

// Export utilities for testing
export const utils = {
  truncateMiddle,
  safeJsonStringify,
  createCollapsible,
  createRawJsonSection,
  formatDuration,
  formatCost,
  escapeMarkdown,
  getToolIcon,
  CONFIG
};

// Export all functions
export default {
  createInteractiveHandler,
  isInteractiveModeSupported,
  validateInteractiveModeConfig,
  utils
};
