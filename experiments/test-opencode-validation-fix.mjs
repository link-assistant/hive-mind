#!/usr/bin/env node

/**
 * Test script to verify the OpenCode validation fix
 * Tests that timeouts are calculated correctly without producing NaN
 */

// Load use-m
globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;

console.log('Testing OpenCode validation fix...\n');

// Test 1: Verify config has opencodeCli timeout
console.log('Test 1: Verify config has opencodeCli timeout');
const config = await import('../src/config.lib.mjs');
console.log('  timeouts.opencodeCli:', config.timeouts.opencodeCli);
if (config.timeouts.opencodeCli && !isNaN(config.timeouts.opencodeCli)) {
  console.log('  ✅ PASS: opencodeCli timeout is defined and not NaN');
} else {
  console.log('  ❌ FAIL: opencodeCli timeout is undefined or NaN');
  process.exit(1);
}

// Test 2: Verify timeout calculations work correctly
console.log('\nTest 2: Verify timeout calculations');
const timeoutInSeconds = Math.floor(config.timeouts.opencodeCli / 1000);
console.log('  Calculated timeout in seconds:', timeoutInSeconds);
if (timeoutInSeconds && !isNaN(timeoutInSeconds) && timeoutInSeconds > 0) {
  console.log('  ✅ PASS: Timeout calculation produces valid number');
} else {
  console.log('  ❌ FAIL: Timeout calculation produces NaN or invalid value');
  process.exit(1);
}

// Test 3: Verify model mapping includes grok-code-fast-1
console.log('\nTest 3: Verify model mapping');
const opencodeLib = await import('../src/opencode.lib.mjs');
const mappedModel = opencodeLib.mapModelToId('grok-code-fast-1');
console.log('  Mapped model for grok-code-fast-1:', mappedModel);
if (mappedModel === 'opencode/grok-code') {
  console.log('  ✅ PASS: grok-code-fast-1 maps correctly');
} else {
  console.log('  ❌ FAIL: grok-code-fast-1 mapping incorrect');
  process.exit(1);
}

console.log('\n✅ All tests passed!');
