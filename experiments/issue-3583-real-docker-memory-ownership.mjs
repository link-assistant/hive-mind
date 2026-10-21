#!/usr/bin/env node
/**
 * Issue #3583 against a real Docker daemon.
 *
 * Builds a tiny image whose `box` user is uid 1001 (as in the published Formal
 * AI images) and whose default `USER` is `box` (the harder case for chown), leaves the memory volume root-owned the way an older Hive Mind
 * did, and checks that:
 *   1. `ensureFormalAiMemoryVolume` repairs it and logs the issue's line;
 *   2. `box` can then write `memory.lino` and `logs/`;
 *   3. a second call finds the volume healthy and runs no chown;
 *   4. a container printing Formal AI's `logging_failure` record is reported,
 *      and its stdout is streamed to the archive before `docker rm`.
 *
 * Uses the real `hive-mind-formal-ai-memory` volume name, so it refuses to run
 * when that volume already exists. Everything it creates is removed.
 *
 * Usage: node experiments/issue-3583-real-docker-memory-ownership.mjs
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { archiveFormalAiSidecarLogs, checkFormalAiSidecarLogging } from '../src/formal-ai-sidecar-logs.lib.mjs';
import { FORMAL_AI_MEMORY_MOUNT, FORMAL_AI_MEMORY_VOLUME_NAME, ensureFormalAiMemoryVolume } from '../src/formal-ai-sidecar.lib.mjs';

const IMAGE = 'hive-mind-issue-3583-box:test';
const CONTAINER = 'hive-mind-issue-3583-sidecar';
const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const quiet = (...args) => {
  try {
    return docker(...args);
  } catch {
    return null;
  }
};

if (quiet('volume', 'inspect', FORMAL_AI_MEMORY_VOLUME_NAME) !== null) {
  console.error(`refusing to run: volume ${FORMAL_AI_MEMORY_VOLUME_NAME} already exists on this host`);
  process.exit(2);
}

const logDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hive-3583-logs-'));
const lines = [];
const log = async line => {
  lines.push(line);
  console.log(`  log: ${line}`);
};

try {
  execFileSync('docker', ['build', '--quiet', '--tag', IMAGE, '-'], { input: 'FROM alpine:3.20\nRUN adduser -D -u 1001 box\nUSER box\n', encoding: 'utf8' });

  // An existing, root-owned volume: what two months of the bug looked like.
  docker('volume', 'create', FORMAL_AI_MEMORY_VOLUME_NAME);
  docker('run', '--rm', '--user', '0:0', '--volume', `${FORMAL_AI_MEMORY_VOLUME_NAME}:/v`, '--entrypoint', 'sh', IMAGE, '-c', 'mkdir -p /v/logs');
  console.log(`before: ${docker('run', '--rm', '--user', '0:0', '--volume', `${FORMAL_AI_MEMORY_VOLUME_NAME}:/v`, '--entrypoint', 'stat', IMAGE, '-c', '%u:%g', '/v')}`);
  assert.notEqual(quiet('run', '--rm', '--user', 'box', '--volume', `${FORMAL_AI_MEMORY_VOLUME_NAME}:${FORMAL_AI_MEMORY_MOUNT}`, IMAGE, 'touch', `${FORMAL_AI_MEMORY_MOUNT}/memory.lino`), '', 'box cannot write the root-owned volume');

  const fixed = await ensureFormalAiMemoryVolume({ image: IMAGE, log });
  console.log('first call:', fixed);
  assert.equal(fixed.created, false);
  assert.equal(fixed.fixed, true);
  assert.ok(lines.includes('[formal-ai] memory volume was owned by 0:0; fixed'));

  docker('run', '--rm', '--user', 'box', '--volume', `${FORMAL_AI_MEMORY_VOLUME_NAME}:${FORMAL_AI_MEMORY_MOUNT}`, IMAGE, 'sh', '-c', `echo memory > ${FORMAL_AI_MEMORY_MOUNT}/memory.lino && mkdir -p ${FORMAL_AI_MEMORY_MOUNT}/logs && echo entry > ${FORMAL_AI_MEMORY_MOUNT}/logs/dialog.lino`);
  console.log(`after: ${docker('run', '--rm', '--user', '0:0', '--volume', `${FORMAL_AI_MEMORY_VOLUME_NAME}:/v`, '--entrypoint', 'sh', IMAGE, '-c', 'stat -c "%u:%g %n" /v /v/memory.lino /v/logs /v/logs/dialog.lino')}`);

  lines.length = 0;
  const healthy = await ensureFormalAiMemoryVolume({ image: IMAGE, log });
  console.log('second call:', healthy);
  assert.equal(healthy.fixed, false, 'a healthy volume is left alone');
  assert.equal(healthy.writable, true);
  assert.deepEqual(lines, []);

  // A sidecar that reports a logging failure on stdout.
  const record = '(formal-ai-log-v1 (object (field component (string structured_log)) (field kind (string logging_failure)) (field level (string error)) (field message (string logging_failed_check_log_directory_permissions_and_space)) (field reason (string file_write_failed)) (field sequence (number 2))))';
  docker('run', '--detach', '--name', CONTAINER, '--entrypoint', 'sh', IMAGE, '-c', `echo '${record}'; echo '[dialog-log] failed to record exchange: Permission denied (os error 13)'; sleep 30`);
  execFileSync('sleep', ['1']);
  const logging = await checkFormalAiSidecarLogging({ containerName: CONTAINER, memoryVolume: FORMAL_AI_MEMORY_VOLUME_NAME, memoryMount: FORMAL_AI_MEMORY_MOUNT });
  console.log(`warning: ${logging.warning}`);
  assert.match(logging.warning, /^Formal AI cannot write its logs or memory \(.*\): dialogs of this session will not be kept$/);

  docker('stop', '--time', '1', CONTAINER);
  const archive = await archiveFormalAiSidecarLogs({ containerName: CONTAINER, env: { HIVE_MIND_LOG_DIR: logDir }, log });
  assert.equal(archive.archived, true, archive.error);
  console.log(`archive ${archive.path}:\n${fs.readFileSync(archive.path, 'utf8')}`);
  assert.match(fs.readFileSync(archive.path, 'utf8'), /^\d{4}-\d\d-\d\dT[\d:.]+Z \(formal-ai-log-v1/);
  console.log('OK: issue #3583 behaviour verified against a real Docker daemon');
} finally {
  quiet('rm', '--force', CONTAINER);
  quiet('volume', 'rm', FORMAL_AI_MEMORY_VOLUME_NAME);
  quiet('rmi', IMAGE);
  fs.rmSync(logDir, { recursive: true, force: true });
}
