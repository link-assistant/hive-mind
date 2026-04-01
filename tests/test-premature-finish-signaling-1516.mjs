#!/usr/bin/env node

/**
 * Tests for issue #1516: Premature finish signaling and leaked child processes
 *
 * Verifies that:
 * 1. Process group kill is used on stream timeout (not just parent PID)
 * 2. .gitkeep cleanup runs AFTER completion signals (verifyResults, auto-merge)
 * 3. drainHandles kills surviving child processes instead of just unreffing them
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  \u2705 PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  \u274c FAIL: ${testName}`);
    if (details) console.log(`     ${details}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 1: Process group kill on stream timeout
// ═══════════════════════════════════════════════════════════════════
console.log('\n\ud83e\uddea Test Suite 1: Process group kill on stream timeout (Issue #1516)');
console.log('\u2500'.repeat(60));

{
  const claudeLibContent = await readFile(join(__dirname, '..', 'src', 'claude.lib.mjs'), 'utf-8');

  // Test: killProcessTree helper exists
  assert(claudeLibContent.includes('const killProcessTree'), 'killProcessTree helper function exists in claude.lib.mjs', 'Expected a killProcessTree helper for process group killing');

  // Test: Process group kill uses negative PID
  assert(claudeLibContent.includes('process.kill(-pid'), 'killProcessTree sends signal to negative PID (process group)', 'Expected process.kill(-pid, signal) for process group kill');

  // Test: forceExitOnTimeout uses killProcessTree instead of direct execCommand.kill
  const forceExitSection = claudeLibContent.substring(claudeLibContent.indexOf('const forceExitOnTimeout'), claudeLibContent.indexOf('// Issue #1472'));
  assert(forceExitSection.includes("killProcessTree('SIGTERM')"), 'forceExitOnTimeout uses killProcessTree for SIGTERM', "Expected killProcessTree('SIGTERM') in forceExitOnTimeout");

  assert(forceExitSection.includes("killProcessTree('SIGKILL')"), 'forceExitOnTimeout uses killProcessTree for SIGKILL follow-up', "Expected killProcessTree('SIGKILL') in the 5-second follow-up timeout");

  // Test: Issue #1516 comment present
  assert(claudeLibContent.includes('Issue #1516'), 'claude.lib.mjs references Issue #1516 in comments');

  // Test: killProcessTree has fallback to execCommand.kill
  assert(claudeLibContent.includes('execCommand.kill(signal)'), 'killProcessTree falls back to execCommand.kill when process group kill fails', 'Expected fallback: execCommand.kill(signal)');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 2: .gitkeep cleanup ordering in solve.mjs
// ═══════════════════════════════════════════════════════════════════
console.log('\n\ud83e\uddea Test Suite 2: .gitkeep cleanup ordering (Issue #1516)');
console.log('\u2500'.repeat(60));

{
  const solveMjsContent = await readFile(join(__dirname, '..', 'src', 'solve.mjs'), 'utf-8');

  // Test: cleanupClaudeFile is called AFTER verifyResults
  const verifyResultsPos = solveMjsContent.indexOf('const verifyResult = await verifyResults(');
  const autoMergePos = solveMjsContent.indexOf('startAutoRestartUntilMergeable(');
  const endWorkSessionPos = solveMjsContent.indexOf('await endWorkSession(');

  // Find the cleanupClaudeFile call that uses claudeCommitHash (the main cleanup)
  const mainCleanupPattern = 'await cleanupClaudeFile(tempDir, branchName, claudeCommitHash, argv)';
  const mainCleanupPos = solveMjsContent.indexOf(mainCleanupPattern);

  assert(mainCleanupPos > 0, 'Main cleanupClaudeFile call exists in solve.mjs', `Expected pattern: ${mainCleanupPattern}`);

  assert(mainCleanupPos > verifyResultsPos, 'cleanupClaudeFile runs AFTER verifyResults', `cleanupClaudeFile at pos ${mainCleanupPos}, verifyResults at pos ${verifyResultsPos}`);

  assert(mainCleanupPos > autoMergePos, 'cleanupClaudeFile runs AFTER startAutoRestartUntilMergeable', `cleanupClaudeFile at pos ${mainCleanupPos}, autoMerge at pos ${autoMergePos}`);

  assert(mainCleanupPos < endWorkSessionPos, 'cleanupClaudeFile runs BEFORE endWorkSession', `cleanupClaudeFile at pos ${mainCleanupPos}, endWorkSession at pos ${endWorkSessionPos}`);

  // Test: Comment explains the reason for the ordering
  assert(solveMjsContent.includes('cleanupClaudeFile() moved to after completion signals'), 'Comment explains why cleanupClaudeFile was moved (Issue #1516)', 'Expected a comment explaining the ordering change');

  // Test: No cleanupClaudeFile call between showSessionSummary and verifyResults
  const sessionSummaryPos = solveMjsContent.indexOf('await showSessionSummary(');
  const sectionBetween = solveMjsContent.substring(sessionSummaryPos, verifyResultsPos);
  assert(!sectionBetween.includes('await cleanupClaudeFile(tempDir, branchName, claudeCommitHash'), 'No cleanupClaudeFile(claudeCommitHash) between showSessionSummary and verifyResults', 'cleanupClaudeFile should NOT run before verifyResults to avoid premature new commits');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 3: drainHandles kills child processes
// ═══════════════════════════════════════════════════════════════════
console.log('\n\ud83e\uddea Test Suite 3: drainHandles kills child processes (Issue #1516)');
console.log('\u2500'.repeat(60));

{
  const exitHandlerContent = await readFile(join(__dirname, '..', 'src', 'exit-handler.lib.mjs'), 'utf-8');

  // Find the section that handles ChildProcess in drainHandles
  const childProcessSection = exitHandlerContent.substring(exitHandlerContent.indexOf('// 3.'), exitHandlerContent.indexOf('// 4.'));

  // Test: drainHandles sends SIGTERM to child processes
  assert(childProcessSection.includes("handle.kill('SIGTERM')"), 'drainHandles sends SIGTERM to surviving child processes', "Expected handle.kill('SIGTERM') in child process handling");

  // Test: drainHandles still calls .unref() after kill
  assert(childProcessSection.includes('handle.unref()'), 'drainHandles still calls .unref() after killing child processes', 'Expected handle.unref() to still be called');

  // Test: drainHandles checks if process is already killed
  assert(childProcessSection.includes('!handle.killed'), 'drainHandles checks handle.killed before sending SIGTERM', 'Expected !handle.killed guard to avoid killing already-dead processes');

  // Test: Issue #1516 comment present
  assert(exitHandlerContent.includes('Issue #1516'), 'exit-handler.lib.mjs references Issue #1516 in comments');
}

// ═══════════════════════════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════════════════════════
console.log('\n' + '\u2500'.repeat(60));
console.log(`\ud83c\udfc1 Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}
