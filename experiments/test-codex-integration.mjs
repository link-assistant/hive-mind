#!/usr/bin/env node
/**
 * Test script to verify Codex integration
 * This script tests the basic functionality of the codex tool integration
 */

// Import use-m for dynamic imports
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
globalThis.use = use;

const { $ } = await use('command-stream');

// Import codex validation function
const codexLib = await import('../src/codex.lib.mjs');
const { validateCodexConnection, mapModelToId } = codexLib;

console.log('🧪 Testing Codex Integration\n');

// Test 1: Model mapping
console.log('Test 1: Model mapping');
const testModels = ['gpt5', 'gpt5-codex', 'o3', 'o3-mini', 'gpt4o'];
for (const model of testModels) {
  const mapped = mapModelToId(model);
  console.log(`  ✓ ${model} → ${mapped}`);
}
console.log('');

// Test 2: Check if codex CLI is installed
console.log('Test 2: Codex CLI availability');
try {
  const versionResult = await $`codex --version`;
  if (versionResult.code === 0) {
    const version = versionResult.stdout.toString().trim();
    console.log(`  ✓ Codex CLI found: ${version}`);
  } else {
    console.log('  ✗ Codex CLI not found or returned non-zero exit code');
    process.exit(1);
  }
} catch (error) {
  console.log(`  ✗ Codex CLI check failed: ${error.message}`);
  process.exit(1);
}
console.log('');

// Test 3: Validate connection (basic connectivity check)
console.log('Test 3: Connection validation');
try {
  const isConnected = await validateCodexConnection('gpt-5');
  if (isConnected) {
    console.log('  ✓ Codex connection validated successfully');
  } else {
    console.log('  ✗ Codex connection validation failed');
    process.exit(1);
  }
} catch (error) {
  console.log(`  ✗ Connection validation error: ${error.message}`);
  process.exit(1);
}
console.log('');

// Test 4: Check configuration
console.log('Test 4: Configuration check');
try {
  const config = await import('../src/config.lib.mjs');
  const { timeouts } = config;
  console.log(`  ✓ Codex CLI timeout: ${timeouts.codexCli}ms`);
} catch (error) {
  console.log(`  ✗ Configuration error: ${error.message}`);
  process.exit(1);
}
console.log('');

console.log('✅ All tests passed! Codex integration is working correctly.\n');
