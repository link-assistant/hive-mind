#!/usr/bin/env node
/**
 * Test script to fetch actual Claude usage limits and display with double progress bars
 */

import { getClaudeUsageLimits, formatUsageMessage } from '../src/claude-limits.lib.mjs';

console.log('Fetching actual Claude usage limits...\n');

const result = await getClaudeUsageLimits(true);

if (!result.success) {
  console.error('❌ Error:', result.error);
  process.exit(1);
}

console.log('\n📊 Claude Usage Limits\n');
console.log(formatUsageMessage(result.usage));

console.log('\n✅ Successfully fetched and displayed usage limits with double progress bars!');
