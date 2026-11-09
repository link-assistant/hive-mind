#!/usr/bin/env node
// Inspect effective worker limits without allocating a stress-test heap.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const source = `
  const { Worker } = require('node:worker_threads');
  const worker = new Worker("require('node:worker_threads').parentPort.postMessage(require('node:v8').getHeapStatistics().heap_size_limit)", { eval: true, resourceLimits: { maxOldGenerationSizeMb: 48 } });
  worker.on('message', heapSizeLimit => console.log(JSON.stringify({ declared: worker.resourceLimits.maxOldGenerationSizeMb, heapSizeLimit })));
  worker.on('error', () => { process.exitCode = 1; });
`;
const results = {};
for (const override of [false, true]) {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  if (override) env.NODE_OPTIONS = '--max-old-space-size=160';
  const result = spawnSync(process.execPath, ['-e', source], { env, encoding: 'utf8', timeout: 10_000, maxBuffer: 16 * 1024 });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  results[override ? 'parentOverride' : 'nativeWorkerLimit'] = JSON.parse(result.stdout);
}
console.log(JSON.stringify(results));
assert.equal(results.nativeWorkerLimit.declared, 48);
assert.equal(results.parentOverride.declared, 48);
assert.ok(results.parentOverride.heapSizeLimit > results.nativeWorkerLimit.heapSizeLimit);
