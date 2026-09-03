#!/usr/bin/env node

/**
 * Worker entry point for {@link sanitizeLogFileToFileBounded} (issue #2189).
 *
 * Runs the streaming publication sanitizer inside a worker thread whose old
 * generation is capped by `resourceLimits`, so a residual blow-up in any of the
 * sanitizer's regular expressions terminates *this thread* with
 * `ERR_WORKER_OUT_OF_MEMORY` instead of aborting the whole run with
 * `FATAL ERROR: Reached heap limit`.
 *
 * Protocol: post `{type:'ready'}` once the sanitizer module graph is loaded (the
 * parent uses it to tell a start-up failure from a sanitize failure), then
 * `{type:'done', stats}` or `{type:'error', ...}`.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import { parentPort, workerData } from 'node:worker_threads';
import { sanitizeLogFileToFile } from './log-sanitize-stream.lib.mjs';

if (!parentPort) throw new Error('log-sanitize-worker-entry must be started as a worker thread');

parentPort.postMessage({ type: 'ready' });

try {
  const stats = await sanitizeLogFileToFile({ ...(workerData || {}) });
  parentPort.postMessage({ type: 'done', stats });
} catch (error) {
  parentPort.postMessage({ type: 'error', message: error?.message || String(error), name: error?.name || 'Error', code: error?.code || null });
}
