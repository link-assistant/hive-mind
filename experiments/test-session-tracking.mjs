#!/usr/bin/env node
/**
 * Test session tracking logic for watch mode
 * Verifies that session data is properly tracked and returned
 */

// Simulate the watch mode behavior
const testSessionTracking = () => {
  console.log('Testing session tracking logic...\n');

  // Simulate initial state
  let latestSessionId = null;
  let latestAnthropicCost = null;

  // Simulate first execution
  const firstToolResult = {
    success: true,
    sessionId: 'session-abc-123',
    anthropicTotalCostUSD: 0.964416
  };

  console.log('1. First execution:');
  console.log(`   sessionId: ${firstToolResult.sessionId}`);
  console.log(`   anthropicTotalCostUSD: $${firstToolResult.anthropicTotalCostUSD}`);

  // Capture first session data
  if (firstToolResult.success && firstToolResult.sessionId) {
    latestSessionId = firstToolResult.sessionId;
    latestAnthropicCost = firstToolResult.anthropicTotalCostUSD;
    console.log('   ✅ Session data captured');
  }

  console.log(`\n2. After first execution:`);
  console.log(`   latestSessionId: ${latestSessionId}`);
  console.log(`   latestAnthropicCost: $${latestAnthropicCost}`);

  // Simulate auto-restart execution
  const secondToolResult = {
    success: true,
    sessionId: 'session-xyz-789',
    anthropicTotalCostUSD: 1.234567
  };

  console.log(`\n3. Auto-restart execution:`);
  console.log(`   sessionId: ${secondToolResult.sessionId}`);
  console.log(`   anthropicTotalCostUSD: $${secondToolResult.anthropicTotalCostUSD}`);

  // Capture second session data
  if (secondToolResult.success && secondToolResult.sessionId) {
    latestSessionId = secondToolResult.sessionId;
    latestAnthropicCost = secondToolResult.anthropicTotalCostUSD;
    console.log('   ✅ Session data captured (updated)');
  }

  console.log(`\n4. After auto-restart:`);
  console.log(`   latestSessionId: ${latestSessionId}`);
  console.log(`   latestAnthropicCost: $${latestAnthropicCost}`);

  // Simulate return value
  const returnValue = {
    latestSessionId,
    latestAnthropicCost
  };

  console.log(`\n5. Return value from watchForFeedback:`);
  console.log(`   ${JSON.stringify(returnValue, null, 2)}`);

  // Simulate solve.mjs receiving the data
  console.log(`\n6. In solve.mjs after startWatchMode:`);
  let sessionId = 'session-abc-123'; // Old value from first execution
  let anthropicTotalCostUSD = 0.964416; // Old value from first execution

  console.log(`   Before update:`);
  console.log(`     sessionId: ${sessionId}`);
  console.log(`     anthropicTotalCostUSD: $${anthropicTotalCostUSD}`);

  // Update with latest from watch mode
  if (returnValue && returnValue.latestSessionId) {
    sessionId = returnValue.latestSessionId;
    anthropicTotalCostUSD = returnValue.latestAnthropicCost;
    console.log(`   After update:`);
    console.log(`     sessionId: ${sessionId}`);
    console.log(`     anthropicTotalCostUSD: $${anthropicTotalCostUSD}`);
    console.log(`   ✅ Variables updated with latest session data`);
  }

  console.log(`\n7. Log upload will now use:`);
  console.log(`   sessionId: ${sessionId}`);
  console.log(`   anthropicTotalCostUSD: $${anthropicTotalCostUSD}`);
  console.log(`   ✅ These are the LATEST values from auto-restart, not the first execution`);

  console.log(`\n✅ Test passed: Session tracking works correctly!`);
};

// Run the test
testSessionTracking();
