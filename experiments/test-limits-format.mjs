#!/usr/bin/env node
/**
 * Test script for the updated limits formatting
 * This tests the new features:
 * 1. Minutes in time format
 * 2. Relative time display
 * 3. Current time display
 * 4. Monospace formatting
 */

import { formatUsageMessage, getProgressBar } from '../src/claude-limits.lib.mjs';

// Create test usage data
const testUsage = {
  currentSession: {
    percentage: 100,
    resetTime: 'Dec 3, 10:59pm UTC',
    resetsAt: new Date(Date.now() + 1000 * 60 * 94).toISOString() // 1h 34m from now
  },
  allModels: {
    percentage: 97,
    resetTime: 'Dec 4, 5:00pm UTC',
    resetsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString() // 24h from now
  },
  sonnetOnly: {
    percentage: 44,
    resetTime: 'Dec 4, 5:00pm UTC',
    resetsAt: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString() // 24h from now
  }
};

console.log('Testing formatUsageMessage:');
console.log('================================\n');
const message = formatUsageMessage(testUsage);
console.log(message);
console.log('\n================================');
console.log('Testing progress bar alignment:');
console.log('================================\n');
console.log('100%:', getProgressBar(100));
console.log(' 97%:', getProgressBar(97));
console.log(' 44%:', getProgressBar(44));
console.log('  0%:', getProgressBar(0));
console.log('\n✅ All tests completed!');
