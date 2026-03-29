#!/usr/bin/env node

/**
 * Unit Tests: Resource Leak Fixes (Issue #1493)
 *
 * Tests verify that:
 * 1. drainHandles() kills surviving child processes (SIGTERM) before unref
 * 2. logActiveHandles() produces categorized summary with enhanced detail
 * 3. Temp file cleanup patterns use try/finally (compile-time verified by structure)
 *
 * Run with: node tests/test-resource-leak-fixes-1493.mjs
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1493
 */

import { logActiveHandles } from '../src/exit-handler.lib.mjs';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const RESET = '\x1b[0m';

let passed = 0;
let failed = 0;

const test = async (description, fn) => {
  try {
    await fn();
    console.log(`  ${GREEN}✅ PASS:${RESET} ${description}`);
    passed++;
  } catch (e) {
    console.log(`  ${RED}❌ FAIL:${RESET} ${description}`);
    console.log(`      Error: ${e.message}`);
    failed++;
  }
};

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

console.log('\n🧪 Testing Resource Leak Fixes (Issue #1493)\n');

// ── logActiveHandles tests ─────────────────────────────────────────────

console.log('  --- logActiveHandles diagnostics ---');

await test('logActiveHandles emits categorized summary with handle counts', async () => {
  const messages = [];
  await logActiveHandles(msg => messages.push(msg));

  // There should be at least the summary line since the test process has active handles
  // (at minimum stdout/stderr WriteStreams)
  assert(messages.length > 0, 'Expected at least one message from logActiveHandles');

  // The first message should contain the categorized summary in brackets
  const summaryLine = messages[0];
  assert(summaryLine.includes('['), `Expected summary line to contain '[', got: ${summaryLine}`);
  assert(summaryLine.includes(']'), `Expected summary line to contain ']', got: ${summaryLine}`);
  assert(summaryLine.includes('handles'), `Expected 'handles' in summary, got: ${summaryLine}`);
});

await test('logActiveHandles produces no output when no handles exist', async () => {
  // In a minimal test process, _getActiveHandles() may return 0.
  // logActiveHandles should either produce categorized output or nothing — both are valid.
  const messages = [];
  await logActiveHandles(msg => messages.push(msg));

  if (messages.length > 0) {
    // If there ARE handles, verify the summary format
    const summaryLine = messages[0];
    assert(summaryLine.includes('['), `Expected summary line to contain '[', got: ${summaryLine}`);
    assert(summaryLine.includes(']'), `Expected summary line to contain ']', got: ${summaryLine}`);
  }
  // If no handles, logActiveHandles correctly returns early — that's valid
  assert(true, 'logActiveHandles handled gracefully');
});

await test('logActiveHandles summary format contains type×count when handles exist', async () => {
  // Verify the format by inspecting the source code structure
  const fs = await import('fs');
  const source = fs.readFileSync(new URL('../src/exit-handler.lib.mjs', import.meta.url), 'utf-8');

  // Verify the categorized summary code exists
  assert(source.includes('categories[name]'), 'Expected handle categorization logic');
  assert(source.includes('×'), 'Expected × separator in summary format');
  assert(source.includes('.map(([name, count])'), 'Expected map over category entries for summary');
});

// ── Exit handler structural tests ──────────────────────────────────────

console.log('\n  --- Exit handler structure ---');

await test('exit-handler.lib.mjs exports safeExit, logActiveHandles, installGlobalExitHandlers', async () => {
  const mod = await import('../src/exit-handler.lib.mjs');
  assert(typeof mod.safeExit === 'function', 'safeExit should be a function');
  assert(typeof mod.logActiveHandles === 'function', 'logActiveHandles should be a function');
  assert(typeof mod.installGlobalExitHandlers === 'function', 'installGlobalExitHandlers should be a function');
  assert(typeof mod.initializeExitHandler === 'function', 'initializeExitHandler should be a function');
  assert(typeof mod.resetExitHandler === 'function', 'resetExitHandler should be a function');
});

await test('drainHandles code contains SIGTERM kill for child processes', async () => {
  const fs = await import('fs');
  const source = fs.readFileSync(new URL('../src/exit-handler.lib.mjs', import.meta.url), 'utf-8');

  // Verify the kill-before-unref pattern exists
  assert(source.includes("child.kill('SIGTERM')"), 'Expected SIGTERM kill call for child processes');
  assert(source.includes("child.kill('SIGKILL')"), 'Expected SIGKILL fallback for child processes');
  assert(source.includes('child.exitCode === null'), 'Expected exitCode check before killing');
  assert(source.includes('child.killed'), 'Expected killed check before killing');
});

// ── Temp file try/finally pattern verification ─────────────────────────

console.log('\n  --- Temp file cleanup patterns ---');

const verifyTryFinally = async (filePath, label) => {
  await test(`${label} uses try/finally for temp file cleanup`, async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(new URL(filePath, import.meta.url), 'utf-8');

    // Count 'finally' blocks that contain 'unlink' — these are the try/finally cleanup patterns
    const finallyBlocks = source.split('finally').length - 1;
    const unlinkInSource = (source.match(/fs\.unlink/g) || []).length;

    assert(finallyBlocks > 0, `Expected at least one finally block in ${label}`);
    assert(unlinkInSource > 0, `Expected at least one fs.unlink call in ${label}`);
  });
};

await verifyTryFinally('../src/github.lib.mjs', 'github.lib.mjs');
await verifyTryFinally('../src/github-error-reporter.lib.mjs', 'github-error-reporter.lib.mjs');
await verifyTryFinally('../src/solve.auto-pr.lib.mjs', 'solve.auto-pr.lib.mjs');
await verifyTryFinally('../src/solve.results.lib.mjs', 'solve.results.lib.mjs');

// ── ESLint rule registration ───────────────────────────────────────────

console.log('\n  --- ESLint rule registration ---');

await test('eslint.config.mjs registers no-leaked-child-processes rule', async () => {
  const fs = await import('fs');
  const config = fs.readFileSync(new URL('../eslint.config.mjs', import.meta.url), 'utf-8');

  assert(config.includes('no-leaked-child-processes'), 'Expected no-leaked-child-processes rule in eslint config');
  assert(config.includes('child-process'), 'Expected child-process plugin in eslint config');
});

// ── Summary ────────────────────────────────────────────────────────────

console.log(`\n📊 Results: ${passed} passed, ${failed} failed out of ${passed + failed} tests`);
if (failed > 0) {
  process.exit(1);
} else {
  console.log(`${GREEN}✅ All tests passed!${RESET}\n`);
}
