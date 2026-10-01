#!/usr/bin/env node
// Issue #2400: does calling sanitizeForPublication many times grow the heap?
// Usage: node --expose-gc experiments/issue-2400-heap-per-call.mjs <file> [lines]
import fs from 'node:fs/promises';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';

const [file, limit = '4000'] = process.argv.slice(2);
const lines = (await fs.readFile(file, 'utf8')).split('\n').slice(0, Number(limit));
const mb = () => {
  globalThis.gc?.();
  return Math.round(process.memoryUsage().heapUsed / 1048576);
};
console.log(`start heap ${mb()} MB`);
for (const [index, line] of lines.entries()) {
  try {
    await sanitizeForPublication(line);
  } catch {
    /* blocked lines are reported by issue-2400-find-blocking-lines.mjs */
  }
  if ((index + 1) % 1000 === 0) console.log(`${index + 1} calls: heap ${mb()} MB`);
}
