#!/usr/bin/env node

import { fileURLToPath } from 'url';

/**
 * Add a timeout to an async operation.
 * @template T
 * @param {Promise<T>} promise - Promise to guard
 * @param {number} timeoutMs - Timeout in milliseconds
 * @param {string} operation - Human-readable operation label
 * @returns {Promise<T>}
 */
export function withTimeout(promise, timeoutMs, operation) {
  let timeoutId;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error(`Operation '${operation}' timed out after ${timeoutMs}ms. This might be due to slow network or npm configuration issues.`)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timeoutId));
}

/**
 * Check whether hive.mjs is being run directly rather than imported.
 *
 * @param {string | undefined} argvPath - Executed path from process.argv[1]
 * @param {string} moduleUrl - Current module URL from import.meta.url
 * @returns {boolean}
 */
export function isDirectExecution(argvPath, moduleUrl) {
  return argvPath === fileURLToPath(moduleUrl) || (argvPath && (argvPath.includes('/hive') || argvPath.endsWith('hive')));
}
