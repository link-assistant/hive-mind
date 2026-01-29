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
 */
export class OrchestratorQueue {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.executeCallback = options.executeCallback || null;
    this.solveCommand = options.solveCommand || 'solve';

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

    this.log('OrchestratorQueue initialized');
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
   * Add a solve task to the queue
   * @param {Object} options - Queue item options
   * @returns {OrchestratorQueueItem} The queued item
   */
  enqueue(options) {
    const item = new OrchestratorQueueItem(options);
    this.queue.push(item);
    this.stats.totalEnqueued++;

    this.log(`Enqueued: ${item.toString()}, queue length: ${this.queue.length}`);

    // Start consumer if not already running
    this.ensureConsumerRunning();

    return item;
  }

  /**
   * Find an item by URL in the queue or processing items
   * @param {string} url - The URL to search for
   * @returns {OrchestratorQueueItem|null}
   */
  findByUrl(url) {
    const queuedItem = this.queue.find(item => item.url === url);
    if (queuedItem) return queuedItem;

    for (const item of this.processing.values()) {
      if (item.url === url) return item;
    }

    return null;
  }

  /**
   * Find an item by ID
   * @param {string} id - The item ID
   * @returns {OrchestratorQueueItem|null}
   */
  findById(id) {
    const queuedItem = this.queue.find(item => item.id === id);
    if (queuedItem) return queuedItem;

    if (this.processing.has(id)) return this.processing.get(id);

    const completedItem = this.completed.find(item => item.id === id);
    if (completedItem) return completedItem;

    const failedItem = this.failed.find(item => item.id === id);
    if (failedItem) return failedItem;

    return null;
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
      pending: this.queue.map(item => item.toJSON()),
      processing: Array.from(this.processing.values()).map(item => item.toJSON()),
      recentCompleted: this.completed.slice(-10).map(item => item.toJSON()),
      recentFailed: this.failed.slice(-10).map(item => item.toJSON()),
    };
  }

  /**
   * Check if a new command can start
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

    // Check running claude processes
    const claudeProcs = await getRunningClaudeProcesses(this.verbose);
    const hasRunningClaude = claudeProcs.count > 0;

    const totalProcessing = this.processing.size + claudeProcs.count;

    if (hasRunningClaude) {
      this.recordThrottle('claude_running');
    }

    // Check system resources
    const resourceCheck = await this.checkSystemResources(totalProcessing);
    if (!resourceCheck.ok) {
      reasons.push(...resourceCheck.reasons);
    }
    if (resourceCheck.oneAtATime) {
      oneAtATime = true;
    }

    // Check API limits
    const limitCheck = await this.checkApiLimits(hasRunningClaude, totalProcessing);
    if (!limitCheck.ok) {
      reasons.push(...limitCheck.reasons);
    }
    if (limitCheck.oneAtATime) {
      oneAtATime = true;
    }

    // Add claude_running info if there are other reasons
    if (hasRunningClaude && reasons.length > 0) {
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
   * Check API limits (Claude, GitHub)
   * @param {boolean} hasRunningClaude - Whether claude processes are running
   * @param {number} totalProcessing - Total processing count
   * @returns {Promise<{ok: boolean, reasons: string[], oneAtATime: boolean}>}
   */
  async checkApiLimits(hasRunningClaude = false, totalProcessing = 0) {
    const reasons = [];
    let oneAtATime = false;

    // Check Claude limits
    const claudeResult = await getCachedClaudeLimits(this.verbose);
    if (claudeResult.success) {
      const sessionPercent = claudeResult.usage.currentSession.percentage;
      const weeklyPercent = claudeResult.usage.allModels.percentage;

      if (sessionPercent !== null) {
        const sessionRatio = sessionPercent / 100;
        if (sessionRatio >= QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD) {
          oneAtATime = true;
          this.recordThrottle(sessionRatio >= 1.0 ? 'claude_5_hour_session_100' : 'claude_5_hour_session_high');
          if (totalProcessing > 0) {
            reasons.push(formatWaitingReason('claude_5_hour_session', sessionPercent, QUEUE_CONFIG.CLAUDE_5_HOUR_SESSION_THRESHOLD) + ' (waiting for current command)');
          }
        }
      }

      if (weeklyPercent !== null) {
        const weeklyRatio = weeklyPercent / 100;
        if (weeklyRatio >= QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD) {
          oneAtATime = true;
          this.recordThrottle(weeklyRatio >= 1.0 ? 'claude_weekly_100' : 'claude_weekly_high');
          if (totalProcessing > 0) {
            reasons.push(formatWaitingReason('claude_weekly', weeklyPercent, QUEUE_CONFIG.CLAUDE_WEEKLY_THRESHOLD) + ' (waiting for current command)');
          }
        }
      }
    }

    // Check GitHub limits
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
        for (const item of this.queue) {
          if (item.status === QueueItemStatus.QUEUED || item.status === QueueItemStatus.WAITING) {
            item.setWaiting(check.reason);
          }
        }

        this.log(`Throttled: ${check.reason}`);
        await this.sleep(QUEUE_CONFIG.CONSUMER_POLL_INTERVAL_MS);
        continue;
      }

      // Check one-at-a-time mode
      if (check.oneAtATime && check.totalProcessing > 0) {
        this.log(`One-at-a-time mode: waiting for current command to finish`);
        await this.sleep(QUEUE_CONFIG.CONSUMER_POLL_INTERVAL_MS);
        continue;
      }

      // Get next item from queue
      const item = this.queue.shift();
      if (!item) continue;

      // Update status to Starting
      item.setStarting();
      this.processing.set(item.id, item);
      this.lastStartTime = Date.now();
      this.stats.totalStarted++;

      this.log(`Starting: ${item.toString()}`);

      // Execute in background
      this.executeItem(item).catch(error => {
        console.error(`[orchestrator-queue] Execution error for ${item.id}:`, error);
      });
    }

    this.log('Consumer stopped');
    this.consumerTask = null;
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
