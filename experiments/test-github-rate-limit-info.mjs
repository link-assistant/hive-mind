#!/usr/bin/env node
/**
 * Test script for getGitHubRateLimits function
 * Run with: node experiments/test-github-rate-limit-info.mjs
 */

import { getGitHubRateLimits, getDiskSpaceInfo, getProgressBar, formatUsageMessage } from '../src/claude-limits.lib.mjs';

async function main() {
  console.log('Testing getGitHubRateLimits function...\n');

  // Test getGitHubRateLimits
  const result = await getGitHubRateLimits(true);

  if (result.success) {
    console.log('\n✅ GitHub rate limits retrieved successfully:');
    console.log(JSON.stringify(result.githubRateLimit, null, 2));

    // Test progress bar
    console.log('\n📊 Progress bar test:');
    const bar = getProgressBar(result.githubRateLimit.remainingPercentage);
    console.log(`${bar} ${result.githubRateLimit.remainingPercentage}% available`);
    console.log(`${result.githubRateLimit.remaining}/${result.githubRateLimit.limit} requests remaining`);
    if (result.githubRateLimit.relativeReset) {
      console.log(`Resets in ${result.githubRateLimit.relativeReset} (${result.githubRateLimit.resetTime})`);
    }

    // Test formatted message with mock usage data and disk space
    console.log('\n📋 Full formatted message test:');
    const mockUsage = {
      currentSession: { percentage: 25, resetTime: 'Dec 26, 3:00pm UTC', resetsAt: null },
      allModels: { percentage: 40, resetTime: 'Dec 30, 12:00am UTC', resetsAt: null },
      sonnetOnly: { percentage: 15, resetTime: 'Dec 30, 12:00am UTC', resetsAt: null },
    };

    // Get real disk space info
    const diskSpaceResult = await getDiskSpaceInfo(true);
    const diskSpace = diskSpaceResult.success ? diskSpaceResult.diskSpace : null;

    const formattedMessage = formatUsageMessage(mockUsage, diskSpace, result.githubRateLimit);
    console.log(formattedMessage);
  } else {
    console.log('❌ Failed to get GitHub rate limits:', result.error);
  }
}

main().catch(console.error);
