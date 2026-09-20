#!/usr/bin/env node
/**
 * Test to understand the timing issue with rate limiting
 */

// Check MIN_COMMENT_INTERVAL
console.log('MIN_COMMENT_INTERVAL from config:', 5000, 'ms');
console.log('');

// Simulate the timing
let lastCommentTime = 0;

function checkIfQueued(eventName) {
  const now = Date.now();
  const timeSinceLastComment = now - lastCommentTime;
  const MIN_COMMENT_INTERVAL = 5000;

  console.log(`Event: ${eventName}`);
  console.log(`  now: ${now}`);
  console.log(`  lastCommentTime: ${lastCommentTime}`);
  console.log(`  timeSinceLastComment: ${timeSinceLastComment}ms`);
  console.log(`  MIN_COMMENT_INTERVAL: ${MIN_COMMENT_INTERVAL}ms`);

  if (timeSinceLastComment < MIN_COMMENT_INTERVAL) {
    console.log(`  RESULT: QUEUED (${timeSinceLastComment} < ${MIN_COMMENT_INTERVAL})`);
    return true;
  } else {
    console.log(`  RESULT: POSTED DIRECTLY`);
    lastCommentTime = now;
    return false;
  }
}

// Simulate events with realistic timing (100ms between events in test)
const events = ['system.init', 'assistant.text', 'tool_use', 'tool_result'];

console.log('=== Simulating events with 100ms delays ===\n');
for (let i = 0; i < events.length; i++) {
  checkIfQueued(events[i]);
  console.log('');
  if (i < events.length - 1) {
    // Wait 100ms (simulating test delay, but in reality events come faster)
    await new Promise(r => setTimeout(r, 100));
  }
}

console.log('\n=== Now with 6000ms delays (like real production) ===\n');
lastCommentTime = 0;
for (let i = 0; i < events.length; i++) {
  checkIfQueued(events[i]);
  console.log('');
  if (i < events.length - 1) {
    await new Promise(r => setTimeout(r, 6000));
  }
}
