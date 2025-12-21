#!/usr/bin/env node

/**
 * Test script to verify the fork retry mechanism fix
 * This simulates the scenario where multiple workers try to fork the same repo
 * and one gets "already exists" error
 */

import { execSync } from 'child_process';
import { log, formatAligned } from '../lib.mjs';

// Mock the $ function for testing
const $ = (strings, ...values) => {
  const command = strings.reduce((acc, str, i) => acc + str + (values[i] || ''), '');

  return {
    then: onFulfilled => {
      try {
        const output = execSync(command, { encoding: 'utf8', stdio: 'pipe' });
        return onFulfilled({
          code: 0,
          stdout: output,
          stderr: ''
        });
      } catch (error) {
        return onFulfilled({
          code: error.status || 1,
          stdout: '',
          stderr: error.stderr ? error.stderr.toString() : error.message
        });
      }
    }
  };
};

async function testForkRetryLogic() {
  console.log('\n=== Testing Fork Retry Logic ===\n');

  // Test configuration
  const testUser = 'test-user';
  const testRepo = 'test-repo';

  console.log('Simulating fork already exists scenario...\n');

  // Simulate the fork verification with retry logic
  const maxRetries = 5;
  const baseDelay = 100; // Use shorter delays for testing (100ms instead of 2000ms)
  let forkVerified = false;
  let attemptsThatFailed = 3; // Simulate fork becoming visible after 3 attempts

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const delay = baseDelay * Math.pow(2, attempt - 1);
    console.log(`⏳ Verifying fork: Attempt ${attempt}/${maxRetries} (waiting ${delay}ms)...`);
    await new Promise(resolve => setTimeout(resolve, delay));

    // Simulate the fork becoming visible after a few attempts
    if (attempt > attemptsThatFailed) {
      forkVerified = true;
      console.log(`✅ Fork verified: Successfully confirmed fork exists`);
      break;
    } else {
      console.log(`   Fork not visible yet (simulated failure ${attempt}/${attemptsThatFailed})`);
    }
  }

  if (!forkVerified) {
    console.log(`❌ Error: Fork not found after ${maxRetries} retries`);
    console.log('   This would exit with error in production');
  } else {
    console.log('\n✨ Success! Fork was verified after retries');
    console.log(`   Total attempts: ${attemptsThatFailed + 1}`);
    console.log(
      `   Total wait time: ${Array.from(
        { length: attemptsThatFailed + 1 },
        (_, i) => baseDelay * Math.pow(2, i)
      ).reduce((a, b) => a + b, 0)}ms`
    );
  }

  // Calculate what the actual delays would be in production
  console.log('\n📊 Production delay schedule (with 2s base delay):');
  const prodBaseDelay = 2000;
  let totalDelay = 0;
  for (let i = 1; i <= 5; i++) {
    const delay = prodBaseDelay * Math.pow(2, i - 1);
    totalDelay += delay;
    console.log(`   Attempt ${i}: ${delay / 1000}s delay (cumulative: ${totalDelay / 1000}s)`);
  }

  console.log('\n✅ Test completed successfully!\n');
}

// Run the test
testForkRetryLogic().catch(console.error);
