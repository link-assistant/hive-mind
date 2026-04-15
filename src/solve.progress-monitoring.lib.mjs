#!/usr/bin/env node
/**
 * Progress Monitoring Library
 *
 * [EXPERIMENTAL] This module provides live progress monitoring for work sessions
 * by tracking TODO list updates and reflecting them in PR comments or descriptions.
 *
 * Display modes:
 * - "comment" (default): Creates a per-session PR comment with updatable progress section
 * - "pr": Updates the PR description with a live progress section
 *
 * Features:
 * - Tracks TODO list state from TodoWrite tool calls
 * - Calculates progress percentage (completed/total)
 * - Generates progress bar visualization
 * - Task list is always shown expanded (never collapsible)
 *
 * Usage:
 *   const { createProgressMonitor } = await import('./solve.progress-monitoring.lib.mjs');
 *   const monitor = createProgressMonitor({ owner, repo, prNumber, $, log, displayMode: 'comment' });
 *   await monitor.updateProgress(todos);
 *
 * @module solve.progress-monitoring.lib.mjs
 * @experimental
 */

/**
 * Configuration constants for progress monitoring
 */
const CONFIG = {
  // Progress bar width in characters
  PROGRESS_BAR_WIDTH: 30,
  // Progress bar characters
  PROGRESS_CHAR_FILLED: '█',
  PROGRESS_CHAR_EMPTY: '░',
  // Marker comments for identifying the progress section
  PROGRESS_SECTION_START: '<!-- LIVE-PROGRESS-START -->',
  PROGRESS_SECTION_END: '<!-- LIVE-PROGRESS-END -->',
  // Minimum interval between PR description updates (in ms)
  MIN_UPDATE_INTERVAL: 10000, // 10 seconds to avoid rate limiting
  // Valid display modes
  DISPLAY_MODES: ['comment', 'pr'],
  // Default display mode when enabled without explicit value
  DEFAULT_DISPLAY_MODE: 'comment',
};

/**
 * Generate a progress bar visualization
 *
 * @param {number} percentage - Progress percentage (0-100)
 * @param {number} width - Width of the progress bar in characters
 * @returns {string} Progress bar string
 */
const generateProgressBar = (percentage, width = CONFIG.PROGRESS_BAR_WIDTH) => {
  const clamped = Math.max(0, Math.min(100, percentage));
  const filled = Math.round((clamped / 100) * width);
  const empty = width - filled;
  return CONFIG.PROGRESS_CHAR_FILLED.repeat(filled) + CONFIG.PROGRESS_CHAR_EMPTY.repeat(empty);
};

/**
 * Calculate progress statistics from TODO list
 *
 * @param {Array<Object>} todos - Array of TODO items with status property
 * @returns {Object} Progress statistics
 */
const calculateProgress = todos => {
  if (!todos || !Array.isArray(todos) || todos.length === 0) {
    return {
      total: 0,
      completed: 0,
      inProgress: 0,
      pending: 0,
      percentage: 0,
    };
  }

  const total = todos.length;
  const completed = todos.filter(t => t.status === 'completed').length;
  const inProgress = todos.filter(t => t.status === 'in_progress').length;
  const pending = todos.filter(t => t.status === 'pending').length;
  const percentage = total > 0 ? Math.round((completed / total) * 100) : 0;

  return { total, completed, inProgress, pending, percentage };
};

/**
 * Format TODO list for display
 *
 * @param {Array<Object>} todos - Array of TODO items
 * @param {number} maxDisplay - Maximum number of TODOs to show (0 for all)
 * @returns {string} Formatted TODO list
 */
