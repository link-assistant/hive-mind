#!/usr/bin/env node
/**
 * Issue #3614: replay the reported load against the bot's real status callers.
 *
 * The issue measured ~95 `$ --status` per minute (plus `docker inspect`,
 * `pgrep`, `which`) for 2–3 docker tasks. This script tracks 3 sessions and
 * lets several callers (session monitor, queue count, /limits, /queue, /log,
 * backend probe, pgrep) ask about them at that rate. Stub `$`, `docker` and
 * `pgrep` binaries on PATH count every process the bot starts.
 *
 * Time is scaled so the run is short: SCALE = 20 makes 1 "minute" last 3 s and
 * the 5 s default interval 250 ms. Prints processes per simulated minute.
 *
 * Usage: node experiments/issue-3614-load-simulation.mjs [minIntervalMs=5000]
 */
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const SCALE = 20;
const MINUTE_MS = 60_000 / SCALE;
const minIntervalMs = Number(process.argv[2] ?? 5000);
const sessions = ['task-a', 'task-b', 'task-c'];

const stubDir = await mkdtemp(path.join(os.tmpdir(), 'hive-3614-sim-'));
const counterFile = path.join(stubDir, 'calls.log');
await writeFile(counterFile, '');
const stub = async (name, body) => {
  await writeFile(path.join(stubDir, name), `#!/bin/sh\necho "${name} $*" >> '${counterFile}'\n${body}\n`);
  await chmod(path.join(stubDir, name), 0o755);
};
await stub('$', `case "$1" in --status) printf '{"uuid":"%s","status":"executing","exitCode":null,"options":{"isolated":"docker"}}\\n' "$2" ;; --list) printf '[]\\n' ;; esac`);
await stub('docker', `printf 'aaaaaaaa\\ttask-a\\nbbbbbbbb\\ttask-b\\ncccccccc\\ttask-c\\n'`);
await stub('pgrep', `printf '101 claude\\n'`);
process.env.PATH = `${stubDir}${path.delimiter}${process.env.PATH}`;

const { configureDockerStatusMinIntervalMs } = await import('../src/status-check-cache.lib.mjs');
const { querySessionStatus, isSessionRunning, checkBackendSessionAlive } = await import('../src/isolation-runner.lib.mjs');
const { getRunningProcesses } = await import('../src/telegram-solve-queue.helpers.lib.mjs');
configureDockerStatusMinIntervalMs(Math.round(minIntervalMs / SCALE));

// One "lookup" = every caller of one session asking once, like a busy tick.
const lookup = session => Promise.all([querySessionStatus(session), isSessionRunning(session, { backend: 'docker' }), checkBackendSessionAlive(session, 'docker'), getRunningProcesses('claude')]);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const lookupsPerMinute = 95;
const started = Date.now();
while (Date.now() - started < MINUTE_MS) {
  await Promise.all(sessions.map(lookup));
  await sleep(MINUTE_MS / lookupsPerMinute);
}

const lines = (await readFile(counterFile, 'utf8')).split('\n').filter(Boolean);
const count = predicate => lines.filter(predicate).length;
console.log(`min interval ${minIntervalMs} ms (scaled ${Math.round(minIntervalMs / SCALE)} ms), ${lookupsPerMinute} lookups/min per session, callers per lookup: 4`);
for (const session of sessions) console.log(`  $ --status ${session}: ${count(line => line === `$ --status ${session} --output-format json` || line.startsWith(`$ --status ${session} `))}/min`);
console.log(`  docker (all sessions, one docker ps): ${count(line => line.startsWith('docker '))}/min`);
console.log(`  pgrep (all tools, one call): ${count(line => line.startsWith('pgrep '))}/min`);
console.log(`  which: ${count(line => line.startsWith('which '))}/min, total processes: ${lines.length}/min`);
await rm(stubDir, { recursive: true, force: true });
