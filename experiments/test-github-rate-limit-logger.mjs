#!/usr/bin/env node
/**
 * Test script for GitHub Rate Limit Logger
 * Run with: node experiments/test-github-rate-limit-logger.mjs
 *
 * This script tests the rate limit logging functionality that tracks
 * GitHub API usage during solve command execution.
 */

import { setRateLimitLoggingEnabled, isRateLimitLoggingEnabled, resetRateLimitTracking, getGitHubCoreRateLimit, logGitHubRateLimits, logRateLimitSummary, createRateLimitCheckpoint } from '../src/github-rate-limit-logger.lib.mjs';

// Simple mock log function for testing
const mockLog = async message => {
  console.log(message);
};

async function main() {
  console.log('🧪 Testing GitHub Rate Limit Logger\n');
  console.log('='.repeat(50));

  // Test 1: Check if rate limit logging is enabled by default
  console.log('\n1. Testing default state...');
  console.log(`   Rate limit logging enabled: ${isRateLimitLoggingEnabled()}`);

  // Test 2: Get current rate limit
  console.log('\n2. Testing getGitHubCoreRateLimit()...');
  const rateLimit = await getGitHubCoreRateLimit();
  if (rateLimit) {
    console.log('   ✅ Successfully retrieved rate limit:');
    console.log(`      Limit: ${rateLimit.limit}`);
    console.log(`      Used: ${rateLimit.used}`);
    console.log(`      Remaining: ${rateLimit.remaining}`);
    console.log(`      Resets in: ${rateLimit.relativeReset || 'N/A'}`);
  } else {
    console.log('   ❌ Failed to get rate limit (check gh auth)');
  }

  // Test 3: Create a checkpoint
  console.log('\n3. Testing createRateLimitCheckpoint()...');
  const checkpoint = await createRateLimitCheckpoint();
  if (checkpoint) {
    console.log('   ✅ Checkpoint created successfully');
  } else {
    console.log('   ⚠️  Could not create checkpoint');
  }

  // Test 4: Log rate limits with context
  console.log('\n4. Testing logGitHubRateLimits()...');
  await logGitHubRateLimits({
    context: 'test operation 1',
    log: mockLog,
  });

  // Make a few API calls to show delta tracking
  console.log('\n5. Making test API calls to show delta tracking...');
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const execAsync = promisify(exec);

  // Make some API calls
  await execAsync('gh api rate_limit --jq .resources.core.used 2>/dev/null').catch(() => {});
  await execAsync('gh api user --jq .login 2>/dev/null').catch(() => {});

  // Log again to show delta
  console.log('\n6. Testing delta tracking after API calls...');
  await logGitHubRateLimits({
    context: 'test operation 2 (after API calls)',
    log: mockLog,
  });

  // Test 5: Test disabling rate limit logging
  console.log('\n7. Testing setRateLimitLoggingEnabled(false)...');
  setRateLimitLoggingEnabled(false);
  console.log(`   Rate limit logging enabled: ${isRateLimitLoggingEnabled()}`);

  console.log('\n8. Logging should be skipped when disabled...');
  const result = await logGitHubRateLimits({
    context: 'should not appear',
    log: mockLog,
  });
  console.log(`   Result: ${result === null ? 'null (correctly skipped)' : 'error - should have been skipped'}`);

  // Re-enable for summary test
  setRateLimitLoggingEnabled(true);

  // Test 6: Log summary
  console.log('\n9. Testing logRateLimitSummary()...');
  await logRateLimitSummary({
    startLimit: checkpoint,
    log: mockLog,
  });

  // Test 7: Reset tracking
  console.log('\n10. Testing resetRateLimitTracking()...');
  resetRateLimitTracking();
  console.log('   ✅ Tracking reset');

  console.log('\n' + '='.repeat(50));
  console.log('✅ All tests completed!\n');
}

main().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
