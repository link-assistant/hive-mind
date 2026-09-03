#!/usr/bin/env node

/**
 * Regression: the sanitize step runs with a bounded heap of its own (#2189).
 *
 * The incident log-publication step exhausted the *process* heap, so the whole
 * working session died after the AI tool had already pushed its work. Issue
 * #2189 asks for a second line of defence on top of the streaming sanitizer:
 *
 * > A worker with a bounded heap for the sanitize step would also contain any
 * > residual blow-up instead of taking the whole run down.
 *
 * `sanitizeLogFileToFileBounded` is that defence. This file locks in:
 *   1. routing — small logs in-process, large logs in a heap-capped worker, and
 *      an environment switch to force the worker off;
 *   2. equivalence — the worker writes byte-identical output to the in-process
 *      path (the sanitize guarantee must not depend on where it runs);
 *   3. failure semantics — a worker that never started falls back in-process,
 *      a worker that started and then failed propagates (falling back would
 *      re-run the blow-up in the parent);
 *   4. containment — a real worker that exceeds its cap is terminated with
 *      `ERR_WORKER_OUT_OF_MEMORY` while this process keeps running.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2189
 */

import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';
import { sanitizeLogFileToFile } from '../src/log-sanitize-stream.lib.mjs';
import { DEFAULT_WORKER_HEAP_MB, DEFAULT_WORKER_THRESHOLD_BYTES, WORKER_DISABLE_ENV, sanitizeLogFileInWorker, sanitizeLogFileToFileBounded, shouldUseSanitizeWorker } from '../src/log-sanitize-worker.lib.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, '..');

const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'hive-2189-worker-'));
const tmp = name => path.join(workDir, name);

console.log('================================================================================');
console.log('Regression: bounded-heap worker for the log sanitize step (#2189)');
console.log('================================================================================\n');

/**
 * Write a log whose content the sanitizer has to actually rewrite.
 *
 * @param {string} filePath - Destination
 * @param {number} lines - Number of transcript lines
 * @returns {Promise<string>} The path written
 */
const writeLog = async (filePath, lines) => {
  const handle = await fs.open(filePath, 'w');
  for (let i = 0; i < lines; i++) {
    await handle.write(`[VERBOSE] line ${i} token ghp_${String(i).padStart(36, 'a')} tail\n`, null, 'utf8');
  }
  await handle.close();
  return filePath;
};

// ---------------------------------------------------------------------------
// 1. Routing
// ---------------------------------------------------------------------------
console.log('1. Worker routing\n');

assert(DEFAULT_WORKER_THRESHOLD_BYTES === 16 * 1024 * 1024, `the worker threshold stays at 16 MiB (${DEFAULT_WORKER_THRESHOLD_BYTES})`);
assert(DEFAULT_WORKER_HEAP_MB === 512, `the worker heap cap stays at 512 MiB (${DEFAULT_WORKER_HEAP_MB})`);
assert(DEFAULT_WORKER_HEAP_MB > 64, 'the cap stays far above the sanitizer largest single allocation (1 MiB block, 8 MiB hold)');

assert(shouldUseSanitizeWorker(DEFAULT_WORKER_THRESHOLD_BYTES, { env: {} }) === true, 'a log at the threshold uses the worker');
assert(shouldUseSanitizeWorker(DEFAULT_WORKER_THRESHOLD_BYTES - 1, { env: {} }) === false, 'a log below the threshold stays in-process');
assert(shouldUseSanitizeWorker(null, { env: {} }) === false, 'an unknown size stays in-process');
assert(shouldUseSanitizeWorker(1e9, { env: { [WORKER_DISABLE_ENV]: '0' } }) === false, `${WORKER_DISABLE_ENV}=0 forces the worker off`);
assert(shouldUseSanitizeWorker(1e9, { env: { [WORKER_DISABLE_ENV]: 'off' } }) === false, `${WORKER_DISABLE_ENV}=off forces the worker off`);
assert(shouldUseSanitizeWorker(1e9, { env: { [WORKER_DISABLE_ENV]: '1' } }) === true, `${WORKER_DISABLE_ENV}=1 leaves the worker on`);

