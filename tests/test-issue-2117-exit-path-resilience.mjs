#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for the exit-path hardening that came out of issue #2117.
 *
 * The incident was NOT a solver that exited 1: the archived run exits 0 (see
 * docs/case-studies/issue-2117). The false failure was reported by the Telegram
 * monitor, and it is covered by tests/test-issue-2117-false-terminal-exit-code.mjs.
 *
 * What remains valuable on the solver side is the guarantee that the exit code a
 * caller asks for is the exit code the process uses: diagnostic housekeeping
 * (exit banner, development-log finalization, handle draining, Sentry close,
 * temp-directory cleanup) must never turn a success into a failure — and must
 * never mask a genuine failure either.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2117
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { finalizeSolveProcess } from '../src/solve.finalize.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

const exitHandlerUrl = new URL('../src/exit-handler.lib.mjs', import.meta.url).href;

const runExitChild = source => spawnSync(process.execPath, ['--input-type=module', '--eval', source], { encoding: 'utf8' });

// A failure stays a failure — nothing in the exit path may downgrade it.
const failingExitChild = runExitChild(`
  import { initializeExitHandler, safeExit } from ${JSON.stringify(exitHandlerUrl)};
  initializeExitHandler(() => '/tmp/issue-2117-failure.log', async () => {});
  await safeExit(1, 'simulated failure');
`);
assert(failingExitChild.status === 1, 'safeExit(1) exits the process with code 1');

// A success stays a success even when the best-effort steps throw.
const noisySuccessChild = runExitChild(`
  import { initializeExitHandler, safeExit } from ${JSON.stringify(exitHandlerUrl)};
  initializeExitHandler(
    () => { throw new Error('simulated log path failure'); },
    async () => { throw new Error('simulated log failure'); }
  );
  await safeExit(0, 'simulated success with broken diagnostics');
`);
assert(noisySuccessChild.status === 0, 'Broken exit diagnostics cannot turn a successful exit into a failure');

// solve installs its own richer uncaughtException/unhandledRejection handlers,
// so the generic pair must not be installed a second time and race them.
const solveSource = fs.readFileSync(new URL('../src/solve.mjs', import.meta.url), 'utf8');
assert(solveSource.includes('installGlobalExitHandlers({ handleProcessErrors: false })'), 'solve does not install a second pair of racing process-error handlers');

const exitHandlerSource = fs.readFileSync(new URL('../src/exit-handler.lib.mjs', import.meta.url), 'utf8');
assert(exitHandlerSource.includes('export const installGlobalExitHandlers = ({ handleProcessErrors = true } = {}) =>'), 'Other consumers keep the generic process-error handlers by default');
assert(!/resolveInternalExitCode|confirmPullRequestMerged/.test(exitHandlerSource), 'No exit-code override survives in the exit path: a reported failure is always a real failure');

const finalizerCalls = [];
const finalizerWarnings = [];
await finalizeSolveProcess({
  tempDir: '/tmp/issue-2117',
  argv: {},
  limitReached: false,
  path: { resolve: value => value },
  getLogFile: () => '/tmp/issue-2117.log',
  log: async message => {
    finalizerWarnings.push(message);
  },
  closeSentry: async () => {
    throw new Error('simulated Sentry close failure');
  },
  logActiveHandles: async () => {
    throw new Error('simulated active-handle probe failure');
  },
  cleanupTempDirectory: async () => {
    throw new Error('simulated cleanup failure');
  },
  safeExit: async code => {
    finalizerCalls.push(code);
  },
});

assert(finalizerCalls.length === 1 && finalizerCalls[0] === 0, 'Post-run housekeeping failures cannot prevent the final successful exit');
assert(finalizerWarnings.filter(message => message.includes('Finalization step failed')).length === 3, 'Every failed housekeeping step remains visible for investigation');

printSummary();
if (getFailCount() > 0) process.exit(1);
