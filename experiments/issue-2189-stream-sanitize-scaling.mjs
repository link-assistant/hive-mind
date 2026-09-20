#!/usr/bin/env node
/**
 * Issue #2189 — measure throughput and peak heap of the streaming sanitizer as
 * the log grows, and (optionally) show that the old whole-file approach is what
 * scales with file size.
 *
 * Usage: node --expose-gc experiments/issue-2189-stream-sanitize-scaling.mjs [sizeMB] [chunkMB]
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sanitizeLogFileToFile } from '../src/log-sanitize-stream.lib.mjs';

const sizeMb = Number(process.argv[2] || 32);
const chunkMb = Number(process.argv[3] || 1);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2189-scale-'));
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

const dest = path.join(dir, 'streamed.log');
if (global.gc) global.gc();
const before = process.memoryUsage();
let peakHeap = before.heapUsed;
let peakRss = before.rss;
const startedAt = Date.now();
const stats = await sanitizeLogFileToFile({
  sourcePath: source,
  destPath: dest,
  chunkBytes: chunkMb * 1024 * 1024,
  onProgress: () => {
    const usage = process.memoryUsage();
    peakHeap = Math.max(peakHeap, usage.heapUsed);
    peakRss = Math.max(peakRss, usage.rss);
  },
});
const elapsed = (Date.now() - startedAt) / 1000;
const mb = stat.size / 1024 / 1024;
console.log(`size=${mb.toFixed(1)}MB chunk=${chunkMb}MB blocks=${stats.blocks} elapsed=${elapsed.toFixed(1)}s throughput=${(mb / elapsed).toFixed(1)}MB/s peakHeapDelta=${((peakHeap - before.heapUsed) / 1024 / 1024).toFixed(1)}MB peakRss=${(peakRss / 1024 / 1024).toFixed(0)}MB`);
await fs.rm(dir, { recursive: true, force: true });
