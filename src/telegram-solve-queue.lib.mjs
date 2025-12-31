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
 * - Cached limit checks (5-minute cache)
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1041
 */

import { exec } from 'node:child_process';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

// Import resource monitoring functions
import { getClaudeUsageLimits, getCpuLoadInfo, getMemoryInfo, getDiskSpaceInfo, getGitHubRateLimits } from './claude-limits.lib.mjs';

/**
 * Configuration constants for queue throttling
 */
export const QUEUE_CONFIG = {
  // Resource thresholds
  RAM_THRESHOLD_PERCENT: 50, // Stop if RAM usage > 50%
  CPU_THRESHOLD_PERCENT: 50, // Stop if CPU usage > 50%
  DISK_FREE_THRESHOLD_PERCENT: 5, // One-at-a-time if disk free < 5%

  // API limit thresholds
  CLAUDE_SESSION_THRESHOLD_PERCENT: 90, // Stop if 5-hour limit > 90%
  CLAUDE_WEEKLY_THRESHOLD_PERCENT: 99, // One-at-a-time if weekly limit > 99%
  GITHUB_API_THRESHOLD_PERCENT: 80, // Stop if GitHub > 80% with parallel claude

  // Timing
  MIN_START_INTERVAL_MS: 60000, // 1 minute between starts
  LIMIT_CACHE_TTL_MS: 300000, // 5 minutes cache for API calls
  CONSUMER_POLL_INTERVAL_MS: 5000, // 5 seconds between queue checks

  // Process detection
  CLAUDE_PROCESS_NAMES: ['claude'], // Process names to detect
};

/**
 * Cache for API limit checks to avoid excessive API calls
 */
class LimitCache {
  constructor(ttlMs = QUEUE_CONFIG.LIMIT_CACHE_TTL_MS) {
    this.ttlMs = ttlMs;
    this.cache = new Map();
  }

  /**
   * Get cached value if not expired
   * @param {string} key - Cache key
   * @returns {any|null} Cached value or null if expired/missing
   */
  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() - entry.timestamp > this.ttlMs) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set cached value
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   */
  set(key, value) {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear entire cache
   */
  clear() {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   * @returns {Object} Cache stats
   */
  getStats() {
    const now = Date.now();
    let validEntries = 0;
    let expiredEntries = 0;

    for (const [_key, entry] of this.cache.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        expiredEntries++;
      } else {
        validEntries++;
      }
    }

    return {
      validEntries,
      expiredEntries,
      totalEntries: this.cache.size,
    };
  }
}

/**
 * Count running claude processes
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<{count: number, processes: string[]}>}
 */
