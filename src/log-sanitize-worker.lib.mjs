#!/usr/bin/env node

/**
 * Bounded-heap execution of the streaming log sanitizer (issue #2189).
 *
 * {@link sanitizeLogFileToFile} is already memory-bounded by construction: it
 * holds one block at a time and caps its hold-back. This module is the second
 * line of defence issue #2189 asks for —
 *
 * > A worker with a bounded heap for the sanitize step would also contain any
 * > residual blow-up instead of taking the whole run down.
 *
 * Node's `worker_threads` gives each worker its own V8 isolate with its own
 * `resourceLimits`. Exceeding them terminates the worker with
 * `ERR_WORKER_OUT_OF_MEMORY` and leaves the parent running, verified in
 * `experiments/issue-2189-bounded-sanitize-worker.mjs`. So even if a future
 * pattern, a pathological log, or a dependency upgrade reintroduces an
 * unbounded allocation inside the sanitizer, the blast radius is one thread and
 * one failed log upload — not the working session that already did its job.
 *
 * The worker is only worth its start-up cost on logs big enough to matter, so
 * small logs run in-process ({@link DEFAULT_WORKER_THRESHOLD_BYTES}). If the
 * worker cannot even start (no `worker_threads`, a module resolution failure,
 * a restricted runtime) the sanitize falls back in-process, which is exactly
 * the behaviour before this module existed. Once the worker has reported
 * `ready`, failures are propagated instead: falling back in-process after the
 * worker hit its heap limit would run the same blow-up in the parent.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import fsPromises from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { sanitizeLogFileToFile } from './log-sanitize-stream.lib.mjs';

/** Old-generation cap for the sanitize worker, in MiB. */
export const DEFAULT_WORKER_HEAP_MB = 512;

/** Logs at or above this size are sanitized in a bounded worker. */
export const DEFAULT_WORKER_THRESHOLD_BYTES = 16 * 1024 * 1024;

/** Environment variable that forces the worker off (`0`/`false`/`off`). */
export const WORKER_DISABLE_ENV = 'HIVE_MIND_SANITIZE_WORKER';

const WORKER_ENTRY_URL = new URL('./log-sanitize-worker-entry.mjs', import.meta.url);

/** Options whose values cannot be structured-cloned into a worker. */
const NON_CLONABLE_OPTIONS = ['sanitize', 'transform', 'onProgress', 'fsImpl'];

/**
 * Whether the bounded worker should be used for a source of this size.
 *
 * @param {number} sourceSize - Bytes to sanitize
 * @param {object} [options]
 * @param {number} [options.thresholdBytes=DEFAULT_WORKER_THRESHOLD_BYTES]
 * @param {object} [options.env=process.env]
 * @returns {boolean}
 */
export function shouldUseSanitizeWorker(sourceSize, options = {}) {
  const { thresholdBytes = DEFAULT_WORKER_THRESHOLD_BYTES, env = process.env } = options;
  const disabled = String(env?.[WORKER_DISABLE_ENV] ?? '')
    .trim()
    .toLowerCase();
  if (disabled === '0' || disabled === 'false' || disabled === 'off' || disabled === 'no') return false;
  if (!Number.isFinite(sourceSize)) return false;
  return sourceSize >= thresholdBytes;
}

/**
 * Run {@link sanitizeLogFileToFile} inside a worker with a bounded old generation.
 *
 * @param {object} options - Forwarded to {@link sanitizeLogFileToFile}
 * @param {number} [options.workerHeapMb=DEFAULT_WORKER_HEAP_MB]
 * @param {Function} [options.workerFactory] - `(url, opts) => Worker`, for tests
 * @returns {Promise<object>} Sanitize stats, plus `{worker: true}`
 */
