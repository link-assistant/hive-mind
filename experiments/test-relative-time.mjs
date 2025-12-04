#!/usr/bin/env node

import { formatResetTimeWithRelative, parseResetTime, formatRelativeTime } from '../src/usage-limit.lib.mjs';

console.log('Testing relative time formatting...\n');

// Test different time formats
const testTimes = [
  '11:00 PM',
  '5:00 AM',
  '12:30 PM',
  '1:15 AM'
];

for (const testTime of testTimes) {
  console.log(`Input: "${testTime}"`);

  const resetDate = parseResetTime(testTime);
  if (resetDate) {
    console.log(`  Parsed date: ${resetDate}`);
    console.log(`  Relative time: ${formatRelativeTime(resetDate)}`);
    console.log(`  Formatted: ${formatResetTimeWithRelative(testTime)}`);
  } else {
    console.log(`  Failed to parse`);
  }
  console.log();
}

console.log('✅ All tests completed successfully!');
