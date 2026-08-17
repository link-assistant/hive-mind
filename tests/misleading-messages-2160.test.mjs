#!/usr/bin/env node

/**
 * Regression test for issue #2160: two log lines in the reported hive run described something
 * other than what actually happened.
 *
 * 1. `📁 Keeping directory (--no-auto-cleanup): /tmp/gh-issue-solver-…` appeared 6 times, but
 *    `--no-auto-cleanup` was never passed on any command line. The workspaces were kept because
 *    solve defaults auto-cleanup to off for public repositories (src/solve.mjs), and naming a flag
 *    nobody passed hid the real reason the disk was filling up.
 * 2. `⚠️  Log comment too long (… chars), GitHub limit is … chars` was reported as a warning even
 *    though the very next thing the code does is upload the log via gh-upload-log — the handled,
 *    expected route for a long log.
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2160
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  ${GREEN}PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Run cleanupTempDirectory() against a directory that does not exist and capture what it logs. */
const captureCleanupOutput = async argv => {
  const { cleanupTempDirectory } = await import('../src/solve.repository.lib.mjs');
  const originalWrite = process.stdout.write.bind(process.stdout);
  let output = '';
  process.stdout.write = chunk => {
    output += chunk;
    return true;
  };
  try {
    await cleanupTempDirectory('/tmp/gh-issue-solver-0000000000000', argv, false);
  } finally {
    process.stdout.write = originalWrite;
  }
  return output;
};

console.log('================================================================================');
console.log('Regression: log lines describe what actually happened (Issue #2160)');
console.log('================================================================================\n');

console.log('cleanupTempDirectory() — why the workspace is kept:\n');

await test('a public-repository default says so instead of blaming --no-auto-cleanup', async () => {
  const output = await captureCleanupOutput({ autoCleanup: false, autoCleanupSource: 'repository-visibility-default' });
  assert(output.includes('Keeping directory'), `expected a keeping-directory line, got: ${output}`);
  assert(output.includes('auto-cleanup is off by default for public repositories'), `expected the real reason, got: ${output}`);
  assert(!output.includes('--no-auto-cleanup'), `a flag that was never passed must not be reported, got: ${output}`);
});

await test('an explicit --no-auto-cleanup is still reported as the flag', async () => {
  const output = await captureCleanupOutput({ autoCleanup: false });
  assert(output.includes('Keeping directory (--no-auto-cleanup)'), `expected the flag to be named, got: ${output}`);
});

console.log('\nsrc/solve.mjs — the default records its own origin:\n');

const solveSrc = readFileSync(join(__dirname, '..', 'src', 'solve.mjs'), 'utf8');

await test('solve.mjs marks the visibility-based default', async () => {
  assert(solveSrc.includes("argv.autoCleanupSource = 'repository-visibility-default'"), 'solve.mjs should record that auto-cleanup was defaulted, not requested');
  const defaultIndex = solveSrc.indexOf('argv.autoCleanup = !isRepoPublic');
  const sourceIndex = solveSrc.indexOf("argv.autoCleanupSource = 'repository-visibility-default'");
  assert(defaultIndex !== -1 && sourceIndex > defaultIndex, 'the marker must be set where the default is applied');
});

console.log('\nsrc/github.lib.mjs — a handled long log is not a warning:\n');

const githubSrc = readFileSync(join(__dirname, '..', 'src', 'github.lib.mjs'), 'utf8');

await test('the long-log path is informational and names the fallback', async () => {
  assert(githubSrc.includes('Log comment too long'), 'the long-log branch should still be logged');
  const line = githubSrc.split('\n').find(l => l.includes('Log comment too long'));
  assert(!line.includes('⚠️'), `a handled fallback must not be a warning, got: ${line.trim()}`);
  assert(line.includes('ℹ️'), `expected an informational marker, got: ${line.trim()}`);
  assert(line.includes('gh-upload-log'), `the message should name the route it takes, got: ${line.trim()}`);
});

console.log('');
console.log('================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

process.exit(failed === 0 ? 0 : 1);
