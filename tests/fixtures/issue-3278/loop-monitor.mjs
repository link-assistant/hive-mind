// @hive-mind-test-skip
/**
 * Preload for tests/telegram-event-loop-watchdog-3278.test.mjs (issue #3278).
 *
 * Measures how long the bot's event loop is blocked. A 10 ms timer that fires
 * late by `blockedMs` means nothing else could run in the meantime. Once the
 * loop runs again, each stall is reported over IPC as
 * `{ type: 'stall', blockedMs, runQueueMs, histogramMaxMs }`, so the parent can
 * relate it to the update batches the harness reports. `histogramMaxMs` is the
 * maximum delay seen by `monitorEventLoopDelay` since the previous report, as a
 * cross-check.
 *
 * `runQueueMs` is how much of the stall the main thread spent runnable but not
 * running, from the second field of Linux's /proc/self/schedstat. On a loaded
 * host (the parallel default suite on a CI runner) a timer fires late because
 * the scheduler gave the CPU to other processes, not because the bot blocked.
 * A synchronous wait for a child process is a sleep, not run-queue time, so it
 * still counts in full. Without /proc/self/schedstat it is 0.
 */

import { readFileSync } from 'node:fs';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const INTERVAL_MS = 10;
const REPORT_OVER_MS = 25;

const histogram = monitorEventLoopDelay({ resolution: INTERVAL_MS });
histogram.enable();

const runQueueNs = () => {
  try {
    return Number(readFileSync('/proc/self/schedstat', 'utf8').split(' ')[1]) || 0;
  } catch {
    return 0;
  }
};

let last = performance.now();
let lastRunQueueNs = runQueueNs();
const timer = setInterval(() => {
  const now = performance.now();
  const queued = runQueueNs();
  const blockedMs = Math.round(now - last - INTERVAL_MS);
  const runQueueMs = Math.round((queued - lastRunQueueNs) / 1e6);
  last = now;
  lastRunQueueNs = queued;
  if (blockedMs < REPORT_OVER_MS || typeof process.send !== 'function') return;
  try {
    process.send({ type: 'stall', blockedMs, runQueueMs, histogramMaxMs: Math.round(histogram.max / 1e6) });
  } catch {
    // The parent went away; nothing to report to.
  }
  histogram.reset();
}, INTERVAL_MS);
timer.unref();
