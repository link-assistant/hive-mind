#!/usr/bin/env node

/**
 * Test suite for buildResumeCommand function in solve.results.lib.mjs
 * Tests that the resume command properly preserves all relevant options
 * Related issue: https://github.com/link-assistant/hive-mind/issues/942
 */

import { buildResumeCommand } from '../src/solve.results.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('\x1b[32m\u2713 PASSED\x1b[0m');
    testsPassed++;
  } catch (error) {
    console.log(`\x1b[31m\u2717 FAILED: ${error.message}\x1b[0m`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(`${message}: expected truthy value, got "${value}"`);
  }
}

function assertContains(haystack, needle, message) {
  if (!haystack.includes(needle)) {
    throw new Error(`${message}: expected "${haystack}" to contain "${needle}"`);
  }
}

function assertNotContains(haystack, needle, message) {
  if (haystack.includes(needle)) {
    throw new Error(`${message}: expected "${haystack}" to NOT contain "${needle}"`);
  }
}

// === Basic command structure tests ===

runTest('buildResumeCommand: generates basic command with session ID', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet' },
    shouldAttachLogs: false,
  });

  assertContains(cmd, 'solve.mjs', 'Should contain solve.mjs');
  assertContains(cmd, '"https://github.com/owner/repo/issues/123"', 'Should contain issue URL');
  assertContains(cmd, '--resume', 'Should contain --resume flag');
  assertContains(cmd, 'abc123', 'Should contain session ID');
});

runTest('buildResumeCommand: does not include default model (sonnet for claude)', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet' },
    shouldAttachLogs: false,
  });

  assertNotContains(cmd, '--model', 'Should not include --model for default sonnet');
});

runTest('buildResumeCommand: includes non-default model', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'opus' },
    shouldAttachLogs: false,
  });

  assertContains(cmd, '--model opus', 'Should include --model opus');
});

// === Flag preservation tests ===

runTest('buildResumeCommand: includes --verbose when set', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet', verbose: true },
    shouldAttachLogs: false,
  });

  assertContains(cmd, '--verbose', 'Should include --verbose');
});

runTest('buildResumeCommand: does not include --verbose when false', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet', verbose: false },
    shouldAttachLogs: false,
  });

  assertNotContains(cmd, '--verbose', 'Should not include --verbose when false');
});

runTest('buildResumeCommand: includes --fork when set', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet', fork: true },
    shouldAttachLogs: false,
  });

  assertContains(cmd, '--fork', 'Should include --fork');
});

runTest('buildResumeCommand: includes --attach-logs from shouldAttachLogs param', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet' },
    shouldAttachLogs: true,
  });

  assertContains(cmd, '--attach-logs', 'Should include --attach-logs');
});

runTest('buildResumeCommand: includes --attach-logs from argv.attachLogs', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet', attachLogs: true },
    shouldAttachLogs: false,
  });

  assertContains(cmd, '--attach-logs', 'Should include --attach-logs from argv');
});

runTest('buildResumeCommand: includes --auto-continue-on-limit-reset when set', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet', autoContinueOnLimitReset: true },
    shouldAttachLogs: false,
  });

  assertContains(cmd, '--auto-continue-on-limit-reset', 'Should include --auto-continue-on-limit-reset');
});

runTest('buildResumeCommand: includes --no-auto-cleanup when autoCleanup is false', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet', autoCleanup: false },
    shouldAttachLogs: false,
  });

  assertContains(cmd, '--no-auto-cleanup', 'Should include --no-auto-cleanup');
});

runTest('buildResumeCommand: does not include --no-auto-cleanup when autoCleanup is true', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet', autoCleanup: true },
    shouldAttachLogs: false,
  });

  assertNotContains(cmd, '--no-auto-cleanup', 'Should not include --no-auto-cleanup when true');
  assertNotContains(cmd, '--auto-cleanup', 'Should not include --auto-cleanup flag at all');
});

runTest('buildResumeCommand: includes --watch when set', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet', watch: true },
    shouldAttachLogs: false,
  });

  assertContains(cmd, '--watch', 'Should include --watch');
});

runTest('buildResumeCommand: includes --think level when set', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet', think: 'high' },
    shouldAttachLogs: false,
  });

  assertContains(cmd, '--think high', 'Should include --think high');
});

runTest('buildResumeCommand: includes --auto-resume-on-errors when set', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet', autoResumeOnErrors: true },
    shouldAttachLogs: false,
  });

  assertContains(cmd, '--auto-resume-on-errors', 'Should include --auto-resume-on-errors');
});

runTest('buildResumeCommand: includes --auto-commit-uncommitted-changes when set', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet', autoCommitUncommittedChanges: true },
    shouldAttachLogs: false,
  });

  assertContains(cmd, '--auto-commit-uncommitted-changes', 'Should include --auto-commit-uncommitted-changes');
});

// === Tool-specific tests ===

runTest('buildResumeCommand: does not include --tool for default (claude)', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'claude', model: 'sonnet' },
    shouldAttachLogs: false,
  });

  assertNotContains(cmd, '--tool', 'Should not include --tool for default claude');
});

runTest('buildResumeCommand: includes --tool for non-default tool', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'opencode', model: 'grok-code-fast-1' },
    shouldAttachLogs: false,
  });

  assertContains(cmd, '--tool opencode', 'Should include --tool opencode');
});

runTest('buildResumeCommand: uses correct default model for opencode', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'opencode', model: 'grok-code-fast-1' },
    shouldAttachLogs: false,
  });

  assertNotContains(cmd, '--model', 'Should not include --model for default opencode model');
});

runTest('buildResumeCommand: includes non-default model for opencode', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: { tool: 'opencode', model: 'grok' },
    shouldAttachLogs: false,
  });

  assertContains(cmd, '--model grok', 'Should include --model grok for non-default');
});

// === Complex command with multiple options ===

runTest('buildResumeCommand: preserves all options in complex scenario', () => {
  const cmd = buildResumeCommand({
    issueUrl: 'https://github.com/owner/repo/issues/123',
    sessionId: 'abc123',
    argv: {
      tool: 'claude',
      model: 'opus',
      verbose: true,
      fork: true,
      watch: true,
      think: 'max',
      autoCleanup: false,
      autoContinueOnLimitReset: true,
      autoResumeOnErrors: true,
    },
    shouldAttachLogs: true,
  });

  assertContains(cmd, 'solve.mjs', 'Should contain solve.mjs');
  assertContains(cmd, '--resume abc123', 'Should contain resume flag');
  assertContains(cmd, '--model opus', 'Should contain non-default model');
  assertContains(cmd, '--verbose', 'Should contain verbose');
  assertContains(cmd, '--fork', 'Should contain fork');
  assertContains(cmd, '--attach-logs', 'Should contain attach-logs');
  assertContains(cmd, '--watch', 'Should contain watch');
  assertContains(cmd, '--think max', 'Should contain think level');
  assertContains(cmd, '--no-auto-cleanup', 'Should contain no-auto-cleanup');
  assertContains(cmd, '--auto-continue-on-limit-reset', 'Should contain auto-continue');
  assertContains(cmd, '--auto-resume-on-errors', 'Should contain auto-resume');
});

// === Summary ===

console.log('\n' + '='.repeat(50));
console.log(`Test results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(50));

if (testsFailed > 0) {
  process.exit(1);
}
