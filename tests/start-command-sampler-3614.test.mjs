#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Exercise the published dependency's real sampler, rather than testing only
 * image pin strings. start-command 0.39.0 fails the unreadable-counter and
 * backoff cases; 0.39.1+ must stop permanent failures and retain working streams.
 */
import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const require = createRequire(import.meta.url);
const packageDir = path.resolve(path.dirname(require.resolve('start-command')), '../..');
const experiment = fileURLToPath(new URL('../experiments/issue-3614-upstream-check.mjs', import.meta.url));

test('the pinned start-command sampler stops unreadable counters and backs off transient failures', { timeout: 60_000, skip: process.platform === 'win32' }, async () => {
  const { stdout } = await promisify(execFile)(process.execPath, [experiment, packageDir]);
  console.log(stdout);
});
