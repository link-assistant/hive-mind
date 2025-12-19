#!/usr/bin/env node
/**
 * Test script for the double progress bar feature
 * Tests the new calculateTimePassedPercentage function
 * and verifies the double progress bar display
 */

import { formatUsageMessage, getProgressBar, calculateTimePassedPercentage } from '../src/claude-limits.lib.mjs';

console.log('Testing calculateTimePassedPercentage function:');
console.log('='.repeat(60));

// Test 1: 5-hour session (current session)
// Simulate being 2.5 hours into a 5-hour session (50%)
const sessionResetTime = new Date(Date.now() + 1000 * 60 * 60 * 2.5).toISOString();
const sessionTimePassed = calculateTimePassedPercentage(sessionResetTime, 5);
console.log(`\nTest 1: 5-hour session (2.5h passed)`);
console.log(`Expected: ~50%, Got: ${sessionTimePassed}%`);
console.log(`Progress bar: ${getProgressBar(sessionTimePassed)}`);

// Test 2: 7-day week
// Simulate being 3.5 days into a 7-day week (50%)
const weekResetTime = new Date(Date.now() + 1000 * 60 * 60 * 24 * 3.5).toISOString();
const weekTimePassed = calculateTimePassedPercentage(weekResetTime, 168);
console.log(`\nTest 2: 7-day week (3.5 days passed)`);
console.log(`Expected: ~50%, Got: ${weekTimePassed}%`);
console.log(`Progress bar: ${getProgressBar(weekTimePassed)}`);

// Test 3: Almost complete session (4.5h into 5h = 90%)
const almostDoneSession = new Date(Date.now() + 1000 * 60 * 30).toISOString(); // 30 min left
const almostDoneTimePassed = calculateTimePassedPercentage(almostDoneSession, 5);
console.log(`\nTest 3: Almost done session (4.5h passed)`);
console.log(`Expected: ~90%, Got: ${almostDoneTimePassed}%`);
console.log(`Progress bar: ${getProgressBar(almostDoneTimePassed)}`);

// Test 4: Just started (0.5h into 5h = 10%)
const justStarted = new Date(Date.now() + 1000 * 60 * 60 * 4.5).toISOString(); // 4.5h left
const justStartedTimePassed = calculateTimePassedPercentage(justStarted, 5);
console.log(`\nTest 4: Just started (0.5h passed)`);
console.log(`Expected: ~10%, Got: ${justStartedTimePassed}%`);
console.log(`Progress bar: ${getProgressBar(justStartedTimePassed)}`);

console.log('\n' + '='.repeat(60));
console.log('Testing complete usage message with double progress bars:');
console.log('='.repeat(60));

// Create test usage data with realistic scenarios
const testUsage = {
  currentSession: {
    percentage: 12,  // 12% used
    resetTime: 'Dec 5, 8:59pm UTC',
    resetsAt: new Date(Date.now() + 1000 * 60 * 60 * 3.8).toISOString() // 3.8h left (24% time passed)
  },
  allModels: {
    percentage: 16,  // 16% used
    resetTime: 'Dec 11, 5:59pm UTC',
    resetsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 6).toISOString() // 6 days left (14% time passed)
  },
  sonnetOnly: {
    percentage: 15,  // 15% used
    resetTime: 'Dec 11, 5:59pm UTC',
    resetsAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 6).toISOString() // 6 days left (14% time passed)
  }
};

const message = formatUsageMessage(testUsage);
console.log('\n📊 Claude Usage Limits\n');
console.log(message);

console.log('\n' + '='.repeat(60));
console.log('Visual comparison scenarios:');
console.log('='.repeat(60));

console.log('\nScenario 1: Overusing (high usage, low time passed)');
console.log('Time passed: ' + getProgressBar(30) + ' 30% passed');
console.log('Usage:       ' + getProgressBar(80) + ' 80% used');
console.log('→ Using too fast! Slow down to avoid hitting limits.');

console.log('\nScenario 2: Underusing (low usage, high time passed)');
console.log('Time passed: ' + getProgressBar(70) + ' 70% passed');
console.log('Usage:       ' + getProgressBar(20) + ' 20% used');
console.log('→ Using slowly, can increase activity.');

console.log('\nScenario 3: Balanced (similar percentages)');
console.log('Time passed: ' + getProgressBar(50) + ' 50% passed');
console.log('Usage:       ' + getProgressBar(45) + ' 45% used');
console.log('→ Well balanced usage rate.');

console.log('\n✅ All tests completed!');
