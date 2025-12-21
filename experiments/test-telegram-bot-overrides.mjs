#!/usr/bin/env node

/**
 * Test script for telegram bot options override functionality
 *
 * Tests:
 * 1. mergeArgsWithOverrides function with boolean flags
 * 2. mergeArgsWithOverrides function with duplet flags (flag + value)
 * 3. Proper removal of conflicting user args
 * 4. Handling of multiple overrides
 */

import { strict as assert } from 'assert';

// Mock the mergeArgsWithOverrides function
function mergeArgsWithOverrides(userArgs, overrides) {
  if (!overrides || overrides.length === 0) {
    return userArgs;
  }

  // Parse overrides to identify flags and their values
  const overrideFlags = new Map(); // Map of flag -> value (or null for boolean flags)

  for (let i = 0; i < overrides.length; i++) {
    const arg = overrides[i];
    if (arg.startsWith('--')) {
      // Check if next item is a value (doesn't start with --)
      if (i + 1 < overrides.length && !overrides[i + 1].startsWith('--')) {
        overrideFlags.set(arg, overrides[i + 1]);
        i++; // Skip the value in next iteration
      } else {
        overrideFlags.set(arg, null); // Boolean flag
      }
    }
  }

  // Filter user args to remove any that conflict with overrides
  const filteredArgs = [];
  for (let i = 0; i < userArgs.length; i++) {
    const arg = userArgs[i];
    if (arg.startsWith('--')) {
      // If this flag exists in overrides, skip it and its value
      if (overrideFlags.has(arg)) {
        // Skip the flag
        // Also skip next arg if it's a value (doesn't start with --)
        if (i + 1 < userArgs.length && !userArgs[i + 1].startsWith('--')) {
          i++; // Skip the value too
        }
        continue;
      }
    }
    filteredArgs.push(arg);
  }

  // Merge: filtered user args + overrides
  return [...filteredArgs, ...overrides];
}

// Test cases
const tests = [
  {
    name: 'No overrides - returns user args unchanged',
    userArgs: ['https://github.com/owner/repo/issues/123', '--verbose', '--fork'],
    overrides: [],
    expected: ['https://github.com/owner/repo/issues/123', '--verbose', '--fork'],
  },
  {
    name: 'Boolean flag override - removes user flag',
    userArgs: ['https://github.com/owner/repo/issues/123', '--verbose'],
    overrides: ['--auto-continue'],
    expected: ['https://github.com/owner/repo/issues/123', '--verbose', '--auto-continue'],
  },
  {
    name: 'Duplet override - removes user duplet',
    userArgs: ['https://github.com/owner/repo/issues/123', '--tool', 'haiku'],
    overrides: ['--tool', 'opencode'],
    expected: ['https://github.com/owner/repo/issues/123', '--tool', 'opencode'],
  },
  {
    name: 'Multiple overrides with mixed types',
    userArgs: ['https://github.com/owner/repo/issues/123', '--verbose', '--tool', 'haiku', '--fork'],
    overrides: ['--auto-continue', '--attach-logs', '--tool', 'opencode'],
    expected: ['https://github.com/owner/repo/issues/123', '--verbose', '--fork', '--auto-continue', '--attach-logs', '--tool', 'opencode'],
  },
  {
    name: 'Override replaces existing flag',
    userArgs: ['https://github.com/owner/repo/issues/123', '--auto-continue', '--verbose'],
    overrides: ['--auto-continue'],
    expected: ['https://github.com/owner/repo/issues/123', '--verbose', '--auto-continue'],
  },
  {
    name: 'Multiple duplets with same flag',
    userArgs: ['https://github.com/owner/repo/issues/123', '--model', 'haiku', '--verbose'],
    overrides: ['--model', 'sonnet', '--think', 'max'],
    expected: ['https://github.com/owner/repo/issues/123', '--verbose', '--model', 'sonnet', '--think', 'max'],
  },
  {
    name: 'Complex real-world scenario',
    userArgs: ['https://github.com/owner/repo/issues/123', '--fork', '--model', 'haiku', '--verbose'],
    overrides: ['--auto-continue', '--attach-logs', '--verbose', '--tool', 'opencode'],
    expected: ['https://github.com/owner/repo/issues/123', '--fork', '--model', 'haiku', '--auto-continue', '--attach-logs', '--verbose', '--tool', 'opencode'],
  },
  {
    name: 'URL preserved as first argument',
    userArgs: ['https://github.com/owner/repo/issues/123'],
    overrides: ['--auto-continue', '--verbose'],
    expected: ['https://github.com/owner/repo/issues/123', '--auto-continue', '--verbose'],
  },
];

let passed = 0;
let failed = 0;

console.log('🧪 Running telegram bot override tests...\n');

for (const test of tests) {
  try {
    const result = mergeArgsWithOverrides(test.userArgs, test.overrides);
    assert.deepEqual(result, test.expected);
    console.log(`✅ PASS: ${test.name}`);
    passed++;
  } catch (error) {
    console.error(`❌ FAIL: ${test.name}`);
    console.error(`   Expected: ${JSON.stringify(test.expected)}`);
    console.error(`   Got:      ${JSON.stringify(mergeArgsWithOverrides(test.userArgs, test.overrides))}`);
    failed++;
  }
}

console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);

if (failed > 0) {
  process.exit(1);
}

console.log('✅ All tests passed!');
