#!/usr/bin/env node
/**
 * Telegram Solve Queue Library
 *
 * Producer/consumer queue for /solve commands in the Telegram bot.
 * Implements resource-aware throttling to prevent system overload.
 *
 * Features:
 * - Resource checking (RAM, CPU, disk)
 * - API limit checking (Claude, GitHub)
 * - Minimum interval between command starts
 * - Running process detection
 * - Status tracking: Queued -> Waiting -> Starting -> Started
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1041
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Import centralized limits and caching
import { getCachedClaudeLimits, getCachedGitHubLimits, getCachedMemoryInfo, getCachedCpuInfo, getCachedDiskInfo, getLimitCache } from './limits.lib.mjs';

// Import centralized queue configuration
// This ensures thresholds are consistent between queue logic and display formatting
// See: https://github.com/link-assistant/hive-mind/issues/1242
// See: https://github.com/link-assistant/hive-mind/issues/1253 (configurable strategies)
export { QUEUE_CONFIG, THRESHOLD_STRATEGIES } from './queue-config.lib.mjs';
import { QUEUE_CONFIG } from './queue-config.lib.mjs';

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
      console.log(`[VERBOSE] /solve_queue found ${processes.length} running claude processes`);
      if (processes.length > 0) {
        console.log(`[VERBOSE] /solve_queue processes: ${JSON.stringify(processes)}`);
      }
    }

    return {
      count: processes.length,
      processes: processes.map(p => `${p.pid}:${p.name}`),
    };
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] /solve_queue error counting claude processes:', error.message);
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
 * Format milliseconds into human-readable duration
 * Shows days, hours, minutes, and seconds as appropriate.
 * Examples: "5h 43m 23s", "2m 15s", "45s", "1d 3h 12m 5s"
 *
 * @param {number} ms - Duration in milliseconds
 * @returns {string} Human-readable duration
 * @see https://github.com/link-assistant/hive-mind/issues/1267
 */
export function formatDuration(ms) {
  if (ms < 0) ms = 0;

  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(' ');
}

/**
 * Generate human-readable waiting reason based on threshold violation
 * @param {string} metric - The metric name (ram, cpu, disk, etc.)
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
 * Queue item representing a /solve command request
 */
