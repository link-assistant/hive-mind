#!/usr/bin/env node

/**
 * Regression test for issue #1952 (log-attachment guarantee).
 *
 * The issue reported: "there was no log attached, yet `--attach-logs` were enabled. So we cannot
 * finish any working session with no logs when `--attach-logs` is enabled, double check all logic
 * paths."
 *
 * Root cause: every log-attachment path in solve.mjs is conditional. verifyResults() only attaches
 * when the PR is detected as session-owned; the temporary-watch block only runs on uncommitted
 * changes; the auto-merge/watch loops attach per AI iteration, but their stop-for-human-review
 * exits (billing_limit, ci_cancelled_requires_review, external_review_limit, limit reached) can
 * return before any iteration ran — attaching nothing. So a session could finish with NO log.
 *
 * Fix: attachLogToGitHub records a process-global flag (global.logAttachedToGitHub) on every
 * successful upload, and solve.mjs adds a final safety net that attaches the log when nothing else
 * did. This test verifies the flag mechanism (behaviourally) and the wiring (source assertions).
 *
 * @hive-mind-test-suite default
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1952
 */

import { readFileSync, promises as fs } from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { attachLogToGitHub } from '../src/github.lib.mjs';
import { attachFinalLogIfMissing } from '../src/attach-logs-guarantee.lib.mjs';

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
  if (!condition) {
    throw new Error(message);
  }
};

console.log('================================================================================');
console.log('Regression: --attach-logs must always attach a log (Issue #1952)');
console.log('================================================================================\n');

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// ---------------------------------------------------------------------------
// Behavioural: the global flag is only set on a successful upload.
// ---------------------------------------------------------------------------

await test('attachLogToGitHub does NOT set global.logAttachedToGitHub when there is nothing to upload', async () => {
  delete global.logAttachedToGitHub;
  const tempDir = await fs.mkdtemp(join(os.tmpdir(), 'attach-1952-'));
  const emptyLog = join(tempDir, 'empty.log');
  await fs.writeFile(emptyLog, '');

  const logs = [];
  const result = await attachLogToGitHub({
    logFile: emptyLog,
    targetType: 'pr',
    targetNumber: 1,
    owner: 'o',
    repo: 'r',
    $: async () => ({ code: 1, stdout: '', stderr: '' }),
    log: async msg => logs.push(msg),
    sanitizeLogContent: c => c,
  });

  await fs.rm(tempDir, { recursive: true, force: true });
  assert(result === false, 'empty log file should not upload');
  assert(!global.logAttachedToGitHub, 'global.logAttachedToGitHub must remain unset when nothing was attached');
});

// ---------------------------------------------------------------------------
// Wiring: attachLogToGitHub records success on both upload paths.
// ---------------------------------------------------------------------------

const githubSrc = readFileSync(join(repoRoot, 'src', 'github.lib.mjs'), 'utf8');
const solveSrc = readFileSync(join(repoRoot, 'src', 'solve.mjs'), 'utf8');
const errorHandlersSrc = readFileSync(join(repoRoot, 'src', 'solve.error-handlers.lib.mjs'), 'utf8');

await test('attachLogToGitHub marks the global flag on a successful upload (both branches)', () => {
  const occurrences = githubSrc.split('global.logAttachedToGitHub = true').length - 1;
  assert(occurrences >= 2, `expected the success flag to be set on both upload branches, found ${occurrences}`);
});

const guaranteeSrc = readFileSync(join(repoRoot, 'src', 'attach-logs-guarantee.lib.mjs'), 'utf8');

await test('attach-logs-guarantee guard requires --attach-logs, a PR, and nothing attached yet', () => {
  assert(guaranteeSrc.includes('!shouldAttachLogs || !prNumber || globalState.logAttachedToGitHub'), 'helper guard must require shouldAttachLogs && prNumber && !logAttachedToGitHub');
});

await test('solve.mjs wires the final safety net and reconciles logsAttached from it', () => {
  assert(solveSrc.includes('attachFinalLogIfMissing'), 'solve.mjs must call the final --attach-logs safety net helper');
  const idx = solveSrc.indexOf('attachFinalLogIfMissing({');
  assert(idx !== -1, 'safety net call should exist');
  // The call result must feed back into logsAttached so endWorkSession does not double-post.
  const around = solveSrc.slice(Math.max(0, idx - 120), idx);
  assert(around.includes('logsAttached ='), 'the safety net result must reconcile logsAttached');
});

// ---------------------------------------------------------------------------
// Behavioural: the extracted helper only attaches as a last resort.
// ---------------------------------------------------------------------------

const baseArgs = {
  owner: 'o',
  repo: 'r',
  $: async () => ({ code: 0, stdout: '', stderr: '' }),
  log: async () => {},
  sanitizeLogContent: c => c,
  getLogFile: () => '/tmp/does-not-matter.log',
  argv: {},
};

await test('attachFinalLogIfMissing does nothing when --attach-logs is disabled', async () => {
  let called = false;
  const globalState = {};
  const result = await attachFinalLogIfMissing({
    ...baseArgs,
    shouldAttachLogs: false,
    prNumber: 5,
    attachLogToGitHub: async () => {
      called = true;
      return true;
    },
    globalState,
  });
  assert(called === false, 'must not attach when --attach-logs is disabled');
  assert(result === false, 'returns false when nothing was attached');
});

await test('attachFinalLogIfMissing does nothing when there is no PR to attach to', async () => {
  let called = false;
  const result = await attachFinalLogIfMissing({
    ...baseArgs,
    shouldAttachLogs: true,
    prNumber: null,
    attachLogToGitHub: async () => {
      called = true;
      return true;
    },
    globalState: {},
  });
  assert(called === false, 'must not attach when there is no PR');
  assert(result === false, 'returns false when nothing was attached');
});

await test('attachFinalLogIfMissing skips when a log was already attached earlier', async () => {
  let called = false;
  const result = await attachFinalLogIfMissing({
    ...baseArgs,
    shouldAttachLogs: true,
    prNumber: 5,
    attachLogToGitHub: async () => {
      called = true;
      return true;
    },
    globalState: { logAttachedToGitHub: true },
  });
  assert(called === false, 'must not double-attach when a log already went up');
  assert(result === true, 'returns true because a log is already attached');
});

await test('attachFinalLogIfMissing attaches as the last resort when nothing else did', async () => {
  let called = false;
  // Simulate attachLogToGitHub marking the global flag on success, as the real one does.
  const globalState = {};
  const result = await attachFinalLogIfMissing({
    ...baseArgs,
    shouldAttachLogs: true,
    prNumber: 5,
    attachLogToGitHub: async () => {
      called = true;
      globalState.logAttachedToGitHub = true;
      return true;
    },
    globalState,
  });
  assert(called === true, 'must attach when --attach-logs is on, a PR exists, and nothing attached yet');
  assert(result === true, 'returns true once the safety net attaches the log');
});

await test('error/failure path still attaches logs when --attach-logs is enabled', () => {
  // Issue #1952 requires ALL logic paths to attach. The error handler path must keep its attach.
  assert(errorHandlersSrc.includes('shouldAttachLogs && getLogFile()'), 'error handler must attach logs on failure when --attach-logs is enabled');
  assert(errorHandlersSrc.includes('attachLogToGitHub('), 'error handler must call attachLogToGitHub');
});

console.log('\n================================================================================');
console.log(`Results: ${passed} passed, ${failed} failed`);
console.log('================================================================================');

process.exit(failed === 0 ? 0 : 1);
