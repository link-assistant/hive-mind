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

  // Test: isStartupTimeout is included in transient error detection (via isTimeoutRetry helper)
  assert(claudeLibContent.includes('isStartupTimeout || isActivityTimeout || isOverloadError'), 'isStartupTimeout and isActivityTimeout are included in isTransientError condition for retry');

  // Test: Timeout retry uses shorter backoff (fresh start for startup, session preserved for activity)
  assert(claudeLibContent.includes('isTimeoutRetry ? 30000'), 'Timeout retry uses 30s initial delay (shorter than API errors)');
  assert(claudeLibContent.includes('isTimeoutRetry ? 120000'), 'Timeout retry uses 120s max delay');

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
// Test Suite 7: Activity timeout configuration and implementation
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 7: Activity timeout (mid-session hang detection)');
console.log('─'.repeat(60));

{
  const configLib = await import(join(__dirname, '..', 'src', 'config.lib.mjs'));

  // Test: streamActivityMs exists
  assert(typeof configLib.timeouts.streamActivityMs === 'number', 'timeouts.streamActivityMs is a number', `Got: ${typeof configLib.timeouts.streamActivityMs}`);

  // Test: Default value is 300000ms (5 minutes)
  assert(configLib.timeouts.streamActivityMs === 300000, 'Default streamActivityMs is 300000ms (5 minutes)', `Got: ${configLib.timeouts.streamActivityMs}`);

  const claudeLibContent = await readFile(join(__dirname, '..', 'src', 'claude.lib.mjs'), 'utf-8');
  const configContent = await readFile(join(__dirname, '..', 'src', 'config.lib.mjs'), 'utf-8');

  // Test: Activity timeout variable declared
  assert(claudeLibContent.includes('activityTimeoutId'), 'claude.lib.mjs declares activityTimeoutId');
  assert(claudeLibContent.includes('isActivityTimeout'), 'claude.lib.mjs declares isActivityTimeout flag');

  // Test: Activity timeout reset on stdout
  assert(claudeLibContent.includes('resetActivityTimeout'), 'claude.lib.mjs has resetActivityTimeout helper');

  // Test: Activity timeout is included in transient error detection
  assert(claudeLibContent.includes('isActivityTimeout'), 'isActivityTimeout is used in transient error retry logic');

  // Test: Activity timeout has distinct error label
  assert(claudeLibContent.includes('Stream activity timeout (Issue #1472)'), 'Activity timeout has distinct error label');

  // Test: Activity timeout preserves session (unlike startup timeout)
  assert(claudeLibContent.includes('!isStartupTimeout && sessionId'), 'Activity timeout allows session resume (work was started)');

  // Test: Config references HIVE_MIND_STREAM_ACTIVITY_MS
  assert(configContent.includes('HIVE_MIND_STREAM_ACTIVITY_MS'), 'Config references HIVE_MIND_STREAM_ACTIVITY_MS env variable');

  // Test: Activity timeout cleanup
  assert(claudeLibContent.includes('clearTimeout(activityTimeoutId)'), 'Activity timeout is cleaned up after stream ends');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 8: Remaining buffer forwarded to interactive handler
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 8: Remaining buffer forwarded to interactive handler');
console.log('─'.repeat(60));

{
  const claudeLibContent = await readFile(join(__dirname, '..', 'src', 'claude.lib.mjs'), 'utf-8');

  // Test: Remaining buffer is forwarded to interactive handler
  assert(claudeLibContent.includes('Interactive mode error (remaining buffer)'), 'claude.lib.mjs forwards remaining buffer events to interactive handler');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 9: Interactive handler diagnostic counters
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 9: Interactive handler diagnostic counters');
console.log('─'.repeat(60));

{
  const interactiveModeContent = await readFile(join(__dirname, '..', 'src', 'interactive-mode.lib.mjs'), 'utf-8');

  // Test: Diagnostic counters exist in state
  assert(interactiveModeContent.includes('eventsProcessed:'), 'interactive-mode.lib.mjs has eventsProcessed counter');
  assert(interactiveModeContent.includes('commentsAttempted:'), 'interactive-mode.lib.mjs has commentsAttempted counter');
  assert(interactiveModeContent.includes('commentsPosted:'), 'interactive-mode.lib.mjs has commentsPosted counter');
  assert(interactiveModeContent.includes('commentsFailed:'), 'interactive-mode.lib.mjs has commentsFailed counter');
  assert(interactiveModeContent.includes('editsAttempted:'), 'interactive-mode.lib.mjs has editsAttempted counter');
  assert(interactiveModeContent.includes('editsSucceeded:'), 'interactive-mode.lib.mjs has editsSucceeded counter');
  assert(interactiveModeContent.includes('editsFailed:'), 'interactive-mode.lib.mjs has editsFailed counter');

  // Test: Events processed counter incremented in processEvent
  assert(interactiveModeContent.includes('state.eventsProcessed++'), 'processEvent increments eventsProcessed');

  // Test: Comments attempted counter incremented in postComment
  assert(interactiveModeContent.includes('state.commentsAttempted++'), 'postComment increments commentsAttempted');

  // Test: Comment failures are always logged (not just verbose)
  assert(interactiveModeContent.includes('state.commentsFailed++'), 'Failed comments increment commentsFailed counter');

  // Test: Edit counters exist
  assert(interactiveModeContent.includes('state.editsAttempted++'), 'editComment increments editsAttempted');
  assert(interactiveModeContent.includes('state.editsSucceeded++'), 'Successful edits increment editsSucceeded');
  assert(interactiveModeContent.includes('state.editsFailed++'), 'Failed edits increment editsFailed');
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 10: Interactive handler functional test — diagnostic counters
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 10: Interactive handler functional test — diagnostic counters');
console.log('─'.repeat(60));

{
  const { createInteractiveHandler } = await import(join(__dirname, '..', 'src', 'interactive-mode.lib.mjs'));

  const logs = [];
  const mockLog = async msg => logs.push(msg);

  // Mock execFile that fails (simulates GitHub API failure)
  const failingExecFile = async () => {
    throw new Error('gh: HTTP 400');
  };

  const handler = createInteractiveHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    log: mockLog,
    verbose: true,
    execFile: failingExecFile,
  });

  // Process a system.init event
  await handler.processEvent({ type: 'system', subtype: 'init', session_id: 'test-session', cwd: '/tmp', tools: [] });

  const state = handler.getState();

  // Test: eventsProcessed should be incremented
  assert(state.eventsProcessed === 1, 'eventsProcessed is 1 after processing one event', `Got: ${state.eventsProcessed}`);

  // Test: commentsAttempted should be incremented (system.init posts a comment)
  assert(state.commentsAttempted >= 1, 'commentsAttempted >= 1 after system.init event', `Got: ${state.commentsAttempted}`);

  // Test: commentsFailed should be incremented (our mock fails)
  assert(state.commentsFailed >= 1, 'commentsFailed >= 1 when GitHub API fails', `Got: ${state.commentsFailed}`);

  // Test: commentsPosted should remain 0 (all failed)
  assert(state.commentsPosted === 0, 'commentsPosted is 0 when all comments fail', `Got: ${state.commentsPosted}`);

  // Test: Failure was logged (not just verbose)
  const failureLogs = logs.filter(l => l.includes('Failed to post comment'));
  assert(failureLogs.length > 0, 'Comment failure was logged', `Logs: ${logs.join(' | ')}`);
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 11: Interactive handler functional test — successful posting
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 11: Interactive handler functional test — successful posting');
console.log('─'.repeat(60));

{
  const { createInteractiveHandler } = await import(join(__dirname, '..', 'src', 'interactive-mode.lib.mjs'));

  const logs = [];
  const mockLog = async msg => logs.push(msg);

  // Mock execFile that succeeds
  const successExecFile = async () => ({
    stdout: JSON.stringify({ id: 42, html_url: 'https://github.com/test/test/issues/1#issuecomment-42' }),
  });

  const handler = createInteractiveHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    log: mockLog,
    verbose: true,
    execFile: successExecFile,
  });

  // Process a system.init event
  await handler.processEvent({ type: 'system', subtype: 'init', session_id: 'test-session-2', cwd: '/tmp', tools: ['Bash'] });

  const state = handler.getState();

  // Test: commentsPosted should be incremented
  assert(state.commentsPosted >= 1, 'commentsPosted >= 1 when GitHub API succeeds', `Got: ${state.commentsPosted}`);

  // Test: commentsFailed should remain 0
  assert(state.commentsFailed === 0, 'commentsFailed is 0 when no failures', `Got: ${state.commentsFailed}`);

  // Test: eventsProcessed should be 1
  assert(state.eventsProcessed === 1, 'eventsProcessed is 1 after processing one event', `Got: ${state.eventsProcessed}`);
}

// ═══════════════════════════════════════════════════════════════════
// Test Suite 12: Diagnostic summary in claude.lib.mjs
// ═══════════════════════════════════════════════════════════════════
console.log('\n🧪 Test Suite 12: Diagnostic summary logging');
console.log('─'.repeat(60));

{
  const claudeLibContent = await readFile(join(__dirname, '..', 'src', 'claude.lib.mjs'), 'utf-8');

  // Test: Summary includes event counts
  assert(claudeLibContent.includes('events processed'), 'Summary logs events processed count');
  assert(claudeLibContent.includes('comments attempted'), 'Summary logs comments attempted count');
  assert(claudeLibContent.includes('commentsFailed} failed'), 'Summary logs about comment failures');

  // Test: Zero-comment warning
  assert(claudeLibContent.includes('zero comments were posted'), 'Warns when events received but zero comments posted');

  // Test: Summary uses getState() for handler diagnostics
  assert(claudeLibContent.includes('interactiveHandler.getState()'), 'Summary retrieves handler state via getState()');
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