class SolveQueueItem {
  constructor(options) {
    this.id = `solve-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    this.url = options.url;
    this.args = options.args;
    this.ctx = options.ctx;
    this.requester = options.requester;
    this.infoBlock = options.infoBlock;
    this.tool = options.tool || 'claude';
    this.createdAt = new Date();
    this.startedAt = null;
    this.status = QueueItemStatus.QUEUED;
    this.waitingReason = null;
    this.error = null;
    this.result = null;
    this.sessionName = null;
    // Message tracking - forget after STARTED
    this.messageInfo = null; // { chatId, messageId }
    // Track when we last updated the Telegram message
    // See: https://github.com/link-assistant/hive-mind/issues/1078
    this.lastMessageUpdateTime = null;
  }

  /**
   * Update status to waiting with reason
   * @param {string} reason - Waiting reason
   */
  setWaiting(reason) {
    this.status = QueueItemStatus.WAITING;
    this.waitingReason = reason;
  }

  /**
   * Update status to starting
   */
  setStarting() {
    this.status = QueueItemStatus.STARTING;
    this.startedAt = new Date();
    this.waitingReason = null;
  }

  /**
   * Update status to started and clear message tracking
   * @param {string} sessionName - Session name for debugging
   */
  setStarted(sessionName) {
    this.status = QueueItemStatus.STARTED;
    this.sessionName = sessionName;
    // Terminal status - forget message tracking
    this.messageInfo = null;
  }

  /**
   * Mark item as failed
   * @param {Error|string} error - Error that occurred
   */
  setFailed(error) {
    this.status = QueueItemStatus.FAILED;
    this.error = error instanceof Error ? error.message : error;
  }

  /**
   * Mark item as cancelled
   */
  setCancelled() {
    this.status = QueueItemStatus.CANCELLED;
  }

  /**
   * Get wait time in queue (ms)
   */
  getWaitTime() {
    const endTime = this.startedAt || new Date();
    return endTime - this.createdAt;
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
 * Solve Queue - Producer/Consumer queue for /solve commands
 *
 * Uses separate queues for each tool type to ensure:
 * - Claude tasks never block agent tasks (and vice versa)
 * - Each tool queue maintains FIFO order
 * - Each tool has independent rate limiting
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1159
 */
export class SolveQueue {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.executeCallback = options.executeCallback || null;
    this.messageUpdateCallback = options.messageUpdateCallback || null;

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

    this.log('SolveQueue initialized with separate tool queues');
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
   * Get combined queue length across all tools (for backwards compatibility)
   * @returns {number} Total queue length
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
      console.log(`[VERBOSE] /solve_queue: ${message}`);
    }
  }

  /**
   * Add a solve command to the appropriate tool queue
   * Items are added to the queue for their specific tool type.
   * @param {Object} options - Queue item options
   * @returns {SolveQueueItem} The queued item
   * @see https://github.com/link-assistant/hive-mind/issues/1159
   */
  enqueue(options) {
    const item = new SolveQueueItem(options);
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
   * @returns {SolveQueueItem|null} The found item or null
   * @see https://github.com/link-assistant/hive-mind/issues/1080
   */
  findByUrl(url) {
    // Check all tool queues
    for (const toolQueue of Object.values(this.queues)) {
      const queuedItem = toolQueue.find(item => item.url === url);
      if (queuedItem) {
        return queuedItem;
      }
    }

    // Check processing items
    for (const item of this.processing.values()) {
      if (item.url === url) {
        return item;
      }
    }

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
   * Find startable items from each tool queue
   * Returns the first item from each tool queue that can start.
   * With separate queues, each tool is checked independently so they don't block each other.
   * @returns {Promise<Array<{item: SolveQueueItem, tool: string, index: number, check: Object}>>}
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
   * @returns {Promise<{item: SolveQueueItem|null, index: number, check: Object}>}
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
        pending.push({
          id: item.id,
          url: item.url,
          requester: item.requester,
          waitTime: item.getWaitTime(),
          createdAt: item.createdAt,
          status: item.status,
          waitingReason: item.waitingReason,
          tool,
        });
      }
    }

    // Sort by createdAt to show oldest first (global order)
    pending.sort((a, b) => a.createdAt - b.createdAt);

    return {
      pending,
      processing: Array.from(this.processing.values()).map(item => ({
        id: item.id,
        url: item.url,
        requester: item.requester,
        startedAt: item.startedAt,
        status: item.status,
        tool: item.tool,
      })),
    };
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
   * Logic per issue #1253:
   * - All thresholds now support configurable strategies (reject, enqueue, dequeue-one-at-a-time)
   * - 'reject' strategy immediately rejects the command without queueing
   * - 'enqueue' blocks and waits in queue until metric drops
   * - 'dequeue-one-at-a-time' allows one command while blocking subsequent
   *
   * @param {Object} options - Options for the check
   * @param {string} options.tool - The tool being used ('claude', 'agent', etc.)
   * @returns {Promise<{canStart: boolean, rejected?: boolean, rejectReason?: string, reason?: string, reasons?: string[], oneAtATime?: boolean}>}
   */
  async canStartCommand(options = {}) {
    const tool = options.tool || 'claude';
    const reasons = [];
    let oneAtATime = false;
    let rejected = false;
    let rejectReason = null;

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

    // Check system resources with strategy support
    // System resources apply to ALL tools, not just Claude
    // See: https://github.com/link-assistant/hive-mind/issues/1155
    // See: https://github.com/link-assistant/hive-mind/issues/1253 (strategies)
    const resourceCheck = await this.checkSystemResources(totalProcessing);
    if (resourceCheck.rejected) {
      rejected = true;
      rejectReason = resourceCheck.rejectReason;
    }
    if (!resourceCheck.ok && !resourceCheck.rejected) {
      reasons.push(...resourceCheck.reasons);
    }
    if (resourceCheck.oneAtATime) {
      oneAtATime = true;
    }

    // Check API limits with strategy support (pass hasRunningClaude, claudeProcessingCount, and tool)
    // Claude limits use claudeProcessingCount (only Claude items), not totalProcessing
    // This allows agent tasks to proceed when Claude limits are reached
    // See: https://github.com/link-assistant/hive-mind/issues/1159
    // See: https://github.com/link-assistant/hive-mind/issues/1253 (strategies)
    const limitCheck = await this.checkApiLimits(hasRunningClaude, claudeProcessingCount, tool);
    if (limitCheck.rejected) {
      rejected = true;
      rejectReason = limitCheck.rejectReason;
    }
    if (!limitCheck.ok && !limitCheck.rejected) {
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

    const canStart = reasons.length === 0 && !rejected;

    if (!canStart && this.verbose) {
      if (rejected) {
        this.log(`Rejected: ${rejectReason}`);
      } else {
        this.log(`Cannot start: ${reasons.join(', ')}`);
      }
    }

    return {
      canStart,
      rejected,
      rejectReason,
      reason: reasons.length > 0 ? reasons.join('\n') : undefined,
      reasons,
      oneAtATime,
      claudeProcesses: claudeProcs.count,
      totalProcessing,
      claudeProcessingCount,
    };
  }

  /**
   * Check system resources (RAM, CPU, disk) using cached values
   *
   * Uses 5-minute load average for CPU instead of instantaneous usage.
   * This provides a more stable metric that isn't affected by brief spikes
   * during claude process startup.
   *
   * Resource threshold modes are now configurable via HIVE_MIND_QUEUE_CONFIG:
   * - 'reject': Immediately reject the command, no queueing
   * - 'enqueue': Block all commands unconditionally until metric drops
   * - 'dequeue-one-at-a-time': Allow one command when above threshold
   *
   * Default strategies:
   * - RAM: enqueue
   * - CPU: enqueue
   * - DISK: reject (changed from dequeue-one-at-a-time - queue lost on restart)
   *
   * See: https://github.com/link-assistant/hive-mind/issues/1155
   * See: https://github.com/link-assistant/hive-mind/issues/1253
   *
   * @param {number} totalProcessing - Total processing count (queue + external claude processes)
   * @returns {Promise<{ok: boolean, reasons: string[], oneAtATime: boolean, rejected: boolean, rejectReason: string|null}>}
   */
  async checkSystemResources(totalProcessing = 0) {
    const reasons = [];
    let oneAtATime = false;
    let rejected = false;
    let rejectReason = null;

    // Check RAM (using cached value)
    const memResult = await getCachedMemoryInfo(this.verbose);
    if (memResult.success) {
      const usedRatio = memResult.memory.usedPercentage / 100;
      if (usedRatio >= QUEUE_CONFIG.thresholds.ram.value) {
        const reason = formatWaitingReason('ram', memResult.memory.usedPercentage, QUEUE_CONFIG.thresholds.ram.value);
        const strategy = QUEUE_CONFIG.thresholds.ram.strategy;
        this.recordThrottle(`ram_${strategy}`);

        if (strategy === 'reject') {
          rejected = true;
          rejectReason = reason;
        } else if (strategy === 'dequeue-one-at-a-time') {
          oneAtATime = true;
          if (totalProcessing > 0) {
            reasons.push(reason + ' (waiting for current command)');
          }
        } else {
          // 'enqueue' - block unconditionally
          reasons.push(reason);
        }
      }
    }

    // Check CPU using 5-minute load average (more stable than 1-minute)
    // Cache TTL is 2 minutes, which is appropriate for this metric
    const cpuResult = await getCachedCpuInfo(this.verbose);
    if (cpuResult.success) {
      // Use loadAvg5 (5-minute average) instead of usagePercentage (1-minute based)
      // This provides a more stable metric that isn't affected by transient spikes
      const loadAvg5 = cpuResult.cpuLoad.loadAvg5;
      const cpuCount = cpuResult.cpuLoad.cpuCount;
      // Calculate usage ratio: loadAvg5 / cpuCount
      // Load average of 1.0 per CPU = 100% utilization
      const usageRatio = loadAvg5 / cpuCount;
      const usagePercent = Math.min(100, Math.round(usageRatio * 100));

      if (this.verbose) {
        this.log(`CPU 5m load avg: ${loadAvg5.toFixed(2)}, cpus: ${cpuCount}, usage: ${usagePercent}%`);
      }

      if (usageRatio >= QUEUE_CONFIG.thresholds.cpu.value) {
        const reason = formatWaitingReason('cpu', usagePercent, QUEUE_CONFIG.thresholds.cpu.value);
        const strategy = QUEUE_CONFIG.thresholds.cpu.strategy;
        this.recordThrottle(`cpu_${strategy}`);

        if (strategy === 'reject') {
          rejected = true;
          rejectReason = reason;
        } else if (strategy === 'dequeue-one-at-a-time') {
          oneAtATime = true;
          if (totalProcessing > 0) {
            reasons.push(reason + ' (waiting for current command)');
          }
        } else {
          // 'enqueue' - block unconditionally
          reasons.push(reason);
        }
      }
    }

    // Check disk space (using cached value)
    // Default strategy changed to 'reject' because queue is lost on restart anyway
    // See: https://github.com/link-assistant/hive-mind/issues/1253
    const diskResult = await getCachedDiskInfo(this.verbose);
    if (diskResult.success) {
      // Calculate usage from free percentage
      const usedPercent = 100 - diskResult.diskSpace.freePercentage;
      const usedRatio = usedPercent / 100;
      if (usedRatio >= QUEUE_CONFIG.thresholds.disk.value) {
        const reason = formatWaitingReason('disk', usedPercent, QUEUE_CONFIG.thresholds.disk.value);
        const strategy = QUEUE_CONFIG.thresholds.disk.strategy;
        this.recordThrottle(`disk_${strategy}`);

        if (strategy === 'reject') {
          rejected = true;
          rejectReason = reason;
        } else if (strategy === 'dequeue-one-at-a-time') {
          oneAtATime = true;
          if (totalProcessing > 0) {
            reasons.push(reason + ' (waiting for current command)');
          }
        } else {
          // 'enqueue' - block unconditionally
          reasons.push(reason);
        }
      }
    }

    return { ok: reasons.length === 0 && !rejected, reasons, oneAtATime, rejected, rejectReason };
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
   * Logic per issue #1253:
   * - All thresholds now support configurable strategies (reject, enqueue, dequeue-one-at-a-time)
   * - Configuration via HIVE_MIND_QUEUE_CONFIG or individual env vars
   *
   * @param {boolean} hasRunningClaude - Whether claude processes are running (from pgrep)
   * @param {number} claudeProcessingCount - Count of 'claude' tool items being processed in queue
   * @param {string} tool - The tool being used ('claude', 'agent', etc.)
   * @returns {Promise<{ok: boolean, reasons: string[], oneAtATime: boolean, rejected: boolean, rejectReason: string|null}>}
   */
  async checkApiLimits(hasRunningClaude = false, claudeProcessingCount = 0, tool = 'claude') {
    const reasons = [];
    let oneAtATime = false;
    let rejected = false;
    let rejectReason = null;

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
        // Configurable strategy via HIVE_MIND_QUEUE_CONFIG or HIVE_MIND_CLAUDE_5_HOUR_SESSION_STRATEGY
        // See: https://github.com/link-assistant/hive-mind/issues/1133, #1159, #1253
        if (sessionPercent !== null) {
          const sessionRatio = sessionPercent / 100;
          if (sessionRatio >= QUEUE_CONFIG.thresholds.claude5Hour.value) {
            const reason = formatWaitingReason('claude_5_hour_session', sessionPercent, QUEUE_CONFIG.thresholds.claude5Hour.value);
            const strategy = QUEUE_CONFIG.thresholds.claude5Hour.strategy;
            this.recordThrottle(sessionRatio >= 1.0 ? 'claude_5_hour_session_100' : `claude_5_hour_session_${strategy}`);

            if (strategy === 'reject') {
              rejected = true;
              rejectReason = reason;
            } else if (strategy === 'dequeue-one-at-a-time') {
              oneAtATime = true;
              if (totalClaudeProcessing > 0) {
                reasons.push(reason + ' (waiting for current command)');
              }
            } else {
              // 'enqueue' - block unconditionally
              reasons.push(reason);
            }
          }
        }

        // Weekly limit
        // Configurable strategy via HIVE_MIND_QUEUE_CONFIG or HIVE_MIND_CLAUDE_WEEKLY_STRATEGY
        // See: https://github.com/link-assistant/hive-mind/issues/1133, #1159, #1253
        if (weeklyPercent !== null) {
          const weeklyRatio = weeklyPercent / 100;
          if (weeklyRatio >= QUEUE_CONFIG.thresholds.claudeWeekly.value) {
            const reason = formatWaitingReason('claude_weekly', weeklyPercent, QUEUE_CONFIG.thresholds.claudeWeekly.value);
            const strategy = QUEUE_CONFIG.thresholds.claudeWeekly.strategy;
            this.recordThrottle(weeklyRatio >= 1.0 ? 'claude_weekly_100' : `claude_weekly_${strategy}`);

            if (strategy === 'reject') {
              rejected = true;
              rejectReason = reason;
            } else if (strategy === 'dequeue-one-at-a-time') {
              oneAtATime = true;
              if (totalClaudeProcessing > 0) {
                reasons.push(reason + ' (waiting for current command)');
              }
            } else {
              // 'enqueue' - block unconditionally
              reasons.push(reason);
            }
          }
        }
      }
    } else if (this.verbose) {
      this.log(`Claude limits not applied for --tool ${tool}`);
    }

    // Check GitHub limits (only relevant if claude processes running)
    // Configurable strategy via HIVE_MIND_QUEUE_CONFIG or HIVE_MIND_GITHUB_API_STRATEGY
    if (hasRunningClaude) {
      const githubResult = await getCachedGitHubLimits(this.verbose);
      if (githubResult.success) {
        const usedPercent = githubResult.githubRateLimit.usedPercentage;
        const usedRatio = usedPercent / 100;
        if (usedRatio >= QUEUE_CONFIG.thresholds.githubApi.value) {
          const reason = formatWaitingReason('github', usedPercent, QUEUE_CONFIG.thresholds.githubApi.value);
          const strategy = QUEUE_CONFIG.thresholds.githubApi.strategy;
          this.recordThrottle(usedRatio >= 1.0 ? 'github_100' : `github_${strategy}`);

          if (strategy === 'reject') {
            rejected = true;
            rejectReason = reason;
          } else if (strategy === 'dequeue-one-at-a-time') {
            oneAtATime = true;
            if (totalClaudeProcessing > 0) {
              reasons.push(reason + ' (waiting for current command)');
            }
          } else {
            // 'enqueue' - block unconditionally
            reasons.push(reason);
          }
        }
      }
    }

    return { ok: reasons.length === 0 && !rejected, reasons, oneAtATime, rejected, rejectReason };
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
      console.error('[solve_queue] Consumer error:', error);
      this.consumerTask = null;
    });
  }

  /**
   * Update item message in Telegram
   * @param {SolveQueueItem} item
   * @param {string} text
   * @param {boolean} trackUpdateTime - Whether to track this as a periodic update (default: true)
   */
  async updateItemMessage(item, text, trackUpdateTime = true) {
    if (!item.messageInfo || !item.ctx) return;

    try {
      const { chatId, messageId } = item.messageInfo;
      await item.ctx.telegram.editMessageText(chatId, messageId, undefined, text, { parse_mode: 'Markdown' });
      if (trackUpdateTime) {
        item.lastMessageUpdateTime = Date.now();
      }
    } catch (error) {
      this.log(`Failed to update message: ${error.message}`);
    }
  }

  /**
   * Check if an item's message should be updated periodically
   * @param {SolveQueueItem} item
   * @returns {boolean}
   */
  shouldUpdateMessage(item) {
    if (!item.messageInfo || !item.ctx) return false;
    if (!item.lastMessageUpdateTime) return true; // Never updated
    return Date.now() - item.lastMessageUpdateTime >= QUEUE_CONFIG.MESSAGE_UPDATE_INTERVAL_MS;
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

        // Update message to show Starting status
        await this.updateItemMessage(item, `🚀 Starting solve command...\n\n${item.infoBlock}`);

        this.log(`Starting: ${item.toString()} from ${tool} queue`);

        // Execute in background
        this.executeItem(item).catch(error => {
          console.error(`[solve_queue] Execution error for ${item.id}:`, error);
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
          const previousStatus = item.status;
          const previousReason = item.waitingReason;
          // Use rejectReason when threshold strategy is 'reject', otherwise use reason
          // This ensures disk-full and other rejection reasons are shown properly
          // See: https://github.com/link-assistant/hive-mind/issues/1267
          const waitReason = itemCheck.rejectReason || itemCheck.reason || 'Waiting in queue';
          item.setWaiting(waitReason);

          // Update message if status/reason changed or it's time for periodic update
          const shouldUpdate = previousStatus !== item.status || previousReason !== item.waitingReason || this.shouldUpdateMessage(item);

          if (shouldUpdate) {
            const position = i + 1; // Position within this tool's queue
            await this.updateItemMessage(item, `⏳ Waiting (${tool} queue #${position})\n\n${item.infoBlock}\n\n*Reason:*\n${item.waitingReason}`);
          }
        }
      }
    }
  }

  /**
   * Execute a queue item
   * @param {SolveQueueItem} item
   */
  async executeItem(item) {
    try {
      if (this.executeCallback) {
        const result = await this.executeCallback(item);

        // Extract session name from result
        let sessionName = 'unknown';
        if (result && result.output) {
          const sessionMatch = result.output.match(/session:\s*(\S+)/i) || result.output.match(/screen -R\s+(\S+)/);
          if (sessionMatch) sessionName = sessionMatch[1];
        }

        // IMPORTANT: Save messageInfo BEFORE calling setStarted, because setStarted clears it
        // This was a bug where the final message update never happened because messageInfo was null
        // See: https://github.com/link-assistant/hive-mind/issues/1062
        const savedMessageInfo = item.messageInfo;

        // Update to Started status (terminal - forgets message tracking)
        item.setStarted(sessionName);
        this.stats.totalCompleted++;

        // Final message update using saved messageInfo
        if (item.ctx && result && savedMessageInfo) {
          const { chatId, messageId } = savedMessageInfo;
          if (chatId && messageId) {
            try {
              if (result.warning) {
                await item.ctx.telegram.editMessageText(chatId, messageId, undefined, `⚠️ ${result.warning}`, { parse_mode: 'Markdown' });
              } else if (result.success) {
                const response = `✅ Solve command started successfully!\n\n📊 Session: \`${sessionName}\`\n\n${item.infoBlock}`;
                await item.ctx.telegram.editMessageText(chatId, messageId, undefined, response, { parse_mode: 'Markdown' });
              } else {
                const response = `❌ Error executing solve command:\n\n\`\`\`\n${result.error || result.output}\n\`\`\``;
                await item.ctx.telegram.editMessageText(chatId, messageId, undefined, response, { parse_mode: 'Markdown' });
              }
            } catch (error) {
              // Log message edit failures for debugging
              // See: https://github.com/link-assistant/hive-mind/issues/1062
              console.error(`[solve_queue] Failed to update message for item ${item.id}: ${error.message}`);
            }
          }
        }
      } else {
        item.setStarted('no-callback');
        this.stats.totalCompleted++;
      }
    } catch (error) {
      item.setFailed(error);
      this.stats.totalFailed++;
      console.error(`[solve_queue] Item failed: ${item.id}`, error);

      // Try to update message with error
      const { chatId, messageId } = item.messageInfo || {};
      if (chatId && messageId && item.ctx) {
        try {
          await item.ctx.telegram.editMessageText(chatId, messageId, undefined, `❌ Error: ${error.message}`, { parse_mode: 'Markdown' });
        } catch (editError) {
          // Log the edit failure for debugging
          // See: https://github.com/link-assistant/hive-mind/issues/1062
          console.error(`[solve_queue] Failed to update error message for item ${item.id}: ${editError.message}`);
        }
      }
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

  /**
   * Format queue status for display in /limits command
   * Shows per-tool queue breakdown with processing counts.
   *
   * Output format:
   * ```
   * Queues
   * claude (pending: 6, processing: 0)
   * agent (pending: 2, processing: 0)
   * ```
   *
   * @returns {string}
   * @see https://github.com/link-assistant/hive-mind/issues/1159
   * @see https://github.com/link-assistant/hive-mind/issues/1267
   */
  formatStatus() {
    // Always show per-tool breakdown for all known queues
    let message = 'Queues\n';
    for (const [tool, toolQueue] of Object.entries(this.queues)) {
      const pending = toolQueue.length;
      const processing = this.getProcessingCountByTool(tool);
      message += `${tool} (pending: ${pending}, processing: ${processing})\n`;
    }

    return message;
  }

  /**
   * Format detailed queue status for Telegram message
   * Groups output by tool queue, shows first 5 items per queue, and uses human-readable time.
   *
   * Output format:
   * ```
   * 📋 Solve Queue Status
   *
   * claude (pending: 6, processing: 0)
   * • url1 (waiting, 5h 43m 23s)
   *   └ RAM usage is 70% (threshold: 65%)
   * • url2 (queued, 2m 15s)
   *
   * agent (pending: 2, processing: 0)
   * • url3 (waiting, 1h 2m 5s)
   * ```
   *
   * @returns {string}
   * @see https://github.com/link-assistant/hive-mind/issues/1159
   * @see https://github.com/link-assistant/hive-mind/issues/1267
   */
  formatDetailedStatus() {
    const stats = this.getStats();

    let message = '📋 *Solve Queue Status*\n\n';

    // Show per-tool queue breakdown with items grouped by queue
    for (const [tool, toolQueue] of Object.entries(this.queues)) {
      const pending = toolQueue.length;
      const processing = this.getProcessingCountByTool(tool);
      message += `*${tool}* (pending: ${pending}, processing: ${processing})\n`;

      // Show processing items for this tool
      for (const item of this.processing.values()) {
        if (item.tool === tool) {
          const runTime = formatDuration(Date.now() - (item.startedAt || item.createdAt));
          message += `  ▶ ${item.url} (${item.status}, ${runTime})\n`;
        }
      }

      // Show first 5 queued items for this tool
      const displayItems = toolQueue.slice(0, 5);
      for (const item of displayItems) {
        const waitTime = formatDuration(item.getWaitTime());
        message += `  • ${item.url} (${item.status}, ${waitTime})\n`;
        if (item.waitingReason) {
          message += `    └ ${item.waitingReason}\n`;
        }
      }
      if (toolQueue.length > 5) {
        message += `    ... and ${toolQueue.length - 5} more\n`;
      }

      message += '\n';
    }

    // Summary stats
    message += `Completed: ${stats.completed}, Failed: ${stats.failed}\n`;

    return message;
  }
}

/**
 * Global queue instance (singleton)
 */
let globalQueue = null;

/**
 * Get or create the global solve queue instance
 * @param {Object} options - Queue options
 * @returns {SolveQueue}
 */
export function getSolveQueue(options = {}) {
  if (!globalQueue) {
    globalQueue = new SolveQueue(options);
  } else if (options.verbose !== undefined) {
    globalQueue.verbose = options.verbose;
  }
  return globalQueue;
}

/**
 * Reset the global queue (useful for testing)
 */
export function resetSolveQueue() {
  if (globalQueue) {
    globalQueue.stop();
    globalQueue = null;
  }
}

/**
 * Create an execute callback for the queue
 * @param {Function} executeStartScreen - Function to execute start-screen command
 * @returns {Function} Execute callback for queue items
 */
export function createQueueExecuteCallback(executeStartScreen) {
  return async item => {
    return await executeStartScreen('solve', item.args);
  };
}

export default {
  SolveQueue,
  SolveQueueItem,
  getSolveQueue,
  resetSolveQueue,
  getRunningClaudeProcesses,
  createQueueExecuteCallback,
  formatDuration,
  QUEUE_CONFIG,
  QueueItemStatus,
};
