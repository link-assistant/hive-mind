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
  // Issue #1263: Agent now extracts lastTextContent from JSON output stream
  assertTrue(agentLib.includes('resultSummary: lastTextContent || null') || agentLib.includes('resultSummary: null'), 'resultSummary should be in return statements');
  assertTrue(agentLib.includes('lastTextContent'), 'lastTextContent variable should be declared for result summary');
});

runTest('codex.lib.mjs includes resultSummary in return type', async () => {
  const fs = await import('fs');
  const codexLib = fs.readFileSync('./src/codex.lib.mjs', 'utf-8');
  // Issue #1263: Codex now extracts lastTextContent from JSON output stream
  assertTrue(codexLib.includes('resultSummary: lastTextContent || null') || codexLib.includes('resultSummary: null'), 'resultSummary should be in return statements');
  assertTrue(codexLib.includes('lastTextContent'), 'lastTextContent variable should be declared for result summary');
});

runTest('opencode.lib.mjs includes resultSummary in return type', async () => {
  const fs = await import('fs');
  const opencodeLib = fs.readFileSync('./src/opencode.lib.mjs', 'utf-8');
  // Issue #1263: OpenCode now extracts lastTextContent from JSON output stream
  assertTrue(opencodeLib.includes('resultSummary: lastTextContent || null') || opencodeLib.includes('resultSummary: null'), 'resultSummary should be in return statements');
  assertTrue(opencodeLib.includes('lastTextContent'), 'lastTextContent variable should be declared for result summary');
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

// Issue #1625: Tool-generated comments should not count as AI-created comments
console.log('\n📋 Tool-Generated Comment Filter Tests (Issue #1625)\n');

runTest('solve.results.lib.mjs exports isToolGeneratedComment helper', async () => {
  const resultsLib = await import('../src/solve.results.lib.mjs');
  assertTrue(typeof resultsLib.isToolGeneratedComment === 'function', 'isToolGeneratedComment should be exported');
});

runTest('solve.results.lib.mjs exports TOOL_GENERATED_COMMENT_MARKERS constant', async () => {
  const resultsLib = await import('../src/solve.results.lib.mjs');
  assertTrue(Array.isArray(resultsLib.TOOL_GENERATED_COMMENT_MARKERS), 'TOOL_GENERATED_COMMENT_MARKERS should be an array');
  assertTrue(resultsLib.TOOL_GENERATED_COMMENT_MARKERS.length > 0, 'TOOL_GENERATED_COMMENT_MARKERS should not be empty');
});

runTest('isToolGeneratedComment detects "AI Work Session Started" (Issue #1625)', async () => {
  const { isToolGeneratedComment } = await import('../src/solve.results.lib.mjs');
  const sessionStarted = '🤖 **AI Work Session Started**\n\nStarting automated work session at 2026-04-17T17:38:40.995Z\n\nThe PR has been converted to draft mode while work is in progress.\n\n_This comment marks the beginning of an AI work session. Please wait for the session to finish, and provide your feedback._';
  assertTrue(isToolGeneratedComment(sessionStarted), 'Session start comment should be recognized as tool-generated');
});

runTest('isToolGeneratedComment detects "Solution Draft Log" (Issue #1625)', async () => {
  const { isToolGeneratedComment } = await import('../src/solve.results.lib.mjs');
  const solutionDraftLog = '## 🤖 Solution Draft Log\nThis log file contains the complete execution trace of the AI solution draft process.';
  assertTrue(isToolGeneratedComment(solutionDraftLog), 'Solution Draft Log comment should be recognized as tool-generated');
});

runTest('isToolGeneratedComment detects "Auto-restart" (Issue #1625)', async () => {
  const { isToolGeneratedComment } = await import('../src/solve.results.lib.mjs');
  const autoRestart = '## 🔄 Auto-restart 1/3\n\nDetected uncommitted changes from previous run.';
  assertTrue(isToolGeneratedComment(autoRestart), 'Auto-restart comment should be recognized as tool-generated');
});

runTest('isToolGeneratedComment detects "Ready to merge" (Issue #1625)', async () => {
  const { isToolGeneratedComment } = await import('../src/solve.results.lib.mjs');
  const readyToMerge = '## ✅ Ready to merge\n\nThis pull request is now ready to be merged.';
  assertTrue(isToolGeneratedComment(readyToMerge), 'Ready to merge comment should be recognized as tool-generated');
});

runTest('isToolGeneratedComment returns false for real AI comments (Issue #1625)', async () => {
  const { isToolGeneratedComment } = await import('../src/solve.results.lib.mjs');
  const aiComment = 'Follow-up pushed in commit 4c3c6016 after the latest owner feedback. The remaining issue was that the floor was a ColorRect.';
  assertFalse(isToolGeneratedComment(aiComment), 'Real AI comment should NOT be recognized as tool-generated');
});

runTest('isToolGeneratedComment returns false for human comments (Issue #1625)', async () => {
  const { isToolGeneratedComment } = await import('../src/solve.results.lib.mjs');
  const humanComment = 'please fix the floor flash, it is still not working';
  assertFalse(isToolGeneratedComment(humanComment), 'Human comment should NOT be recognized as tool-generated');
});

runTest('isToolGeneratedComment returns false for empty/null/non-string input (Issue #1625)', async () => {
  const { isToolGeneratedComment } = await import('../src/solve.results.lib.mjs');
  assertFalse(isToolGeneratedComment(''), 'Empty string should return false');
  assertFalse(isToolGeneratedComment(null), 'Null should return false');
  assertFalse(isToolGeneratedComment(undefined), 'Undefined should return false');
  assertFalse(isToolGeneratedComment(42), 'Number should return false');
  assertFalse(isToolGeneratedComment({}), 'Object should return false');
});

runTest('TOOL_GENERATED_COMMENT_MARKERS covers all known session-related markers (Issue #1625)', async () => {
  const { TOOL_GENERATED_COMMENT_MARKERS } = await import('../src/solve.results.lib.mjs');
  const expectedMarkers = ['AI Work Session Started', 'AI Work Session Completed', 'AI Work Session Resumed', 'Solution Draft Log', 'Auto-restart', 'Ready to merge'];
  for (const marker of expectedMarkers) {
    assertTrue(TOOL_GENERATED_COMMENT_MARKERS.includes(marker), `TOOL_GENERATED_COMMENT_MARKERS should include "${marker}"`);
  }
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
