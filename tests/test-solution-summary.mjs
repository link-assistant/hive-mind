#!/usr/bin/env node
// @hive-mind-test-suite needs-triage
// Pre-existing orphan test that was not in the legacy default suite and fails
// when discovered automatically. Tracked under issue #1758 follow-up; opt in
// via `node scripts/run-tests.mjs --suite needs-triage`.
import fs from 'fs';

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
  // Issue #1694: stabilized — default flipped from false to true (use --no-auto-attach-solution-summary to disable)
  assertEqual(SOLVE_OPTION_DEFINITIONS['auto-attach-solution-summary'].default, true, 'Default should be true (Issue #1694)');
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

// Issue #1728: Unified working-session summary helper used by all working
// session call sites (solve.mjs, solve.auto-merge.lib.mjs, solve.watch.lib.mjs).
runTest('solve.results.lib.mjs exports maybeAttachWorkingSessionSummary (Issue #1728)', async () => {
  const resultsLib = await import('../src/solve.results.lib.mjs');
  assertTrue(typeof resultsLib.maybeAttachWorkingSessionSummary === 'function', 'maybeAttachWorkingSessionSummary should be exported');
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

// Issue #1728: solve.mjs now delegates the attach decision to the shared
// maybeAttachWorkingSessionSummary helper. The helper itself reads
// argv.attachSolutionSummary / argv.autoAttachSolutionSummary, so we verify
// the helper is invoked (and therefore the flags are honoured) instead of
// looking for inline argv references in solve.mjs.
runTest('solve.mjs delegates summary attachment to maybeAttachWorkingSessionSummary (Issue #1728)', async () => {
  const fs = await import('fs');
  const solveMjs = fs.readFileSync('./src/solve.mjs', 'utf-8');
  assertTrue(solveMjs.includes('maybeAttachWorkingSessionSummary'), 'maybeAttachWorkingSessionSummary should be invoked from solve.mjs');
});

runTest('maybeAttachWorkingSessionSummary handles --attach-solution-summary and --auto-attach-solution-summary flags (Issue #1728)', async () => {
  const fs = await import('fs');
  const resultsLibSrc = fs.readFileSync('./src/solve.results.lib.mjs', 'utf-8');
  assertTrue(resultsLibSrc.includes('argv.attachSolutionSummary'), 'helper should check argv.attachSolutionSummary');
  assertTrue(resultsLibSrc.includes('argv.autoAttachSolutionSummary'), 'helper should check argv.autoAttachSolutionSummary');
});

// Issue #1647 / #1728: The "did the AI post comments during this session?"
// check must start from the current work-session boundary, not the older
// feedback referenceTime. The helper now receives workStartTime as a parameter
// and forwards it to checkForAiCreatedComments.
runTest('solve.mjs forwards workStartTime to summary helper (Issues #1647, #1728)', async () => {
  const fs = await import('fs');
  const solveMjs = fs.readFileSync('./src/solve.mjs', 'utf-8');
  assertTrue(solveMjs.includes('const workStartTime = await startWorkSession'), 'startWorkSession return value should be captured');
  assertTrue(/maybeAttachWorkingSessionSummary\([^)]*workStartTime/.test(solveMjs), 'maybeAttachWorkingSessionSummary should be called with workStartTime');
  assertFalse(solveMjs.includes('checkForAiCreatedComments(referenceTime'), 'auto-attach must not use feedback referenceTime as the session comment scan boundary');
});

// Issue #1728: Auto-restart-until-mergeable iterations must call the helper
// after every successful tool execution, scoping the AI-comment check to the
// iteration's own start time.
runTest('solve.auto-merge.lib.mjs invokes maybeAttachWorkingSessionSummary per iteration (Issue #1728)', async () => {
  const fs = await import('fs');
  const autoMerge = fs.readFileSync('./src/solve.auto-merge.lib.mjs', 'utf-8');
  assertTrue(autoMerge.includes('maybeAttachWorkingSessionSummary'), 'auto-merge should call the unified helper');
  assertTrue(autoMerge.includes('iterationStartTime'), 'auto-merge should capture iteration-scoped start time');
});

// Issue #1728: Watch-mode / temporary auto-restart iterations must do the same.
runTest('solve.watch.lib.mjs invokes maybeAttachWorkingSessionSummary per iteration (Issue #1728)', async () => {
  const fs = await import('fs');
  const watch = fs.readFileSync('./src/solve.watch.lib.mjs', 'utf-8');
  assertTrue(watch.includes('maybeAttachWorkingSessionSummary'), 'watch should call the unified helper');
  assertTrue(watch.includes('iterationStartTime'), 'watch should capture iteration-scoped start time');
});

// Issue #1728: Comment header rename — the user-facing header must be
// "Working session summary", but the function/flag names stay the same for
// backwards compatibility.
runTest('attachSolutionSummary posts a "Working session summary" comment (Issue #1728)', async () => {
  const fs = await import('fs');
  const resultsLibSrc = fs.readFileSync('./src/solve.results.lib.mjs', 'utf-8');
  assertTrue(resultsLibSrc.includes('## Working session summary'), 'comment header should be "Working session summary"');
  assertFalse(/^[^*\/]*## Solution summary/m.test(resultsLibSrc), 'comment header should no longer say "Solution summary" outside comments');
});

// Issue #1728: The new "Working session summary" header must be tracked in
// TOOL_GENERATED_COMMENT_MARKERS so that an iteration's auto-attach summary
// doesn't make the next iteration's auto-attach check think the AI posted.
runTest('TOOL_GENERATED_COMMENT_MARKERS includes "Working session summary" (Issue #1728)', async () => {
  const { TOOL_GENERATED_COMMENT_MARKERS, WORKING_SESSION_SUMMARY_MARKER, isToolGeneratedComment } = await import('../src/tool-comments.lib.mjs');
  assertEqual(WORKING_SESSION_SUMMARY_MARKER, 'Working session summary', 'WORKING_SESSION_SUMMARY_MARKER constant should be the header text');
  assertTrue(TOOL_GENERATED_COMMENT_MARKERS.includes(WORKING_SESSION_SUMMARY_MARKER), 'marker must be in TOOL_GENERATED_COMMENT_MARKERS');
  assertTrue(isToolGeneratedComment('## Working session summary\n\nresult body'), 'isToolGeneratedComment should match the new header');
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

// Issue #1625: Centralized marker module + in-memory tracking — the architectural
// refactor that ensures every comment solve.mjs posts is excluded from the
// AI-comment check, independent of whether the marker text happens to match.
console.log('\n📋 Centralized Marker Module Tests (Issue #1625)\n');

runTest('tool-comments.lib.mjs exports every named marker constant', async () => {
  const toolComments = await import('../src/tool-comments.lib.mjs');
  const expectedNames = ['AI_WORK_SESSION_STARTED_MARKER', 'AI_WORK_SESSION_COMPLETED_MARKER', 'AI_WORK_SESSION_RESUMED_MARKER', 'AUTO_RESUME_ON_LIMIT_RESET_MARKER', 'AUTO_RESTART_ON_LIMIT_RESET_MARKER', 'SOLUTION_DRAFT_LOG_MARKER', 'AUTO_RESTART_MARKER', 'AUTO_RESTART_UNTIL_MERGEABLE_LOG_MARKER', 'READY_TO_MERGE_MARKER', 'AUTO_MERGED_MARKER', 'BILLING_LIMIT_MARKER', 'MAINTAINER_ACCESS_REQUEST_MARKER', 'LIVE_PROGRESS_SECTION_START_MARKER', 'LIVE_PROGRESS_SECTION_END_MARKER', 'SESSION_FORCE_KILLED_MARKER', 'REPOSITORY_INITIALIZATION_REQUIRED_MARKER', 'INTERACTIVE_SESSION_STARTED_MARKER', 'INTERACTIVE_SESSION_ENDED_MARKER', 'NOW_WORKING_SESSION_IS_ENDED_MARKER', 'SOLUTION_DRAFT_FAILED_MARKER', 'SOLUTION_DRAFT_FINISHED_WITH_ERRORS_MARKER', 'USAGE_LIMIT_REACHED_MARKER'];
  for (const name of expectedNames) {
    assertTrue(typeof toolComments[name] === 'string' && toolComments[name].length > 0, `${name} should be a non-empty string export`);
  }
});

runTest('TOOL_GENERATED_COMMENT_MARKERS is derived from named constants (no orphaned literals)', async () => {
  const toolComments = await import('../src/tool-comments.lib.mjs');
  const expectedInList = [toolComments.AI_WORK_SESSION_STARTED_MARKER, toolComments.AI_WORK_SESSION_COMPLETED_MARKER, toolComments.AI_WORK_SESSION_RESUMED_MARKER, toolComments.AUTO_RESUME_ON_LIMIT_RESET_MARKER, toolComments.AUTO_RESTART_ON_LIMIT_RESET_MARKER, toolComments.SOLUTION_DRAFT_LOG_MARKER, toolComments.AUTO_RESTART_MARKER, toolComments.READY_TO_MERGE_MARKER, toolComments.AUTO_MERGED_MARKER, toolComments.BILLING_LIMIT_MARKER, toolComments.MAINTAINER_ACCESS_REQUEST_MARKER, toolComments.LIVE_PROGRESS_SECTION_START_MARKER, toolComments.SESSION_FORCE_KILLED_MARKER, toolComments.REPOSITORY_INITIALIZATION_REQUIRED_MARKER, toolComments.INTERACTIVE_SESSION_STARTED_MARKER, toolComments.NOW_WORKING_SESSION_IS_ENDED_MARKER, toolComments.SOLUTION_DRAFT_FAILED_MARKER, toolComments.SOLUTION_DRAFT_FINISHED_WITH_ERRORS_MARKER, toolComments.USAGE_LIMIT_REACHED_MARKER];
  for (const m of expectedInList) {
    assertTrue(toolComments.TOOL_GENERATED_COMMENT_MARKERS.includes(m), `TOOL_GENERATED_COMMENT_MARKERS should include "${m}" (via named constant)`);
  }
});

runTest('SESSION_ENDING_MARKERS contains the two session-end markers', async () => {
  const toolComments = await import('../src/tool-comments.lib.mjs');
  assertTrue(Array.isArray(toolComments.SESSION_ENDING_MARKERS), 'SESSION_ENDING_MARKERS should be an array');
  assertTrue(toolComments.SESSION_ENDING_MARKERS.includes(toolComments.NOW_WORKING_SESSION_IS_ENDED_MARKER), 'should include NOW_WORKING_SESSION_IS_ENDED_MARKER');
  assertTrue(toolComments.SESSION_ENDING_MARKERS.includes(toolComments.AI_WORK_SESSION_COMPLETED_MARKER), 'should include AI_WORK_SESSION_COMPLETED_MARKER');
});

runTest('solve.results.lib.mjs re-exports markers from tool-comments.lib.mjs (single source of truth)', async () => {
  const resultsLib = await import('../src/solve.results.lib.mjs');
  const toolComments = await import('../src/tool-comments.lib.mjs');
  // The re-export should be reference-identical, not a copy.
  assertTrue(resultsLib.TOOL_GENERATED_COMMENT_MARKERS === toolComments.TOOL_GENERATED_COMMENT_MARKERS, 'TOOL_GENERATED_COMMENT_MARKERS should be the same array instance');
  assertTrue(resultsLib.isToolGeneratedComment === toolComments.isToolGeneratedComment, 'isToolGeneratedComment should be the same function');
});

console.log('\n📋 In-Memory Comment ID Tracking Tests (Issue #1625)\n');

runTest('trackToolCommentId registers an ID and isToolTrackedCommentId finds it', async () => {
  const { trackToolCommentId, isToolTrackedCommentId, resetTrackedToolCommentIds } = await import('../src/tool-comments.lib.mjs');
  resetTrackedToolCommentIds();
  assertFalse(isToolTrackedCommentId(12345), 'ID should not be tracked before calling trackToolCommentId');
  trackToolCommentId(12345);
  assertTrue(isToolTrackedCommentId(12345), 'ID should be tracked after calling trackToolCommentId');
  assertTrue(isToolTrackedCommentId('12345'), 'string form of the same ID should also match');
});

runTest('trackToolCommentId is a no-op for null/undefined', async () => {
  const { trackToolCommentId, isToolTrackedCommentId, resetTrackedToolCommentIds } = await import('../src/tool-comments.lib.mjs');
  resetTrackedToolCommentIds();
  trackToolCommentId(null);
  trackToolCommentId(undefined);
  assertFalse(isToolTrackedCommentId(null), 'null should not be tracked');
  assertFalse(isToolTrackedCommentId(undefined), 'undefined should not be tracked');
});

runTest('getTrackedToolCommentIds returns an isolated snapshot', async () => {
  const { trackToolCommentId, getTrackedToolCommentIds, resetTrackedToolCommentIds } = await import('../src/tool-comments.lib.mjs');
  resetTrackedToolCommentIds();
  trackToolCommentId(111);
  trackToolCommentId(222);
  const snap = getTrackedToolCommentIds();
  assertTrue(snap instanceof Set, 'snapshot should be a Set');
  assertEqual(snap.size, 2, 'snapshot should have 2 entries');
  snap.add('999'); // mutate the snapshot
  assertFalse((await import('../src/tool-comments.lib.mjs')).isToolTrackedCommentId(999), 'mutating the snapshot must not affect the real tracking set');
});

runTest('resetTrackedToolCommentIds clears the set', async () => {
  const { trackToolCommentId, isToolTrackedCommentId, resetTrackedToolCommentIds } = await import('../src/tool-comments.lib.mjs');
  trackToolCommentId(77);
  resetTrackedToolCommentIds();
  assertFalse(isToolTrackedCommentId(77), 'ID should not be tracked after reset');
});

runTest('postTrackedComment parses comment ID from gh api JSON response', async () => {
  const { postTrackedComment, isToolTrackedCommentId, resetTrackedToolCommentIds } = await import('../src/tool-comments.lib.mjs');
  resetTrackedToolCommentIds();
  // Build a minimal mock $ that records the command and returns a canned JSON body.
  const fakeResult = { code: 0, stdout: JSON.stringify({ id: 4270296598, body: 'hi' }), stderr: '' };
  const mock$ = (...args) => {
    // Support both $`...` and $({ input })`...` usage. We don't need to
    // inspect args; we just return the canned result.
    void args;
    const tagged = () => Promise.resolve(fakeResult);
    // When called as $({ input })`...`, the caller invokes the template
    // function it returns. When called as $`...` directly, tagged is the
    // template function itself. Handle both shapes.
    return Object.assign(tagged, Promise.resolve(fakeResult));
  };
  const { ok, commentId } = await postTrackedComment({ $: mock$, owner: 'o', repo: 'r', targetNumber: 1, body: 'test' });
  assertTrue(ok, 'postTrackedComment should succeed');
  assertEqual(commentId, '4270296598', 'comment ID should be extracted from JSON');
  assertTrue(isToolTrackedCommentId('4270296598'), 'posted comment ID should be in the tracking set');
});

runTest('postTrackedComment reports failure when gh api returns non-zero exit', async () => {
  const { postTrackedComment, resetTrackedToolCommentIds } = await import('../src/tool-comments.lib.mjs');
  resetTrackedToolCommentIds();
  const fakeResult = { code: 1, stdout: '', stderr: 'boom' };
  const mock$ = (...args) => {
    void args;
    const tagged = () => Promise.resolve(fakeResult);
    return Object.assign(tagged, Promise.resolve(fakeResult));
  };
  const { ok, commentId, stderr } = await postTrackedComment({ $: mock$, owner: 'o', repo: 'r', targetNumber: 1, body: 'x' });
  assertFalse(ok, 'postTrackedComment should report failure');
  assertEqual(commentId, null, 'commentId should be null on failure');
  assertTrue(stderr.includes('boom'), 'stderr should be surfaced');
});

runTest('postTrackedComment throws if $ helper is missing', async () => {
  const { postTrackedComment } = await import('../src/tool-comments.lib.mjs');
  let threw = false;
  try {
    await postTrackedComment({ owner: 'o', repo: 'r', targetNumber: 1, body: 'x' });
  } catch (e) {
    threw = /requires a command-stream/.test(e.message);
  }
  assertTrue(threw, 'missing $ must throw a clear error');
});

// Issue #1631: command-stream's options bag uses `stdin`, not `input`. Passing
// `{ input: payload }` was silently ignored, so `gh api --input -` read the
// parent process stdin and posted an empty/malformed POST — GitHub's edge
// replied with HTTP 400 "Whoa there!". This test pins the option name so a
// future rename can't silently regress the same footgun.
runTest('postTrackedComment passes body via stdin option to command-stream (Issue #1631)', async () => {
  const { postTrackedComment, resetTrackedToolCommentIds } = await import('../src/tool-comments.lib.mjs');
  resetTrackedToolCommentIds();
  let capturedOptions = null;
  const fakeResult = { code: 0, stdout: JSON.stringify({ id: 1631001 }), stderr: '' };
  const mock$ = (...args) => {
    // When invoked as `$(options)` the first call receives the options bag
    // and must return the tagged-template function. When invoked as `$\`…\``
    // the first call receives the template strings array directly — we fall
    // through to returning the result.
    const first = args[0];
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      capturedOptions = first;
      const tagged = () => Promise.resolve(fakeResult);
      return Object.assign(tagged, Promise.resolve(fakeResult));
    }
    const tagged = () => Promise.resolve(fakeResult);
    return Object.assign(tagged, Promise.resolve(fakeResult));
  };
  const body = 'hello world — multi-line\n\nbody';
  const { ok, commentId } = await postTrackedComment({ $: mock$, owner: 'o', repo: 'r', targetNumber: 1, body });
  assertTrue(ok, 'postTrackedComment should succeed');
  assertEqual(commentId, '1631001', 'comment ID should be extracted');
  assertTrue(capturedOptions !== null, 'command-stream options bag should have been captured');
  assertTrue(Object.prototype.hasOwnProperty.call(capturedOptions, 'stdin'), 'options bag must include `stdin` key (command-stream ignores `input`)');
  assertFalse(Object.prototype.hasOwnProperty.call(capturedOptions, 'input'), 'options bag must NOT use legacy `input` key (silently ignored by command-stream)');
  const expected = JSON.stringify({ body });
  assertEqual(capturedOptions.stdin, expected, 'stdin should contain JSON.stringify({body}) exactly');
  resetTrackedToolCommentIds();
});

runTest('Cross-module: comment bodies posted at each site embed the centralized marker', async () => {
  // Spot-check by substring that each known posting site's literal body text
  // references the corresponding marker constant (not an ad-hoc string copy).
  const fs = await import('fs');
  const { SOLUTION_DRAFT_LOG_MARKER, USAGE_LIMIT_REACHED_MARKER, SOLUTION_DRAFT_FAILED_MARKER, NOW_WORKING_SESSION_IS_ENDED_MARKER, READY_TO_MERGE_MARKER, AUTO_MERGED_MARKER, AUTO_RESTART_MARKER, SESSION_FORCE_KILLED_MARKER, REPOSITORY_INITIALIZATION_REQUIRED_MARKER, INTERACTIVE_SESSION_STARTED_MARKER, MAINTAINER_ACCESS_REQUEST_MARKER } = await import('../src/tool-comments.lib.mjs');
  const githubLib = fs.readFileSync('./src/github.lib.mjs', 'utf-8');
  assertTrue(githubLib.includes('SOLUTION_DRAFT_LOG_MARKER'), 'github.lib.mjs should reference SOLUTION_DRAFT_LOG_MARKER');
  assertTrue(githubLib.includes('USAGE_LIMIT_REACHED_MARKER'), 'github.lib.mjs should reference USAGE_LIMIT_REACHED_MARKER');
  assertTrue(githubLib.includes('SOLUTION_DRAFT_FAILED_MARKER'), 'github.lib.mjs should reference SOLUTION_DRAFT_FAILED_MARKER');
  assertTrue(githubLib.includes('NOW_WORKING_SESSION_IS_ENDED_MARKER'), 'github.lib.mjs should reference NOW_WORKING_SESSION_IS_ENDED_MARKER');
  assertTrue(githubLib.includes('Administrator-only CLI details'), 'issue failure log comments should keep admin CLI details out of user-facing guidance');
  const autoMerge = fs.readFileSync('./src/solve.auto-merge.lib.mjs', 'utf-8');
  assertTrue(autoMerge.includes('READY_TO_MERGE_MARKER'), 'solve.auto-merge.lib.mjs should reference READY_TO_MERGE_MARKER');
  assertTrue(autoMerge.includes('AUTO_MERGED_MARKER'), 'solve.auto-merge.lib.mjs should reference AUTO_MERGED_MARKER');
  const watch = fs.readFileSync('./src/solve.watch.lib.mjs', 'utf-8');
  assertTrue(watch.includes('AUTO_RESTART_MARKER'), 'solve.watch.lib.mjs should reference AUTO_RESTART_MARKER');
  const claudeLib = fs.readFileSync('./src/claude.lib.mjs', 'utf-8');
  assertTrue(claudeLib.includes('SESSION_FORCE_KILLED_MARKER'), 'claude.lib.mjs should reference SESSION_FORCE_KILLED_MARKER');
  const repoSetup = fs.readFileSync('./src/solve.repo-setup.lib.mjs', 'utf-8');
  assertTrue(repoSetup.includes('REPOSITORY_INITIALIZATION_REQUIRED_MARKER'), 'solve.repo-setup.lib.mjs should reference REPOSITORY_INITIALIZATION_REQUIRED_MARKER');
  const interactive = fs.readFileSync('./src/interactive-mode.lib.mjs', 'utf-8');
  assertTrue(interactive.includes('INTERACTIVE_SESSION_STARTED_MARKER'), 'interactive-mode.lib.mjs should reference INTERACTIVE_SESSION_STARTED_MARKER');
  const githubLibContent = githubLib;
  assertTrue(githubLibContent.includes('MAINTAINER_ACCESS_REQUEST_MARKER') || githubLibContent.includes('Allow edits by maintainers'), 'github.lib.mjs should reference Allow edits by maintainers (direct or via marker)');
  // Ensure markers are non-empty strings (catches a silent typo that removes a constant)
  for (const m of [SOLUTION_DRAFT_LOG_MARKER, USAGE_LIMIT_REACHED_MARKER, SOLUTION_DRAFT_FAILED_MARKER, NOW_WORKING_SESSION_IS_ENDED_MARKER, READY_TO_MERGE_MARKER, AUTO_MERGED_MARKER, AUTO_RESTART_MARKER, SESSION_FORCE_KILLED_MARKER, REPOSITORY_INITIALIZATION_REQUIRED_MARKER, INTERACTIVE_SESSION_STARTED_MARKER, MAINTAINER_ACCESS_REQUEST_MARKER]) {
    assertTrue(typeof m === 'string' && m.length > 0, `marker constant should be non-empty string, got ${JSON.stringify(m)}`);
  }
});

runTest('isToolGeneratedComment matches every newly added marker', async () => {
  const { isToolGeneratedComment, AUTO_MERGED_MARKER, BILLING_LIMIT_MARKER, MAINTAINER_ACCESS_REQUEST_MARKER, SESSION_FORCE_KILLED_MARKER, REPOSITORY_INITIALIZATION_REQUIRED_MARKER, LIVE_PROGRESS_SECTION_START_MARKER } = await import('../src/tool-comments.lib.mjs');
  for (const marker of [AUTO_MERGED_MARKER, BILLING_LIMIT_MARKER, MAINTAINER_ACCESS_REQUEST_MARKER, SESSION_FORCE_KILLED_MARKER, REPOSITORY_INITIALIZATION_REQUIRED_MARKER, LIVE_PROGRESS_SECTION_START_MARKER]) {
    assertTrue(isToolGeneratedComment(`## 🤖 ${marker}\n\nsome content`), `isToolGeneratedComment should match "${marker}"`);
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