export async function getRunningClaudeProcesses(verbose = false) {
  try {
    // Use pgrep to find claude processes
    // This is more reliable than parsing ps output
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
    // On error, assume no processes (allow command to proceed)
    return { count: 0, processes: [] };
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
    this.ctx = options.ctx; // Telegram context
    this.requester = options.requester;
    this.infoBlock = options.infoBlock;
    this.tool = options.tool || 'claude';
    this.createdAt = new Date();
    this.startedAt = null;
    this.status = 'pending'; // pending, processing, completed, failed, cancelled
    this.error = null;
    this.result = null;
  }

  /**
   * Mark item as processing
   */
  markProcessing() {
    this.status = 'processing';
    this.startedAt = new Date();
  }

  /**
   * Mark item as completed
   * @param {Object} result - Execution result
   */
  markCompleted(result) {
    this.status = 'completed';
    this.result = result;
  }

  /**
   * Mark item as failed
   * @param {Error|string} error - Error that occurred
   */
  markFailed(error) {
    this.status = 'failed';
    this.error = error instanceof Error ? error.message : error;
  }

  /**
   * Mark item as cancelled
   */
  markCancelled() {
    this.status = 'cancelled';
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
 * The queue implements resource-aware throttling:
 * - Checks system resources before starting commands
 * - Enforces minimum intervals between starts
 * - Limits concurrency based on API limits
 * - Caches limit checks to avoid API spam
 */
export class SolveQueue {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.executeCallback = options.executeCallback || null;

    // Queue state
    this.queue = [];
    this.processing = new Map(); // id -> SolveQueueItem
    this.completed = [];
    this.failed = [];
    this.isRunning = true;

    // Timing
    this.lastStartTime = null;

    // Cache for limit checks
    this.limitCache = new LimitCache(options.limitCacheTtlMs || QUEUE_CONFIG.LIMIT_CACHE_TTL_MS);

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
    // Check if in queue
    const queueIndex = this.queue.findIndex(item => item.id === id);
    if (queueIndex !== -1) {
      const item = this.queue.splice(queueIndex, 1)[0];
      item.markCancelled();
      this.stats.totalCancelled++;
      this.log(`Cancelled queued item: ${item.toString()}`);
      return true;
    }

    // Can't cancel processing items
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
      cacheStats: this.limitCache.getStats(),
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
      })),
      processing: Array.from(this.processing.values()).map(item => ({
        id: item.id,
        url: item.url,
        requester: item.requester,
        startedAt: item.startedAt,
      })),
    };
  }

  /**
   * Check if a new command can start
   * Returns { canStart: boolean, reason?: string, oneAtATime?: boolean }
   */
  async canStartCommand() {
    const reasons = [];
    let oneAtATime = false;

    // Check minimum interval since last start
    if (this.lastStartTime) {
      const timeSinceLastStart = Date.now() - this.lastStartTime;
      if (timeSinceLastStart < QUEUE_CONFIG.MIN_START_INTERVAL_MS) {
        const waitSeconds = Math.ceil((QUEUE_CONFIG.MIN_START_INTERVAL_MS - timeSinceLastStart) / 1000);
        reasons.push(`min interval (wait ${waitSeconds}s)`);
        this.recordThrottle('min_interval');
      }
    }

    // Check running claude processes
    const claudeProcs = await getRunningClaudeProcesses(this.verbose);
    if (claudeProcs.count > 0) {
      // Can't start new --tool claude commands if claude is running
      reasons.push(`claude running (${claudeProcs.count} processes)`);
      this.recordThrottle('claude_running');
    }

    // Check system resources (with caching)
    const resourceCheck = await this.checkSystemResources();
    if (!resourceCheck.ok) {
      reasons.push(...resourceCheck.reasons);
    }
    if (resourceCheck.oneAtATime) {
      oneAtATime = true;
    }

    // Check API limits (with caching)
    const limitCheck = await this.checkApiLimits(claudeProcs.count > 0);
    if (!limitCheck.ok) {
      reasons.push(...limitCheck.reasons);
    }
    if (limitCheck.oneAtATime) {
      oneAtATime = true;
    }

    // Determine if we can start
    const canStart = reasons.length === 0;

    if (!canStart && this.verbose) {
      this.log(`Cannot start: ${reasons.join(', ')}`);
    }

    return {
      canStart,
      reason: reasons.length > 0 ? reasons.join(', ') : undefined,
      oneAtATime,
      claudeProcesses: claudeProcs.count,
    };
  }

  /**
   * Check system resources (RAM, CPU, disk)
   * @returns {Promise<{ok: boolean, reasons: string[], oneAtATime: boolean}>}
   */
  async checkSystemResources() {
    const reasons = [];
    let oneAtATime = false;

    // Check RAM
    const memCached = this.limitCache.get('memory');
    const memResult = memCached || (await getMemoryInfo(this.verbose));
    if (!memCached && memResult.success) {
      this.limitCache.set('memory', memResult);
    }

    if (memResult.success) {
      const usedPercent = memResult.memory.usedPercentage;
      if (usedPercent > QUEUE_CONFIG.RAM_THRESHOLD_PERCENT) {
        reasons.push(`RAM ${usedPercent}% > ${QUEUE_CONFIG.RAM_THRESHOLD_PERCENT}%`);
        this.recordThrottle('ram_high');
      }
    }

    // Check CPU
    const cpuCached = this.limitCache.get('cpu');
    const cpuResult = cpuCached || (await getCpuLoadInfo(this.verbose));
    if (!cpuCached && cpuResult.success) {
      this.limitCache.set('cpu', cpuResult);
    }

    if (cpuResult.success) {
      const usedPercent = cpuResult.cpuLoad.usagePercentage;
      if (usedPercent > QUEUE_CONFIG.CPU_THRESHOLD_PERCENT) {
        reasons.push(`CPU ${usedPercent}% > ${QUEUE_CONFIG.CPU_THRESHOLD_PERCENT}%`);
        this.recordThrottle('cpu_high');
      }
    }

    // Check disk space
    const diskCached = this.limitCache.get('disk');
    const diskResult = diskCached || (await getDiskSpaceInfo(this.verbose));
    if (!diskCached && diskResult.success) {
      this.limitCache.set('disk', diskResult);
    }

    if (diskResult.success) {
      const freePercent = diskResult.diskSpace.freePercentage;
      if (freePercent < QUEUE_CONFIG.DISK_FREE_THRESHOLD_PERCENT) {
        // Low disk: one-at-a-time mode
        oneAtATime = true;
        this.recordThrottle('disk_low');
        if (this.processing.size > 0) {
          reasons.push(`disk free ${freePercent}% < ${QUEUE_CONFIG.DISK_FREE_THRESHOLD_PERCENT}% (wait for current)`);
        }
      }
    }

    return {
      ok: reasons.length === 0,
      reasons,
      oneAtATime,
    };
  }

  /**
   * Check API limits (Claude, GitHub)
   * @param {boolean} hasRunningClaude - Whether claude processes are running
   * @returns {Promise<{ok: boolean, reasons: string[], oneAtATime: boolean}>}
   */
  async checkApiLimits(hasRunningClaude = false) {
    const reasons = [];
    let oneAtATime = false;

    // Check Claude limits
    const claudeCached = this.limitCache.get('claude');
    const claudeResult = claudeCached || (await getClaudeUsageLimits(this.verbose));
    if (!claudeCached && claudeResult.success) {
      this.limitCache.set('claude', claudeResult);
    }

    if (claudeResult.success) {
      const sessionPercent = claudeResult.usage.currentSession.percentage;
      const weeklyPercent = claudeResult.usage.allModels.percentage;

      // Session limit (5-hour)
      if (sessionPercent !== null && sessionPercent >= QUEUE_CONFIG.CLAUDE_SESSION_THRESHOLD_PERCENT) {
        if (sessionPercent >= 100) {
          reasons.push(`Claude session 100% (waiting for reset)`);
          this.recordThrottle('claude_session_100');
        } else {
          reasons.push(`Claude session ${sessionPercent}% >= ${QUEUE_CONFIG.CLAUDE_SESSION_THRESHOLD_PERCENT}%`);
          this.recordThrottle('claude_session_high');
        }
      }

      // Weekly limit
      if (weeklyPercent !== null) {
        if (weeklyPercent >= 100) {
          // 100% weekly could mean 99.75%, allow one-at-a-time
          oneAtATime = true;
          this.recordThrottle('claude_weekly_100');
          if (this.processing.size > 0) {
            reasons.push(`Claude weekly 100% (wait for current)`);
          }
        } else if (weeklyPercent >= QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD_PERCENT) {
          // >99% weekly: one-at-a-time mode
          oneAtATime = true;
          this.recordThrottle('claude_weekly_high');
          if (this.processing.size > 0) {
            reasons.push(`Claude weekly ${weeklyPercent}% >= ${QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD_PERCENT}% (wait for current)`);
          }
        }
      }
    }

    // Check GitHub limits (only relevant if claude processes running)
    if (hasRunningClaude) {
      const githubCached = this.limitCache.get('github');
      const githubResult = githubCached || (await getGitHubRateLimits(this.verbose));
      if (!githubCached && githubResult.success) {
        this.limitCache.set('github', githubResult);
      }

      if (githubResult.success) {
        const usedPercent = githubResult.githubRateLimit.usedPercentage;
        if (usedPercent >= 100) {
          reasons.push(`GitHub API 100% (waiting for reset)`);
          this.recordThrottle('github_100');
        } else if (usedPercent >= QUEUE_CONFIG.GITHUB_API_THRESHOLD_PERCENT) {
          reasons.push(`GitHub API ${usedPercent}% >= ${QUEUE_CONFIG.GITHUB_API_THRESHOLD_PERCENT}%`);
          this.recordThrottle('github_high');
        }
      }
    }

    return {
      ok: reasons.length === 0,
      reasons,
      oneAtATime,
    };
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
   * Consumer loop - processes items from the queue
   */
  async runConsumer() {
    this.log('Consumer started');

    while (this.isRunning) {
      // Check if there's work to do
      if (this.queue.length === 0) {
        // No work, wait and check again
        await this.sleep(QUEUE_CONFIG.CONSUMER_POLL_INTERVAL_MS);
        continue;
      }

      // Check if we can start a command
      const check = await this.canStartCommand();

      if (!check.canStart) {
        // Can't start now, wait and retry
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
        // Put item back in front of queue
        this.queue.unshift(item);
        this.log(`Claude tool item queued but claude running, waiting...`);
        await this.sleep(QUEUE_CONFIG.CONSUMER_POLL_INTERVAL_MS);
        continue;
      }

      // Start processing
      item.markProcessing();
      this.processing.set(item.id, item);
      this.lastStartTime = Date.now();
      this.stats.totalStarted++;

      this.log(`Starting: ${item.toString()}`);

      // Execute in background (don't await)
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
        item.markCompleted(result);
        this.stats.totalCompleted++;
      } else {
        // No callback, just mark as completed
        item.markCompleted({ message: 'No execute callback configured' });
        this.stats.totalCompleted++;
      }
    } catch (error) {
      item.markFailed(error);
      this.stats.totalFailed++;
      console.error(`[solve-queue] Item failed: ${item.id}`, error);
    } finally {
      // Move from processing to completed/failed
      this.processing.delete(item.id);

      if (item.status === 'completed') {
        this.completed.push(item);
      } else if (item.status === 'failed') {
        this.failed.push(item);
      }

      this.log(`Finished: ${item.toString()}`);

      // Limit history size
      while (this.completed.length > 100) {
        this.completed.shift();
      }
      while (this.failed.length > 100) {
        this.failed.shift();
      }
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
   * Clear the limit cache (useful after limit reset)
   */
  clearCache() {
    this.limitCache.clear();
    this.log('Limit cache cleared');
  }

  /**
   * Format queue status for display (e.g., in /limits command)
   * @returns {string}
   */
  formatStatus() {
    const stats = this.getStats();
    let status = '';

    if (stats.queued > 0 || stats.processing > 0) {
      status += `Solve Queue: ${stats.queued} pending, ${stats.processing} processing\n`;
    } else {
      status += 'Solve Queue: empty\n';
    }

    return status;
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
        message += `• ${item.url} (waiting ${waitSeconds}s)\n`;
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
 * Created when module is first imported
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

export default {
  SolveQueue,
  SolveQueueItem,
  getSolveQueue,
  resetSolveQueue,
  getRunningClaudeProcesses,
  QUEUE_CONFIG,
};
