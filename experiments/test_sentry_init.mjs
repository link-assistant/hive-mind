#!/usr/bin/env node

// Test script to verify Sentry initialization and transaction creation

import '../src/instrument.mjs'; // This initializes Sentry
import { initializeSentry, withSentry, reportError } from '../src/sentry.lib.mjs';

console.log('Testing Sentry initialization...');

// Test function wrapped with Sentry
const testFunction = withSentry(async () => {
  console.log('Running test function...');

  // Simulate some work
  await new Promise(resolve => setTimeout(resolve, 100));

  console.log('Test function completed successfully');
  return 'success';
}, 'test-operation');

// Run the test
(async () => {
  try {
    // Initialize Sentry
    await initializeSentry({ debug: true, version: '0.12.9' });

    // Test the wrapped function
    const result = await testFunction();
    console.log('Result:', result);

    // Test error reporting
    const testError = new Error('Test error (intentional)');
    reportError(testError, { test: true });
    console.log('Error reporting tested');

    console.log('✅ All Sentry tests passed!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Test failed:', error);
    process.exit(1);
  }
})();