const formatTodoList = (todos, maxDisplay = 0) => {
  if (!todos || todos.length === 0) {
    return '_No tasks yet_';
  }

  const getStatusIcon = status => {
    switch (status) {
      case 'completed':
        return '[x]';
      case 'in_progress':
        return '[~]';
      case 'pending':
        return '[ ]';
      default:
        return '[ ]';
    }
  };

  let todosToShow = todos;
  if (maxDisplay > 0 && todos.length > maxDisplay) {
    const half = Math.floor(maxDisplay / 2);
    const firstHalf = todos.slice(0, half);
    const secondHalf = todos.slice(-half);
    const skipped = todos.length - maxDisplay;

    todosToShow = [...firstHalf, { content: `_...and ${skipped} more tasks_`, status: 'info' }, ...secondHalf];
  }

  return todosToShow
    .map(todo => {
      if (todo.status === 'info') {
        return `- ${todo.content}`;
      }
      return `- ${getStatusIcon(todo.status)} ${todo.content}`;
    })
    .join('\n');
};

/**
 * Generate the progress section markdown (never collapsible)
 *
 * @param {Array<Object>} todos - Array of TODO items
 * @param {string} sessionId - Work session identifier (optional)
 * @returns {string} Progress section markdown
 */
const generateProgressSection = (todos, sessionId = null) => {
  const stats = calculateProgress(todos);
  const progressBar = generateProgressBar(stats.percentage);
  const timestamp = new Date().toISOString();

  return `${CONFIG.PROGRESS_SECTION_START}
## 📊 Live Progress Monitor

**Session:** ${sessionId || 'Current'}
**Last Updated:** ${timestamp}

### Progress: ${stats.percentage}% Complete

\`\`\`
${progressBar} ${stats.percentage}%
\`\`\`

**Tasks:** ${stats.completed}/${stats.total} completed · ${stats.inProgress} in progress · ${stats.pending} pending

📋 **Task List** (${stats.total} total)

${formatTodoList(todos)}

${CONFIG.PROGRESS_SECTION_END}`;
};

/**
 * Normalize the display mode value.
 * - false/falsy → null (disabled)
 * - true or "true" → default mode ("comment")
 * - "comment" or "pr" → that mode
 *
 * @param {*} value - Raw option value
 * @returns {string|null} Normalized display mode or null if disabled
 */
export const normalizeDisplayMode = value => {
  if (!value || value === 'false') return null;
  if (value === true || value === 'true') return CONFIG.DEFAULT_DISPLAY_MODE;
  const mode = String(value).toLowerCase();
  if (CONFIG.DISPLAY_MODES.includes(mode)) return mode;
  // Unknown value falls back to default
  return CONFIG.DEFAULT_DISPLAY_MODE;
};

/**
 * Create a progress monitor instance
 *
 * @param {Object} options - Configuration options
 * @param {string} options.owner - Repository owner
 * @param {string} options.repo - Repository name
 * @param {number} options.prNumber - Pull request number
 * @param {Function} options.$ - Zx executor function
 * @param {Function} options.log - Logging function
 * @param {boolean} options.verbose - Enable verbose logging
 * @param {string} options.sessionId - Work session identifier
 * @param {string} options.displayMode - Display mode: "comment" or "pr"
 * @returns {Object} Progress monitor instance
 */
