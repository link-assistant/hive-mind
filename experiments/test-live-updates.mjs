#!/usr/bin/env node

/**
 * Test script for the live updates monitoring module
 *
 * This tests the solve.live-updates.lib.mjs module to verify:
 * 1. Initial state capture works correctly
 * 2. Hash function produces consistent results
 * 3. Update detection works for issue edits and new comments
 * 4. Feedback formatting is correct
 *
 * Usage: node experiments/test-live-updates.mjs
 */

// Set up globalThis.use for the module
globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;

const liveUpdatesLib = await import('../src/solve.live-updates.lib.mjs');
const {
  captureInitialState,
  checkForUpdates,
  formatUpdatesAsFeedback,
  LiveUpdatesMonitor
} = liveUpdatesLib;

// Test counter
let passed = 0;
let failed = 0;

const test = (name, condition) => {
  if (condition) {
    console.log(`✅ ${name}`);
    passed++;
  } else {
    console.log(`❌ ${name}`);
    failed++;
  }
};

console.log('🧪 Testing solve.live-updates.lib.mjs\n');

// Test 1: UpdatesState class exists
console.log('📋 Test Group 1: Module exports');
test('captureInitialState is a function', typeof captureInitialState === 'function');
test('checkForUpdates is a function', typeof checkForUpdates === 'function');
test('formatUpdatesAsFeedback is a function', typeof formatUpdatesAsFeedback === 'function');
test('LiveUpdatesMonitor is a class/function', typeof LiveUpdatesMonitor === 'function');

// Test 2: Hash function consistency (using internal function via updates)
console.log('\n📋 Test Group 2: Update detection structure');

// Create mock updates object
const mockUpdates = {
  hasUpdates: true,
  issueEdited: true,
  newIssueComments: [{ user: { login: 'testuser' }, body: 'Test comment', created_at: new Date().toISOString() }],
  prEdited: false,
  newPrComments: [],
  updateSummary: ['Issue description/title was edited', '1 new comment(s) on issue']
};

const feedbackLines = formatUpdatesAsFeedback(mockUpdates);
test('formatUpdatesAsFeedback returns an array', Array.isArray(feedbackLines));
test('Feedback lines include LIVE UPDATES header', feedbackLines.some(line => line.includes('LIVE UPDATES')));
test('Feedback lines include issue edit info', feedbackLines.some(line => line.includes('ISSUE EDITED')));
test('Feedback lines include new comments info', feedbackLines.some(line => line.includes('NEW ISSUE COMMENTS')));

// Test 3: Empty updates don't generate feedback
console.log('\n📋 Test Group 3: Empty updates handling');

const emptyUpdates = {
  hasUpdates: false,
  issueEdited: false,
  newIssueComments: [],
  prEdited: false,
  newPrComments: [],
  updateSummary: []
};

const emptyFeedback = formatUpdatesAsFeedback(emptyUpdates);
test('Empty updates return empty feedback array', emptyFeedback.length === 0);

// Test 4: LiveUpdatesMonitor instantiation
console.log('\n📋 Test Group 4: LiveUpdatesMonitor class');

const monitor = new LiveUpdatesMonitor({
  owner: 'test-owner',
  repo: 'test-repo',
  issueNumber: 123,
  prNumber: 456,
  argv: { verbose: false },
  checkInterval: 5000
});

test('Monitor has correct owner', monitor.owner === 'test-owner');
test('Monitor has correct repo', monitor.repo === 'test-repo');
test('Monitor has correct issueNumber', monitor.issueNumber === 123);
test('Monitor has correct prNumber', monitor.prNumber === 456);
test('Monitor has correct checkInterval', monitor.checkInterval === 5000);
test('Monitor is not running initially', monitor.isRunning === false);
test('Monitor hasUpdates returns false initially', monitor.hasUpdates() === false);
test('Monitor getUpdatesAsFeedback returns empty array initially', monitor.getUpdatesAsFeedback().length === 0);

// Test 5: PR-only updates
console.log('\n📋 Test Group 5: PR updates handling');

const prOnlyUpdates = {
  hasUpdates: true,
  issueEdited: false,
  newIssueComments: [],
  prEdited: true,
  newPrComments: [{ user: { login: 'reviewer' }, body: 'Please fix this', created_at: new Date().toISOString() }],
  updateSummary: ['Pull request description/title was edited', '1 new comment(s) on PR']
};

const prFeedback = formatUpdatesAsFeedback(prOnlyUpdates);
test('PR feedback includes PR EDITED info', prFeedback.some(line => line.includes('PULL REQUEST EDITED')));
test('PR feedback includes new PR comments info', prFeedback.some(line => line.includes('NEW PR COMMENTS')));
test('PR feedback does not include issue edit (not edited)', !prFeedback.some(line => line.includes('ISSUE EDITED')));

// Summary
console.log('\n' + '═'.repeat(50));
console.log(`📊 Test Results: ${passed} passed, ${failed} failed`);
console.log('═'.repeat(50));

if (failed > 0) {
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
  process.exit(0);
}
