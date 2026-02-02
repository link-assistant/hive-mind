#!/usr/bin/env node
/**
 * Test script for ENOSPC error detection utility (Issue #1212)
 */

import { isENOSPC } from '../src/lib.mjs';

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

console.log('\n📋 isENOSPC Detection Tests\n');

// Test with error code
const enospcError = new Error('write failed');
enospcError.code = 'ENOSPC';
assert(isENOSPC(enospcError), 'Detects error with code ENOSPC');

// Test with ENOSPC in message
assert(isENOSPC(new Error('ENOSPC: no space left on device, write')), 'Detects ENOSPC in error message');

// Test with "no space left on device" in message
assert(isENOSPC(new Error('Error: no space left on device')), 'Detects "no space left on device" in message');

// Test with string input
assert(isENOSPC('ENOSPC: no space left on device, write'), 'Detects ENOSPC in string');

// Test with string containing "no space left"
assert(isENOSPC('no space left on device'), 'Detects "no space left on device" in string');

// Test with npm-style error
assert(isENOSPC('npm error code ENOSPC\nnpm error syscall write\nnpm error errno -28'), 'Detects npm ENOSPC error');

// Negative tests
assert(!isENOSPC(null), 'Returns false for null');
assert(!isENOSPC(undefined), 'Returns false for undefined');
assert(!isENOSPC(new Error('Permission denied')), 'Returns false for non-ENOSPC error');
assert(!isENOSPC('Some other error'), 'Returns false for non-ENOSPC string');
assert(!isENOSPC(''), 'Returns false for empty string');

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