export const createProgressMonitor = ({ owner, repo, prNumber, $, log, verbose = false, sessionId = null, displayMode = 'comment' }) => {
  const state = {
    lastUpdate: 0,
    currentTodos: null,
    sessionId: sessionId || `session-${Date.now()}`,
    commentId: null, // For comment mode: the ID of the progress comment to update
    displayMode: displayMode || CONFIG.DEFAULT_DISPLAY_MODE,
  };

  /**
   * Update progress via PR comment (comment mode)
   * Creates a new comment on first call, then edits it on subsequent calls.
   *
   * @param {Array<Object>} todos - Array of TODO items
   * @returns {Promise<boolean>} True if update was successful
   */
  const updateProgressComment = async todos => {
    try {
      state.currentTodos = todos;
      const progressSection = generateProgressSection(todos, state.sessionId);

      if (state.commentId) {
        // Edit existing comment
        const fs = (await import('fs')).promises;
        const tempFile = `/tmp/pr-progress-comment-${prNumber}-${Date.now()}.md`;
        await fs.writeFile(tempFile, progressSection);
        await $`gh api repos/${owner}/${repo}/issues/comments/${state.commentId} --method PATCH --field body=@${tempFile}`;
        await fs.unlink(tempFile).catch(() => {});
      } else {
        // Create new comment
        const fs = (await import('fs')).promises;
        const tempFile = `/tmp/pr-progress-comment-${prNumber}-${Date.now()}.md`;
        await fs.writeFile(tempFile, progressSection);
        const result = await $`gh pr comment ${prNumber} --repo ${owner}/${repo} --body-file ${tempFile}`;
        await fs.unlink(tempFile).catch(() => {});

        // Extract comment ID from the created comment URL for future edits
        // gh pr comment outputs the URL of the created comment
        const output = result.stdout?.toString?.() || '';
        const urlMatch = output.match(/\/comments\/(\d+)/);
        if (urlMatch) {
          state.commentId = urlMatch[1];
        } else {
          // Fallback: find the comment we just created by looking for our marker
          const commentsResult = await $`gh api repos/${owner}/${repo}/issues/${prNumber}/comments --jq ${`[.[] | select(.body | contains("${CONFIG.PROGRESS_SECTION_START}")) | .id] | last`}`;
          const commentId = commentsResult.stdout?.toString?.().trim();
          if (commentId && commentId !== 'null') {
            state.commentId = commentId;
          }
        }
      }

      const stats = calculateProgress(todos);
      await log(`📊 Updated progress comment: ${stats.percentage}% (${stats.completed}/${stats.total} tasks completed)`);
      return true;
    } catch (error) {
      await log(`⚠️  Failed to update progress comment: ${error.message}`);
      return false;
    }
  };

  /**
   * Update progress via PR description (pr mode)
   *
   * @param {Array<Object>} todos - Array of TODO items
   * @returns {Promise<boolean>} True if update was successful
   */
  const updateProgressPrDescription = async todos => {
    try {
      state.currentTodos = todos;

      // Fetch current PR description
      const prData = await $`gh pr view ${prNumber} --repo ${owner}/${repo} --json body`;
      const prInfo = JSON.parse(prData.stdout);
      let currentBody = prInfo.body || '';

      // Generate new progress section
      const progressSection = generateProgressSection(todos, state.sessionId);

      // Check if progress section already exists
      const hasProgressSection = currentBody.includes(CONFIG.PROGRESS_SECTION_START);

      let updatedBody;
      if (hasProgressSection) {
        // Replace existing progress section
        const startIdx = currentBody.indexOf(CONFIG.PROGRESS_SECTION_START);
        const endIdx = currentBody.indexOf(CONFIG.PROGRESS_SECTION_END);

        if (startIdx !== -1 && endIdx !== -1) {
          updatedBody = currentBody.substring(0, startIdx) + progressSection + currentBody.substring(endIdx + CONFIG.PROGRESS_SECTION_END.length);
        } else {
          updatedBody = currentBody + '\n\n' + progressSection;
        }
      } else {
        updatedBody = currentBody + '\n\n' + progressSection;
      }

      // Write to temp file and update PR
      const fs = (await import('fs')).promises;
      const tempBodyFile = `/tmp/pr-progress-${prNumber}-${Date.now()}.md`;
      await fs.writeFile(tempBodyFile, updatedBody);
      await $`gh pr edit ${prNumber} --repo ${owner}/${repo} --body-file ${tempBodyFile}`;
      await fs.unlink(tempBodyFile).catch(() => {});

      const stats = calculateProgress(todos);
      await log(`📊 Updated PR progress: ${stats.percentage}% (${stats.completed}/${stats.total} tasks completed)`);
      return true;
    } catch (error) {
      await log(`⚠️  Failed to update PR progress: ${error.message}`);
      return false;
    }
  };

  /**
   * Update progress using the configured display mode
   *
   * @param {Array<Object>} todos - Array of TODO items
   * @param {boolean} force - Force update even if within rate limit interval
   * @returns {Promise<boolean>} True if update was successful
   */
  const updateProgress = async (todos, force = false) => {
    const now = Date.now();

    // Rate limiting: don't update too frequently unless forced
    if (!force && now - state.lastUpdate < CONFIG.MIN_UPDATE_INTERVAL) {
      if (verbose) {
        await log(`⏭️  Skipping progress update (rate limited, ${Math.round((CONFIG.MIN_UPDATE_INTERVAL - (now - state.lastUpdate)) / 1000)}s remaining)`, { verbose: true });
      }
      return false;
    }

    let result;
    if (state.displayMode === 'pr') {
      result = await updateProgressPrDescription(todos);
    } else {
      result = await updateProgressComment(todos);
    }

    if (result) {
      state.lastUpdate = now;
    }
    return result;
  };

  /**
   * Get current progress statistics
   *
   * @returns {Object} Current progress statistics
   */
  const getStats = () => {
    return calculateProgress(state.currentTodos);
  };

  /**
   * Generate progress section without updating
   *
   * @param {Array<Object>} todos - Array of TODO items
   * @returns {string} Progress section markdown
   */
  const generateSection = todos => {
    return generateProgressSection(todos, state.sessionId);
  };

  /**
 * Process a tool stream event, detecting Claude TodoWrite or Codex todo_list
 * updates and updating progress automatically.
   *
   * @param {Object} data - Parsed JSON event from Claude CLI stream
   * @param {boolean} force - Force update even if within rate limit interval
   * @returns {Promise<boolean>} True if a progress update was triggered
   */
  const processStreamEvent = async (data, force = false) => {
    if (!data || typeof data !== 'object') return false;
    let updated = false;
    // Pattern 1: assistant event with tool_use containing TodoWrite input
    if (data.type === 'assistant' && data.message?.content) {
      const contentItems = Array.isArray(data.message.content) ? data.message.content : [data.message.content];
      for (const item of contentItems) {
        if (item.type === 'tool_use' && item.name === 'TodoWrite' && item.input?.todos) {
          updated = await updateProgress(item.input.todos, force);
        }
      }
    }
    // Pattern 2: user event with tool_use_result containing newTodos (confirmation)
    if (data.type === 'user' && data.tool_use_result?.newTodos) {
      updated = await updateProgress(data.tool_use_result.newTodos, force);
    }
    // Pattern 3: Codex item event with todo_list payload
    if ((data.type === 'item.started' || data.type === 'item.updated' || data.type === 'item.completed') && data.item?.type === 'todo_list' && Array.isArray(data.item.items)) {
      const todos = data.item.items.map(todo => ({
        status: todo?.completed ? 'completed' : 'pending',
        content: todo?.text || '',
      }));
      updated = await updateProgress(todos, force);
    }
    return updated;
  };

  return {
    updateProgress,
    processStreamEvent,
    getStats,
    generateSection,
    get currentTodos() {
      return state.currentTodos;
    },
    get sessionId() {
      return state.sessionId;
    },
    get displayMode() {
      return state.displayMode;
    },
    get commentId() {
      return state.commentId;
    },
  };
};

