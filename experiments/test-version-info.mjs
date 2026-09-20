#!/usr/bin/env node

// Test script for version-info.lib.mjs

import { getVersionInfo, formatVersionMessage } from '../src/version-info.lib.mjs';

console.log('Testing version-info library...\n');

// Test getVersionInfo
console.log('1. Testing getVersionInfo():');
const result = await getVersionInfo(true);

console.log('\nResult:');
console.log(JSON.stringify(result, null, 2));

// Test formatVersionMessage
if (result.success) {
  console.log('\n2. Testing formatVersionMessage():');
  const message = formatVersionMessage(result.versions);
  console.log('\nFormatted message:');
  console.log(message);

  console.log('\n✅ All tests passed!');
} else {
  console.log('\n❌ getVersionInfo failed:', result.error);
  process.exit(1);
}
