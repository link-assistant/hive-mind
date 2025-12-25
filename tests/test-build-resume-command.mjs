#!/usr/bin/env node

/**
 * Test suite for command builder functions in claude.command-builder.lib.mjs
 * Tests that the Claude CLI resume and initial commands are generated correctly
 * using the (cd ... && claude ...) pattern
 *
 * Related issue: https://github.com/link-assistant/hive-mind/issues/942
 *
 * Note: These command builders are specifically designed for Claude CLI (--tool claude)
 * and are placed in the claude.command-builder.lib.mjs file as per user requirements.
 */

import { buildClaudeResumeCommand, buildClaudeInitialCommand, isClaudeTool, getDefaultModelForTool } from '../src/claude.command-builder.lib.mjs';

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

// === buildClaudeResumeCommand tests ===

runTest('buildClaudeResumeCommand: generates command with (cd ... && claude --resume ...) pattern', () => {
  const cmd = buildClaudeResumeCommand({
    tempDir: '/tmp/gh-issue-solver-1234567890',
    sessionId: 'abc123-def456-ghi789',
  });

  assertEqual(cmd, '(cd "/tmp/gh-issue-solver-1234567890" && claude --resume abc123-def456-ghi789)', 'Should generate exact command pattern');
});

runTest('buildClaudeResumeCommand: contains cd command', () => {
  const cmd = buildClaudeResumeCommand({
    tempDir: '/tmp/gh-issue-solver-1234567890',
    sessionId: 'abc123',
  });

  assertContains(cmd, 'cd ', 'Should contain cd command');
});

runTest('buildClaudeResumeCommand: contains quoted tempDir', () => {
  const cmd = buildClaudeResumeCommand({
    tempDir: '/tmp/gh-issue-solver-1234567890',
    sessionId: 'abc123',
  });

  assertContains(cmd, '"/tmp/gh-issue-solver-1234567890"', 'Should contain quoted tempDir');
});

runTest('buildClaudeResumeCommand: contains claude --resume', () => {
  const cmd = buildClaudeResumeCommand({
    tempDir: '/tmp/gh-issue-solver-1234567890',
    sessionId: 'abc123',
  });

  assertContains(cmd, 'claude --resume', 'Should contain claude --resume');
});

runTest('buildClaudeResumeCommand: contains session ID', () => {
  const cmd = buildClaudeResumeCommand({
    tempDir: '/tmp/gh-issue-solver-1234567890',
    sessionId: '4c549ec6-3204-4312-b8e2-5f04113b2f86',
  });

  assertContains(cmd, '4c549ec6-3204-4312-b8e2-5f04113b2f86', 'Should contain session ID');
});

runTest('buildClaudeResumeCommand: uses subshell parentheses', () => {
  const cmd = buildClaudeResumeCommand({
    tempDir: '/tmp/gh-issue-solver-1234567890',
    sessionId: 'abc123',
  });

  assertTrue(cmd.startsWith('('), 'Should start with opening parenthesis');
  assertTrue(cmd.endsWith(')'), 'Should end with closing parenthesis');
});

runTest('buildClaudeResumeCommand: uses && to chain commands', () => {
  const cmd = buildClaudeResumeCommand({
    tempDir: '/tmp/gh-issue-solver-1234567890',
    sessionId: 'abc123',
  });

  assertContains(cmd, ' && ', 'Should contain && to chain commands');
});

runTest('buildClaudeResumeCommand: handles paths with spaces', () => {
  const cmd = buildClaudeResumeCommand({
    tempDir: '/tmp/path with spaces/work-dir',
    sessionId: 'abc123',
  });

  assertContains(cmd, '"/tmp/path with spaces/work-dir"', 'Should properly quote path with spaces');
});

// === buildClaudeInitialCommand tests ===

runTest('buildClaudeInitialCommand: generates command with (cd ... && claude ...) pattern', () => {
  const cmd = buildClaudeInitialCommand({
    tempDir: '/tmp/gh-issue-solver-1234567890',
  });

  assertContains(cmd, '(cd "/tmp/gh-issue-solver-1234567890" && claude ', 'Should generate correct pattern');
  assertNotContains(cmd, '--resume', 'Should NOT contain --resume');
});

