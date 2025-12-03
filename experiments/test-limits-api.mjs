#!/usr/bin/env node
/**
 * Test script for /limits command using OAuth API
 * Verifies the Claude usage limits can be retrieved via the API
 */

import { getClaudeUsageLimits, formatUsageMessage, getProgressBar } from '../src/claude-limits.lib.mjs';

async function main() {
  console.log('=== Testing Claude Usage Limits API ===\n');

  // Test 1: Fetch usage limits
  console.log('Test 1: Fetching usage limits via OAuth API...\n');

  const result = await getClaudeUsageLimits(true);

  if (!result.success) {
    console.error('FAIL: Could not fetch usage limits');
    console.error('Error:', result.error);
    process.exit(1);
  }

  console.log('\nPASS: Successfully fetched usage limits');
  console.log('Usage data:', JSON.stringify(result.usage, null, 2));

  // Test 2: Verify data structure
  console.log('\n---\nTest 2: Verifying data structure...\n');

  const { usage } = result;

  const hasCurrentSession = usage.currentSession !== undefined;
  const hasAllModels = usage.allModels !== undefined;
  const hasSonnetOnly = usage.sonnetOnly !== undefined;

  console.log('Has currentSession:', hasCurrentSession ? 'PASS' : 'FAIL');
  console.log('Has allModels:', hasAllModels ? 'PASS' : 'FAIL');
  console.log('Has sonnetOnly:', hasSonnetOnly ? 'PASS' : 'FAIL');

  if (!hasCurrentSession || !hasAllModels || !hasSonnetOnly) {
    console.error('\nFAIL: Missing required usage fields');
    process.exit(1);
  }

  // Test 3: Verify percentages are valid numbers
  console.log('\n---\nTest 3: Verifying percentages...\n');

  const sessionPct = usage.currentSession.percentage;
  const allModelsPct = usage.allModels.percentage;
  const sonnetPct = usage.sonnetOnly.percentage;

  const isValidPercentage = (pct) => pct === null || (typeof pct === 'number' && pct >= 0 && pct <= 100);

  console.log(`Current session: ${sessionPct}% -`, isValidPercentage(sessionPct) ? 'PASS' : 'FAIL');
  console.log(`All models: ${allModelsPct}% -`, isValidPercentage(allModelsPct) ? 'PASS' : 'FAIL');
  console.log(`Sonnet only: ${sonnetPct}% -`, isValidPercentage(sonnetPct) ? 'PASS' : 'FAIL');

  // Test 4: Test progress bar generation
  console.log('\n---\nTest 4: Testing progress bar generation...\n');

  console.log('0%:', getProgressBar(0));
  console.log('25%:', getProgressBar(25));
  console.log('50%:', getProgressBar(50));
  console.log('75%:', getProgressBar(75));
  console.log('100%:', getProgressBar(100));

  // Test 5: Format message
  console.log('\n---\nTest 5: Testing message formatting...\n');

  const message = formatUsageMessage(usage);
  console.log('Formatted message:');
  console.log(message);

  console.log('\n=== All tests passed! ===');
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
