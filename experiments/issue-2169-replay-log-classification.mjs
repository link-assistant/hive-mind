#!/usr/bin/env node
/**
 * Issue #2169 — replay the 11 `result` payloads captured in
 * docs/case-studies/issue-2169/logs/run.log.txt through the OLD (pre-fix) gateway
 * matcher and the NEW `classifyRetryableError`, proving the retries were false
 * positives caused by the bare `/\b52[0-4]\b/` test matching PR/issue numbers.
 *
 * Usage: node experiments/issue-2169-replay-log-classification.mjs
 */
import fsModule from 'node:fs';
import osModule from 'node:os';
import pathModule from 'node:path';

globalThis.use = async name => {
  const packageName = name.replace(/@\d[^/]*$/, '');
  if (packageName === 'fs') return { ...fsModule, default: fsModule };
  if (packageName === 'os') return { ...osModule, default: osModule };
  if (packageName === 'path') return { ...pathModule, default: pathModule };
  if (packageName === 'getenv') return (key, fallback) => process.env[key] ?? fallback;
  return await import(packageName);
};

const { classifyRetryableError } = await import('../src/tool-retry.lib.mjs');

// The pre-fix predicate, verbatim from `git show main:src/tool-retry.lib.mjs` line 166.
const oldIsGatewayError = lower => lower.includes('502 bad gateway') || lower.includes('bad gateway') || lower.includes('504 gateway timeout') || lower.includes('gateway time-out') || lower.includes('gateway timeout') || lower.includes('api error: 502') || lower.includes('api error: 504') || /\b52[0-4]\b/.test(lower);

const logPath = pathModule.join(process.cwd(), 'docs/case-studies/issue-2169/logs/run.log.txt');
const lines = fsModule.readFileSync(logPath, 'utf8').split('\n');
const payloads = lines.map(line => line.trim()).filter(line => line.startsWith('"result": "'));

let oldRetryable = 0;
let newRetryable = 0;
for (const [index, raw] of payloads.entries()) {
  const text = JSON.parse(`{${raw.replace(/,$/, '')}}`).result;
  const old = oldIsGatewayError(text.toLowerCase());
  const now = classifyRetryableError(text);
  if (old) oldRetryable++;
  if (now.isRetryable) newRetryable++;
  const hits = text.match(/\b52[0-4]\b/g) || [];
  console.log(`attempt ${String(index + 1).padStart(2)}: old=${old ? 'RETRY' : 'ok   '} new=${now.isRetryable ? 'RETRY' : 'ok   '} 52x-hits=${JSON.stringify([...new Set(hits)])} :: ${text.slice(0, 70).replace(/\n/g, ' ')}…`);
}

console.log(`\npayloads: ${payloads.length}`);
console.log(`classified retryable by OLD matcher: ${oldRetryable}`);
console.log(`classified retryable by NEW matcher: ${newRetryable}`);
process.exit(payloads.length === 11 && oldRetryable === 11 && newRetryable === 0 ? 0 : 1);
