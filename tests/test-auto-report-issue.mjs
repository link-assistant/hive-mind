#!/usr/bin/env node

/**
 * Test suite for --auto-report-issue and issue-creation disable flags
 * (issues #1484, #1752)
 * Tests the error reporting behavior with different flag combinations
 */

import { handleErrorWithIssueCreation, formatLogForIssue, createIssueForError } from '../src/github-error-reporter.lib.mjs';
import { SOLVE_OPTION_DEFINITIONS, parseArguments } from '../src/solve.config.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

async function runAsyncTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message || 'Assertion failed');
  }
}

async function parseSolveArgs(args) {
  const originalArgv = process.argv;
  try {
    process.argv = ['node', 'solve.mjs', ...args];
    return await parseArguments();
  } finally {
    process.argv = originalArgv;
  }
}

console.log('🧪 Auto Report Issue Tests (Issue #1484)\n');

// === Test --disable-report-issue flag ===

await runAsyncTest('--disable-report-issue: returns null without creating issue', async () => {
  const result = await handleErrorWithIssueCreation({
    error: new Error('test error'),
    errorType: 'execution',
    logFile: null,
    context: {},
    skipPrompt: false,
    autoReport: false,
    disableReport: true,
  });
  assert(result === null, 'Should return null when disableReport is true');
});

await runAsyncTest('--disable-report-issue overrides --auto-report-issue', async () => {
  const result = await handleErrorWithIssueCreation({
    error: new Error('test error'),
    errorType: 'execution',
    logFile: null,
    context: {},
    skipPrompt: false,
    autoReport: true,
    disableReport: true,
  });
  assert(result === null, 'Should return null when both autoReport and disableReport are true');
});

// === Test default behavior (no flags) ===

await runAsyncTest('default: non-TTY returns null without prompt', async () => {
  // In test environment, stdin is typically not a TTY
  const result = await handleErrorWithIssueCreation({
    error: new Error('test error'),
    errorType: 'execution',
    logFile: null,
    context: {},
    skipPrompt: false,
    autoReport: false,
    disableReport: false,
  });
  assert(result === null, 'Should return null in non-TTY mode');
});

await runAsyncTest('default: skipPrompt returns null', async () => {
  const result = await handleErrorWithIssueCreation({
    error: new Error('test error'),
    errorType: 'execution',
    logFile: null,
    context: {},
    skipPrompt: true,
    autoReport: false,
    disableReport: false,
  });
  assert(result === null, 'Should return null when skipPrompt is true');
});

// === Test SOLVE_OPTION_DEFINITIONS ===

runTest('CLI option definitions include auto-report-issue', async () => {
  assert(SOLVE_OPTION_DEFINITIONS['auto-report-issue'], 'auto-report-issue should be defined');
  assert(SOLVE_OPTION_DEFINITIONS['auto-report-issue'].type === 'boolean', 'auto-report-issue should be boolean');
  assert(SOLVE_OPTION_DEFINITIONS['auto-report-issue'].default === false, 'auto-report-issue should default to false');
});

runTest('CLI option definitions include disable-report-issue', async () => {
  assert(SOLVE_OPTION_DEFINITIONS['disable-report-issue'], 'disable-report-issue should be defined');
  assert(SOLVE_OPTION_DEFINITIONS['disable-report-issue'].type === 'boolean', 'disable-report-issue should be boolean');
  assert(SOLVE_OPTION_DEFINITIONS['disable-report-issue'].default === false, 'disable-report-issue should default to false');
});

runTest('CLI option definitions include disable-issue-auto-creation-on-error', () => {
  assert(SOLVE_OPTION_DEFINITIONS['disable-issue-auto-creation-on-error'], 'disable-issue-auto-creation-on-error should be defined');
  assert(SOLVE_OPTION_DEFINITIONS['disable-issue-auto-creation-on-error'].type === 'boolean', 'disable-issue-auto-creation-on-error should be boolean');
  assert(SOLVE_OPTION_DEFINITIONS['disable-issue-auto-creation-on-error'].default === false, 'disable-issue-auto-creation-on-error should default to false');
});

await runAsyncTest('--disable-issue-auto-creation-on-error normalizes to disabled error issue creation', async () => {
  const argv = await parseSolveArgs(['https://github.com/link-assistant/hive-mind/issues/1752', '--disable-issue-auto-creation-on-error']);
  assert(argv.disableIssueAutoCreationOnError === true, 'disableIssueAutoCreationOnError should be true');
  assert(argv.disableReportIssue === true, 'disableReportIssue should be true after normalization');
});

await runAsyncTest('--disable-issue-auto-creation-on-error overrides --auto-report-issue at parse time', async () => {
  const argv = await parseSolveArgs(['https://github.com/link-assistant/hive-mind/issues/1752', '--auto-report-issue', '--disable-issue-auto-creation-on-error']);
  assert(argv.autoReportIssue === true, 'autoReportIssue should still reflect the CLI flag');
  assert(argv.disableReportIssue === true, 'disableReportIssue should be true so disable wins in the handler');
});

// === Test formatLogForIssue ===

await runAsyncTest('formatLogForIssue: inline for small logs', async () => {
  const result = await formatLogForIssue('small log content', '/tmp/test.log');
  assert(result.method === 'inline', 'Small logs should be inline');
  assert(result.content.includes('small log content'), 'Content should include log text');
});

// === Summary ===
console.log(`\n📊 Results: ${testsPassed} passed, ${testsFailed} failed out of ${testsPassed + testsFailed} tests`);

if (testsFailed > 0) {
  process.exit(1);
}
