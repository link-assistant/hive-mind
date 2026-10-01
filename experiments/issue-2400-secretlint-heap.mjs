#!/usr/bin/env node
// Issue #2400: does @secretlint/core lintSource retain memory per call?
// Usage: node --expose-gc experiments/issue-2400-secretlint-heap.mjs [calls] [--no-profiler]
import { lintSource } from '@secretlint/core';
import { creator } from '@secretlint/secretlint-rule-preset-recommend';

const calls = Number(process.argv[2] || 3000);
if (process.argv.includes('--no-profiler')) {
  const { secretLintProfiler } = await import('@secretlint/profiler');
  secretLintProfiler.setEnabled(false);
}
const config = { rules: [{ id: '@secretlint/secretlint-rule-preset-recommend', rule: creator }] };
const mb = () => {
  globalThis.gc?.();
  return Math.round(process.memoryUsage().heapUsed / 1048576);
};
console.log(`start heap ${mb()} MB`);
for (let i = 1; i <= calls; i++) {
  await lintSource({ source: { filePath: '/virtual/content.txt', content: `line ${i}: const fileTokens = await getTokens();`, contentType: 'text' }, options: { config, maskSecrets: false } });
  if (i % 1000 === 0) console.log(`${i} calls: heap ${mb()} MB`);
}