export async function sanitizeLogFileInWorker(options = {}) {
  const { workerHeapMb = DEFAULT_WORKER_HEAP_MB, workerFactory = null, ...sanitizeOptions } = options;
  const createWorker = workerFactory || (await defaultWorkerFactory());

  return await new Promise((resolve, reject) => {
    let ready = false;
    let settled = false;
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };

    let worker;
    try {
      worker = createWorker(WORKER_ENTRY_URL, {
        workerData: sanitizeOptions,
        resourceLimits: { maxOldGenerationSizeMb: workerHeapMb },
      });
    } catch (error) {
      error.sanitizeWorkerStarted = false;
      settle(reject, error);
      return;
    }

    worker.on('message', message => {
      if (message?.type === 'ready') {
        ready = true;
        return;
      }
      if (message?.type === 'done') {
        settle(resolve, { ...message.stats, worker: true });
        worker.terminate().catch(() => {});
        return;
      }
      if (message?.type === 'error') {
        const error = new Error(message.message);
        error.name = message.name || 'Error';
        if (message.code) error.code = message.code;
        error.sanitizeWorkerStarted = true;
        settle(reject, error);
        worker.terminate().catch(() => {});
      }
    });
    worker.on('error', error => {
      error.sanitizeWorkerStarted = ready;
      settle(reject, error);
    });
    worker.on('exit', code => {
      const error = new Error(`log sanitize worker exited with code ${code} before reporting a result`);
      error.sanitizeWorkerStarted = ready;
      settle(reject, error);
    });
  });
}

/**
 * Sanitize a log file to another file, in a bounded worker when it is large.
 *
 * Drop-in replacement for {@link sanitizeLogFileToFile}: same options, same
 * stats, same fail-closed guarantee about the destination.
 *
 * @param {object} options - {@link sanitizeLogFileToFile} options
 * @param {number} [options.thresholdBytes=DEFAULT_WORKER_THRESHOLD_BYTES]
 * @param {number} [options.workerHeapMb=DEFAULT_WORKER_HEAP_MB]
 * @param {Function} [options.onWorkerFallback] - `({reason, error}) => void`
 * @returns {Promise<object>} Sanitize stats; `worker` is true when the worker ran
 */
export async function sanitizeLogFileToFileBounded(options = {}) {
  const { thresholdBytes = DEFAULT_WORKER_THRESHOLD_BYTES, workerHeapMb = DEFAULT_WORKER_HEAP_MB, workerFactory = null, onWorkerFallback = null, env = process.env, fsImpl = fsPromises, ...sanitizeOptions } = options;

  let sourceSize = null;
  try {
    sourceSize = (await fsImpl.stat(sanitizeOptions.sourcePath)).size;
  } catch {
    // An unknown size routes in-process, which is the conservative choice.
  }

  // `workerData` crosses the thread boundary by structured clone, which cannot
  // carry functions. A caller that customises the sanitize, the transform or the
  // progress hook keeps the in-process path (still streaming, still bounded).
  const clonable = NON_CLONABLE_OPTIONS.every(name => typeof sanitizeOptions[name] !== 'function');

  if (!clonable || !shouldUseSanitizeWorker(sourceSize, { thresholdBytes, env })) {
    return { ...(await sanitizeLogFileToFile({ ...sanitizeOptions, fsImpl })), worker: false };
  }

  try {
    return await sanitizeLogFileInWorker({ ...sanitizeOptions, workerHeapMb, workerFactory });
  } catch (error) {
    if (error?.sanitizeWorkerStarted) throw error;
    // The worker never got as far as loading the sanitizer, so nothing about
    // memory has been learned; run in-process exactly as before.
    if (onWorkerFallback) onWorkerFallback({ reason: 'worker-unavailable', error });
    await fsImpl.unlink(sanitizeOptions.destPath).catch(() => {});
    return { ...(await sanitizeLogFileToFile({ ...sanitizeOptions, fsImpl })), worker: false };
  }
}

/**
 * Resolve the real `worker_threads` Worker constructor, lazily.
 *
 * @returns {Promise<Function>} `(url, options) => Worker`
 */
async function defaultWorkerFactory() {
  const { Worker } = await import('node:worker_threads');
  return (url, workerOptions) => new Worker(fileURLToPath(url), workerOptions);
}

export { WORKER_ENTRY_URL };
