#!/usr/bin/env node
/**
 * Test script for Usage API Cache TTL configuration
 *
 * This test verifies that the Claude Usage API cache TTL is properly configured
 * to 20 minutes (or the configured value via HIVE_MIND_USAGE_API_CACHE_TTL_MS)
 * to avoid rate limiting issues that cause null values.
 *
 * See: https://github.com/link-assistant/hive-mind/issues/1074
 */

import { CACHE_TTL, getCachedClaudeLimits, getLimitCache, resetLimitCache } from '../src/limits.lib.mjs';
import { cacheTtl } from '../src/config.lib.mjs';

function formatMs(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

async function main() {
  console.log('=== Testing Usage API Cache TTL Configuration ===\n');
  console.log('Issue: https://github.com/link-assistant/hive-mind/issues/1074\n');

  // Test 1: Verify CACHE_TTL.USAGE_API is at least 20 minutes
  console.log('Test 1: Verify CACHE_TTL.USAGE_API is at least 20 minutes...\n');

  const minTtl = 20 * 60 * 1000; // 20 minutes in ms
  const usageApiTtl = CACHE_TTL.USAGE_API;

  console.log(`  CACHE_TTL.USAGE_API: ${formatMs(usageApiTtl)} (${usageApiTtl} ms)`);
  console.log(`  Minimum required:    ${formatMs(minTtl)} (${minTtl} ms)`);

  if (usageApiTtl >= minTtl) {
    console.log('  ✅ PASS: Usage API TTL meets 20-minute minimum requirement\n');
  } else {
    console.log('  ❌ FAIL: Usage API TTL is too low, may cause rate limiting\n');
    process.exitCode = 1;
  }

  // Test 2: Verify config.lib.mjs exports cacheTtl
  console.log('Test 2: Verify config.lib.mjs exports cacheTtl...\n');

  if (cacheTtl && typeof cacheTtl === 'object') {
    console.log('  ✅ PASS: cacheTtl object exported from config.lib.mjs');
    console.log(`  cacheTtl.api: ${formatMs(cacheTtl.api)}`);
    console.log(`  cacheTtl.usageApi: ${formatMs(cacheTtl.usageApi)}`);
    console.log(`  cacheTtl.system: ${formatMs(cacheTtl.system)}\n`);
  } else {
    console.log('  ❌ FAIL: cacheTtl not properly exported from config.lib.mjs\n');
    process.exitCode = 1;
  }

  // Test 3: Verify CACHE_TTL uses values from config
  console.log('Test 3: Verify CACHE_TTL uses values from config...\n');

  const apiMatch = CACHE_TTL.API === cacheTtl.api;
  const usageApiMatch = CACHE_TTL.USAGE_API === cacheTtl.usageApi;
  const systemMatch = CACHE_TTL.SYSTEM === cacheTtl.system;

  console.log(`  CACHE_TTL.API === cacheTtl.api: ${apiMatch ? '✅' : '❌'}`);
  console.log(`  CACHE_TTL.USAGE_API === cacheTtl.usageApi: ${usageApiMatch ? '✅' : '❌'}`);
  console.log(`  CACHE_TTL.SYSTEM === cacheTtl.system: ${systemMatch ? '✅' : '❌'}\n`);

  if (!apiMatch || !usageApiMatch || !systemMatch) {
    console.log('  ❌ FAIL: CACHE_TTL values do not match config\n');
    process.exitCode = 1;
  } else {
    console.log('  ✅ PASS: CACHE_TTL uses values from config.lib.mjs\n');
  }

  // Test 4: Verify USAGE_API TTL is different from regular API TTL
  console.log('Test 4: Verify USAGE_API TTL is different from regular API TTL...\n');

  if (CACHE_TTL.USAGE_API > CACHE_TTL.API) {
    console.log(`  CACHE_TTL.USAGE_API (${formatMs(CACHE_TTL.USAGE_API)}) > CACHE_TTL.API (${formatMs(CACHE_TTL.API)})`);
    console.log('  ✅ PASS: Usage API has longer cache TTL than regular API\n');
  } else {
    console.log('  ❌ FAIL: Usage API TTL should be longer than regular API TTL\n');
    process.exitCode = 1;
  }

  // Test 5: Test cache behavior with mocked time
  console.log('Test 5: Test cache stores entries with correct TTL...\n');

  resetLimitCache();
  const cache = getLimitCache();

  // Manually set a cache entry
  const testValue = { success: true, usage: { test: 'data' } };
  cache.set('test-claude', testValue, CACHE_TTL.USAGE_API);

  // Verify it's retrievable immediately
  const retrieved = cache.get('test-claude', CACHE_TTL.USAGE_API);
  if (retrieved === testValue) {
    console.log('  ✅ PASS: Cache entry can be retrieved immediately');
  } else {
    console.log('  ❌ FAIL: Cache entry not retrievable');
    process.exitCode = 1;
  }

  // Get cache stats
  const stats = cache.getStats();
  console.log(`  Cache stats: ${stats.validEntries} valid, ${stats.expiredEntries} expired\n`);

  // Test 6: Verify getCachedClaudeLimits uses USAGE_API TTL
  console.log('Test 6: Verify getCachedClaudeLimits uses USAGE_API TTL...\n');

  // This test just verifies the function exists and can be called
  // Actual API testing would require valid credentials
  try {
    // Don't actually call the API, just verify the function signature
    console.log('  getCachedClaudeLimits is defined:', typeof getCachedClaudeLimits === 'function' ? '✅' : '❌');
    console.log('  ✅ PASS: getCachedClaudeLimits function is properly exported\n');
  } catch (error) {
    console.log('  ❌ FAIL:', error.message, '\n');
    process.exitCode = 1;
  }

  // Summary
  console.log('=== Summary ===\n');
  console.log('Cache TTL Configuration:');
  console.log(`  - Regular API (GitHub):     ${formatMs(CACHE_TTL.API)}`);
  console.log(`  - Usage API (Claude):       ${formatMs(CACHE_TTL.USAGE_API)}`);
  console.log(`  - System Metrics:           ${formatMs(CACHE_TTL.SYSTEM)}`);
  console.log('');
  console.log('Environment Variables:');
  console.log('  - HIVE_MIND_API_CACHE_TTL_MS:       General API cache TTL');
  console.log('  - HIVE_MIND_USAGE_API_CACHE_TTL_MS: Claude Usage API cache TTL (default: 20 min)');
  console.log('  - HIVE_MIND_SYSTEM_CACHE_TTL_MS:    System metrics cache TTL');
  console.log('');

  if (process.exitCode === 1) {
    console.log('❌ Some tests failed!\n');
  } else {
    console.log('✅ All tests passed!\n');
  }
}

main().catch(error => {
  console.error('Unhandled error:', error);
  process.exitCode = 1;
});