const smallSource = await writeLog(tmp('small.log'), 200);
const smallStats = await sanitizeLogFileToFileBounded({ sourcePath: smallSource, destPath: tmp('small.sanitized.log') });
assert(smallStats.worker === false, 'a small log is sanitized in-process');
const smallOut = await fs.readFile(tmp('small.sanitized.log'), 'utf8');
assert(!smallOut.includes('ghp_'), 'the in-process route still masks credentials');

// A caller that customises the sanitize/transform/progress hooks passes
// functions, which structured clone cannot carry — those stay in-process.
const customStats = await sanitizeLogFileToFileBounded({
  sourcePath: smallSource,
  destPath: tmp('custom.sanitized.log'),
  thresholdBytes: 1,
  transform: text => text.toUpperCase(),
});
assert(customStats.worker === false, 'function-valued options keep the in-process route even above the threshold');
assert((await fs.readFile(tmp('custom.sanitized.log'), 'utf8')).includes('[VERBOSE] LINE 0'), 'the custom transform still ran');

// ---------------------------------------------------------------------------
// 2. Equivalence: the worker writes exactly what the in-process pass writes
// ---------------------------------------------------------------------------
console.log('\n2. Worker output equivalence\n');

const source = await writeLog(tmp('session.log'), 20000);
const workerStats = await sanitizeLogFileToFileBounded({ sourcePath: source, destPath: tmp('worker.sanitized.log'), thresholdBytes: 1024 });
assert(workerStats.worker === true, 'a log above the threshold is sanitized in a worker');
await sanitizeLogFileToFile({ sourcePath: source, destPath: tmp('inprocess.sanitized.log') });
const [workerOut, inProcessOut] = await Promise.all([fs.readFile(tmp('worker.sanitized.log')), fs.readFile(tmp('inprocess.sanitized.log'))]);
assert(workerOut.equals(inProcessOut), `worker output is byte-identical to in-process output (${workerOut.length} vs ${inProcessOut.length} bytes)`);
assert(!workerOut.toString('utf8').includes('ghp_'), 'the worker route masks credentials too');
assert(workerStats.sourceSize === (await fs.stat(source)).size, 'the worker reports the full source size back to the parent');
assert(workerStats.blocks > 1, `the worker still streams block by block (${workerStats.blocks} blocks)`);

// ---------------------------------------------------------------------------
// 3. Failure semantics
// ---------------------------------------------------------------------------
console.log('\n3. Failure semantics\n');

const fallbacks = [];
const unstartableFactory = () => {
  const error = new Error('Cannot find module worker_threads');
  error.code = 'ERR_MODULE_NOT_FOUND';
  throw error;
};
const fallbackStats = await sanitizeLogFileToFileBounded({
  sourcePath: source,
  destPath: tmp('fallback.sanitized.log'),
  thresholdBytes: 1024,
  workerFactory: unstartableFactory,
  onWorkerFallback: entry => fallbacks.push(entry),
});
assert(fallbackStats.worker === false, 'a worker that cannot start falls back in-process');
assert(fallbacks.length === 1 && fallbacks[0].reason === 'worker-unavailable', 'the fallback is reported to the caller');
assert((await fs.readFile(tmp('fallback.sanitized.log'))).equals(inProcessOut), 'the fallback still produces the sanitized artifact');

// A worker that reached `ready` and then died has told us something real about
// memory. Re-running it here would reproduce the blow-up in this process, so the
// error propagates instead.
let oomTimer = null;
const startedThenFailed = () => {
  const listeners = new Map();
  const emit = (event, value) => setImmediate(() => listeners.get(event)?.forEach(fn => fn(value)));
  const stub = {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
      return stub;
    },
    terminate: async () => 0,
  };
  emit('message', { type: 'ready' });
  const oom = new Error('Worker terminated due to reaching memory limit: JS heap out of memory');
  oom.code = 'ERR_WORKER_OUT_OF_MEMORY';
  oomTimer = setTimeout(() => emit('error', oom), 5);
  return stub;
};
let propagated = null;
const retries = [];
try {
  await sanitizeLogFileToFileBounded({
    sourcePath: source,
    destPath: tmp('propagated.sanitized.log'),
    thresholdBytes: 1024,
    workerFactory: startedThenFailed,
    onWorkerFallback: entry => retries.push(entry),
  });
} catch (error) {
  propagated = error;
} finally {
  clearTimeout(oomTimer);
}
assert(propagated?.code === 'ERR_WORKER_OUT_OF_MEMORY', `a worker that started and then blew its heap propagates (${propagated?.code})`);
assert(propagated?.sanitizeWorkerStarted === true, 'the propagated error records that the worker had started');
assert(retries.length === 0, 'no in-process retry is attempted after a heap failure inside the worker');
assert(
  await fs
    .access(tmp('propagated.sanitized.log'))
    .then(() => false)
    .catch(() => true),
  'no partial sanitized artifact is left behind'
);

