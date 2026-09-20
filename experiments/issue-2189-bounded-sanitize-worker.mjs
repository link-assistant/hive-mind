#!/usr/bin/env node
/**
 * Issue #2189 — show that the sanitize step, run in a worker with a bounded old
 * generation, contains a blow-up instead of taking the whole process down.
 *
 * Part 1 sanitizes a real log through `sanitizeLogFileToFileBounded` and shows
 * the worker ran and produced the same output the in-process path produces.
 * Part 2 asks the worker to hold an unreasonable amount of text (a hold cap far
 * above its heap cap, on a file with no record boundaries) and shows that the
 * worker — and only the worker — dies.
 *
 * Usage: node experiments/issue-2189-bounded-sanitize-worker.mjs [sizeMB]
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sanitizeLogFileToFile } from '../src/log-sanitize-stream.lib.mjs';
import { sanitizeLogFileInWorker, sanitizeLogFileToFileBounded } from '../src/log-sanitize-worker.lib.mjs';

const sizeMb = Number(process.argv[2] || 24);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2189-worker-'));
const source = path.join(dir, 'session.log');

const handle = await fs.open(source, 'w');
let written = 0;
let n = 0;
while (written < sizeMb * 1024 * 1024) {
  const lines = [];
  for (let i = 0; i < 2000; i++) {
    n += 1;
    lines.push(`2026-09-03T10:00:00Z [VERBOSE] line ${n} ordinary transcript text ${'x'.repeat(40)}`);
    if (n % 500 === 0) lines.push(`sha=${n.toString(16).padStart(40, 'a')}`);
  }
  const block = lines.join('\n') + '\n';
  await handle.write(block, null, 'utf8');
  written += Buffer.byteLength(block);
}
await handle.close();
const stat = await fs.stat(source);
console.log(`source: ${source} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);

console.log('\n--- part 1: bounded worker sanitize ---');
const workerDest = path.join(dir, 'worker.log');
const workerStats = await sanitizeLogFileToFileBounded({ sourcePath: source, destPath: workerDest, thresholdBytes: 1024 });
console.log('stats:', workerStats);

const inlineDest = path.join(dir, 'inline.log');
await sanitizeLogFileToFile({ sourcePath: source, destPath: inlineDest });
const [a, b] = await Promise.all([fs.readFile(workerDest, 'utf8'), fs.readFile(inlineDest, 'utf8')]);
console.log('worker output identical to in-process output:', a === b);

console.log('\n--- part 2: containment ---');
// Reproduce the original bug's shape inside the worker: a log with no record
// boundary at all and a hold cap raised far above the worker's heap, so the
// sanitizer is driven to accumulate gradually until it cannot.
//
// Caveat worth knowing: `resourceLimits` contains *gradual* growth. A single
// allocation larger than the cap (e.g. `chunkBytes` above `workerHeapMb`) still
// reaches V8's fatal handler and aborts the process. That is why the worker cap
// (512 MiB) is two orders of magnitude above the sanitizer's block size (1 MiB)
// and hold cap (8 MiB).
const pathological = path.join(dir, 'one-line.log');
const unit = '[VERBOSE] ordinary transcript text with words and numbers 12345 ';
const filler = unit.repeat(Math.ceil((4 * 1024 * 1024) / unit.length));
const pathologicalHandle = await fs.open(pathological, 'w');
for (let i = 0; i < 30; i++) await pathologicalHandle.write(filler, null, 'utf8');
await pathologicalHandle.close();

const parentRssBefore = process.memoryUsage().rss;
try {
  await sanitizeLogFileInWorker({
    sourcePath: pathological,
    destPath: path.join(dir, 'contained.log'),
    chunkBytes: 1024 * 1024,
    maxHoldBytes: 1024 * 1024 * 1024,
    workerHeapMb: 48,
  });
  console.log('worker completed (no blow-up to contain at this size)');
} catch (error) {
  console.log('worker failed as designed:', error.code || error.name, '-', error.message);
  console.log('worker had started:', error.sanitizeWorkerStarted);
}
console.log(`parent survived: rss ${(parentRssBefore / 1048576).toFixed(0)} MB -> ${(process.memoryUsage().rss / 1048576).toFixed(0)} MB, pid ${process.pid} still running`);

await fs.rm(dir, { recursive: true, force: true });
