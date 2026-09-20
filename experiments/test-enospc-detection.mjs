#!/usr/bin/env node
/**
 * Test script for ENOSPC error detection utility (Issue #1212)
 */

import { isENOSPC } from '../src/lib.mjs';
import { classifyCloneError } from '../src/solve.repository.lib.mjs';

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

// Issue #1211: Git clone ENOSPC patterns
assert(isENOSPC('error: unable to write file backtest-results-full/test-000189.json'), 'Detects git clone "unable to write file" error');
assert(isENOSPC("fatal: cannot create directory at 'backtest-results-test': No space left on device"), 'Detects git clone "cannot create directory: No space left on device"');
assert(isENOSPC("error: unable to write file foo.json\nerror: unable to write file bar.json\nfatal: cannot create directory at 'dir': No space left on device"), 'Detects multi-line git clone ENOSPC output');

// Negative tests
assert(!isENOSPC(null), 'Returns false for null');
assert(!isENOSPC(undefined), 'Returns false for undefined');
assert(!isENOSPC(new Error('Permission denied')), 'Returns false for non-ENOSPC error');
assert(!isENOSPC('Some other error'), 'Returns false for non-ENOSPC string');
assert(!isENOSPC(''), 'Returns false for empty string');
assert(!isENOSPC('unable to find file'), 'Returns false for "unable to find file" (no write)');

// classifyCloneError ENOSPC tests (Issue #1211)
console.log('\n📋 classifyCloneError ENOSPC Tests\n');

const cloneEnospc1 = classifyCloneError("error: unable to write file backtest-results-full/test-000189.json\nfatal: cannot create directory at 'dir': No space left on device");
assert(cloneEnospc1.type === 'ENOSPC', 'classifyCloneError: detects ENOSPC from git clone output');
assert(cloneEnospc1.retryable === false, 'classifyCloneError: ENOSPC is not retryable');

const cloneEnospc2 = classifyCloneError('npm error code ENOSPC\nnpm error errno -28');
assert(cloneEnospc2.type === 'ENOSPC', 'classifyCloneError: detects npm ENOSPC');

const cloneNetwork = classifyCloneError('connection refused');
assert(cloneNetwork.type === 'NETWORK', 'classifyCloneError: network error still detected correctly');

const cloneNotFound = classifyCloneError('error: 404 repository not found');
assert(cloneNotFound.type === 'NOT_FOUND', 'classifyCloneError: 404 still detected correctly');

console.log(`\n📊 Results: ${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