// A worker that exits silently is also a failure, not a success.
const silentExit = () => {
  const listeners = new Map();
  const stub = {
    on(event, fn) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(fn);
      return stub;
    },
    terminate: async () => 0,
  };
  setImmediate(() => listeners.get('exit')?.forEach(fn => fn(1)));
  return stub;
};
let silentError = null;
try {
  await sanitizeLogFileInWorker({ sourcePath: source, destPath: tmp('silent.sanitized.log'), workerFactory: silentExit });
} catch (error) {
  silentError = error;
}
assert(/exited with code 1 before reporting a result/.test(silentError?.message || ''), `a silent worker exit rejects (${silentError?.message})`);
assert(silentError?.sanitizeWorkerStarted === false, 'a worker that never reported ready is marked as not started, so callers may fall back');

// ---------------------------------------------------------------------------
// 4. Containment: a real worker over its cap does not take this process down
// ---------------------------------------------------------------------------
console.log('\n4. Real containment\n');

// No record boundary anywhere plus a hold cap far above the worker heap: the
// sanitizer is driven to accumulate until it cannot. Gradual growth is what
// `resourceLimits` contains; the block size (1 MiB here, as in production) stays
// well under the cap, because a single allocation larger than the cap would
// reach V8's fatal handler and abort the whole process.
const pathological = tmp('one-line.log');
const unit = '[VERBOSE] ordinary transcript text with words and numbers 12345 ';
const filler = unit.repeat(Math.ceil((4 * 1024 * 1024) / unit.length));
const handle = await fs.open(pathological, 'w');
for (let i = 0; i < 30; i++) await handle.write(filler, null, 'utf8');
await handle.close();

let contained = null;
try {
  await sanitizeLogFileInWorker({
    sourcePath: pathological,
    destPath: tmp('contained.sanitized.log'),
    chunkBytes: 1024 * 1024,
    maxHoldBytes: 1024 * 1024 * 1024,
    workerHeapMb: 48,
  });
} catch (error) {
  contained = error;
}
assert(contained !== null, 'the pathological sanitize failed instead of consuming unbounded memory');
assert(contained?.code === 'ERR_WORKER_OUT_OF_MEMORY', `the failure is the worker heap cap, not the process heap (${contained?.code}: ${contained?.message})`);
assert(contained?.sanitizeWorkerStarted === true, 'the worker had started, so the caller must not retry in-process');
assert(process.exitCode === undefined || process.exitCode === 0, 'this process survived the contained blow-up');

// ---------------------------------------------------------------------------
// 5. Source guarantees: the publication paths use the bounded variant
// ---------------------------------------------------------------------------
console.log('\n5. Callers use the bounded sanitize\n');

for (const name of ['log-upload.lib.mjs', 'telegram-log-command.lib.mjs', 'github-error-reporter.lib.mjs', 'development-log.lib.mjs']) {
  const src = await fs.readFile(path.join(repoRoot, 'src', name), 'utf8');
  assert(src.includes('sanitizeLogFileToFileBounded('), `${name} sanitizes through the bounded worker path`);
  assert(!/[^d]\bsanitizeLogFileToFile\(/.test(src), `${name} has no unbounded-heap sanitize call left`);
}

const ruleSrc = await fs.readFile(path.join(repoRoot, 'eslint-rules', 'require-sanitized-output.mjs'), 'utf8');
assert(ruleSrc.includes("'sanitizeLogFileToFileBounded'"), 'the require-sanitized-output rule knows the bounded sanitizer marks its destPath sanitized');

await fs.rm(workDir, { recursive: true, force: true });

printSummary('Issue #2189 — bounded-heap sanitize worker');
process.exit(getFailCount() > 0 ? 1 : 0);
