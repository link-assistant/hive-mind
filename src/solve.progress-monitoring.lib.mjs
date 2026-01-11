#!/usr/bin/env node
/**
 * Progress Monitoring Library
 *
 * [EXPERIMENTAL] This module provides live progress monitoring for work sessions
 * by tracking TODO list updates and reflecting them in PR descriptions.
 *
 * Features:
 * - Tracks TODO list state from TodoWrite tool calls
 * - Calculates progress percentage (completed/total)
 * - Updates PR description with live progress section
 * - Generates progress bar visualization
 * - Can be displayed in PR description or work session comments
 *
 * Usage:
 *   const { createProgressMonitor } = await import('./solve.progress-monitoring.lib.mjs');
 *   const monitor = createProgressMonitor({ owner, repo, prNumber, $, log });
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
};

/**
 * Generate a progress bar visualization
 *
 * @param {number} percentage - Progress percentage (0-100)
 * @param {number} width - Width of the progress bar in characters
 * @returns {string} Progress bar string
 */
const generateProgressBar = (percentage, width = CONFIG.PROGRESS_BAR_WIDTH) => {
  const filled = Math.round((percentage / 100) * width);
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
 * Generate the progress section markdown
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

<details>
<summary>📋 Task List (${stats.total} total)</summary>

${formatTodoList(todos)}

</details>

${CONFIG.PROGRESS_SECTION_END}`;
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
 * @returns {Object} Progress monitor instance
 */
export const createProgressMonitor = ({ owner, repo, prNumber, $, log, verbose = false, sessionId = null }) => {
  const state = {
    lastUpdate: 0,
    currentTodos: null,
    sessionId: sessionId || `session-${Date.now()}`,
  };

  /**
   * Update PR description with current progress
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
        await log(`⏭️  Skipping PR progress update (rate limited, ${Math.round((CONFIG.MIN_UPDATE_INTERVAL - (now - state.lastUpdate)) / 1000)}s remaining)`, { verbose: true });
      }
      return false;
    }

    try {
      // Store current todos
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
          // Malformed markers, append new section
          updatedBody = currentBody + '\n\n' + progressSection;
        }
      } else {
        // Add progress section at the end
        updatedBody = currentBody + '\n\n' + progressSection;
      }

      // Write to temp file and update PR
      const fs = (await import('fs')).promises;
      const tempBodyFile = `/tmp/pr-progress-${prNumber}-${Date.now()}.md`;
      await fs.writeFile(tempBodyFile, updatedBody);

      await $`gh pr edit ${prNumber} --repo ${owner}/${repo} --body-file ${tempBodyFile}`;

      await fs.unlink(tempBodyFile).catch(() => {});

      state.lastUpdate = now;

      const stats = calculateProgress(todos);
      await log(`📊 Updated PR progress: ${stats.percentage}% (${stats.completed}/${stats.total} tasks completed)`);

      return true;
    } catch (error) {
      await log(`⚠️  Failed to update PR progress: ${error.message}`);
      return false;
    }
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
   * Generate progress section without updating PR
   *
   * @param {Array<Object>} todos - Array of TODO items
   * @returns {string} Progress section markdown
   */
  const generateSection = todos => {
    return generateProgressSection(todos, state.sessionId);
  };

  return {
    updateProgress,
    getStats,
    generateSection,
    get currentTodos() {
      return state.currentTodos;
    },
    get sessionId() {
      return state.sessionId;
    },
  };
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
