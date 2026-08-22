#!/usr/bin/env node
/**
 * @hive-mind-test-suite default
 *
 * Regression coverage for issue #1974. The captured Claude run emitted nested
 * assistant/user events, ended after a failed tool_result, and never emitted a
 * terminal result event. The solver treated that as success and finalized a PR
 * containing only the initial .gitkeep commit.
 */

import assert from 'node:assert/strict';
import { buildMissingClaudeResultMessage, collectClaudeStreamEventFacts, shouldFailClaudeStreamWithoutResult } from '../src/claude.stream-events.lib.mjs';

const assistantToolUse = {
  type: 'assistant',
  message: {
    content: [
      {
        type: 'tool_use',
        id: 'toolu_015noGSadEBXVhs18BnVRa46',
        name: 'Grep',
        input: {
          pattern: 'amneziawg|regenerate.*config|/config/regenerate',
          path: '/tmp/gh-issue-solver-1779276811027/apps/bot/src',
        },
      },
    ],
  },
};

const failedToolResult = {
  type: 'user',
  message: {
    content: [
      {
        type: 'tool_result',
        tool_use_id: 'toolu_015noGSadEBXVhs18BnVRa46',
        is_error: true,
        content: '<tool_use_error>Path does not exist: /tmp/gh-issue-solver-1779276811027/apps/bot/src.</tool_use_error>',
      },
    ],
  },
  tool_use_result: 'Error: Path does not exist: /tmp/gh-issue-solver-1779276811027/apps/bot/src.',
};

const syntheticCompaction = {
  type: 'user',
  isSynthetic: true,
  message: {
    content: [
      {
        type: 'text',
        text: 'This session is being continued from a previous conversation that ran out of context.\n\nSummary:\nRoot cause identified; implementation is still pending.',
      },
    ],
  },
};

const toolUseFacts = collectClaudeStreamEventFacts(assistantToolUse);
assert.equal(toolUseFacts.messageCountDelta, 1);
assert.equal(toolUseFacts.toolUseCountDelta, 1);

const toolResultFacts = collectClaudeStreamEventFacts(failedToolResult);
assert.equal(toolResultFacts.messageCountDelta, 1);
assert.equal(toolResultFacts.toolResultError, 'Path does not exist: /tmp/gh-issue-solver-1779276811027/apps/bot/src.');

const compactionFacts = collectClaudeStreamEventFacts(syntheticCompaction);
assert.equal(compactionFacts.messageCountDelta, 1);
assert.match(compactionFacts.compactionSummary, /Root cause identified/);

assert.equal(
  shouldFailClaudeStreamWithoutResult({
    commandFailed: false,
    streamingInput: false,
    resultEventReceived: false,
  }),
  true
);
assert.equal(
  shouldFailClaudeStreamWithoutResult({
    commandFailed: false,
    streamingInput: false,
    resultEventReceived: true,
  }),
  false
);

assert.match(buildMissingClaudeResultMessage({ lastToolResultError: toolResultFacts.toolResultError }), /without a terminal result event/);
assert.match(buildMissingClaudeResultMessage({ lastToolResultError: toolResultFacts.toolResultError }), /Path does not exist/);

console.log('Issue #1974 Claude stream completion regression tests passed.');
