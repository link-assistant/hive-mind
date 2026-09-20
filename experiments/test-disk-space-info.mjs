#!/usr/bin/env node
/**
 * Test script for getDiskSpaceInfo function
 * Run with: node experiments/test-disk-space-info.mjs
 */

import { getDiskSpaceInfo, getProgressBar, formatUsageMessage } from '../src/claude-limits.lib.mjs';

async function main() {
  console.log('Testing getDiskSpaceInfo function...\n');

  // Test getDiskSpaceInfo
  const result = await getDiskSpaceInfo(true);

  if (result.success) {
    console.log('\n✅ Disk space info retrieved successfully:');
    console.log(JSON.stringify(result.diskSpace, null, 2));

    // Test progress bar
    console.log('\n📊 Progress bar test:');
    const bar = getProgressBar(result.diskSpace.freePercentage);
    console.log(`${bar} ${result.diskSpace.freePercentage}% free`);
    console.log(`${result.diskSpace.availableFormatted} free of ${result.diskSpace.totalFormatted}`);

    // Test formatted message with mock usage data
    console.log('\n📋 Full formatted message test:');
    const mockUsage = {
      currentSession: { percentage: 25, resetTime: 'Dec 25, 3:00pm UTC', resetsAt: null },
      allModels: { percentage: 40, resetTime: 'Dec 30, 12:00am UTC', resetsAt: null },
      sonnetOnly: { percentage: 15, resetTime: 'Dec 30, 12:00am UTC', resetsAt: null },
    };

    const formattedMessage = formatUsageMessage(mockUsage, result.diskSpace);
    console.log(formattedMessage);
  } else {
    console.log('❌ Failed to get disk space info:', result.error);
  }
}

main().catch(console.error);
