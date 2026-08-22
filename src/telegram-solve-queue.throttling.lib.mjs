/**
 * Resource and API-limit throttling checks for the Telegram solve queue.
 *
 * These are the two decision functions the queue consults before starting a
 * command: `checkSystemResources` (RAM, CPU, disk) and `checkApiLimits`
 * (Claude/Codex session + weekly usage, GitHub API). Both return the same
 * shape — the reasons a command must wait, whether the queue must fall back to
 * one-at-a-time, and whether the command must be rejected outright.
 *
 * Extracted from telegram-solve-queue.lib.mjs (issue #2175) so that file stays
 * under the 1350-line early-warning threshold of the CI file-headroom check
 * (long files cause concurrent PR merge conflicts — issue #1593). They take the
 * queue instance explicitly instead of `this`; SolveQueue keeps thin methods
 * that delegate here, so every caller and test is unaffected.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2175
 */

import { getCachedClaudeLimits, getCachedCodexLimits, getCachedGitHubLimits, getCachedMemoryInfo, getCachedCpuInfo, getCachedDiskInfo } from './limits.lib.mjs';
import { formatWaitingReason } from './telegram-solve-queue.helpers.lib.mjs';
import { QUEUE_CONFIG } from './queue-config.lib.mjs';
import { lt } from './limits-i18n.lib.mjs';

/**
 * Normalize the locale argument, which callers pass either as a bare string or
 * inside an options object.
 * @param {string|{locale?: string}} [options]
 * @returns {string|null}
 */
export function getLocale(options = {}) {
  if (typeof options === 'string') return options;
  return options?.locale || null;
}

/**
 * Suffix a waiting reason with the "waiting for the current command" note.
 * @param {string} reason
 * @param {string|null} locale
 * @returns {string}
 */
