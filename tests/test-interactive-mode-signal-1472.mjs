#!/usr/bin/env node

/**
 * Tests for issue #1472/#1475: Stuck Claude CLI streaming and interactive mode
 *
 * Verifies that:
 * 1. Stream startup timeout is properly configured in config.lib.mjs
 * 2. The timeout is configurable via environment variable
 * 3. claude.lib.mjs contains the startup timeout implementation
 * 4. Interactive mode handler is still correctly created in claude.lib.mjs
 * 5. validateInteractiveModeConfig remains exported (used by claude.lib.mjs internally)
 */

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));

let passed = 0;
let failed = 0;

function assert(condition, testName, details = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${testName}`);
    passed++;
  } else {
    console.log(`  ❌ FAIL: ${testName}`);
    if (details) console.log(`     ${details}`);
    failed++;
  }
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 1: Stream startup timeout configuration
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 1: Stream startup timeout configuration');
console.log('─'.repeat(60));

{
  const configLib = await import(join(__dirname, '..', 'src', 'config.lib.mjs'));

  // Test: timeouts.streamStartupMs exists
  assert(typeof configLib.timeouts.streamStartupMs === 'number', 'timeouts.streamStartupMs is a number', `Got: ${typeof configLib.timeouts.streamStartupMs}`);

  // Test: Default value is 120000ms (2 minutes)
  assert(configLib.timeouts.streamStartupMs === 120000, 'Default streamStartupMs is 120000ms (2 minutes)', `Got: ${configLib.timeouts.streamStartupMs}`);

  // Test: resultStreamCloseMs still exists (Issue #1280)
  assert(typeof configLib.timeouts.resultStreamCloseMs === 'number', 'resultStreamCloseMs still exists (Issue #1280)', `Got: ${typeof configLib.timeouts.resultStreamCloseMs}`);
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 2: claude.lib.mjs contains startup timeout implementation
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 2: claude.lib.mjs startup timeout implementation');
console.log('─'.repeat(60));

{
  const claudeLibContent = await readFile(join(__dirname, '..', 'src', 'claude.lib.mjs'), 'utf-8');

  // Test: Startup timeout variables declared
  assert(claudeLibContent.includes('firstChunkReceived'), 'claude.lib.mjs declares firstChunkReceived tracking variable');

  assert(claudeLibContent.includes('streamStartupMs'), 'claude.lib.mjs uses streamStartupMs from timeouts config');

  assert(claudeLibContent.includes('startupTimeoutId'), 'claude.lib.mjs declares startupTimeoutId for timeout management');

  // Test: Startup timeout is set with setTimeout
  assert(claudeLibContent.includes('startupTimeoutId = setTimeout'), 'claude.lib.mjs sets startup timeout via setTimeout');

  // Test: Startup timeout is cleared on first chunk
  assert(claudeLibContent.includes('clearTimeout(startupTimeoutId)'), 'claude.lib.mjs clears startup timeout when first chunk received');

  // Test: References Issue #1472/#1475
  assert(claudeLibContent.includes('Issue #1472/#1475'), 'claude.lib.mjs references Issue #1472/#1475 in comments');

  // Test: Calls forceExitOnTimeout when stuck
  assert(claudeLibContent.includes('await forceExitOnTimeout()'), 'Startup timeout triggers forceExitOnTimeout when no output received');

  // Test: Still creates interactive handler when enabled
  assert(claudeLibContent.includes('createInteractiveHandler'), 'claude.lib.mjs still creates interactive handler when interactiveMode is enabled');

  // Test: Interactive handler processes events in stream loop
  assert(claudeLibContent.includes('interactiveHandler.processEvent'), 'claude.lib.mjs still calls interactiveHandler.processEvent for stream events');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 2b: Startup timeout triggers retry logic (not just kill)
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 2b: Startup timeout retry integration');
console.log('─'.repeat(60));

{
  const claudeLibContent = await readFile(join(__dirname, '..', 'src', 'claude.lib.mjs'), 'utf-8');

  // Test: isStartupTimeout flag exists
  assert(claudeLibContent.includes('isStartupTimeout'), 'claude.lib.mjs declares isStartupTimeout flag for retry logic');

  // Test: isStartupTimeout is set when startup timeout fires
  assert(claudeLibContent.includes('isStartupTimeout = true'), 'isStartupTimeout is set to true when startup timeout fires');

  // Test: isStartupTimeout is included in transient error detection
  assert(claudeLibContent.includes('isStartupTimeout || isOverloadError'), 'isStartupTimeout is included in isTransientError condition for retry');

  // Test: Startup timeout uses shorter backoff (fresh start, not session resume)
  assert(claudeLibContent.includes('isStartupTimeout ? 30000'), 'Startup timeout uses 30s initial delay (shorter than API errors)');
  assert(claudeLibContent.includes('isStartupTimeout ? 120000'), 'Startup timeout uses 120s max delay');

  // Test: Startup timeout does NOT preserve session (no session to resume)
  assert(claudeLibContent.includes('!isStartupTimeout && sessionId'), 'Startup timeout skips session resume (no session created when stuck)');

  // Test: Startup timeout has distinct error label
  assert(claudeLibContent.includes('Stream startup timeout (Issue #1472/#1475)'), 'Startup timeout has distinct error label for logs');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 2c: Interactive mode status tracking (zero-comments detection)
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 2c: Interactive mode status tracking');
console.log('─'.repeat(60));

{
  const claudeLibContent = await readFile(join(__dirname, '..', 'src', 'claude.lib.mjs'), 'utf-8');

  // Test: First event logging for interactive mode
  assert(claudeLibContent.includes('_firstEventLogged'), 'claude.lib.mjs tracks first event received by interactive handler');

  // Test: Warning when zero events received
  assert(claudeLibContent.includes('No events received from Claude CLI'), 'claude.lib.mjs warns when interactive mode received zero events');

  // Test: First event log message
  assert(claudeLibContent.includes('First event received'), 'claude.lib.mjs logs when first interactive mode event arrives');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 3: Telegram bot does NOT have redundant interactive mode signal
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 3: Telegram bot signal reverted per reviewer');
console.log('─'.repeat(60));

{
  const telegramBotContent = await readFile(join(__dirname, '..', 'src', 'telegram-bot.mjs'), 'utf-8');

  // Test: No redundant interactive mode signal (reviewer feedback: options already show it)
  assert(!telegramBotContent.includes('Interactive mode: ENABLED'), 'Telegram bot does NOT contain redundant "Interactive mode: ENABLED" signal');

  // Test: Options display still exists
  assert(telegramBotContent.includes('Options:'), 'Telegram bot still displays user options (which include --interactive-mode when used)');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 4: solve.mjs does NOT call validateInteractiveModeConfig
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 4: solve.mjs reverted per reviewer');
console.log('─'.repeat(60));

{
  const solveMjsContent = await readFile(join(__dirname, '..', 'src', 'solve.mjs'), 'utf-8');

  // Test: solve.mjs does NOT import validateInteractiveModeConfig (reverted)
  assert(!solveMjsContent.includes('validateInteractiveModeConfig'), 'solve.mjs does NOT reference validateInteractiveModeConfig (reverted per reviewer)');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 5: validateInteractiveModeConfig still exported (used internally)
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 5: validateInteractiveModeConfig internal validation');
console.log('─'.repeat(60));

{
  const interactiveModeLib = await import(join(__dirname, '..', 'src', 'interactive-mode.lib.mjs'));

  // Test: Function is still exported
  assert(typeof interactiveModeLib.validateInteractiveModeConfig === 'function', 'validateInteractiveModeConfig is still exported as a function');

  // Test: Returns true when disabled
  const logs = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };
  const result = await interactiveModeLib.validateInteractiveModeConfig({ interactiveMode: false, tool: 'claude' }, mockLog);
  assert(result === true, 'Returns true when interactive mode is disabled');

  // Test: Returns true when enabled with claude
  const logs2 = [];
  const mockLog2 = msg => {
    logs2.push(msg);
    return Promise.resolve();
  };
  const result2 = await interactiveModeLib.validateInteractiveModeConfig({ interactiveMode: true, tool: 'claude' }, mockLog2);
  assert(result2 === true, 'Returns true when interactive mode is enabled with claude tool');

  // Test: isInteractiveModeSupported
  assert(typeof interactiveModeLib.isInteractiveModeSupported === 'function', 'isInteractiveModeSupported is exported');
  assert(interactiveModeLib.isInteractiveModeSupported('claude') === true, 'isInteractiveModeSupported returns true for claude');
  assert(interactiveModeLib.isInteractiveModeSupported('opencode') === false, 'isInteractiveModeSupported returns false for opencode');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 6: config.lib.mjs comment references
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 6: config.lib.mjs documentation');
console.log('─'.repeat(60));

{
  const configContent = await readFile(join(__dirname, '..', 'src', 'config.lib.mjs'), 'utf-8');

  // Test: Config documents the startup timeout
  assert(configContent.includes('HIVE_MIND_STREAM_STARTUP_MS'), 'Config references HIVE_MIND_STREAM_STARTUP_MS env variable');

  // Test: Config references Issue #1472/#1475
  assert(configContent.includes('Issue #1472/#1475'), 'Config references Issue #1472/#1475 for stream startup timeout');
}

// ═══════════════════════════════════════════════════════════════════
// Results
// ═══════════════════════════════════════════════════════════════════
console.log('\n' + '═'.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log('\n❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}
