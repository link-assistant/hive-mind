/**
 * Per-tool concurrency gate for the solve queue (Issue #1474).
 *
 * The gate decides whether a head-of-tool-queue item is allowed to start
 * given the current set of in-flight items and the configured mode for that
 * tool. Modes are defined in queue-config.lib.mjs (CONCURRENCY_MODES).
 *
 * Kept in a separate file from telegram-solve-queue.lib.mjs to keep the main
 * queue module under the project's 1500-line cap (see
 * scripts/check-file-line-limits.sh and eslint max-lines rule).
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1474
 */

import { QUEUE_CONFIG } from './queue-config.lib.mjs';
import { isFreeAgentModel } from './models/index.mjs';

/**
 * Count processing items with the same (tool, model) pair.
 * @param {Map<string, {tool: string, model?: string|null}>} processing
 * @param {string} tool
 * @param {string|null} model
 * @returns {number}
 */
export function countProcessingByToolAndModel(processing, tool, model) {
  let count = 0;
  const target = model || null;
  for (const item of processing.values()) {
    if (item.tool !== tool) continue;
    const itemModel = item.model || null;
    if (itemModel === target) count++;
  }
  return count;
}

/**
 * Count processing items for a tool, regardless of model.
 * @param {Map<string, {tool: string}>} processing
 * @param {string} tool
 * @returns {number}
 */
export function countProcessingByTool(processing, tool) {
  let count = 0;
  for (const item of processing.values()) {
    if (item.tool === tool) count++;
  }
  return count;
}

/**
 * Decide whether `item` is permitted to start under the configured
 * per-tool concurrency mode. Returns true for unknown modes so a misconfig
 * cannot wedge the queue.
 *
 * @param {Map<string, {tool: string, model?: string|null}>} processing
 * @param {string} tool
 * @param {{tool: string, model?: string|null}} item
 * @returns {boolean}
 */
export function canStartUnderConcurrencyMode(processing, tool, item) {
  const mode = (QUEUE_CONFIG.concurrency && QUEUE_CONFIG.concurrency[tool]) || 'off';
  if (mode === 'off') return true;

  if (mode === 'global-one-at-a-time') {
    return countProcessingByTool(processing, tool) === 0;
  }

  if (mode === 'per-model-one-at-a-time') {
    return countProcessingByToolAndModel(processing, tool, item.model || null) === 0;
  }

  if (mode === 'per-free-model-one-at-a-time') {
    const model = item.model || null;
    if (!model || !isFreeAgentModel(model)) return true;
    return countProcessingByToolAndModel(processing, tool, model) === 0;
  }

  return true;
}