export function appendWaitingForCurrentCommand(reason, locale) {
  return `${reason} (${lt('queue_waiting_current_command', {}, { locale })})`;
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
 * - DISK: enqueue (waits until disk drops below the threshold)
 *
 * See: https://github.com/link-assistant/hive-mind/issues/1155
 * See: https://github.com/link-assistant/hive-mind/issues/1253
 * See: https://github.com/link-assistant/hive-mind/issues/1981
 *
 * @param {number} totalProcessing - Total processing count (queue + external claude processes)
 * @returns {Promise<{ok: boolean, reasons: string[], oneAtATime: boolean, rejected: boolean, rejectReason: string|null}>}
 */
export async function checkSystemResources(queue, totalProcessing = 0, options = {}) {
  const locale = getLocale(options);
  const reasons = [];
  let oneAtATime = false;
  let rejected = false;
  let rejectReason = null;
  // Check RAM (using cached value)
  const memResult = await getCachedMemoryInfo(queue.verbose);
  if (memResult.success) {
    const usedRatio = memResult.memory.usedPercentage / 100;
    if (usedRatio >= QUEUE_CONFIG.thresholds.ram.value) {
      const reason = formatWaitingReason('ram', memResult.memory.usedPercentage, QUEUE_CONFIG.thresholds.ram.value, { locale });
      const strategy = QUEUE_CONFIG.thresholds.ram.strategy;
      queue.recordThrottle(`ram_${strategy}`);
      if (strategy === 'reject') {
        rejected = true;
        rejectReason = reason;
      } else if (strategy === 'dequeue-one-at-a-time') {
        oneAtATime = true;
        if (totalProcessing > 0) {
          reasons.push(appendWaitingForCurrentCommand(reason, locale));
        }
      } else {
        // 'enqueue' - block unconditionally
        reasons.push(reason);
      }
    }
  }
  // Check CPU using 5-minute load average (more stable than 1-minute)
  const cpuResult = await getCachedCpuInfo(queue.verbose);
  if (cpuResult.success) {
    // Use loadAvg5 (5-minute average) instead of usagePercentage (1-minute based)
    // This provides a more stable metric that isn't affected by transient spikes
    const loadAvg5 = cpuResult.cpuLoad.loadAvg5;
    const cpuCount = cpuResult.cpuLoad.cpuCount;
    // Calculate usage ratio: loadAvg5 / cpuCount
    // Load average of 1.0 per CPU = 100% utilization
    const usageRatio = loadAvg5 / cpuCount;
    const usagePercent = Math.min(100, Math.round(usageRatio * 100));
    if (queue.verbose) {
      queue.log(`CPU 5m load avg: ${loadAvg5.toFixed(2)}, cpus: ${cpuCount}, usage: ${usagePercent}%`);
    }
    if (usageRatio >= QUEUE_CONFIG.thresholds.cpu.value) {
      const reason = formatWaitingReason('cpu', usagePercent, QUEUE_CONFIG.thresholds.cpu.value, { locale });
      const strategy = QUEUE_CONFIG.thresholds.cpu.strategy;
      queue.recordThrottle(`cpu_${strategy}`);
      if (strategy === 'reject') {
        rejected = true;
        rejectReason = reason;
      } else if (strategy === 'dequeue-one-at-a-time') {
        oneAtATime = true;
        if (totalProcessing > 0) {
          reasons.push(appendWaitingForCurrentCommand(reason, locale));
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
  const diskResult = await getCachedDiskInfo(queue.verbose);
  if (diskResult.success) {
    // Calculate usage from free percentage
    const usedPercent = 100 - diskResult.diskSpace.freePercentage;
    const usedRatio = usedPercent / 100;
    if (usedRatio >= QUEUE_CONFIG.thresholds.disk.value) {
      const reason = formatWaitingReason('disk', usedPercent, QUEUE_CONFIG.thresholds.disk.value, { locale });
      const strategy = QUEUE_CONFIG.thresholds.disk.strategy;
      queue.recordThrottle(`disk_${strategy}`);
      if (strategy === 'reject') {
        rejected = true;
        rejectReason = reason;
      } else if (strategy === 'dequeue-one-at-a-time') {
        oneAtATime = true;
        if (totalProcessing > 0) {
          reasons.push(appendWaitingForCurrentCommand(reason, locale));
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
 * - When tool is 'agent', 'gemini', or 'qwen', skip Claude-specific limits entirely since these tools use
 *   different rate limiting backends. Only system resources and GitHub limits apply.
 * - For Claude limits, only count Claude-specific processing items, not agent/codex/gemini/qwen items.
 *   This allows non-Claude tasks to run in parallel even when Claude limits are reached.
 *
 * Logic per issue #1253:
 * - All thresholds now support configurable strategies (reject, enqueue, dequeue-one-at-a-time)
 * - Configuration via HIVE_MIND_QUEUE_CONFIG or individual env vars
 *
 * @param {boolean} hasRunningToolProcess - Whether matching tool processes are running (from pgrep)
 * @param {number} toolProcessingCount - Count of matching tool items being processed in queue
 * @param {string} tool - The tool being used ('claude', 'agent', 'codex', 'gemini', 'qwen', etc.)
 * @returns {Promise<{ok: boolean, reasons: string[], oneAtATime: boolean, rejected: boolean, rejectReason: string|null}>}
 */
export async function checkApiLimits(queue, hasRunningToolProcess = false, toolProcessingCount = 0, tool = 'claude', options = {}) {
  const locale = getLocale(options);
  const reasons = [];
  let oneAtATime = false;
  let rejected = false;
  let rejectReason = null;
  // Apply Claude-specific limits only when tool is 'claude'
  // Other tools (like 'agent', 'gemini', and 'qwen') use different rate limiting backends and are not
  // affected by Claude API limits (5-hour session, weekly limits)
  // See: https://github.com/link-assistant/hive-mind/issues/1159
  const applyClaudeLimits = tool === 'claude';
  const applyCodexLimits = tool === 'codex';
  const totalToolProcessing = toolProcessingCount + (hasRunningToolProcess ? 1 : 0);
  // Check Claude limits (using cached value)
  // Only applied when tool is 'claude'
  if (applyClaudeLimits) {
    const claudeResult = await getCachedClaudeLimits(queue.verbose);
    if (claudeResult.success) {
      const sessionPercent = claudeResult.usage.currentSession.percentage;
      const weeklyPercent = claudeResult.usage.allModels.percentage;
      // Session limit (5-hour)
      // Configurable strategy via HIVE_MIND_QUEUE_CONFIG or HIVE_MIND_CLAUDE_5_HOUR_SESSION_STRATEGY
      // See: https://github.com/link-assistant/hive-mind/issues/1133, #1159, #1253
      if (sessionPercent !== null) {
        const sessionRatio = sessionPercent / 100;
        if (sessionRatio >= QUEUE_CONFIG.thresholds.claude5Hour.value) {
          const reason = formatWaitingReason('claude_5_hour_session', sessionPercent, QUEUE_CONFIG.thresholds.claude5Hour.value, { locale });
          const strategy = QUEUE_CONFIG.thresholds.claude5Hour.strategy;
          queue.recordThrottle(sessionRatio >= 1.0 ? 'claude_5_hour_session_100' : `claude_5_hour_session_${strategy}`);
          if (strategy === 'reject') {
            rejected = true;
            rejectReason = reason;
          } else if (strategy === 'dequeue-one-at-a-time') {
            oneAtATime = true;
            if (totalToolProcessing > 0) {
              reasons.push(appendWaitingForCurrentCommand(reason, locale));
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
          const reason = formatWaitingReason('claude_weekly', weeklyPercent, QUEUE_CONFIG.thresholds.claudeWeekly.value, { locale });
          const strategy = QUEUE_CONFIG.thresholds.claudeWeekly.strategy;
          queue.recordThrottle(weeklyRatio >= 1.0 ? 'claude_weekly_100' : `claude_weekly_${strategy}`);
          if (strategy === 'reject') {
            rejected = true;
            rejectReason = reason;
          } else if (strategy === 'dequeue-one-at-a-time') {
            oneAtATime = true;
            if (totalToolProcessing > 0) {
              reasons.push(appendWaitingForCurrentCommand(reason, locale));
            }
          } else {
            // 'enqueue' - block unconditionally
            reasons.push(reason);
          }
        }
      }
    }
  } else if (applyCodexLimits) {
    const codexResult = await getCachedCodexLimits(queue.verbose);
    if (codexResult.success) {
      const sessionPercent = codexResult.usage.currentSession.percentage;
      const weeklyPercent = codexResult.usage.allModels.percentage;
      if (sessionPercent !== null) {
        const sessionRatio = sessionPercent / 100;
        if (sessionRatio >= QUEUE_CONFIG.thresholds.codex5Hour.value) {
          const reason = formatWaitingReason('codex_5_hour_session', sessionPercent, QUEUE_CONFIG.thresholds.codex5Hour.value, { locale });
          const strategy = QUEUE_CONFIG.thresholds.codex5Hour.strategy;
          queue.recordThrottle(sessionRatio >= 1.0 ? 'codex_5_hour_session_100' : `codex_5_hour_session_${strategy}`);
          if (strategy === 'reject') {
            rejected = true;
            rejectReason = reason;
          } else if (strategy === 'dequeue-one-at-a-time') {
            oneAtATime = true;
            if (totalToolProcessing > 0) {
              reasons.push(appendWaitingForCurrentCommand(reason, locale));
            }
          } else {
            reasons.push(reason);
          }
        }
      }
      if (weeklyPercent !== null) {
        const weeklyRatio = weeklyPercent / 100;
        if (weeklyRatio >= QUEUE_CONFIG.thresholds.codexWeekly.value) {
          const reason = formatWaitingReason('codex_weekly', weeklyPercent, QUEUE_CONFIG.thresholds.codexWeekly.value, { locale });
          const strategy = QUEUE_CONFIG.thresholds.codexWeekly.strategy;
          queue.recordThrottle(weeklyRatio >= 1.0 ? 'codex_weekly_100' : `codex_weekly_${strategy}`);
          if (strategy === 'reject') {
            rejected = true;
            rejectReason = reason;
          } else if (strategy === 'dequeue-one-at-a-time') {
            oneAtATime = true;
            if (totalToolProcessing > 0) {
              reasons.push(appendWaitingForCurrentCommand(reason, locale));
            }
          } else {
            reasons.push(reason);
          }
        }
      }
    }
  } else if (queue.verbose) {
    queue.log(`Claude limits not applied for --tool ${tool}`);
  }
  // Check GitHub limits when the active tool already has a running process.
  // This keeps the queue behavior aligned with the existing one-at-a-time throttling model.
  // Configurable strategy via HIVE_MIND_QUEUE_CONFIG or HIVE_MIND_GITHUB_API_STRATEGY
  if (hasRunningToolProcess) {
    const githubResult = await getCachedGitHubLimits(queue.verbose);
    if (githubResult.success) {
      const usedPercent = githubResult.githubRateLimit.usedPercentage;
      const usedRatio = usedPercent / 100;
      if (usedRatio >= QUEUE_CONFIG.thresholds.githubApi.value) {
        const reason = formatWaitingReason('github', usedPercent, QUEUE_CONFIG.thresholds.githubApi.value, { locale });
        const strategy = QUEUE_CONFIG.thresholds.githubApi.strategy;
        queue.recordThrottle(usedRatio >= 1.0 ? 'github_100' : `github_${strategy}`);
        if (strategy === 'reject') {
          rejected = true;
          rejectReason = reason;
        } else if (strategy === 'dequeue-one-at-a-time') {
          oneAtATime = true;
          if (totalToolProcessing > 0) {
            reasons.push(appendWaitingForCurrentCommand(reason, locale));
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
