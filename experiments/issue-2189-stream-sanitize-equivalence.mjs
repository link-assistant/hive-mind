#!/usr/bin/env node
/**
 * Issue #2189 — prove the streaming sanitizer is equivalent to the whole-file
 * sanitizer while staying memory-bounded.
 *
 * Usage: node experiments/issue-2189-stream-sanitize-equivalence.mjs [sizeMB]
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { sanitizeForPublication } from '../src/token-sanitization.lib.mjs';
import { sanitizeLogFileToFile } from '../src/log-sanitize-stream.lib.mjs';

const sizeMb = Number(process.argv[2] || 4);
const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'issue-2189-'));
const source = path.join(dir, 'session.log');

const secrets = ['ghp_' + 'a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8', 'sk-ant-api03-' + 'x'.repeat(80), 'AKIA' + 'ABCDEFGHIJKLMNOP'];
const pem = ['-----BEGIN RSA PRIVATE KEY-----', ...Array.from({ length: 12 }, (_, i) => 'MIIEow' + String(i).padStart(2, '0') + 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'), '-----END RSA PRIVATE KEY-----'].join('\n');

let written = 0;
const handle = await fs.open(source, 'w');
let n = 0;
while (written < sizeMb * 1024 * 1024) {
  const lines = [];
  for (let i = 0; i < 500; i++) {
    n += 1;
    lines.push(`2026-09-03T10:00:00Z [VERBOSE] line ${n} some ordinary transcript text padding padding padding`);
    if (n % 250 === 0) lines.push(`token=${secrets[n % secrets.length]}`);
    if (n % 4000 === 0) lines.push(pem);
  }
  const block = lines.join('\n') + '\n';
  await handle.write(block, null, 'utf8');
  written += Buffer.byteLength(block);
}
await handle.close();
const stat = await fs.stat(source);
console.log(`source: ${source} (${(stat.size / 1024 / 1024).toFixed(2)} MB)`);

const whole = await sanitizeForPublication(await fs.readFile(source, 'utf8'));

const dest = path.join(dir, 'streamed.log');
const before = process.memoryUsage().heapUsed;
let peak = before;
const stats = await sanitizeLogFileToFile({
  sourcePath: source,
  destPath: dest,
  onProgress: () => {
    peak = Math.max(peak, process.memoryUsage().heapUsed);
  },
});
const streamed = await fs.readFile(dest, 'utf8');

console.log('stats:', stats);
console.log(`peak heap delta during stream: ${((peak - before) / 1024 / 1024).toFixed(1)} MB`);
console.log(`whole-file result length: ${whole.length}`);
console.log(`streamed result length:   ${streamed.length}`);
console.log(`identical: ${whole === streamed}`);
if (whole !== streamed) {
  let i = 0;
  while (i < whole.length && whole[i] === streamed[i]) i++;
  console.log(`first divergence at ${i}:`);
  console.log(`  whole:    ${JSON.stringify(whole.slice(Math.max(0, i - 80), i + 120))}`);
  console.log(`  streamed: ${JSON.stringify(streamed.slice(Math.max(0, i - 80), i + 120))}`);
}
for (const secret of secrets) {
  if (streamed.includes(secret)) console.log(`LEAK: ${secret.slice(0, 12)}… survived streaming sanitize`);
}
if (streamed.includes('MIIEow00')) console.log('LEAK: PEM body survived streaming sanitize');
await fs.rm(dir, { recursive: true, force: true });
