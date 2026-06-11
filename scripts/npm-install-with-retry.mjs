#!/usr/bin/env node

// Run `npm install` / `npm ci` (or any npm subcommand) with automatic retries on
// transient network failures. GitHub-hosted runners intermittently drop the
// connection to the npm registry mid-download, which surfaces as:
//
//   npm error code ECONNRESET
//   npm error network aborted
//   ##[error]Process completed with exit code 1.
//
// (see issue #1903, run 27332260596, job test-execution). A plain `npm install`
// step has no retry, so a single dropped socket fails the whole CI job — a
// false positive that has nothing to do with the change under test.
//
// This wrapper reuses the retryable-error detection and exponential backoff from
// scripts/preinstall-use-m-packages.mjs (issue #1724) so the two scripts agree on
// what counts as a flaky npm error. It deliberately depends only on Node
// built-ins because it runs *before* `npm install` has populated node_modules.
//
// Usage:
//   node scripts/npm-install-with-retry.mjs            # defaults to `npm install`
//   node scripts/npm-install-with-retry.mjs ci         # runs `npm ci`
//   node scripts/npm-install-with-retry.mjs install --no-audit
//
// Environment:
//   NPM_INSTALL_MAX_ATTEMPTS   override attempt count (default 5)
//   NPM_INSTALL_BASE_DELAY_MS  override base backoff in ms (default 2000)
//   NPM_INSTALL_RETRY_VERBOSE / RUNNER_DEBUG=1  extra debug output

import { spawn } from 'node:child_process';
import { isRetryableNpmError, computeBackoffMs } from './preinstall-use-m-packages.mjs';

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 2000;

const VERBOSE = process.env.NPM_INSTALL_RETRY_VERBOSE === '1' || process.env.RUNNER_DEBUG === '1';

const log = message => process.stdout.write(`[npm-install-with-retry] ${message}\n`);
const debug = message => {
  if (VERBOSE) process.stdout.write(`[npm-install-with-retry][debug] ${message}\n`);
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// Spawn npm, stream its output live to the parent stdio while also buffering it
// so we can inspect the text and decide whether a failure is retryable.
export const runNpm = (args, { spawner = spawn } = {}) =>
  new Promise(resolve => {
    const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    const child = spawner(npmCommand, args, { stdio: ['inherit', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', chunk => {
      stdout += chunk.toString();
      process.stdout.write(chunk);
    });
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString();
      process.stderr.write(chunk);
    });
    child.on('error', error => resolve({ code: 1, stdout, stderr, message: error.message }));
    child.on('close', code => resolve({ code: code ?? 1, stdout, stderr, message: '' }));
  });

export const installWithRetry = async ({ args, attempts = DEFAULT_MAX_ATTEMPTS, baseDelayMs = DEFAULT_BASE_DELAY_MS, runner = runNpm, sleeper = sleep } = {}) => {
  for (let attempt = 1; attempt <= attempts; attempt++) {
    log(`attempt ${attempt}/${attempts}: npm ${args.join(' ')}`);
    const result = await runner(args);
    if (result.code === 0) {
      log(`✅ npm ${args.join(' ')} succeeded on attempt ${attempt}`);
      return { ok: true, attempt };
    }

    const retryable = isRetryableNpmError(result);
    log(`⚠️  attempt ${attempt}/${attempts} failed (exit ${result.code})${retryable ? ' [retryable]' : ''}`);
    debug(`stderr tail: ${(result.stderr || '').split('\n').slice(-5).join(' / ') || '(none)'}`);

    if (!retryable || attempt === attempts) {
      log(`❌ giving up on \`npm ${args.join(' ')}\` after ${attempt} attempt(s)`);
      return { ok: false, attempt, result };
    }

    const delayMs = computeBackoffMs(attempt, baseDelayMs);
    log(`⏳ transient npm failure; retrying in ${delayMs}ms`);
    await sleeper(delayMs);
  }
  return { ok: false, attempts };
};

const parseAttempts = (value, fallback) => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const main = async () => {
  // Default to `npm install` when no subcommand is given.
  const argv = process.argv.slice(2);
  const args = argv.length > 0 ? argv : ['install'];
  const attempts = parseAttempts(process.env.NPM_INSTALL_MAX_ATTEMPTS, DEFAULT_MAX_ATTEMPTS);
  const baseDelayMs = parseAttempts(process.env.NPM_INSTALL_BASE_DELAY_MS, DEFAULT_BASE_DELAY_MS);

  const { ok } = await installWithRetry({ args, attempts, baseDelayMs });
  if (!ok) process.exit(1);
};

const isMain = import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('npm-install-with-retry.mjs');
if (isMain) {
  main().catch(error => {
    log(`fatal: ${error.message}`);
    process.exit(1);
  });
}