/**
 * Initialize progress monitoring if enabled. Returns null if disabled or missing PR info.
 * Logs status to the provided log function. Designed to minimize integration lines in claude.lib.mjs.
 *
 * @param {Object} argv - Parsed CLI arguments (needs workingSessionLiveProgress)
 * @param {Object} context - { owner, repo, prNumber, $, log }
 * @returns {Promise<Object|null>} Progress monitor instance or null
 */
export const initProgressMonitoring = async (argv, { owner, repo, prNumber, $, log }) => {
  const displayMode = normalizeDisplayMode(argv.workingSessionLiveProgress);
  if (!displayMode) return null;
  if (!owner || !repo || !prNumber) {
    await log('⚠️ Live progress monitoring: Disabled - missing PR info', { verbose: true });
    return null;
  }
  const monitor = createProgressMonitor({ owner, repo, prNumber, $, log, verbose: argv.verbose, sessionId: `session-${Date.now()}`, displayMode });
  await log(`📊 Live progress monitoring: ENABLED (mode: ${displayMode}, session: ${monitor.sessionId})`, { verbose: true });
  return monitor;
};

/**
 * Export utility functions for testing and standalone use
 */
export const utils = {
  generateProgressBar,
  calculateProgress,
  formatTodoList,
  generateProgressSection,
  CONFIG,
};
