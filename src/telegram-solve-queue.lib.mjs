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
import { getCachedClaudeLimits, getCachedGitHubLimits, getCachedMemoryInfo, getCachedCpuInfo, getCachedDiskInfo, getLimitCache, getCpuLoadInfo, getMemoryInfo, CACHE_TTL } from './limits.lib.mjs';

/**
 * Configuration constants for queue throttling
 * All thresholds use ratios (0.0 - 1.0) representing usage percentage
 */
export const QUEUE_CONFIG = {
  // Resource thresholds (usage ratios: 0.0 - 1.0)
  RAM_THRESHOLD: 0.5, // Stop if RAM usage > 50%
  CPU_THRESHOLD: 0.5, // Stop if CPU usage > 50%
  DISK_THRESHOLD: 0.95, // One-at-a-time if disk usage > 95%

  // API limit thresholds (usage ratios: 0.0 - 1.0)
  CLAUDE_SESSION_THRESHOLD: 0.9, // Stop if 5-hour limit > 90%
  CLAUDE_WEEKLY_THRESHOLD: 0.99, // One-at-a-time if weekly limit > 99%
  GITHUB_API_THRESHOLD: 0.8, // Stop if GitHub > 80% with parallel claude

  // Timing
  MIN_START_INTERVAL_MS: 60000, // 1 minute between starts
  CONSUMER_POLL_INTERVAL_MS: 5000, // 5 seconds between queue checks
  MESSAGE_UPDATE_INTERVAL_MS: 60000, // 1 minute between status message updates

  // Process detection
  CLAUDE_PROCESS_NAMES: ['claude'], // Process names to detect
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
      console.log(`[VERBOSE] /solve-queue found ${processes.length} running claude processes`);
      if (processes.length > 0) {
        console.log(`[VERBOSE] /solve-queue processes: ${JSON.stringify(processes)}`);
      }
    }

    return {
      count: processes.length,
      processes: processes.map(p => `${p.pid}:${p.name}`),
    };
  } catch (error) {
    if (verbose) {
      console.error('[VERBOSE] /solve-queue error counting claude processes:', error.message);
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
    case 'claude_session':
      return `Claude session limit is ${currentPercent}% (threshold: ${thresholdPercent})`;
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
 */
export class SolveQueue {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.executeCallback = options.executeCallback || null;
    this.messageUpdateCallback = options.messageUpdateCallback || null;

    // Queue state
    this.queue = [];
    this.processing = new Map();
    this.completed = [];
    this.failed = [];
    this.isRunning = true;

    // Timing
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

    this.log('SolveQueue initialized');
  }

  /**
   * Log message if verbose mode is enabled
   * @param {string} message
   */
  log(message) {
    if (this.verbose) {
      console.log(`[VERBOSE] /solve-queue: ${message}`);
    }
  }

  /**
   * Add a solve command to the queue
   * @param {Object} options - Queue item options
   * @returns {SolveQueueItem} The queued item
   */
  enqueue(options) {
    const item = new SolveQueueItem(options);
    this.queue.push(item);
    this.stats.totalEnqueued++;

    this.log(`Enqueued: ${item.toString()}, queue length: ${this.queue.length}`);

    // Start consumer if not already running
    this.ensureConsumerRunning();

    return item;
  }

  /**
   * Cancel a queued item by ID
   * @param {string} id - Item ID
   * @returns {boolean} True if cancelled
   */
  cancel(id) {
    const queueIndex = this.queue.findIndex(item => item.id === id);
    if (queueIndex !== -1) {
      const item = this.queue.splice(queueIndex, 1)[0];
      item.setCancelled();
      this.stats.totalCancelled++;
      this.log(`Cancelled queued item: ${item.toString()}`);
      return true;
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
    return {
      queued: this.queue.length,
      processing: this.processing.size,
      completed: this.completed.length,
      failed: this.failed.length,
      ...this.stats,
      cacheStats: getLimitCache().getStats(),
      lastStartTime: this.lastStartTime,
      isRunning: this.isRunning,
    };
  }

  /**
   * Get queue items summary for display
   * @returns {Object}
   */
  getQueueSummary() {
    return {
      pending: this.queue.map(item => ({
        id: item.id,
        url: item.url,
        requester: item.requester,
        waitTime: item.getWaitTime(),
        createdAt: item.createdAt,
        status: item.status,
        waitingReason: item.waitingReason,
      })),
      processing: Array.from(this.processing.values()).map(item => ({
        id: item.id,
        url: item.url,
        requester: item.requester,
        startedAt: item.startedAt,
        status: item.status,
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
   * @returns {Promise<{canStart: boolean, reason?: string, reasons?: string[], oneAtATime?: boolean}>}
   */
  async canStartCommand() {
    const reasons = [];
    let oneAtATime = false;

    // Check minimum interval since last start
    if (this.lastStartTime) {
      const timeSinceLastStart = Date.now() - this.lastStartTime;
      if (timeSinceLastStart < QUEUE_CONFIG.MIN_START_INTERVAL_MS) {
        const waitSeconds = Math.ceil((QUEUE_CONFIG.MIN_START_INTERVAL_MS - timeSinceLastStart) / 1000);
        reasons.push(formatWaitingReason('min_interval', 0, 0) + ` (${waitSeconds}s remaining)`);
        this.recordThrottle('min_interval');
      }
    }

    // Check running claude processes (this is a metric, not a blocking reason by itself)
    const claudeProcs = await getRunningClaudeProcesses(this.verbose);
    const hasRunningClaude = claudeProcs.count > 0;

    // Track claude_running as a metric (but don't add to reasons yet)
    if (hasRunningClaude) {
      this.recordThrottle('claude_running');
    }

    // Check system resources
    const resourceCheck = await this.checkSystemResources();
    if (!resourceCheck.ok) {
      reasons.push(...resourceCheck.reasons);
    }
    if (resourceCheck.oneAtATime) {
      oneAtATime = true;
    }

    // Check API limits (pass hasRunningClaude to enable special handling)
    const limitCheck = await this.checkApiLimits(hasRunningClaude);
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
    };
  }

  /**
   * Check system resources (RAM, CPU, disk) using cached values
   *
   * IMPORTANT: When a cached value exceeds a threshold, we force-refresh
   * to avoid blocking on stale values. This prevents the queue from getting
   * stuck when a transient spike (like CPU during claude startup) was cached.
   * See: https://github.com/link-assistant/hive-mind/issues/1078
   *
   * @returns {Promise<{ok: boolean, reasons: string[], oneAtATime: boolean}>}
   */
  async checkSystemResources() {
    const reasons = [];
    let oneAtATime = false;
    const cache = getLimitCache();

    // Check RAM (using cached value, with force-refresh if above threshold)
    let memResult = await getCachedMemoryInfo(this.verbose);
    if (memResult.success) {
      let usedRatio = memResult.memory.usedPercentage / 100;

      // If cached value exceeds threshold, force-refresh to confirm it's not stale
      if (usedRatio > QUEUE_CONFIG.RAM_THRESHOLD) {
        if (this.verbose) {
          this.log(`RAM cached at ${memResult.memory.usedPercentage}% (above threshold), refreshing...`);
        }
        const freshResult = await getMemoryInfo(this.verbose);
        if (freshResult.success) {
          usedRatio = freshResult.memory.usedPercentage / 100;
          // Update cache with fresh value
          cache.set('memory', freshResult, CACHE_TTL.SYSTEM);
          memResult = freshResult;
          if (this.verbose) {
            this.log(`RAM fresh value: ${freshResult.memory.usedPercentage}%`);
          }
        }
      }

      // Only block if (refreshed) value still exceeds threshold
      if (usedRatio > QUEUE_CONFIG.RAM_THRESHOLD) {
        reasons.push(formatWaitingReason('ram', memResult.memory.usedPercentage, QUEUE_CONFIG.RAM_THRESHOLD));
        this.recordThrottle('ram_high');
      }
    }

    // Check CPU (using cached value, with force-refresh if above threshold)
    let cpuResult = await getCachedCpuInfo(this.verbose);
    if (cpuResult.success) {
      let usedRatio = cpuResult.cpuLoad.usagePercentage / 100;

      // If cached value exceeds threshold, force-refresh to confirm it's not stale
      // This is critical because CPU can spike briefly during claude startup
      // See: https://github.com/link-assistant/hive-mind/issues/1078
      if (usedRatio > QUEUE_CONFIG.CPU_THRESHOLD) {
        if (this.verbose) {
          this.log(`CPU cached at ${cpuResult.cpuLoad.usagePercentage}% (above threshold), refreshing...`);
        }
        const freshResult = await getCpuLoadInfo(this.verbose);
        if (freshResult.success) {
          usedRatio = freshResult.cpuLoad.usagePercentage / 100;
          // Update cache with fresh value
          cache.set('cpu', freshResult, CACHE_TTL.SYSTEM);
          cpuResult = freshResult;
          if (this.verbose) {
            this.log(`CPU fresh value: ${freshResult.cpuLoad.usagePercentage}%`);
          }
        }
      }

      // Only block if (refreshed) value still exceeds threshold
      if (usedRatio > QUEUE_CONFIG.CPU_THRESHOLD) {
        reasons.push(formatWaitingReason('cpu', cpuResult.cpuLoad.usagePercentage, QUEUE_CONFIG.CPU_THRESHOLD));
        this.recordThrottle('cpu_high');
      }
    }

    // Check disk space (using cached value)
    const diskResult = await getCachedDiskInfo(this.verbose);
    if (diskResult.success) {
      // Calculate usage from free percentage
      const usedPercent = 100 - diskResult.diskSpace.freePercentage;
      const usedRatio = usedPercent / 100;
      if (usedRatio > QUEUE_CONFIG.DISK_THRESHOLD) {
        oneAtATime = true;
        this.recordThrottle('disk_high');
        if (this.processing.size > 0) {
          reasons.push(formatWaitingReason('disk', usedPercent, QUEUE_CONFIG.DISK_THRESHOLD) + ' (waiting for current command)');
        }
      }
    }

    return { ok: reasons.length === 0, reasons, oneAtATime };
  }

  /**
   * Check API limits (Claude, GitHub) using cached values
   *
   * Simplified logic per issue #1061:
   * - When any limit >= threshold, allow exactly one claude command to pass
   * - Only block if there's already a command in progress
   * - Running claude is the ultimate test of whether limits are really exhausted
   *
   * @param {boolean} hasRunningClaude - Whether claude processes are running
   * @returns {Promise<{ok: boolean, reasons: string[], oneAtATime: boolean}>}
   */
  async checkApiLimits(hasRunningClaude = false) {
    const reasons = [];
    let oneAtATime = false;

    // Check Claude limits (using cached value)
    const claudeResult = await getCachedClaudeLimits(this.verbose);
    if (claudeResult.success) {
      const sessionPercent = claudeResult.usage.currentSession.percentage;
      const weeklyPercent = claudeResult.usage.allModels.percentage;

      // Session limit (5-hour)
      // When above threshold: allow exactly one command, block if one is running
      if (sessionPercent !== null) {
        const sessionRatio = sessionPercent / 100;
        if (sessionRatio >= QUEUE_CONFIG.CLAUDE_SESSION_THRESHOLD) {
          // Only block if Claude is already running
          if (hasRunningClaude) {
            reasons.push(formatWaitingReason('claude_session', sessionPercent, QUEUE_CONFIG.CLAUDE_SESSION_THRESHOLD));
          }
          this.recordThrottle(sessionRatio >= 1.0 ? 'claude_session_100' : 'claude_session_high');
        }
      }

      // Weekly limit
      // When above threshold: allow exactly one command, block if one is in progress
      if (weeklyPercent !== null) {
        const weeklyRatio = weeklyPercent / 100;
        if (weeklyRatio >= QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD) {
          oneAtATime = true;
          this.recordThrottle(weeklyRatio >= 1.0 ? 'claude_weekly_100' : 'claude_weekly_high');
          // Only block if command is already in progress
          if (this.processing.size > 0) {
            reasons.push(formatWaitingReason('claude_weekly', weeklyPercent, QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD) + ' (waiting for current command)');
          }
        }
      }
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
      console.error('[solve-queue] Consumer error:', error);
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
   * Consumer loop - processes items from the queue
   */
  async runConsumer() {
    this.log('Consumer started');

    while (this.isRunning) {
      if (this.queue.length === 0) {
        await this.sleep(QUEUE_CONFIG.CONSUMER_POLL_INTERVAL_MS);
        continue;
      }

      const check = await this.canStartCommand();

      if (!check.canStart) {
        // Update all queued items to waiting status with reason
        // Also periodically refresh messages to show current status
        // See: https://github.com/link-assistant/hive-mind/issues/1078
        for (const item of this.queue) {
          if (item.status === QueueItemStatus.QUEUED || item.status === QueueItemStatus.WAITING) {
            const previousStatus = item.status;
            const previousReason = item.waitingReason;
            item.setWaiting(check.reason);

            // Update message if:
            // 1. Status or reason changed
            // 2. OR it's time for a periodic update (every MESSAGE_UPDATE_INTERVAL_MS)
            const shouldUpdate = previousStatus !== item.status || previousReason !== item.waitingReason || this.shouldUpdateMessage(item);

            if (shouldUpdate) {
              const position = this.queue.indexOf(item) + 1;
              await this.updateItemMessage(item, `⏳ Waiting (position #${position})\n\n${item.infoBlock}\n\n*Reason:*\n${check.reason}`);
            }
          }
        }

        this.log(`Throttled: ${check.reason}`);
        await this.sleep(QUEUE_CONFIG.CONSUMER_POLL_INTERVAL_MS);
        continue;
      }

      // Check one-at-a-time mode
      if (check.oneAtATime && this.processing.size > 0) {
        this.log('One-at-a-time mode: waiting for current command to finish');
        await this.sleep(QUEUE_CONFIG.CONSUMER_POLL_INTERVAL_MS);
        continue;
      }

      // Get next item from queue
      const item = this.queue.shift();
      if (!item) continue;

      // Check if this item uses claude tool and claude is running
      if (item.tool === 'claude' && check.claudeProcesses > 0) {
        this.queue.unshift(item);
        this.log(`Claude tool item queued but claude running, waiting...`);
        await this.sleep(QUEUE_CONFIG.CONSUMER_POLL_INTERVAL_MS);
        continue;
      }

      // Update status to Starting
      item.setStarting();
      this.processing.set(item.id, item);
      this.lastStartTime = Date.now();
      this.stats.totalStarted++;

      // Update message to show Starting status
      await this.updateItemMessage(item, `🚀 Starting solve command...\n\n${item.infoBlock}`);

      this.log(`Starting: ${item.toString()}`);

      // Execute in background
      this.executeItem(item).catch(error => {
        console.error(`[solve-queue] Execution error for ${item.id}:`, error);
      });
    }

    this.log('Consumer stopped');
    this.consumerTask = null;
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
          const sessionMatch = result.output.match(/session:\s*(\S+)/i) || result.output.match(/screen -r\s+(\S+)/);
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
              console.error(`[solve-queue] Failed to update message for item ${item.id}: ${error.message}`);
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
      console.error(`[solve-queue] Item failed: ${item.id}`, error);

      // Try to update message with error
      const { chatId, messageId } = item.messageInfo || {};
      if (chatId && messageId && item.ctx) {
        try {
          await item.ctx.telegram.editMessageText(chatId, messageId, undefined, `❌ Error: ${error.message}`, { parse_mode: 'Markdown' });
        } catch (editError) {
          // Log the edit failure for debugging
          // See: https://github.com/link-assistant/hive-mind/issues/1062
          console.error(`[solve-queue] Failed to update error message for item ${item.id}: ${editError.message}`);
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
   * Format queue status for display
   * @returns {string}
   */
  formatStatus() {
    const stats = this.getStats();
    if (stats.queued > 0 || stats.processing > 0) {
      return `Solve Queue: ${stats.queued} pending, ${stats.processing} processing\n`;
    }
    return 'Solve Queue: empty\n';
  }

  /**
   * Format detailed queue status for Telegram message
   * @returns {string}
   */
  formatDetailedStatus() {
    const stats = this.getStats();
    const summary = this.getQueueSummary();

    let message = '📋 *Solve Queue Status*\n\n';
    message += `Pending: ${stats.queued}\n`;
    message += `Processing: ${stats.processing}\n`;
    message += `Completed: ${stats.completed}\n`;
    message += `Failed: ${stats.failed}\n\n`;

    if (summary.processing.length > 0) {
      message += '*Currently Processing:*\n';
      for (const item of summary.processing) {
        message += `• ${item.url}\n`;
      }
      message += '\n';
    }

    if (summary.pending.length > 0) {
      message += '*Waiting in Queue:*\n';
      for (const item of summary.pending.slice(0, 5)) {
        const waitSeconds = Math.floor(item.waitTime / 1000);
        message += `• ${item.url} (${item.status}, ${waitSeconds}s)\n`;
        if (item.waitingReason) {
          message += `  └ ${item.waitingReason}\n`;
        }
      }
      if (summary.pending.length > 5) {
        message += `  ... and ${summary.pending.length - 5} more\n`;
      }
    }

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
  QUEUE_CONFIG,
  QueueItemStatus,
};
