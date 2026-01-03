#!/usr/bin/env node
/**
 * Telegram Limits Library
 *
 * Centralized caching for all limit-related API calls and system metrics.
 * Used by both /solve queue and /limits command to share cached values.
 *
 * Cache TTLs:
 * - API calls (Claude, GitHub): 3 minutes
 * - System metrics (RAM, CPU, disk): 2 minutes
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1041
 */

import { getClaudeUsageLimits, getCpuLoadInfo, getMemoryInfo, getDiskSpaceInfo, getGitHubRateLimits } from './claude-limits.lib.mjs';

/**
 * Cache TTL constants (in milliseconds)
 */
export const CACHE_TTL = {
  API: 180000, // 3 minutes for API calls (Claude, GitHub)
  SYSTEM: 120000, // 2 minutes for system metrics (RAM, CPU, disk)
};

/**
 * Generic cache class with configurable TTL
 */
class LimitCache {
  constructor(defaultTtlMs = CACHE_TTL.API) {
    this.defaultTtlMs = defaultTtlMs;
    this.cache = new Map();
  }

  /**
   * Get cached value if not expired
   * @param {string} key - Cache key
   * @param {number} [ttlMs] - Optional TTL override
   * @returns {any|null} Cached value or null if expired/missing
   */
  get(key, ttlMs) {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const effectiveTtl = ttlMs ?? entry.ttlMs ?? this.defaultTtlMs;
    if (Date.now() - entry.timestamp > effectiveTtl) {
      this.cache.delete(key);
      return null;
    }

    return entry.value;
  }

  /**
   * Set cached value with optional custom TTL
   * @param {string} key - Cache key
   * @param {any} value - Value to cache
   * @param {number} [ttlMs] - Optional TTL override
   */
  set(key, value, ttlMs) {
    this.cache.set(key, {
      value,
      timestamp: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
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

    for (const [, entry] of this.cache) {
      const effectiveTtl = entry.ttlMs ?? this.defaultTtlMs;
      if (now - entry.timestamp > effectiveTtl) {
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
 * Global limit cache instance (singleton)
 */
let globalCache = null;

/**
 * Get or create the global limit cache instance
 * @returns {LimitCache}
 */
export function getLimitCache() {
  if (!globalCache) {
    globalCache = new LimitCache();
  }
  return globalCache;
}

/**
 * Reset the global cache (useful for testing)
 */
export function resetLimitCache() {
  if (globalCache) {
    globalCache.clear();
    globalCache = null;
  }
}

/**
 * Get Claude usage limits with caching
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Object>} Claude usage limits result
 */
export async function getCachedClaudeLimits(verbose = false) {
  const cache = getLimitCache();
  const cached = cache.get('claude', CACHE_TTL.API);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached Claude limits');
    return cached;
  }

  const result = await getClaudeUsageLimits(verbose);
  if (result.success) {
    cache.set('claude', result, CACHE_TTL.API);
  }
  return result;
}

/**
 * Get GitHub rate limits with caching
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Object>} GitHub rate limits result
 */
export async function getCachedGitHubLimits(verbose = false) {
  const cache = getLimitCache();
  const cached = cache.get('github', CACHE_TTL.API);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached GitHub limits');
    return cached;
  }

  const result = await getGitHubRateLimits(verbose);
  if (result.success) {
    cache.set('github', result, CACHE_TTL.API);
  }
  return result;
}

/**
 * Get memory info with caching
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Object>} Memory info result
 */
export async function getCachedMemoryInfo(verbose = false) {
  const cache = getLimitCache();
  const cached = cache.get('memory', CACHE_TTL.SYSTEM);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached memory info');
    return cached;
  }

  const result = await getMemoryInfo(verbose);
  if (result.success) {
    cache.set('memory', result, CACHE_TTL.SYSTEM);
  }
  return result;
}

/**
 * Get CPU load info with caching
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Object>} CPU load info result
 */
export async function getCachedCpuInfo(verbose = false) {
  const cache = getLimitCache();
  const cached = cache.get('cpu', CACHE_TTL.SYSTEM);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached CPU info');
    return cached;
  }

  const result = await getCpuLoadInfo(verbose);
  if (result.success) {
    cache.set('cpu', result, CACHE_TTL.SYSTEM);
  }
  return result;
}

/**
 * Get disk space info with caching
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Object>} Disk space info result
 */
export async function getCachedDiskInfo(verbose = false) {
  const cache = getLimitCache();
  const cached = cache.get('disk', CACHE_TTL.SYSTEM);
  if (cached) {
    if (verbose) console.log('[VERBOSE] /limits-cache: Using cached disk info');
    return cached;
  }

  const result = await getDiskSpaceInfo(verbose);
  if (result.success) {
    cache.set('disk', result, CACHE_TTL.SYSTEM);
  }
  return result;
}

/**
 * Get all limits (for /limits command)
 * @param {boolean} verbose - Whether to log verbose output
 * @returns {Promise<Object>} All limits
 */
export async function getAllCachedLimits(verbose = false) {
  const [claude, github, memory, cpu, disk] = await Promise.all([getCachedClaudeLimits(verbose), getCachedGitHubLimits(verbose), getCachedMemoryInfo(verbose), getCachedCpuInfo(verbose), getCachedDiskInfo(verbose)]);

  return { claude, github, memory, cpu, disk };
}

export default {
  CACHE_TTL,
  getLimitCache,
  resetLimitCache,
  getCachedClaudeLimits,
  getCachedGitHubLimits,
  getCachedMemoryInfo,
  getCachedCpuInfo,
  getCachedDiskInfo,
  getAllCachedLimits,
};
