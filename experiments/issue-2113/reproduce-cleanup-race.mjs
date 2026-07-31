#!/usr/bin/env node

/**
 * Issue #2113 follow-up: provoke the ENOTEMPTY race observed when use-m@8.14.3
 * removes an alias while another process is still mutating that directory.
 *
 * This is an opt-in stress experiment, not a default-suite test. Filesystem
 * scheduling differs by platform, so the no-retry case is attempted repeatedly.
 */

import assert from 'node:assert/strict';
import { once } from 'node:events';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { removeAliasWithRetry } from '../../src/use-with-retry.lib.mjs';

const scriptPath = fileURLToPath(import.meta.url);

if (process.argv[2] === '--writer') {
  const target = process.argv[3];
  const deadline = Date.now() + Number(process.argv[4]);
  let counter = 0;
  mkdirSync(target, { recursive: true });
  process.stdout.write('ready\n');
  while (Date.now() < deadline) {
    if (!existsSync(target)) break;
    try {
      writeFileSync(join(target, `${counter++}.tmp`), 'x');
    } catch (error) {
      if (['ENOENT', 'ENOTDIR'].includes(error.code)) break;
      throw error;
    }
  }
  process.exit(0);
}

const raceRemoval = async ({ retries }) => {
  const root = await mkdtemp(join(tmpdir(), 'hive-mind-issue-2113-rm-'));
  const alias = join(root, 'command-stream-v-latest');
  const hotDirectory = join(alias, 'examples');
  await mkdir(hotDirectory, { recursive: true });

  const writer = spawn(process.execPath, [scriptPath, '--writer', hotDirectory, '120'], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  const writerExit = once(writer, 'exit');
  await once(writer.stdout, 'data');

  let error = null;
  try {
    if (retries) {
      await removeAliasWithRetry(alias, { maxRetries: 5, retryDelay: 25 });
    } else {
      await rm(alias, { recursive: true, force: true });
    }
  } catch (caught) {
    error = caught;
  }

  await writerExit;
  const resurrected = existsSync(alias);
  await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
  return { error, resurrected };
};

let observedDefaultFailure = null;
for (let attempt = 1; attempt <= 20; attempt++) {
  const result = await raceRemoval({ retries: false });
  if (result.error?.code === 'ENOTEMPTY') {
    observedDefaultFailure = { attempt, ...result };
    break;
  }
}

assert(observedDefaultFailure, 'The filesystem did not expose ENOTEMPTY in 20 stress attempts');
process.stdout.write(`default rm reproduced ${observedDefaultFailure.error.code} on attempt ${observedDefaultFailure.attempt}\n`);

const retried = await raceRemoval({ retries: true });
assert.equal(retried.error, null);
assert.equal(retried.resurrected, false);
process.stdout.write('retry-budget rm completed without leaving the alias behind\n');