runTest('buildClaudeInitialCommand: includes default output format', () => {
  const cmd = buildClaudeInitialCommand({
    tempDir: '/tmp/gh-issue-solver-1234567890',
  });

  assertContains(cmd, '--output-format stream-json', 'Should include --output-format stream-json');
});

runTest('buildClaudeInitialCommand: includes dangerously-skip-permissions', () => {
  const cmd = buildClaudeInitialCommand({
    tempDir: '/tmp/gh-issue-solver-1234567890',
  });

  assertContains(cmd, '--dangerously-skip-permissions', 'Should include --dangerously-skip-permissions');
});

runTest('buildClaudeInitialCommand: includes verbose when set', () => {
  const cmd = buildClaudeInitialCommand({
    tempDir: '/tmp/gh-issue-solver-1234567890',
    verbose: true,
  });

  assertContains(cmd, '--verbose', 'Should include --verbose');
});

runTest('buildClaudeInitialCommand: does not include verbose when false', () => {
  const cmd = buildClaudeInitialCommand({
    tempDir: '/tmp/gh-issue-solver-1234567890',
    verbose: false,
  });

  assertNotContains(cmd, '--verbose', 'Should NOT include --verbose when false');
});

runTest('buildClaudeInitialCommand: includes model when specified', () => {
  const cmd = buildClaudeInitialCommand({
    tempDir: '/tmp/gh-issue-solver-1234567890',
    model: 'claude-opus-4-5-20251101',
  });

  assertContains(cmd, '--model claude-opus-4-5-20251101', 'Should include --model');
});

runTest('buildClaudeInitialCommand: uses custom claude path', () => {
  const cmd = buildClaudeInitialCommand({
    tempDir: '/tmp/gh-issue-solver-1234567890',
    claudePath: '/usr/local/bin/claude',
  });

  assertContains(cmd, '/usr/local/bin/claude', 'Should use custom claude path');
});

// === isClaudeTool tests ===

runTest('isClaudeTool: returns true for claude tool', () => {
  const result = isClaudeTool({ tool: 'claude' });
  assertTrue(result, 'Should return true for claude tool');
});

runTest('isClaudeTool: returns true when tool is undefined (defaults to claude)', () => {
  const result = isClaudeTool({});
  assertTrue(result, 'Should return true when tool is undefined');
});

runTest('isClaudeTool: returns false for non-claude tools', () => {
  const opencode = isClaudeTool({ tool: 'opencode' });
  const codex = isClaudeTool({ tool: 'codex' });
  const agent = isClaudeTool({ tool: 'agent' });

  assertTrue(!opencode, 'Should return false for opencode');
  assertTrue(!codex, 'Should return false for codex');
  assertTrue(!agent, 'Should return false for agent');
});

// === getDefaultModelForTool tests ===

runTest('getDefaultModelForTool: returns sonnet for claude', () => {
  assertEqual(getDefaultModelForTool('claude'), 'sonnet', 'Claude default model should be sonnet');
});

runTest('getDefaultModelForTool: returns grok-code-fast-1 for opencode', () => {
  assertEqual(getDefaultModelForTool('opencode'), 'grok-code-fast-1', 'OpenCode default model should be grok-code-fast-1');
});

runTest('getDefaultModelForTool: returns gpt-5 for codex', () => {
  assertEqual(getDefaultModelForTool('codex'), 'gpt-5', 'Codex default model should be gpt-5');
});

runTest('getDefaultModelForTool: returns grok-code for agent', () => {
  assertEqual(getDefaultModelForTool('agent'), 'grok-code', 'Agent default model should be grok-code');
});

runTest('getDefaultModelForTool: returns sonnet for undefined tool', () => {
  assertEqual(getDefaultModelForTool(undefined), 'sonnet', 'Undefined tool should default to sonnet');
});

// === Summary ===

console.log('\n' + '='.repeat(50));
console.log(`Test results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(50));

if (testsFailed > 0) {
  process.exit(1);
}
