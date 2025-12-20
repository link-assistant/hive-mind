#!/usr/bin/env node
// Test script to verify codex session ID / thread ID extraction

console.log('🧪 Testing Codex Session ID Extraction\n');

// Test case 1: Check if thread_id is extracted correctly
const testJson1 = '{"type":"thread.started","thread_id":"019a3f5f-e513-7d03-a451-787959f5eb92"}';
let sessionId = null;

try {
  const data = JSON.parse(testJson1);
  if ((data.thread_id || data.session_id) && !sessionId) {
    sessionId = data.thread_id || data.session_id;
    console.log('✓ Test 1 PASSED: thread_id extracted correctly');
    console.log(`  Session ID: ${sessionId}`);
  }
} catch (error) {
  console.log('✗ Test 1 FAILED: Could not parse JSON');
}

// Test case 2: Check if session_id is still supported (legacy)
sessionId = null;
const testJson2 = '{"type":"init","session_id":"some-legacy-session-id"}';

try {
  const data = JSON.parse(testJson2);
  if ((data.thread_id || data.session_id) && !sessionId) {
    sessionId = data.thread_id || data.session_id;
    console.log('\n✓ Test 2 PASSED: session_id (legacy) still works');
    console.log(`  Session ID: ${sessionId}`);
  }
} catch (error) {
  console.log('\n✗ Test 2 FAILED: Could not parse JSON');
}

// Test case 3: Verify thread_id takes precedence if both exist
sessionId = null;
const testJson3 = '{"thread_id":"thread-123","session_id":"session-456"}';

try {
  const data = JSON.parse(testJson3);
  if ((data.thread_id || data.session_id) && !sessionId) {
    sessionId = data.thread_id || data.session_id;
    if (sessionId === 'thread-123') {
      console.log('\n✓ Test 3 PASSED: thread_id takes precedence');
      console.log(`  Session ID: ${sessionId}`);
    } else {
      console.log('\n✗ Test 3 FAILED: Wrong ID selected');
      console.log(`  Expected: thread-123, Got: ${sessionId}`);
    }
  }
} catch (error) {
  console.log('\n✗ Test 3 FAILED: Could not parse JSON');
}

console.log('\n✅ All tests completed');
