// @hive-mind-test-skip
/**
 * Preload for tests/telegram-event-loop-watchdog-3278.test.mjs (issue #3278).
 *
 * Measures how long the bot's event loop is blocked. A 10 ms timer that fires
 * late by `blockedMs` means nothing else could run in the meantime. Once the
 * loop runs again, each stall is reported over IPC as
 * `{ type: 'stall', blockedMs, histogramMaxMs }`, so the parent can relate it to
 * the update batches the harness reports. `histogramMaxMs` is the maximum
 * delay seen by `monitorEventLoopDelay` since the previous report, as a
 * cross-check.
 */

import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const INTERVAL_MS = 10;
const REPORT_OVER_MS = 25;

const histogram = monitorEventLoopDelay({ resolution: INTERVAL_MS });
histogram.enable();

let last = performance.now();
const timer = setInterval(() => {
  const now = performance.now();
  const blockedMs = Math.round(now - last - INTERVAL_MS);
  last = now;
  if (blockedMs < REPORT_OVER_MS || typeof process.send !== 'function') return;
  try {
    process.send({ type: 'stall', blockedMs, histogramMaxMs: Math.round(histogram.max / 1e6) });
  } catch {
    // The parent went away; nothing to report to.
  }
  histogram.reset();
}, INTERVAL_MS);
timer.unref();
