#!/usr/bin/env node
/**
 * Verify the actual published start-command sampler with finite Docker stubs.
 *
 * npm install --prefix /tmp/start-check --ignore-scripts start-command@0.39.2
 * node experiments/issue-3614-upstream-check.mjs /tmp/start-check/node_modules/start-command
 *
 * Repeat with 0.39.0 to reproduce start#247. The fixture advances at most four
 * rounds, so even broken samplers cannot run forever. No Docker daemon needed.
 */
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const packageDir = path.resolve(process.argv[2]);
const { version } = require(path.join(packageDir, 'package.json'));
const { buildCgroupSamplerStartSnippet, buildCgroupSamplerStopSnippet, buildCgroupMemoryLogSnippet } = require(path.join(packageDir, 'src/lib/cgroup-memory.js'));
const fixture = fileURLToPath(new URL('./issue-3614-cgroup-fixture.sh', import.meta.url));
const run = promisify(execFile);
const count = (output, text) => output.split('\n').filter(line => line.includes(text)).length;
const sleeps = output =>
  output
    .split('\n')
    .filter(line => line.startsWith('sleep='))
    .map(line => Number(line.slice(6)));

async function sample(mode, interval) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'hive-3614-upstream-'));
  try {
    const script = path.join(dir, 'sample.sh');
    await writeFile(script, [buildCgroupSamplerStartSnippet("task '238'"), 'wait "$__start_command_cgroup_sampler"', buildCgroupSamplerStopSnippet(), buildCgroupMemoryLogSnippet('"$TMPDIR/memory.log"'), 'cat "$TMPDIR/memory.log" "$TMPDIR/calls"', 'sed "s/^/sleep=/" "$TMPDIR/sleeps"'].join('; '));
    const env = { ...process.env };
    delete env.START_COMMAND_CGROUP_SAMPLE_INTERVAL_SECONDS;
    if (interval !== undefined) env.START_COMMAND_CGROUP_SAMPLE_INTERVAL_SECONDS = interval;
    return (await run('/bin/sh', [fixture, mode, script], { env })).stdout;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${name}: ${error.message}`);
  }
}

console.log(`Published start-command ${version}`);
await check('unreadable stream stops after one exec, without liveness checks or sleep', async () => {
  const output = await sample('no-memory');
  assert.equal(count(output, "task '238' sh -c"), 1);
  assert.equal(count(output, '{{.State.Running}}'), 0);
  assert.deepEqual(sleeps(output), []);
  assert.match(output, /Docker exec exit=3: private cgroup v2 counters unreadable/);
});
await check('unreadable per-round counters stop after the stream and one fallback exec', async () => {
  const output = await sample('no-memory-outage');
  assert.equal(count(output, "task '238' sh -c"), 2);
  assert.equal(count(output, '{{.State.Running}}'), 1);
  assert.match(output, /Docker exec exit=3: private cgroup v2 counters unreadable/);
});
await check('failed rounds back off from five seconds', async () => assert.deepEqual(sleeps(await sample('outage')), [5, 10, 20]));
await check('backoff is capped at sixty seconds', async () => assert.deepEqual(sleeps(await sample('outage', '40')), [40, 60, 60]));
await check('backoff respects intervals over sixty seconds', async () => assert.deepEqual(sleeps(await sample('outage', '100')), [100, 100, 100]));
await check('readable local counters retain the five-second default', async () => assert.deepEqual(sleeps(await sample('local')), [5, 5, 5]));
await check('readable remote counters use one stream and the configured interval', async () => {
  const output = await sample('remote', '2');
  assert.deepEqual(sleeps(output), [2, 2, 2]);
  assert.equal(count(output, "exec -i task '238' sh -c"), 1);
});
await check('off disables sampling', async () => {
  const output = await sample('remote', 'off');
  assert.equal(count(output, "task '238' sh -c"), 0);
  assert.deepEqual(sleeps(output), []);
  assert.match(output, /sampling disabled/);
});
console.log(`Failures: ${failures}`);
process.exitCode = failures ? 1 : 0;
