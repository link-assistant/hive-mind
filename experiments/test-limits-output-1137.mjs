#!/usr/bin/env node
/**
 * Test script for issue #1137 - improved /limits output formatting
 * Tests:
 * 1. CPU section shows "CPU" header with "X.XX/Y CPU cores used" format
 * 2. No separate "Load avg" line (5m load average used in CPU cores calculation)
 * 3. RAM shows condensed format (2.8/11.7 GB used)
 * 4. Disk shows condensed format (50.4/95.8 GB used)
 */

import { formatUsageMessage, getProgressBar, getCpuLoadInfo, getMemoryInfo, getDiskSpaceInfo } from '../src/limits.lib.mjs';

console.log('Testing /limits output formatting (Issue #1137)\n');
console.log('='.repeat(60));

// Test 1: Get actual system data and check CPU calculation uses 5m average
console.log('\n1. Testing CPU data calculation...');
const cpuResult = await getCpuLoadInfo(false);
if (cpuResult.success) {
  const { cpuLoad } = cpuResult;
  console.log(`   Load averages: ${cpuLoad.loadAvg1.toFixed(2)} (1m), ${cpuLoad.loadAvg5.toFixed(2)} (5m), ${cpuLoad.loadAvg15.toFixed(2)} (15m)`);
  console.log(`   CPU count: ${cpuLoad.cpuCount}`);

  // Verify usagePercentage is based on 5m average
  const expectedPercentage = Math.min(100, Math.round((cpuLoad.loadAvg5 / cpuLoad.cpuCount) * 100));
  const matches = cpuLoad.usagePercentage === expectedPercentage;
  console.log(`   Expected percentage (5m-based): ${expectedPercentage}%`);
  console.log(`   Actual usagePercentage: ${cpuLoad.usagePercentage}%`);
  console.log(`   5m average calculation: ${matches ? '✅ PASS' : '❌ FAIL'}`);
} else {
  console.log('   ⚠️ Could not get CPU info:', cpuResult.error);
}

// Test 2: Get memory info
console.log('\n2. Testing memory data...');
const memoryResult = await getMemoryInfo(false);
if (memoryResult.success) {
  const { memory } = memoryResult;
  console.log(`   Total: ${memory.totalFormatted}, Used: ${memory.usedFormatted}`);
  console.log(`   Bytes available: usedBytes=${memory.usedBytes}, totalBytes=${memory.totalBytes}`);
}

// Test 3: Get disk info
console.log('\n3. Testing disk data...');
const diskResult = await getDiskSpaceInfo(false);
if (diskResult.success) {
  const { diskSpace } = diskResult;
  console.log(`   Total: ${diskSpace.totalFormatted}, Used: ${diskSpace.usedFormatted}`);
  console.log(`   Bytes available: usedBytes=${diskSpace.usedBytes}, totalBytes=${diskSpace.totalBytes}`);
}

// Test 4: Format the complete message and verify format
console.log('\n4. Testing formatted message output...');
console.log('='.repeat(60));

// Create mock usage data
const mockUsage = {
  currentSession: {
    percentage: 22,
    resetTime: 'Jan 18, 10:59pm UTC',
    resetsAt: new Date(Date.now() + 1 * 60 * 60 * 1000).toISOString(),
  },
  allModels: {
    percentage: 3,
    resetTime: 'Jan 25, 5:59pm UTC',
    resetsAt: new Date(Date.now() + 164 * 60 * 60 * 1000).toISOString(),
  },
  sonnetOnly: {
    percentage: 3,
    resetTime: 'Jan 25, 5:59pm UTC',
    resetsAt: new Date(Date.now() + 164 * 60 * 60 * 1000).toISOString(),
  },
};

// Use actual system data if available
const cpuLoad = cpuResult.success ? cpuResult.cpuLoad : null;
const memory = memoryResult.success ? memoryResult.memory : null;
const diskSpace = diskResult.success ? diskResult.diskSpace : null;

// Mock GitHub data
const githubRateLimit = {
  limit: 5000,
  used: 71,
  remaining: 4929,
  usedPercentage: 1,
  remainingPercentage: 99,
  relativeReset: '32m',
  resetTime: 'Jan 18, 12:52am UTC',
};

const message = formatUsageMessage(mockUsage, diskSpace, githubRateLimit, cpuLoad, memory);

console.log('\nFormatted output:');
console.log(message);

console.log('\n' + '='.repeat(60));
console.log('Verification checks:\n');

// Check 1: CPU section format - should have "CPU" header followed by "X.XX/Y CPU cores used"
const hasCpuHeader = message.includes('CPU\n');
const hasCpuCoresUsedFormat = message.match(/\d+\.\d+\/\d+ CPU cores used/);
const hasOldLoadAvg = message.includes('Load avg:');
const hasOldPercentHeader = message.includes('CPU (5m load average');

console.log(`CPU header is just "CPU": ${hasCpuHeader && !hasOldPercentHeader ? '✅ PASS' : '❌ FAIL'}`);
console.log(`CPU shows "X.XX/Y CPU cores used" format: ${hasCpuCoresUsedFormat ? '✅ PASS' : '❌ FAIL'}`);
console.log(`No old "Load avg:" line: ${!hasOldLoadAvg ? '✅ PASS' : '❌ FAIL - still has Load avg line'}`);

// Check 2: RAM format
const hasRamSlashFormat = message.match(/\d+\.\d\/\d+\.\d GB used/);

console.log(`RAM uses condensed format (X/Y GB used): ${hasRamSlashFormat ? '✅ PASS' : '❌ FAIL - should use X/Y format'}`);

// Check 3: Disk format
const hasDiskSlashFormat = message.match(/\d+\.\d\/\d+\.\d GB used/g);

console.log(`Disk uses condensed format (X/Y GB used): ${hasDiskSlashFormat && hasDiskSlashFormat.length >= 2 ? '✅ PASS' : '❌ FAIL - should use X/Y format'}`);

// Overall result
const allPassed = hasCpuHeader && !hasOldPercentHeader && hasCpuCoresUsedFormat && !hasOldLoadAvg && hasRamSlashFormat && hasDiskSlashFormat;

console.log('\n' + '='.repeat(60));
if (allPassed) {
  console.log('🎉 All formatting tests passed!');
  process.exit(0);
} else {
  console.log('❌ Some formatting tests failed!');
  process.exit(1);
}
