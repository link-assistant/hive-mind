#!/usr/bin/env node
/**
 * Test script to verify /limits command output formatting
 * This tests the complete formatUsageMessage function with the new relative time formatting
 */

import { getProgressBar, formatUsageMessage } from '../src/claude-limits.lib.mjs';

// Mock usage data with dates far in the future to test days formatting
const now = new Date();

// Create mock data that will result in 164h 13m (6d 20h 13m)
const in164Hours13Min = new Date(now.getTime() + 164 * 60 * 60 * 1000 + 13 * 60 * 1000);

// Create mock data for session reset (1h 13m)
const in1Hour13Min = new Date(now.getTime() + 1 * 60 * 60 * 1000 + 13 * 60 * 1000);

const mockUsage = {
  currentSession: {
    percentage: 22,
    resetTime: 'Dec 4, 10:59pm UTC',
    resetsAt: in1Hour13Min.toISOString()
  },
  allModels: {
    percentage: 3,
    resetTime: 'Dec 11, 5:59pm UTC',
    resetsAt: in164Hours13Min.toISOString()
  },
  sonnetOnly: {
    percentage: 3,
    resetTime: 'Dec 11, 5:59pm UTC',
    resetsAt: in164Hours13Min.toISOString()
  }
};

console.log('Testing /limits output with new relative time formatting\n');
console.log('=' .repeat(60));

const message = formatUsageMessage(mockUsage);

console.log('\nFormatted output:');
console.log(message);

console.log('\n' + '=' .repeat(60));
console.log('\nExpected behavior:');
console.log('✅ Session reset should show: "1h 13m"');
console.log('✅ Week reset should show: "6d 20h 13m" (not "164h 13m")');

// Verify the output contains the expected format
const hasSessionTime = message.includes('1h 13m') || message.includes('1h 12m') || message.includes('1h 14m');
const hasWeekTime = message.includes('6d 20h') || message.includes('6d 19h') || message.includes('6d 21h');
const hasOldFormat = message.includes('164h');

console.log('\n' + '=' .repeat(60));
console.log('Verification:');
console.log(`Session time format (1h 13m): ${hasSessionTime ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Week time format (6d 20h 13m): ${hasWeekTime ? '✅ PASS' : '❌ FAIL'}`);
console.log(`Old format not present (164h): ${!hasOldFormat ? '✅ PASS' : '❌ FAIL - still using old format!'}`);

if (hasSessionTime && hasWeekTime && !hasOldFormat) {
  console.log('\n🎉 All formatting tests passed!');
  process.exit(0);
} else {
  console.log('\n❌ Some formatting tests failed!');
  process.exit(1);
}
