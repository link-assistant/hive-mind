#!/usr/bin/env node

/**
 * Test suite for solution summary attachment functionality
 * Tests the --attach-solution-summary and --auto-attach-solution-summary options
 * Related issues:
 *   - https://github.com/link-assistant/hive-mind/issues/1263
 */

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('\x1b[32m\u2713 PASSED\x1b[0m');
    testsPassed++;
  } catch (error) {
    console.log(`\x1b[31m\u2717 FAILED: ${error.message}\x1b[0m`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(`${message}: expected "${expected}", got "${actual}"`);
  }
}

function assertTrue(value, message) {
  if (!value) {
    throw new Error(`${message}: expected truthy value`);
  }
}

function assertFalse(value, message) {
  if (value) {
    throw new Error(`${message}: expected falsy value`);
  }
}

console.log('\n================================================================================');
console.log('Unit Tests: Solution Summary Attachment (Issue #1263)');
console.log('================================================================================\n');

// Test that the option definitions exist in solve.config.lib.mjs
console.log('📋 Option Definition Tests\n');

runTest('SOLVE_OPTION_DEFINITIONS includes attach-solution-summary', async () => {
  const { SOLVE_OPTION_DEFINITIONS } = await import('../src/solve.config.lib.mjs');
  assertTrue(SOLVE_OPTION_DEFINITIONS['attach-solution-summary'], 'Option should exist');
  assertEqual(SOLVE_OPTION_DEFINITIONS['attach-solution-summary'].type, 'boolean', 'Type should be boolean');
  assertEqual(SOLVE_OPTION_DEFINITIONS['attach-solution-summary'].default, false, 'Default should be false');
});

runTest('SOLVE_OPTION_DEFINITIONS includes auto-attach-solution-summary', async () => {
  const { SOLVE_OPTION_DEFINITIONS } = await import('../src/solve.config.lib.mjs');
  assertTrue(SOLVE_OPTION_DEFINITIONS['auto-attach-solution-summary'], 'Option should exist');
  assertEqual(SOLVE_OPTION_DEFINITIONS['auto-attach-solution-summary'].type, 'boolean', 'Type should be boolean');
  assertEqual(SOLVE_OPTION_DEFINITIONS['auto-attach-solution-summary'].default, false, 'Default should be false');
});

// Test the attachSolutionSummary function (mock test)
console.log('\n📋 Function Export Tests\n');

runTest('solve.results.lib.mjs exports checkForAiCreatedComments', async () => {
  const resultsLib = await import('../src/solve.results.lib.mjs');
  assertTrue(typeof resultsLib.checkForAiCreatedComments === 'function', 'Function should be exported');
});

runTest('solve.results.lib.mjs exports attachSolutionSummary', async () => {
  const resultsLib = await import('../src/solve.results.lib.mjs');
  assertTrue(typeof resultsLib.attachSolutionSummary === 'function', 'Function should be exported');
});

// Test that resultSummary is included in tool return types
console.log('\n📋 Tool Return Type Tests\n');

runTest('claude.lib.mjs exports resultSummary in return type (by checking variable initialization)', async () => {
  // We can't easily test the return type without running the function,
  // but we can verify that the code was modified by checking if the variable is declared
  const fs = await import('fs');
  const claudeLib = fs.readFileSync('./src/claude.lib.mjs', 'utf-8');
  assertTrue(claudeLib.includes('let resultSummary = null'), 'resultSummary variable should be declared');
  assertTrue(claudeLib.includes('resultSummary, // Issue #1263'), 'resultSummary should be in return statements');
});

runTest('agent.lib.mjs includes resultSummary in return type', async () => {
  const fs = await import('fs');
  const agentLib = fs.readFileSync('./src/agent.lib.mjs', 'utf-8');
  assertTrue(agentLib.includes('resultSummary: null, // Issue #1263'), 'resultSummary should be in return statements');
});

runTest('codex.lib.mjs includes resultSummary in return type', async () => {
  const fs = await import('fs');
  const codexLib = fs.readFileSync('./src/codex.lib.mjs', 'utf-8');
  assertTrue(codexLib.includes('resultSummary: null, // Issue #1263'), 'resultSummary should be in return statements');
});

runTest('opencode.lib.mjs includes resultSummary in return type', async () => {
  const fs = await import('fs');
  const opencodeLib = fs.readFileSync('./src/opencode.lib.mjs', 'utf-8');
  assertTrue(opencodeLib.includes('resultSummary: null, // Issue #1263'), 'resultSummary should be in return statements');
});

// Test solve.mjs integration
console.log('\n📋 Integration Tests\n');

runTest('solve.mjs imports checkForAiCreatedComments and attachSolutionSummary', async () => {
  const fs = await import('fs');
  const solveMjs = fs.readFileSync('./src/solve.mjs', 'utf-8');
  assertTrue(solveMjs.includes('checkForAiCreatedComments'), 'checkForAiCreatedComments should be imported');
  assertTrue(solveMjs.includes('attachSolutionSummary'), 'attachSolutionSummary should be imported');
});

runTest('solve.mjs extracts resultSummary from toolResult', async () => {
  const fs = await import('fs');
  const solveMjs = fs.readFileSync('./src/solve.mjs', 'utf-8');
  assertTrue(solveMjs.includes('let resultSummary = toolResult.resultSummary'), 'resultSummary should be extracted from toolResult');
});

runTest('solve.mjs handles --attach-solution-summary flag', async () => {
  const fs = await import('fs');
  const solveMjs = fs.readFileSync('./src/solve.mjs', 'utf-8');
  assertTrue(solveMjs.includes('argv.attachSolutionSummary'), 'attachSolutionSummary flag should be checked');
});

runTest('solve.mjs handles --auto-attach-solution-summary flag', async () => {
  const fs = await import('fs');
  const solveMjs = fs.readFileSync('./src/solve.mjs', 'utf-8');
  assertTrue(solveMjs.includes('argv.autoAttachSolutionSummary'), 'autoAttachSolutionSummary flag should be checked');
});

// Print summary
console.log('\n================================================================================');
console.log(`Test Results for Solution Summary Attachment:`);
console.log(`  \x1b[32m✅ Passed: ${testsPassed}\x1b[0m`);
console.log(`  \x1b[31m❌ Failed: ${testsFailed}\x1b[0m`);
console.log(`  Total: ${testsPassed + testsFailed}`);
console.log('================================================================================\n');

if (testsFailed > 0) {
  process.exit(1);
}
