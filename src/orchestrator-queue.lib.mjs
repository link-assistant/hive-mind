#!/usr/bin/env node
/**
 * Orchestrator Queue Library
 *
 * Producer/consumer queue for solve tasks in the orchestrator.
 * Implements resource-aware throttling to prevent system overload.
 *
 * This is a generalized version of telegram-solve-queue.lib.mjs that can be used
 * by the orchestrator REST API and other clients.
 *
 * Features:
 * - Resource checking (RAM, CPU, disk)
 * - API limit checking (Claude, GitHub)
 * - Minimum interval between command starts
 * - Running process detection
 * - Status tracking: Queued -> Waiting -> Starting -> Started
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1193
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';

const execAsync = promisify(exec);

// Import centralized limits and caching
import { getCachedClaudeLimits, getCachedGitHubLimits, getCachedMemoryInfo, getCachedCpuInfo, getCachedDiskInfo, getLimitCache } from './limits.lib.mjs';

/**
 * Configuration constants for queue throttling
 * All thresholds use ratios (0.0 - 1.0) representing usage percentage
 */
export const QUEUE_CONFIG = {
  // Resource thresholds (usage ratios: 0.0 - 1.0)
  RAM_THRESHOLD: 0.65,
  CPU_THRESHOLD: 0.65,
  DISK_THRESHOLD: 0.9,

  // API limit thresholds (usage ratios: 0.0 - 1.0)
  CLAUDE_5_HOUR_SESSION_THRESHOLD: 0.75,
  CLAUDE_WEEKLY_THRESHOLD: 0.97,
  GITHUB_API_THRESHOLD: 0.75,

  // Timing
  MIN_START_INTERVAL_MS: 60000, // 1 minute between starts
  CONSUMER_POLL_INTERVAL_MS: 60000, // 1 minute between queue checks

  // Process detection
  CLAUDE_PROCESS_NAMES: ['claude'],
};

/**
 * Status enum for queue items
 */
export const QueueItemStatus = {
  QUEUED: 'queued',
  WAITING: 'waiting',
  STARTING: 'starting',
  STARTED: 'started',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

/**
 * Count running claude processes
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{count: number, processes: string[]}>}
 */
export async function getRunningClaudeProcesses(verbose = false) {
  try {
    const { stdout } = await execAsync('pgrep -l -x claude 2>/dev/null || true');
    const lines = stdout
      .trim()
      .split('\n')
      .filter(line => line.trim());

    const processes = lines
      .map(line => {
        const parts = line.trim().split(/\s+/);
        return {
          pid: parts[0],
          name: parts.slice(1).join(' ') || 'claude',
        };
      })
      .filter(p => p.pid);

    if (verbose) {
      console.log(`[VERBOSE] orchestrator-queue found ${processes.length} running claude processes`);
    }

    return {
      count: processes.length,
      processes: processes.map(p => `${p.pid}:${p.name}`),
    };
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] orchestrator-queue error counting claude processes:', error.message);
    }
    return { count: 0, processes: [] };
  }
}

/**
 * Format a threshold as percentage for display
 * @param {number} ratio - Ratio (0.0 - 1.0)
 * @returns {string} Formatted percentage
 */
