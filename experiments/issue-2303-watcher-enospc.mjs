#!/usr/bin/env node
// Issue #2303 experiment: start-command's detached docker completion watcher
// removes a *still running* container when `docker logs -f >> <log>` dies
// because the log's filesystem is full (ENOSPC).
//
// The watcher script is `docker logs -f C >> LOG; <inspect state>; if exit==0 &&
// !oom then docker rm -f C; fi; printf footer >> LOG; finalize`. A running
// container reports State.ExitCode=0 / OOMKilled=false, so when `docker logs`
// exits early the watcher treats the live session as a *successful* one,
// force-removes it, writes "Exit Code: 0" and finalizes the record as
// `executed` / 0. Hive Mind then announces "✅ Work session finished
// successfully".
//
// Usage: node experiments/issue-2303-watcher-enospc.mjs [path/to/start-command/src/lib]
// Needs a working `docker` and the alpine image. /dev/full stands in for a
// full disk: every write to it fails with ENOSPC.
import { createRequire } from 'module';
import { execSync, spawnSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';

const require = createRequire(import.meta.url);
const libDir = process.argv[2] || path.join(execSync('npm root -g').toString().trim(), 'start-command/src/lib');
const { buildDetachedDockerCompletionScript, DOCKER_CONTAINER_CLEANUP_POLICY } = require(path.join(libDir, 'docker-cleanup.js'));
const { ExecutionStore, ExecutionRecord } = require(path.join(libDir, 'execution-store.js'));

// A private execution store, so the finalizer's verdict can be read back the
// same way Hive Mind reads it (`$ --status <uuid> --output-format json`).
const appFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-2303-store-'));
process.env.START_APP_FOLDER = appFolder;
const store = new ExecutionStore({ appFolder });
const record = new ExecutionRecord({ command: 'solve (issue #2303 experiment)', logPath: '/dev/full', options: { isolated: 'docker', detached: true } });
store.save(record);

const name = `issue-2303-${process.pid}`;
const sh = cmd => spawnSync('sh', ['-c', cmd], { encoding: 'utf8' });
sh(`docker rm -f ${name} >/dev/null 2>&1`);
const run = sh(`docker run -d --name ${name} alpine:3.20 sh -c 'i=0; while true; do echo "work $i"; i=$((i+1)); sleep 0.1; done'`);
if (run.status !== 0) throw new Error(`docker run failed: ${run.stderr}`);
console.log(`started container ${name}; running=${sh(`docker inspect -f '{{.State.Running}}' ${name}`).stdout.trim()}`);
console.log(`state of a RUNNING container: ${sh(`docker inspect -f '{{.State.ExitCode}} {{.State.OOMKilled}} {{.State.FinishedAt}}' ${name}`).stdout.trim()}`);

const script = buildDetachedDockerCompletionScript(name, DOCKER_CONTAINER_CLEANUP_POLICY.DEFAULT, '/dev/full', record.uuid);
const started = Date.now();
const watcher = spawnSync('sh', ['-c', `${script}; echo "watcher saw exit=$__start_command_exit oom=$__start_command_oom" >&2`], { encoding: 'utf8', timeout: 60000 });
console.log(`watcher finished after ${Date.now() - started} ms (the container was never asked to stop)`);
console.log(watcher.stderr.trim());
const after = sh(`docker inspect -f '{{.State.Running}}' ${name} 2>&1`);
console.log(`container after watcher: ${after.status === 0 ? `exists, running=${after.stdout.trim()}` : 'REMOVED (docker rm -f killed the live session)'}`);
const finalized = new ExecutionStore({ appFolder }).get(record.uuid);
console.log(`execution record after watcher: status=${finalized?.status} exitCode=${finalized?.exitCode} exitReason=${finalized?.exitReason ?? null}`);
const status = sh(`START_APP_FOLDER=${appFolder} $ --status ${record.uuid} --output-format json`);
console.log(`$ --status (what Hive Mind polls): ${status.stdout.trim().replace(/\s+/g, ' ').slice(0, 400)}`);
sh(`docker rm -f ${name} >/dev/null 2>&1`);
fs.rmSync(appFolder, { recursive: true, force: true });
