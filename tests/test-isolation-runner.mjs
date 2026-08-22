#!/usr/bin/env node
/**
 * Tests for isolation-runner.lib.mjs
 *
 * Tests the isolation runner module that wraps $ from start-command
 * for executing commands in isolated environments with GUID-based tracking.
 *
 * @see https://github.com/link-assistant/hive-mind/issues/380
 */

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    failed++;
  }
}

const originalFetch = globalThis.fetch;
const originalUse = globalThis.use;
let importFetchCalls = 0;
let isolationRunner;

try {
  globalThis.fetch = async url => {
    importFetchCalls++;
    throw new Error(`Unexpected network fetch during isolation-runner import: ${url}`);
  };
  delete globalThis.use;
  isolationRunner = await import(`../src/isolation-runner.lib.mjs?issue2025=${Date.now()}`);
} finally {
  globalThis.fetch = originalFetch;
  if (originalUse === undefined) {
    delete globalThis.use;
  } else {
    globalThis.use = originalUse;
  }
}

const { generateSessionId, isValidIsolationBackend, VALID_ISOLATION_BACKENDS } = isolationRunner;

console.log('Testing isolation-runner.lib.mjs');
console.log('='.repeat(60));

// Import should not fetch use-m/command-stream for pure helper tests.
console.log('\n  import side effects:');

assert(importFetchCalls === 0, 'Importing pure helpers does not fetch use-m bootstrap');

// Test generateSessionId
console.log('\n  generateSessionId:');

const id1 = generateSessionId();
const id2 = generateSessionId();
assert(typeof id1 === 'string', 'Returns a string');
assert(id1.length === 36, 'UUID has correct length (36 chars)');
assert(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id1), 'UUID matches v4 format');
assert(id1 !== id2, 'Generates unique IDs');

// Test isValidIsolationBackend
console.log('\n  isValidIsolationBackend:');

assert(isValidIsolationBackend('screen') === true, 'screen is valid');
assert(isValidIsolationBackend('tmux') === true, 'tmux is valid');
assert(isValidIsolationBackend('docker') === true, 'docker is valid');
assert(isValidIsolationBackend('ssh') === false, 'ssh is not valid (not supported in telegram bot)');
assert(isValidIsolationBackend('invalid') === false, 'invalid backend is rejected');
assert(isValidIsolationBackend('') === false, 'empty string is rejected');

// Test VALID_ISOLATION_BACKENDS
console.log('\n  VALID_ISOLATION_BACKENDS:');

assert(Array.isArray(VALID_ISOLATION_BACKENDS), 'Is an array');
assert(VALID_ISOLATION_BACKENDS.length === 3, 'Has 3 backends');
assert(VALID_ISOLATION_BACKENDS.includes('screen'), 'Contains screen');
assert(VALID_ISOLATION_BACKENDS.includes('tmux'), 'Contains tmux');
assert(VALID_ISOLATION_BACKENDS.includes('docker'), 'Contains docker');

// Results
console.log('\n' + '='.repeat(60));
console.log(`Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log('='.repeat(60));

if (failed > 0) {
  console.error(`\n❌ ${failed} test(s) failed!`);
  process.exit(1);
} else {
  console.log('\n✅ All tests passed!');
}