function formatThresholdPercent(ratio) {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Generate human-readable waiting reason based on threshold violation
 * @param {string} metric - The metric name
 * @param {number} currentValue - Current value (as percentage 0-100)
 * @param {number} threshold - Threshold ratio (0.0 - 1.0)
 * @returns {string} Human-readable reason
 */
function formatWaitingReason(metric, currentValue, threshold) {
  const thresholdPercent = formatThresholdPercent(threshold);
  const currentPercent = Math.round(currentValue);

  switch (metric) {
    case 'ram':
      return `RAM usage is ${currentPercent}% (threshold: ${thresholdPercent})`;
    case 'cpu':
      return `CPU usage is ${currentPercent}% (threshold: ${thresholdPercent})`;
    case 'disk':
      return `Disk usage is ${currentPercent}% (threshold: ${thresholdPercent})`;
    case 'claude_5_hour_session':
      return `Claude 5 hour session limit is ${currentPercent}% (threshold: ${thresholdPercent})`;
    case 'claude_weekly':
      return `Claude weekly limit is ${currentPercent}% (threshold: ${thresholdPercent})`;
    case 'github':
      return `GitHub API usage is ${currentPercent}% (threshold: ${thresholdPercent})`;
    case 'min_interval':
      return `Minimum interval between commands not reached`;
    case 'claude_running':
      return `Claude process is already running`;
    default:
      return `${metric} threshold exceeded`;
  }
}

/**
 * Queue item representing a solve task
 */
export class OrchestratorQueueItem {
  constructor(options) {
    this.id = `solve-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.url = options.url;
    this.args = options.args || [];
    this.requester = options.requester || 'unknown';
    this.tool = options.tool || 'claude';
    this.priority = options.priority || 'normal';
    this.createdAt = new Date();
    this.startedAt = null;
    this.completedAt = null;
    this.status = QueueItemStatus.QUEUED;
    this.waitingReason = null;
    this.error = null;
    this.result = null;
    this.sessionName = null;
    this.childProcess = null;
    // Callback for status updates
    this.onStatusChange = options.onStatusChange || null;
  }

  /**
   * Update status to waiting with reason
   * @param {string} reason - Waiting reason
   */
  setWaiting(reason) {
    this.status = QueueItemStatus.WAITING;
    this.waitingReason = reason;
    this._notifyStatusChange();
  }

  /**
   * Update status to starting
   */
  setStarting() {
    this.status = QueueItemStatus.STARTING;
    this.startedAt = new Date();
    this.waitingReason = null;
    this._notifyStatusChange();
  }

  /**
   * Update status to started
   * @param {string} sessionName - Session name for debugging
   */
  setStarted(sessionName) {
    this.status = QueueItemStatus.STARTED;
    this.sessionName = sessionName;
    this._notifyStatusChange();
  }

  /**
   * Mark item as completed
   * @param {*} result - Result data
   */
  setCompleted(result) {
    this.status = QueueItemStatus.STARTED;
    this.result = result;
    this.completedAt = new Date();
    this._notifyStatusChange();
  }

  /**
   * Mark item as failed
   * @param {Error|string} error - Error that occurred
   */
  setFailed(error) {
    this.status = QueueItemStatus.FAILED;
    this.error = error instanceof Error ? error.message : error;
    this.completedAt = new Date();
    this._notifyStatusChange();
  }

  /**
   * Mark item as cancelled
   */
  setCancelled() {
    this.status = QueueItemStatus.CANCELLED;
    this.completedAt = new Date();
    this._notifyStatusChange();
  }

  /**
   * Notify about status change
   */
  _notifyStatusChange() {
    if (this.onStatusChange) {
      this.onStatusChange(this);
    }
  }

  /**
   * Get wait time in queue (ms)
   */
  getWaitTime() {
    const endTime = this.startedAt || new Date();
    return endTime - this.createdAt;
  }

  /**
   * Get run time (ms)
   */
  getRunTime() {
    if (!this.startedAt) return 0;
    const endTime = this.completedAt || new Date();
    return endTime - this.startedAt;
  }

  /**
   * Convert to JSON for API responses
   */
  toJSON() {
    return {
      id: this.id,
      url: this.url,
      args: this.args,
      requester: this.requester,
      tool: this.tool,
      priority: this.priority,
      status: this.status,
      waitingReason: this.waitingReason,
      error: this.error,
      sessionName: this.sessionName,
      createdAt: this.createdAt.toISOString(),
      startedAt: this.startedAt ? this.startedAt.toISOString() : null,
      completedAt: this.completedAt ? this.completedAt.toISOString() : null,
      waitTimeMs: this.getWaitTime(),
      runTimeMs: this.getRunTime(),
    };
  }

  /**
   * Format for display
   * @returns {string}
   */
  toString() {
    return `[${this.id}] ${this.url} (${this.status})`;
  }
}

/**
 * Orchestrator Queue - Producer/Consumer queue for solve tasks
 *
 * Uses separate queues for each tool type to ensure:
 * - Claude tasks never block agent tasks (and vice versa)
 * - Each tool queue maintains FIFO order
 * - Each tool has independent rate limiting
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1159
 */
export class OrchestratorQueue {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.executeCallback = options.executeCallback || null;
    this.solveCommand = options.solveCommand || 'solve';

    // Separate queues per tool type - claude tasks never block agent tasks
    // See: https://github.com/link-assistant/hive-mind/issues/1159
    this.queues = {
      claude: [],
      agent: [],
    };
    this.processing = new Map();
    this.completed = [];
    this.failed = [];
    this.isRunning = true;

    // Timing - separate per tool to ensure independent processing
    this.lastStartTimeByTool = {
      claude: null,
      agent: null,
    };
    // Legacy: keep for compatibility with existing code that uses lastStartTime
    this.lastStartTime = null;

    // Consumer task reference
    this.consumerTask = null;

    // Statistics
    this.stats = {
      totalEnqueued: 0,
      totalStarted: 0,
      totalCompleted: 0,
      totalFailed: 0,
      totalCancelled: 0,
      throttleReasons: {},
    };

    this.log('OrchestratorQueue initialized with separate tool queues');
  }

  /**
   * Get the queue array for a specific tool, creating it if needed
   * @param {string} tool - Tool type ('claude', 'agent', etc.)
   * @returns {Array} The queue array for this tool
   */
  getToolQueue(tool) {
    if (!this.queues[tool]) {
      this.queues[tool] = [];
    }
    return this.queues[tool];
  }

  /**
   * Get combined queue as array (for backwards compatibility)
   * @returns {Array} Combined queue from all tools
   */
  get queue() {
    let total = [];
    for (const toolQueue of Object.values(this.queues)) {
      total = total.concat(toolQueue);
    }
    return total;
  }

  /**
   * Get total pending count across all tool queues
   * @returns {number} Total pending items
   */
  getTotalQueueLength() {
    let total = 0;
    for (const toolQueue of Object.values(this.queues)) {
      total += toolQueue.length;
    }
    return total;
  }

  /**
   * Log message if verbose mode is enabled
   * @param {string} message
   */
  log(message) {
    if (this.verbose) {
      console.log(`[VERBOSE] orchestrator-queue: ${message}`);
    }
  }

  /**
   * Add a solve task to the appropriate tool queue
   * Items are added to the queue for their specific tool type.
   * @param {Object} options - Queue item options
   * @returns {OrchestratorQueueItem} The queued item
   * @see https://github.com/link-assistant/hive-mind/issues/1159
   */
  enqueue(options) {
    const item = new OrchestratorQueueItem(options);
    const toolQueue = this.getToolQueue(item.tool);
    toolQueue.push(item);
    this.stats.totalEnqueued++;

    this.log(`Enqueued: ${item.toString()} to ${item.tool} queue, queue length: ${toolQueue.length}`);

    // Start consumer if not already running
    this.ensureConsumerRunning();

    return item;
  }

  /**
   * Find an item by URL in any queue or processing items
   * Used to prevent duplicate URLs from being added to the queue
   * @param {string} url - The URL to search for
   * @returns {OrchestratorQueueItem|null}
   * @see https://github.com/link-assistant/hive-mind/issues/1080
   */
  findByUrl(url) {
    // Check all tool queues
    for (const toolQueue of Object.values(this.queues)) {
      const queuedItem = toolQueue.find(item => item.url === url);
      if (queuedItem) return queuedItem;
    }

    for (const item of this.processing.values()) {
      if (item.url === url) return item;
    }

    return null;
  }

  /**
   * Find an item by ID
   * Searches all tool queues, processing items, completed and failed lists.
   * @param {string} id - The item ID
   * @returns {OrchestratorQueueItem|null}
   * @see https://github.com/link-assistant/hive-mind/issues/1159
   */
  findById(id) {
    // Check all tool queues
    for (const toolQueue of Object.values(this.queues)) {
      const queuedItem = toolQueue.find(item => item.id === id);
      if (queuedItem) return queuedItem;
    }

    if (this.processing.has(id)) return this.processing.get(id);

    const completedItem = this.completed.find(item => item.id === id);
    if (completedItem) return completedItem;

    const failedItem = this.failed.find(item => item.id === id);
    if (failedItem) return failedItem;

    return null;
  }

  /**
   * Cancel a queued item by ID
   * Searches all tool queues to find the item.
   * @param {string} id - Item ID
   * @returns {boolean} True if cancelled
   * @see https://github.com/link-assistant/hive-mind/issues/1159
   */
  cancel(id) {
    // Search all tool queues
    for (const [tool, toolQueue] of Object.entries(this.queues)) {
      const queueIndex = toolQueue.findIndex(item => item.id === id);
      if (queueIndex !== -1) {
        const item = toolQueue.splice(queueIndex, 1)[0];
        item.setCancelled();
        this.stats.totalCancelled++;
        this.log(`Cancelled queued item: ${item.toString()} from ${tool} queue`);
        return true;
      }
    }

    if (this.processing.has(id)) {
      this.log(`Cannot cancel processing item: ${id}`);
      return false;
    }

    return false;
  }

  /**
   * Count processing items by tool type
   * Used for tool-specific limit checking - e.g., Claude limits only count Claude processing items
   * @param {string} tool - Tool type to count ('claude', 'agent', etc.)
   * @returns {number} Count of processing items with the specified tool
   * @see https://github.com/link-assistant/hive-mind/issues/1159
   */
  getProcessingCountByTool(tool) {
    let count = 0;
    for (const item of this.processing.values()) {
      if (item.tool === tool) {
        count++;
      }
    }
    return count;
  }

  /**
   * Get queue statistics
   * @returns {Object}
   */
  getStats() {
    // Calculate per-tool queue stats
    const queuedByTool = {};
    let totalQueued = 0;
    for (const [tool, toolQueue] of Object.entries(this.queues)) {
      queuedByTool[tool] = toolQueue.length;
      totalQueued += toolQueue.length;
    }

    return {
      queued: totalQueued,
      queuedByTool,
      processing: this.processing.size,
      completed: this.completed.length,
      failed: this.failed.length,
      ...this.stats,
      cacheStats: getLimitCache().getStats(),
      lastStartTime: this.lastStartTime,
      lastStartTimeByTool: this.lastStartTimeByTool,
      isRunning: this.isRunning,
    };
  }

  /**
   * Get queue items summary for display
   * Combines items from all tool queues into a single pending list.
   * @returns {Object}
   * @see https://github.com/link-assistant/hive-mind/issues/1159
   */
  getQueueSummary() {
    // Collect pending items from all tool queues
    const pending = [];
    for (const [tool, toolQueue] of Object.entries(this.queues)) {
      for (const item of toolQueue) {
        pending.push(item.toJSON());
      }
    }

    // Sort by createdAt to show oldest first (global order)
    pending.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

    return {
      pending,
      processing: Array.from(this.processing.values()).map(item => item.toJSON()),
      recentCompleted: this.completed.slice(-10).map(item => item.toJSON()),
      recentFailed: this.failed.slice(-10).map(item => item.toJSON()),
    };
  }

  /**
   * Find startable items from each tool queue
   * Returns the first item from each tool queue that can start.
   * With separate queues, each tool is checked independently so they don't block each other.
   * @returns {Promise<Array<{item: OrchestratorQueueItem, tool: string, index: number, check: Object}>>}
   * @see https://github.com/link-assistant/hive-mind/issues/1159
   */
  async findStartableItems() {
    const startableItems = [];

    for (const [tool, toolQueue] of Object.entries(this.queues)) {
      if (toolQueue.length === 0) continue;

      // Check if first item in this tool's queue can start
      const item = toolQueue[0];
      const check = await this.canStartCommand({ tool });

      if (check.canStart) {
        // Also check one-at-a-time mode for this specific tool
        // For tool-specific one-at-a-time, only count that tool's processing items
        const toolProcessingCount = this.getProcessingCountByTool(tool);
        if (check.oneAtATime && toolProcessingCount > 0) {
          // This tool is in one-at-a-time mode and has items processing
          // Skip but don't block other tools
          continue;
        }
        startableItems.push({ item, tool, index: 0, check });
      }
    }

    return startableItems;
  }

  /**
   * Find first queue item that can start based on its tool's limits (legacy compatibility)
   * With separate queues, returns the first startable item from any tool queue.
   * @returns {Promise<{item: OrchestratorQueueItem|null, index: number, check: Object}>}
   * @see https://github.com/link-assistant/hive-mind/issues/1159
   */
  async findStartableItem() {
    const startableItems = await this.findStartableItems();
    if (startableItems.length > 0) {
      // Return the first startable item (arbitrary order among tools)
      const first = startableItems[0];
      return { item: first.item, index: first.index, check: first.check };
    }
    return { item: null, index: -1, check: null };
  }

  /**
   * Check if a new command can start
   *
   * Logic per issue #1061:
   * 1. "Claude process is already running" is NOT a limit by itself - it's a metric
   * 2. Commands can run in parallel as long as actual limits are not exceeded
   * 3. When any limit >= threshold, allow exactly one claude command to pass
   *
   * Logic per issue #1159:
   * - Different tools have different limits. Claude limits only apply to 'claude' tool.
   * - Processing count for Claude limits only includes Claude items, not agent items.
   * - This allows agent tasks to run in parallel when Claude limits are reached.
   *
   * @param {Object} options - Options for the check
   * @param {string} options.tool - The tool being used ('claude', 'agent', etc.)
   * @returns {Promise<{canStart: boolean, reason?: string, reasons?: string[], oneAtATime?: boolean}>}
   */
  async canStartCommand(options = {}) {
    const tool = options.tool || 'claude';
    const reasons = [];
    let oneAtATime = false;

    // Check minimum interval since last start FOR THIS TOOL
    // Each tool queue has independent timing to prevent cross-blocking
    // See: https://github.com/link-assistant/hive-mind/issues/1159
    const lastStartTime = this.lastStartTimeByTool[tool] || null;
    if (lastStartTime) {
      const timeSinceLastStart = Date.now() - lastStartTime;
      if (timeSinceLastStart < QUEUE_CONFIG.MIN_START_INTERVAL_MS) {
        const waitSeconds = Math.ceil((QUEUE_CONFIG.MIN_START_INTERVAL_MS - timeSinceLastStart) / 1000);
        reasons.push(formatWaitingReason('min_interval', 0, 0) + ` (${waitSeconds}s remaining)`);
        this.recordThrottle('min_interval');
      }
    }

    // Check running claude processes (this is a metric, not a blocking reason by itself)
    const claudeProcs = await getRunningClaudeProcesses(this.verbose);
    const hasRunningClaude = claudeProcs.count > 0;

    // Calculate total processing count for system resources (all tools)
    // System resources (RAM, CPU, disk) apply to all tools
    const totalProcessing = this.processing.size + claudeProcs.count;

    // Calculate Claude-specific processing count for Claude API limits
    // Only counts Claude items in queue + external claude processes
    // Agent items don't count against Claude's one-at-a-time limit
    // See: https://github.com/link-assistant/hive-mind/issues/1159
    const claudeProcessingCount = this.getProcessingCountByTool('claude');

    // Track claude_running as a metric (but don't add to reasons yet)
    if (hasRunningClaude) {
      this.recordThrottle('claude_running');
    }

    // Check system resources (RAM, CPU block unconditionally; disk uses one-at-a-time mode)
    // System resources apply to ALL tools, not just Claude
    // See: https://github.com/link-assistant/hive-mind/issues/1155
    const resourceCheck = await this.checkSystemResources(totalProcessing);
    if (!resourceCheck.ok) {
      reasons.push(...resourceCheck.reasons);
    }
    if (resourceCheck.oneAtATime) {
      oneAtATime = true;
    }

    // Check API limits (pass hasRunningClaude, claudeProcessingCount, and tool)
    // Claude limits use claudeProcessingCount (only Claude items), not totalProcessing
    // This allows agent tasks to proceed when Claude limits are reached
    // See: https://github.com/link-assistant/hive-mind/issues/1159
    const limitCheck = await this.checkApiLimits(hasRunningClaude, claudeProcessingCount, tool);
    if (!limitCheck.ok) {
      reasons.push(...limitCheck.reasons);
    }
    if (limitCheck.oneAtATime) {
      oneAtATime = true;
    }

    // "Claude process running" only blocks if there are OTHER reasons too
    // This allows parallel execution when limits are not exceeded
    if (hasRunningClaude && reasons.length > 0) {
      // Add claude_running info at the END (not beginning) of reasons
      // Since it's supplementary info, not the primary blocking reason
      // See: https://github.com/link-assistant/hive-mind/issues/1078
      reasons.push(formatWaitingReason('claude_running', claudeProcs.count, 0) + ` (${claudeProcs.count} processes)`);
    }

    const canStart = reasons.length === 0;

    if (!canStart && this.verbose) {
      this.log(`Cannot start: ${reasons.join(', ')}`);
    }

    return {
      canStart,
      reason: reasons.length > 0 ? reasons.join('\n') : undefined,
      reasons,
      oneAtATime,
      claudeProcesses: claudeProcs.count,
      totalProcessing,
      claudeProcessingCount,
    };
  }

  /**
   * Check system resources (RAM, CPU, disk)
   * @param {number} totalProcessing - Total processing count
   * @returns {Promise<{ok: boolean, reasons: string[], oneAtATime: boolean}>}
   */
  async checkSystemResources(totalProcessing = 0) {
    const reasons = [];
    let oneAtATime = false;

    // Check RAM
    const memResult = await getCachedMemoryInfo(this.verbose);
    if (memResult.success) {
      const usedRatio = memResult.memory.usedPercentage / 100;
      if (usedRatio >= QUEUE_CONFIG.RAM_THRESHOLD) {
        reasons.push(formatWaitingReason('ram', memResult.memory.usedPercentage, QUEUE_CONFIG.RAM_THRESHOLD));
        this.recordThrottle('ram_high');
      }
    }

    // Check CPU
    const cpuResult = await getCachedCpuInfo(this.verbose);
    if (cpuResult.success) {
      const loadAvg5 = cpuResult.cpuLoad.loadAvg5;
      const cpuCount = cpuResult.cpuLoad.cpuCount;
      const usageRatio = loadAvg5 / cpuCount;
      const usagePercent = Math.min(100, Math.round(usageRatio * 100));

      if (usageRatio >= QUEUE_CONFIG.CPU_THRESHOLD) {
        reasons.push(formatWaitingReason('cpu', usagePercent, QUEUE_CONFIG.CPU_THRESHOLD));
        this.recordThrottle('cpu_high');
      }
    }

    // Check disk
    const diskResult = await getCachedDiskInfo(this.verbose);
    if (diskResult.success) {
      const usedPercent = 100 - diskResult.diskSpace.freePercentage;
      const usedRatio = usedPercent / 100;
      if (usedRatio >= QUEUE_CONFIG.DISK_THRESHOLD) {
        oneAtATime = true;
        this.recordThrottle('disk_high');
        if (totalProcessing > 0) {
          reasons.push(formatWaitingReason('disk', usedPercent, QUEUE_CONFIG.DISK_THRESHOLD) + ' (waiting for current command)');
        }
      }
    }

    return { ok: reasons.length === 0, reasons, oneAtATime };
  }

  /**
   * Check API limits (Claude, GitHub) using cached values
   *
   * Logic per issue #1133:
   * - CLAUDE_5_HOUR_SESSION_THRESHOLD and CLAUDE_WEEKLY_THRESHOLD use one-at-a-time mode:
   *   when above threshold, allow exactly one command, block if claudeProcessing > 0
   * - GitHub threshold blocks unconditionally when exceeded (ultimate restriction)
   *
   * Logic per issue #1159:
   * - When tool is 'agent', skip Claude-specific limits entirely since agent uses different
   *   rate limits (Grok Code or similar). Only system resources and GitHub limits apply.
   * - For Claude limits, only count Claude-specific processing items, not agent items.
   *   This allows agent tasks to run in parallel even when Claude limits are reached.
   *
   * @param {boolean} hasRunningClaude - Whether claude processes are running (from pgrep)
   * @param {number} claudeProcessingCount - Count of 'claude' tool items being processed in queue
   * @param {string} tool - The tool being used ('claude', 'agent', etc.)
   * @returns {Promise<{ok: boolean, reasons: string[], oneAtATime: boolean}>}
   */
  async checkApiLimits(hasRunningClaude = false, claudeProcessingCount = 0, tool = 'claude') {
    const reasons = [];
    let oneAtATime = false;

    // Apply Claude-specific limits only when tool is 'claude'
    // Other tools (like 'agent') use different rate limiting backends and are not
    // affected by Claude API limits (5-hour session, weekly limits)
    // See: https://github.com/link-assistant/hive-mind/issues/1159
    const applyClaudeLimits = tool === 'claude';

    // Calculate total Claude processing: queue-internal claude items + external claude processes
    // This is used for Claude limits one-at-a-time mode - only counts Claude-related processing
    // Agent items in the queue don't count against Claude's one-at-a-time limit
    // See: https://github.com/link-assistant/hive-mind/issues/1159
    const totalClaudeProcessing = claudeProcessingCount + (hasRunningClaude ? 1 : 0);

    // Check Claude limits (using cached value)
    // Only applied when tool is 'claude'
    if (applyClaudeLimits) {
      const claudeResult = await getCachedClaudeLimits(this.verbose);
      if (claudeResult.success) {
        const sessionPercent = claudeResult.usage.currentSession.percentage;
        const weeklyPercent = claudeResult.usage.allModels.percentage;

        // Session limit (5-hour)
        // When above threshold: allow exactly one Claude command, block if any Claude processing
        // Only counts Claude-specific processing, not agent items
        // See: https://github.com/link-assistant/hive-mind/issues/1133, #1159
        if (sessionPercent !== null) {
          const sessionRatio = sessionPercent / 100;
          if (sessionRatio >= QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD) {
            oneAtATime = true;
            this.recordThrottle(sessionRatio >= 1.0 ? 'claude_5_hour_session_100' : 'claude_5_hour_session_high');
            // Use totalClaudeProcessing for Claude-specific one-at-a-time checking
            if (totalClaudeProcessing > 0) {
              reasons.push(formatWaitingReason('claude_5_hour_session', sessionPercent, QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD) + ' (waiting for current command)');
            }
          }
        }

        // Weekly limit
        // When above threshold: allow exactly one Claude command, block if one is in progress
        if (weeklyPercent !== null) {
          const weeklyRatio = weeklyPercent / 100;
          if (weeklyRatio >= QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD) {
            oneAtATime = true;
            this.recordThrottle(weeklyRatio >= 1.0 ? 'claude_weekly_100' : 'claude_weekly_high');
            // Use totalClaudeProcessing for Claude-specific one-at-a-time checking
            // See: https://github.com/link-assistant/hive-mind/issues/1133, #1159
            if (totalClaudeProcessing > 0) {
              reasons.push(formatWaitingReason('claude_weekly', weeklyPercent, QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD) + ' (waiting for current command)');
            }
          }
        }
      }
    } else if (this.verbose) {
      this.log(`Claude limits not applied for --tool ${tool}`);
    }

    // Check GitHub limits (only relevant if claude processes running)
    if (hasRunningClaude) {
      const githubResult = await getCachedGitHubLimits(this.verbose);
      if (githubResult.success) {
        const usedPercent = githubResult.githubRateLimit.usedPercentage;
        const usedRatio = usedPercent / 100;
        if (usedRatio >= QUEUE_CONFIG.GITHUB_API_THRESHOLD) {
          reasons.push(formatWaitingReason('github', usedPercent, QUEUE_CONFIG.GITHUB_API_THRESHOLD));
          this.recordThrottle(usedRatio >= 1.0 ? 'github_100' : 'github_high');
        }
      }
    }

    return { ok: reasons.length === 0, reasons, oneAtATime };
  }

  /**
   * Record a throttle event for statistics
   * @param {string} reason
   */
  recordThrottle(reason) {
    this.stats.throttleReasons[reason] = (this.stats.throttleReasons[reason] || 0) + 1;
  }

  /**
   * Ensure consumer task is running
   */
  ensureConsumerRunning() {
    if (this.consumerTask) return;

    this.consumerTask = this.runConsumer();
    this.consumerTask.catch(error => {
      console.error('[orchestrator-queue] Consumer error:', error);
      this.consumerTask = null;
    });
  }

  /**
   * Consumer loop - processes items from all tool queues
   *
   * With separate queues per tool:
   * - Each tool queue is checked independently
   * - Claude limits only affect Claude queue
   * - Agent queue can proceed even when Claude is blocked (and vice versa)
   * - Multiple items can start in the same cycle (one per tool)
   *
   * @see https://github.com/link-assistant/hive-mind/issues/1159
   */
  async runConsumer() {
    this.log('Consumer started with separate tool queues');

    while (this.isRunning) {
      // Check if all queues are empty
      if (this.getTotalQueueLength() === 0) {
        await this.sleep(QUEUE_CONFIG.CONSUMER_POLL_INTERVAL_MS);
        continue;
      }

      // Find startable items from each tool queue
      // Each tool is checked independently so they don't block each other
      // See: https://github.com/link-assistant/hive-mind/issues/1159
      const startableItems = await this.findStartableItems();

      if (startableItems.length === 0) {
        // No items can start - update all queued items with their tool-specific waiting reasons
        await this.updateAllWaitingItems();
        this.log(`Throttled: no items can start from any tool queue`);
        await this.sleep(QUEUE_CONFIG.CONSUMER_POLL_INTERVAL_MS);
        continue;
      }

      // Start items from each tool that can proceed
      // This allows parallel starts from different tool queues
      for (const startable of startableItems) {
        const { tool } = startable;
        const toolQueue = this.getToolQueue(tool);

        // Remove the first item from this tool's queue
        const item = toolQueue.shift();
        if (!item) continue;

        // Update status to Starting
        item.setStarting();
        this.processing.set(item.id, item);

        // Update tool-specific last start time
        this.lastStartTimeByTool[tool] = Date.now();
        this.lastStartTime = Date.now(); // Legacy compatibility
        this.stats.totalStarted++;

        this.log(`Starting: ${item.toString()} from ${tool} queue`);

        // Execute in background
        this.executeItem(item).catch(error => {
          console.error(`[orchestrator-queue] Execution error for ${item.id}:`, error);
        });
      }
    }

    this.log('Consumer stopped');
    this.consumerTask = null;
  }

  /**
   * Update all waiting items with their tool-specific waiting reasons
   * @see https://github.com/link-assistant/hive-mind/issues/1078
   */
  async updateAllWaitingItems() {
    for (const [tool, toolQueue] of Object.entries(this.queues)) {
      for (let i = 0; i < toolQueue.length; i++) {
        const item = toolQueue[i];
        if (item.status === QueueItemStatus.QUEUED || item.status === QueueItemStatus.WAITING) {
          // Get the specific reason for this item's tool
          const itemCheck = await this.canStartCommand({ tool: item.tool });
          item.setWaiting(itemCheck.reason || 'Waiting in queue');
        }
      }
    }
  }

  /**
   * Execute a queue item
   * @param {OrchestratorQueueItem} item
   */
  async executeItem(item) {
    try {
      if (this.executeCallback) {
        const result = await this.executeCallback(item);
        item.setCompleted(result);
        this.stats.totalCompleted++;
      } else {
        // Default execution: spawn solve command
        const result = await this.spawnSolveCommand(item);
        item.setCompleted(result);
        this.stats.totalCompleted++;
      }
    } catch (error) {
      item.setFailed(error);
      this.stats.totalFailed++;
      console.error(`[orchestrator-queue] Item failed: ${item.id}`, error);
    } finally {
      this.processing.delete(item.id);

      if (item.status === QueueItemStatus.STARTED) {
        this.completed.push(item);
      } else if (item.status === QueueItemStatus.FAILED) {
        this.failed.push(item);
      }

      this.log(`Finished: ${item.toString()}`);

      // Limit history size
      while (this.completed.length > 100) this.completed.shift();
      while (this.failed.length > 100) this.failed.shift();
    }
  }

  /**
   * Spawn solve command for an item
   * @param {OrchestratorQueueItem} item
   * @returns {Promise<Object>}
   */
  async spawnSolveCommand(item) {
    return new Promise((resolve, reject) => {
      const args = [item.url, ...item.args];

      this.log(`Spawning: ${this.solveCommand} ${args.join(' ')}`);

      const child = spawn(this.solveCommand, args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: false,
      });

      item.childProcess = child;
      let stdout = '';
      let stderr = '';

      child.stdout.on('data', data => {
        stdout += data.toString();
      });

      child.stderr.on('data', data => {
        stderr += data.toString();
      });

      child.on('close', code => {
        item.childProcess = null;
        if (code === 0) {
          resolve({
            success: true,
            output: stdout,
            exitCode: code,
          });
        } else {
          reject(new Error(`Solve command exited with code ${code}: ${stderr || stdout}`));
        }
      });

      child.on('error', error => {
        item.childProcess = null;
        reject(error);
      });
    });
  }

  /**
   * Sleep for specified milliseconds
   * @param {number} ms
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Stop the queue
   */
  stop() {
    this.log('Stopping queue...');
    this.isRunning = false;
  }

  /**
   * Clear the limit cache
   */
  clearCache() {
    getLimitCache().clear();
    this.log('Limit cache cleared');
  }
}

/**
 * Global queue instance (singleton)
 */
let globalQueue = null;

/**
 * Get or create the global orchestrator queue instance
 * @param {Object} options - Queue options
 * @returns {OrchestratorQueue}
 */
export function getOrchestratorQueue(options = {}) {
  if (!globalQueue) {
    globalQueue = new OrchestratorQueue(options);
  } else if (options.verbose !== undefined) {
    globalQueue.verbose = options.verbose;
  }
  return globalQueue;
}

/**
 * Reset the global queue (useful for testing)
 */
export function resetOrchestratorQueue() {
  if (globalQueue) {
    globalQueue.stop();
    globalQueue = null;
  }
}

export default {
  OrchestratorQueue,
  OrchestratorQueueItem,
  getOrchestratorQueue,
  resetOrchestratorQueue,
  getRunningClaudeProcesses,
  QUEUE_CONFIG,
  QueueItemStatus,
};
