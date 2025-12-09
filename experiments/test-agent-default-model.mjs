#!/usr/bin/env node
// Test script for verifying the agent tool default model fix (issue #865)

import { initializeConfig, parseArguments } from '../src/solve.config.lib.mjs';

// Initialize use
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

console.log('🧪 Testing Agent Tool Default Model Fix (Issue #865)\n');

// Initialize yargs
const { yargs, hideBin } = await initializeConfig(use);

// Test cases
const testCases = [
  {
    name: 'Agent tool without model flag',
    args: ['https://github.com/test/repo/issues/1', '--tool', 'agent'],
    expected: { tool: 'agent', model: 'grok-code' }
  },
  {
    name: 'Agent tool with explicit model',
    args: ['https://github.com/test/repo/issues/1', '--tool', 'agent', '--model', 'sonnet'],
    expected: { tool: 'agent', model: 'sonnet' }
  },
  {
    name: 'Codex tool without model flag',
    args: ['https://github.com/test/repo/issues/1', '--tool', 'codex'],
    expected: { tool: 'codex', model: 'gpt-5' }
  },
  {
    name: 'Claude tool (default) without model flag',
    args: ['https://github.com/test/repo/issues/1'],
    expected: { tool: undefined, model: 'sonnet' }
  }
];

let passed = 0;
let failed = 0;

for (const testCase of testCases) {
  try {
    // Simulate process.argv for this test
    const originalArgv = process.argv;
    process.argv = ['node', 'solve.mjs', ...testCase.args];

    // Parse arguments using the same function as solve.mjs
    const argv = await parseArguments(yargs, hideBin);

    // Restore original argv
    process.argv = originalArgv;

    // Check tool
    const toolMatch = testCase.expected.tool === undefined
      ? argv.tool === undefined || argv.tool === 'claude'
      : argv.tool === testCase.expected.tool;

    // Check model
    const modelMatch = argv.model === testCase.expected.model;

    if (toolMatch && modelMatch) {
      console.log(`✅ PASS: ${testCase.name}`);
      console.log(`   Tool: ${argv.tool || 'claude (default)'}, Model: ${argv.model}\n`);
      passed++;
    } else {
      console.log(`❌ FAIL: ${testCase.name}`);
      console.log(`   Expected: tool=${testCase.expected.tool || 'claude'}, model=${testCase.expected.model}`);
      console.log(`   Got:      tool=${argv.tool || 'claude'}, model=${argv.model}\n`);
      failed++;
    }
  } catch (error) {
    console.log(`❌ ERROR: ${testCase.name}`);
    console.log(`   ${error.message}\n`);
    failed++;
  }
}

// Summary
console.log('─'.repeat(50));
console.log(`\n📊 Test Results: ${passed} passed, ${failed} failed`);

if (failed === 0) {
  console.log('✅ All tests passed! The fix is working correctly.\n');
  process.exit(0);
} else {
  console.log('❌ Some tests failed. Please review the fix.\n');
  process.exit(1);
}
