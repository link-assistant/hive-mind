#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #2117's root lifecycle bug: after GitHub has
 * confirmed the requested merge, a later internal housekeeping failure must be
 * recorded without changing the solver's successful terminal exit to code 1.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/2117
 */

import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { confirmPullRequestMerged, getConfirmedTerminalOutcome, resetTerminalOutcomeForTests, resolveInternalExitCode } from '../src/solve-terminal-outcome.lib.mjs';
import { finalizeSolveProcess } from '../src/solve.finalize.lib.mjs';
import { assert, printSummary, getFailCount } from './test-helpers.mjs';

resetTerminalOutcomeForTests();
assert(resolveInternalExitCode(1) === 1, 'A real failure before merge remains exit code 1');

const confirmed = confirmPullRequestMerged({
  owner: 'link-foundation',
  repo: 'use-m',
  prNumber: 69,
  mergedAt: '2026-07-30T06:38:12.000Z',
});

assert(confirmed?.kind === 'pull_request_merged', 'A confirmed merge records the durable terminal outcome');
assert(getConfirmedTerminalOutcome()?.prNumber === 69, 'The confirmed outcome retains the pull request identity for diagnostics');
assert(resolveInternalExitCode(1) === 0, 'An internal post-merge failure cannot override the successful terminal exit');
assert(resolveInternalExitCode(0) === 0, 'A normal post-merge exit remains successful');

const exitHandlerUrl = new URL('../src/exit-handler.lib.mjs', import.meta.url).href;
const errorHandlersUrl = new URL('../src/solve.error-handlers.lib.mjs', import.meta.url).href;
const terminalOutcomeUrl = new URL('../src/solve-terminal-outcome.lib.mjs', import.meta.url).href;
const unguardedExitChild = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '--eval',
    `
      import { initializeExitHandler, safeExit } from ${JSON.stringify(exitHandlerUrl)};
      initializeExitHandler(() => '/tmp/issue-2117-pre-merge.log', async () => {});
      await safeExit(1, 'simulated pre-merge failure');
    `,
  ],
  { encoding: 'utf8' }
);
assert(unguardedExitChild.status === 1, 'The real safeExit path preserves exit 1 before a merge');

const guardedExitChild = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '--eval',
    `
      import { initializeExitHandler, safeExit } from ${JSON.stringify(exitHandlerUrl)};
      import { confirmPullRequestMerged } from ${JSON.stringify(terminalOutcomeUrl)};
      initializeExitHandler(() => '/tmp/issue-2117-child.log', async message => console.log(message));
      confirmPullRequestMerged({ owner: 'link-foundation', repo: 'use-m', prNumber: 69 });
      await safeExit(1, 'simulated post-merge failure');
    `,
  ],
  { encoding: 'utf8' }
);
assert(guardedExitChild.status === 0, 'The real safeExit path converts an internal post-merge exit 1 to process exit 0');
assert(guardedExitChild.stdout.includes('preserving exit 0'), 'The guarded exit logs the suppressed post-merge failure for investigation');

const guardedErrorHandlerChild = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '--eval',
    `
      import { initializeExitHandler } from ${JSON.stringify(exitHandlerUrl)};
      import { createUncaughtExceptionHandler } from ${JSON.stringify(errorHandlersUrl)};
      import { confirmPullRequestMerged } from ${JSON.stringify(terminalOutcomeUrl)};
      initializeExitHandler(() => '/tmp/issue-2117-error-handler.log', async message => console.log(message));
      confirmPullRequestMerged({ owner: 'link-foundation', repo: 'use-m', prNumber: 69 });
      const handler = createUncaughtExceptionHandler({
        log: async message => console.log(message),
        cleanErrorMessage: error => error.message,
        absoluteLogPath: '/tmp/issue-2117-error-handler.log',
        shouldAttachLogs: true,
        argv: { autoClosePullRequestOnFail: true },
        global: { createdPR: { number: 69 } },
        owner: 'link-foundation',
        repo: 'use-m',
        getLogFile: () => '/tmp/issue-2117-error-handler.log',
        attachLogToGitHub: async () => {
          console.log('FAILURE_SIDE_EFFECT');
          return true;
        },
        sanitizeLogContent: value => value,
        cleanupContext: {},
        $: async () => {
          console.log('FAILURE_SIDE_EFFECT');
          return { exitCode: 0 };
        },
      });
      await handler(new Error('simulated late exception'));
    `,
  ],
  { encoding: 'utf8' }
);
assert(guardedErrorHandlerChild.status === 0, 'A real post-merge uncaught-exception handler preserves process success');
assert(!guardedErrorHandlerChild.stdout.includes('FAILURE_SIDE_EFFECT'), 'Post-merge exceptions skip failure log attachment and PR auto-close side effects');

const failedDiagnosticLogChild = spawnSync(
  process.execPath,
  [
    '--input-type=module',
    '--eval',
    `
      import { initializeExitHandler } from ${JSON.stringify(exitHandlerUrl)};
      import { createUnhandledRejectionHandler } from ${JSON.stringify(errorHandlersUrl)};
      import { confirmPullRequestMerged } from ${JSON.stringify(terminalOutcomeUrl)};
      const failedLog = async () => { throw new Error('simulated diagnostic log failure'); };
      initializeExitHandler(() => '/tmp/issue-2117-failed-log.log', failedLog);
      confirmPullRequestMerged({ owner: 'link-foundation', repo: 'use-m', prNumber: 69 });
      const handler = createUnhandledRejectionHandler({
        log: failedLog,
        cleanErrorMessage: error => error.message,
        absoluteLogPath: '/tmp/issue-2117-failed-log.log',
      });
      await handler(new Error('simulated late rejection'));
    `,
  ],
  { encoding: 'utf8' }
);
assert(failedDiagnosticLogChild.status === 0, 'A failed diagnostic logger cannot restore exit 1 after a confirmed merge');

const autoMergeSource = fs.readFileSync(new URL('../src/solve.auto-merge.lib.mjs', import.meta.url), 'utf8');
assert(autoMergeSource.match(/confirmPullRequestMerged\(\{/g)?.length === 4, 'Every merge-success and already-merged branch records the durable outcome');
const mergeSuccessBranch = autoMergeSource.slice(autoMergeSource.indexOf('if (mergeResult.success)'));
assert(mergeSuccessBranch.indexOf('confirmPullRequestMerged(') < mergeSuccessBranch.indexOf("await log(formatAligned('🎉', 'PR MERGED SUCCESSFULLY!'"), 'The durable merge outcome is latched before post-merge logging or housekeeping can throw');

const solveSource = fs.readFileSync(new URL('../src/solve.mjs', import.meta.url), 'utf8');
assert(solveSource.includes('installGlobalExitHandlers({ handleProcessErrors: false })'), 'solve does not install a second pair of racing process-error handlers');

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

resetTerminalOutcomeForTests();
printSummary();
if (getFailCount() > 0) process.exit(1);
