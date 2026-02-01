#!/usr/bin/env node

/**
 * Test script for vision capability detection using models.dev API
 * This script verifies that checkModelVisionCapability correctly identifies
 * models that support image input.
 */

// Initialize use-m
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

// Import the vision capability check function
const { checkModelVisionCapability, fetchModelInfo, mapModelToId } = await import('../src/claude.lib.mjs');

console.log('Testing vision capability detection using models.dev API\n');
console.log('='.repeat(60) + '\n');

// Test models (both aliases and full IDs)
const testModels = [
  // Claude models (all should support vision)
  { alias: 'sonnet', expected: true },
  { alias: 'opus', expected: true },
  { alias: 'haiku', expected: true },
  { alias: 'haiku-3-5', expected: true },
  { alias: 'haiku-3', expected: true },
  // Full model IDs
  { alias: 'claude-sonnet-4-5-20250929', expected: true },
  { alias: 'claude-opus-4-5-20251101', expected: true },
  { alias: 'claude-haiku-4-5-20251001', expected: true },
  // Unknown model (should return false gracefully)
  { alias: 'unknown-model-xyz', expected: false },
];

let passCount = 0;
let failCount = 0;

for (const { alias, expected } of testModels) {
  const mappedModel = mapModelToId(alias);
  const supportsVision = await checkModelVisionCapability(mappedModel);
  const passed = supportsVision === expected;

  if (passed) {
    passCount++;
    console.log(`[PASS] ${alias} (${mappedModel})`);
    console.log(`       Vision: ${supportsVision} (expected: ${expected})`);
  } else {
    failCount++;
    console.log(`[FAIL] ${alias} (${mappedModel})`);
    console.log(`       Vision: ${supportsVision} (expected: ${expected})`);
  }
  console.log('');
}

// Also test the raw model info to verify the data structure
console.log('='.repeat(60));
console.log('\nRaw model info sample (claude-opus-4-5-20251101):');
const opusInfo = await fetchModelInfo('claude-opus-4-5-20251101');
if (opusInfo) {
  console.log(`  Name: ${opusInfo.name || 'N/A'}`);
  console.log(`  Provider: ${opusInfo.provider || 'N/A'}`);
  console.log(`  Input modalities: ${JSON.stringify(opusInfo.modalities?.input || [])}`);
  console.log(`  Output modalities: ${JSON.stringify(opusInfo.modalities?.output || [])}`);
  console.log(`  Has vision: ${(opusInfo.modalities?.input || []).includes('image')}`);
} else {
  console.log('  Could not fetch model info');
}

console.log('\n' + '='.repeat(60));
console.log(`\nResults: ${passCount} passed, ${failCount} failed`);
process.exit(failCount > 0 ? 1 : 0);
