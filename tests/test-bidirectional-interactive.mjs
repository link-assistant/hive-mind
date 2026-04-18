#!/usr/bin/env node

/**
 * Unit tests for bidirectional-interactive.lib.mjs
 *
 * Tests the bidirectional interactive mode library with proper mocking
 * to avoid actual GitHub API calls.
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Import the module under test
const bidirectionalLib = await import(join(__dirname, '..', 'src', 'bidirectional-interactive.lib.mjs'));
const { createBidirectionalHandler, isBidirectionalModeSupported, validateBidirectionalModeConfig, utils } = bidirectionalLib;

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

// ============================================
// UTILITY FUNCTION TESTS
// ============================================

console.log('\n=== Testing Utility Functions ===\n');

// Test isSystemComment
runTest('isSystemComment detects system init comments', () => {
  const result = utils.isSystemComment('## 🚀 Session Started\nSome session details...');
  if (!result) {
    throw new Error('Expected true for system init comment');
  }
});

runTest('isSystemComment detects tool comments', () => {
  const tools = ['💻', '📝', '📖', '✏️', '🔍', '🔎', '🌐', '📋', '🎯', '📓', '🔧'];
  for (const icon of tools) {
    const result = utils.isSystemComment(`## ${icon} Tool: Bash\n\`\`\`bash\nls -la\n\`\`\``);
    if (!result) {
      throw new Error(`Expected true for tool comment with icon ${icon}`);
    }
  }
});

runTest('isSystemComment detects result comments', () => {
  const successResult = utils.isSystemComment('## ✅ Session Complete\n### Summary\nTask completed.');
  const failResult = utils.isSystemComment('## ❌ Session Failed\nError occurred.');
  if (!successResult || !failResult) {
    throw new Error('Expected true for result comments');
  }
});

runTest('isSystemComment detects assistant response', () => {
  const result = utils.isSystemComment('## 💬 Assistant Response\nI will help you...');
  if (!result) {
    throw new Error('Expected true for assistant response');
  }
});

runTest('isSystemComment detects raw JSON section', () => {
  const result = utils.isSystemComment('<details><summary>📄 Raw JSON</summary>');
  if (!result) {
    throw new Error('Expected true for raw JSON section');
  }
});

runTest('isSystemComment detects bot signatures', () => {
  const result1 = utils.isSystemComment('Some text\n🤖 Generated with [Claude Code](https://claude.ai)');
  const result2 = utils.isSystemComment('🤖 AI-Powered Solution Draft');
  if (!result1 || !result2) {
    throw new Error('Expected true for bot signatures');
  }
});

runTest('isSystemComment returns false for user comments', () => {
  const userComments = ['Please fix this bug', 'Can you add more tests?', 'I noticed the build is failing', 'Thanks for the help!', '@bot please continue', 'LGTM 👍'];
  for (const comment of userComments) {
    if (utils.isSystemComment(comment)) {
      throw new Error(`Expected false for user comment: ${comment}`);
    }
  }
});

runTest('isSystemComment handles null/undefined/empty', () => {
  if (utils.isSystemComment(null)) {
    throw new Error('Expected false for null');
  }
  if (utils.isSystemComment(undefined)) {
    throw new Error('Expected false for undefined');
  }
  if (utils.isSystemComment('')) {
    throw new Error('Expected false for empty string');
  }
});

// Test formatFeedbackForClaude
runTest('formatFeedbackForClaude creates valid JSON', () => {
  const feedback = utils.formatFeedbackForClaude('Please add more tests');
  const parsed = JSON.parse(feedback);
  if (parsed.type !== 'user') {
    throw new Error('Expected type to be "user"');
  }
  if (parsed.message?.role !== 'user') {
    throw new Error('Expected message.role to be "user"');
  }
  if (!parsed.message?.content?.[0]?.text?.includes('Please add more tests')) {
    throw new Error('Expected feedback text to be in message');
  }
});

runTest('formatFeedbackForClaude wraps feedback in markers', () => {
  const feedback = utils.formatFeedbackForClaude('Fix the bug');
  const parsed = JSON.parse(feedback);
  const text = parsed.message.content[0].text;
  if (!text.includes('[USER FEEDBACK FROM PR COMMENT]')) {
    throw new Error('Expected USER FEEDBACK marker');
  }
  if (!text.includes('[END OF USER FEEDBACK')) {
    throw new Error('Expected END OF USER FEEDBACK marker');
  }
});

// Test CONFIG constants
runTest('CONFIG has required constants', () => {
  if (typeof utils.CONFIG.MIN_POLL_INTERVAL !== 'number') {
    throw new Error('Expected MIN_POLL_INTERVAL to be a number');
  }
  if (typeof utils.CONFIG.DEFAULT_POLL_INTERVAL !== 'number') {
    throw new Error('Expected DEFAULT_POLL_INTERVAL to be a number');
  }
  if (typeof utils.CONFIG.MAX_QUEUE_SIZE !== 'number') {
    throw new Error('Expected MAX_QUEUE_SIZE to be a number');
  }
  if (!Array.isArray(utils.CONFIG.SYSTEM_COMMENT_SIGNATURES)) {
    throw new Error('Expected SYSTEM_COMMENT_SIGNATURES to be an array');
  }
});

runTest('CONFIG has reasonable values', () => {
  if (utils.CONFIG.MIN_POLL_INTERVAL < 5000) {
    throw new Error('MIN_POLL_INTERVAL should be at least 5000ms');
  }
  if (utils.CONFIG.MAX_QUEUE_SIZE < 10) {
    throw new Error('MAX_QUEUE_SIZE should be at least 10');
  }
});

// ============================================
// FUNCTION EXPORT TESTS
// ============================================

console.log('\n=== Testing Function Exports ===\n');

runTest('isBidirectionalModeSupported claude', () => {
  if (!isBidirectionalModeSupported('claude')) {
    throw new Error('Expected true for claude');
  }
});

runTest('isBidirectionalModeSupported opencode', () => {
  if (isBidirectionalModeSupported('opencode')) {
    throw new Error('Expected false for opencode');
  }
});

runTest('isBidirectionalModeSupported other tools', () => {
  if (isBidirectionalModeSupported('codex')) {
    throw new Error('Expected false for codex');
  }
  if (isBidirectionalModeSupported('unknown')) {
    throw new Error('Expected false for unknown');
  }
});

// ============================================
// ASYNC TESTS
// ============================================

console.log('\n=== Testing Async Functions ===\n');

await runAsyncTest('validateBidirectionalModeConfig disabled', async () => {
  const logs = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };

  const result = await validateBidirectionalModeConfig({ acceptIncommingCommentsAsInput: false, tool: 'claude' }, mockLog);
  if (!result) {
    throw new Error('Expected true when incoming-comment acceptance is disabled');
  }
});

await runAsyncTest('validateBidirectionalModeConfig accept-incomming-comments-as-input with claude', async () => {
  const logs = [];
  const argv = { acceptIncommingCommentsAsInput: true, tool: 'claude', interactiveMode: false };
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };

  const result = await validateBidirectionalModeConfig(argv, mockLog);
  if (!result) {
    throw new Error('Expected true when accept-incomming-comments-as-input is enabled with claude');
  }
  // Issue #817: accepting incoming comments does NOT force interactive-mode on its own.
  if (argv.interactiveMode) {
    throw new Error('Expected interactiveMode to remain disabled when only acceptIncommingCommentsAsInput is set');
  }
  if (!logs.some(l => l.includes('Bidirectional Interactive Mode: ENABLED'))) {
    throw new Error('Expected ENABLED log message');
  }
});

await runAsyncTest('validateBidirectionalModeConfig accept-incomming-comments-as-input with opencode disables it', async () => {
  const logs = [];
  const argv = { acceptIncommingCommentsAsInput: true, tool: 'opencode' };
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };

  const result = await validateBidirectionalModeConfig(argv, mockLog);
  if (result) {
    throw new Error('Expected false when incoming-comment acceptance is enabled with unsupported tool');
  }
  if (argv.acceptIncommingCommentsAsInput) {
    throw new Error('Expected acceptIncommingCommentsAsInput to be disabled for unsupported tool');
  }
  if (!logs.some(l => l.includes('only supported for --tool claude'))) {
    throw new Error('Expected warning log message');
  }
});

await runAsyncTest('validateBidirectionalModeConfig --bidirectional-interactive-mode enables all three flags', async () => {
  const logs = [];
  const argv = {
    bidirectionalInteractiveMode: true,
    tool: 'claude',
    interactiveMode: false,
    acceptIncommingCommentsAsInput: false,
    excludeAllOwnIncommingCommentsFromInput: false,
  };
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };

  const result = await validateBidirectionalModeConfig(argv, mockLog);
  if (!result) {
    throw new Error('Expected true when --bidirectional-interactive-mode is enabled with claude');
  }
  if (!argv.interactiveMode) throw new Error('Expected interactiveMode to be auto-enabled by --bidirectional-interactive-mode');
  if (!argv.acceptIncommingCommentsAsInput) throw new Error('Expected acceptIncommingCommentsAsInput to be auto-enabled by --bidirectional-interactive-mode');
  if (!argv.excludeAllOwnIncommingCommentsFromInput) throw new Error('Expected excludeAllOwnIncommingCommentsFromInput to be auto-enabled by --bidirectional-interactive-mode');
});

await runAsyncTest('validateBidirectionalModeConfig interactive-mode alone does not enable bidirectional', async () => {
  const logs = [];
  const argv = { interactiveMode: true, tool: 'claude', acceptIncommingCommentsAsInput: false };
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };

  const result = await validateBidirectionalModeConfig(argv, mockLog);
  if (!result) throw new Error('Expected true (nothing to validate when acceptIncommingCommentsAsInput is false)');
  if (logs.some(l => l.includes('Bidirectional Interactive Mode: ENABLED'))) {
    throw new Error('Should not log ENABLED when only interactive mode is on');
  }
});

// ============================================
// HANDLER TESTS
// ============================================

console.log('\n=== Testing Bidirectional Handler ===\n');

await runAsyncTest('createBidirectionalHandler returns expected interface', async () => {
  const mockLog = () => Promise.resolve();
  const mock$ = () => Promise.resolve({ stdout: '[]' });

  const handler = createBidirectionalHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
  });

  if (typeof handler.startMonitoring !== 'function') {
    throw new Error('Expected startMonitoring function');
  }
  if (typeof handler.stopMonitoring !== 'function') {
    throw new Error('Expected stopMonitoring function');
  }
  if (typeof handler.peekFeedback !== 'function') {
    throw new Error('Expected peekFeedback function');
  }
  if (typeof handler.popFeedback !== 'function') {
    throw new Error('Expected popFeedback function');
  }
  if (typeof handler.getAllQueuedFeedback !== 'function') {
    throw new Error('Expected getAllQueuedFeedback function');
  }
  if (typeof handler.hasFeedback !== 'function') {
    throw new Error('Expected hasFeedback function');
  }
  if (typeof handler.getFeedbackCount !== 'function') {
    throw new Error('Expected getFeedbackCount function');
  }
  if (typeof handler.clearFeedbackQueue !== 'function') {
    throw new Error('Expected clearFeedbackQueue function');
  }
  if (typeof handler.getState !== 'function') {
    throw new Error('Expected getState function');
  }
});

await runAsyncTest('handler initial state', async () => {
  const mockLog = () => Promise.resolve();
  const mock$ = () => Promise.resolve({ stdout: '[]' });

  const handler = createBidirectionalHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
  });

  const state = handler.getState();
  if (state.isMonitoring !== false) {
    throw new Error('Expected isMonitoring to be false initially');
  }
  if (state.feedbackQueueLength !== 0) {
    throw new Error('Expected feedbackQueueLength to be 0 initially');
  }
  if (state.totalCommentsProcessed !== 0) {
    throw new Error('Expected totalCommentsProcessed to be 0 initially');
  }
  if (state.totalFeedbackQueued !== 0) {
    throw new Error('Expected totalFeedbackQueued to be 0 initially');
  }
});

await runAsyncTest('handler processes user comments and queues feedback', async () => {
  const mockLog = () => Promise.resolve();

  // Mock $ function that returns simulated comments (as a tagged template literal function)
  const mockComments = [{ id: 1, body: 'Please add more tests', created_at: '2024-01-01T00:00:00Z', user: 'testuser' }];
  // Mock $ as a tagged template literal function
  const mock$ = () => Promise.resolve({ stdout: JSON.stringify(mockComments) });

  const handler = createBidirectionalHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
  });

  // Start monitoring first (this sets isMonitoring = true)
  // But we'll stop it immediately to avoid polling and test checkForNewComments directly
  await handler.startMonitoring();
  await handler.stopMonitoring();

  // Now test with fresh handler that has isMonitoring = true
  const handler2 = createBidirectionalHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
  });

  // Use internal fetchRecentComments instead (which doesn't check isMonitoring)
  const comments = await handler2._internal.fetchRecentComments();
  if (comments.length !== 1) {
    throw new Error(`Expected 1 comment, got ${comments.length}`);
  }

  // Now test the full flow - start monitoring will do the initial check
  const handler3 = createBidirectionalHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
    pollInterval: 60000, // Long interval so polling doesn't interfere
  });

  await handler3.startMonitoring();

  if (!handler3.hasFeedback()) {
    throw new Error('Expected feedback to be queued');
  }
  if (handler3.getFeedbackCount() !== 1) {
    throw new Error('Expected exactly 1 feedback item');
  }

  const feedback = handler3.popFeedback();
  if (feedback.id !== 1) {
    throw new Error('Expected feedback id to be 1');
  }
  if (feedback.body !== 'Please add more tests') {
    throw new Error('Expected correct feedback body');
  }
  if (feedback.user !== 'testuser') {
    throw new Error('Expected correct feedback user');
  }

  await handler3.stopMonitoring();
});

await runAsyncTest('handler filters out system comments', async () => {
  const mockLog = () => Promise.resolve();

  // Mock comments with both system and user comments
  const mockComments = [
    { id: 1, body: '## 🚀 Session Started\nSession initialized', created_at: '2024-01-01T00:00:00Z', user: 'bot' },
    { id: 2, body: 'Please fix the bug', created_at: '2024-01-01T00:01:00Z', user: 'human' },
    { id: 3, body: '## 💬 Assistant Response\nWorking on it...', created_at: '2024-01-01T00:02:00Z', user: 'bot' },
  ];
  const mock$ = () => Promise.resolve({ stdout: JSON.stringify(mockComments) });

  const handler = createBidirectionalHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
    pollInterval: 60000,
  });

  await handler.startMonitoring();

  // Should only have the human comment queued
  if (handler.getFeedbackCount() !== 1) {
    throw new Error(`Expected 1 feedback item (human comment), got ${handler.getFeedbackCount()}`);
  }

  const feedback = handler.popFeedback();
  if (feedback.body !== 'Please fix the bug') {
    throw new Error('Expected only the human comment to be queued');
  }

  await handler.stopMonitoring();
});

await runAsyncTest('handler does not duplicate processed comments', async () => {
  const mockLog = () => Promise.resolve();

  const mockComments = [{ id: 1, body: 'Please add more tests', created_at: '2024-01-01T00:00:00Z', user: 'testuser' }];
  const mock$ = () => Promise.resolve({ stdout: JSON.stringify(mockComments) });

  const handler = createBidirectionalHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
    pollInterval: 60000,
  });

  // Start monitoring (this does initial check)
  await handler.startMonitoring();

  // Verify we got the comment
  if (handler.getFeedbackCount() !== 1) {
    throw new Error(`Expected 1 feedback item after first check, got ${handler.getFeedbackCount()}`);
  }

  // Clear the queue and manually trigger another check
  // The comment should not be re-added since it's already processed
  handler.clearFeedbackQueue();

  // Manually trigger another check via internal method
  // First we need to set isMonitoring back since we're testing internal behavior
  await handler._internal.checkForNewComments();

  // Should still be 0 since the comment was already processed
  if (handler.getFeedbackCount() !== 0) {
    throw new Error(`Expected 0 feedback items (comment already processed), got ${handler.getFeedbackCount()}`);
  }

  await handler.stopMonitoring();
});

await runAsyncTest('handler initializeWithExistingComments skips them', async () => {
  const mockLog = () => Promise.resolve();

  const mockComments = [
    { id: 1, body: 'Old comment', created_at: '2024-01-01T00:00:00Z', user: 'testuser' },
    { id: 2, body: 'New comment', created_at: '2024-01-01T01:00:00Z', user: 'testuser' },
  ];
  const mock$ = () => Promise.resolve({ stdout: JSON.stringify(mockComments) });

  const handler = createBidirectionalHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
    pollInterval: 60000,
  });

  // Mark comment 1 as already processed BEFORE starting monitoring
  handler.initializeWithExistingComments([1]);

  // Now start monitoring - should only queue comment 2
  await handler.startMonitoring();

  // Should only have comment 2
  if (handler.getFeedbackCount() !== 1) {
    throw new Error(`Expected 1 feedback item, got ${handler.getFeedbackCount()}`);
  }

  const feedback = handler.popFeedback();
  if (feedback.body !== 'New comment') {
    throw new Error('Expected only the new comment to be queued');
  }

  await handler.stopMonitoring();
});

await runAsyncTest('handler peekFeedback does not remove from queue', async () => {
  const mockLog = () => Promise.resolve();

  const mockComments = [{ id: 1, body: 'Test feedback', created_at: '2024-01-01T00:00:00Z', user: 'testuser' }];
  const mock$ = () => Promise.resolve({ stdout: JSON.stringify(mockComments) });

  const handler = createBidirectionalHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
    pollInterval: 60000,
  });

  await handler.startMonitoring();

  const peeked = handler.peekFeedback();
  const stillHas = handler.hasFeedback();
  const countAfter = handler.getFeedbackCount();

  if (!stillHas) {
    throw new Error('Expected queue to still have feedback after peek');
  }
  if (countAfter !== 1) {
    throw new Error('Expected count to still be 1 after peek');
  }
  if (peeked.body !== 'Test feedback') {
    throw new Error('Expected peeked feedback to have correct body');
  }

  await handler.stopMonitoring();
});

await runAsyncTest('handler clearFeedbackQueue empties queue', async () => {
  const mockLog = () => Promise.resolve();

  const mockComments = [
    { id: 1, body: 'Test 1', created_at: '2024-01-01T00:00:00Z', user: 'testuser' },
    { id: 2, body: 'Test 2', created_at: '2024-01-01T00:01:00Z', user: 'testuser' },
  ];
  const mock$ = () => Promise.resolve({ stdout: JSON.stringify(mockComments) });

  const handler = createBidirectionalHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 123,
    $: mock$,
    log: mockLog,
    verbose: false,
    pollInterval: 60000,
  });

  await handler.startMonitoring();

  if (handler.getFeedbackCount() !== 2) {
    throw new Error(`Expected 2 feedback items before clear, got ${handler.getFeedbackCount()}`);
  }

  handler.clearFeedbackQueue();

  if (handler.getFeedbackCount() !== 0) {
    throw new Error('Expected 0 feedback items after clear');
  }

  await handler.stopMonitoring();
});

await runAsyncTest('handler does not poll without PR info', async () => {
  const logs = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };
  const mock$ = async () => {
    throw new Error('Should not be called');
  };

  const handler = createBidirectionalHandler({
    owner: '', // Empty owner
    repo: 'test-repo',
    prNumber: null, // No PR number
    $: mock$,
    log: mockLog,
    verbose: true,
  });

  // Should not throw despite missing info
  await handler._internal.checkForNewComments();

  // Should not have any feedback
  if (handler.hasFeedback()) {
    throw new Error('Expected no feedback when PR info is missing');
  }
});

await runAsyncTest('handler excludes own comments when excludeOwnComments is true', async () => {
  const logs = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };

  // Simulate gh api returning the current user login for `gh api user --jq .login`
  // and returning a list of comments with one from the "own" user and one from someone else.
  // The `$` invocation shape in the lib is `await $\`gh api ...\`` — i.e. a tagged template
  // literal call where the first argument is an array of string chunks. We look at the joined
  // string to decide which stub reply to return.
  const mock$ = (strings, ...values) => {
    const full = Array.isArray(strings) ? strings.reduce((acc, s, i) => acc + s + (values[i] !== undefined ? String(values[i]) : ''), '') : String(strings);
    if (full.includes('gh api user')) {
      return Promise.resolve({ stdout: 'konard\n' });
    }
    const comments = JSON.stringify([
      { id: 101, body: 'please fix the typo', created_at: '2026-01-01T00:00:00Z', user: 'konard' },
      { id: 102, body: 'actual feedback', created_at: '2026-01-02T00:00:00Z', user: 'alice' },
    ]);
    return Promise.resolve({ stdout: comments });
  };

  const handler = createBidirectionalHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 1,
    $: mock$,
    log: mockLog,
    verbose: true,
    pollInterval: 60000,
    excludeOwnComments: true,
  });

  // startMonitoring performs the initial check, which is enough for our assertions.
  await handler.startMonitoring();
  await handler.stopMonitoring();

  if (handler.getFeedbackCount() !== 1) {
    throw new Error(`Expected exactly 1 feedback after filtering own user, got ${handler.getFeedbackCount()}`);
  }
  const fb = handler.peekFeedback();
  if (!fb || fb.user !== 'alice') {
    throw new Error(`Expected remaining feedback from alice, got ${fb && fb.user}`);
  }
});

await runAsyncTest('handler keeps own comments when excludeOwnComments is false', async () => {
  const logs = [];
  const mockLog = msg => {
    logs.push(msg);
    return Promise.resolve();
  };

  const mock$ = (strings, ...values) => {
    const full = Array.isArray(strings) ? strings.reduce((acc, s, i) => acc + s + (values[i] !== undefined ? String(values[i]) : ''), '') : String(strings);
    if (full.includes('gh api user')) {
      return Promise.resolve({ stdout: 'konard\n' });
    }
    const comments = JSON.stringify([
      { id: 201, body: 'talking to myself', created_at: '2026-01-01T00:00:00Z', user: 'konard' },
      { id: 202, body: 'feedback from other', created_at: '2026-01-02T00:00:00Z', user: 'alice' },
    ]);
    return Promise.resolve({ stdout: comments });
  };

  const handler = createBidirectionalHandler({
    owner: 'test-owner',
    repo: 'test-repo',
    prNumber: 1,
    $: mock$,
    log: mockLog,
    verbose: true,
    pollInterval: 60000,
    excludeOwnComments: false,
  });

  await handler.startMonitoring();
  await handler.stopMonitoring();

  if (handler.getFeedbackCount() !== 2) {
    throw new Error(`Expected 2 feedback items (own + other) when excludeOwnComments is false, got ${handler.getFeedbackCount()}`);
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Test Results for bidirectional-interactive.lib.mjs:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
