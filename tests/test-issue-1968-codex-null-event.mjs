#!/usr/bin/env node
// Test file for issue #1968: "CODEX execution failed with Cannot read properties
// of null (reading 'type')".
//
// Root cause (reconstructed from the captured failure log, see
// docs/case-studies/issue-1968):
//   parseCodexExecJsonOutput() parses the Codex CLI's NDJSON stream one line at a
//   time. The JSON.parse() call was wrapped in try/catch, but the very next line
//   read `data.type` *outside* that guard. The Codex CLI (v0.141.0) echoes the
//   stdout of every command it runs back into its own stream (the same mechanism
//   behind issue #1955). When the target repo printed a standalone `null` line,
//   `JSON.parse('null')` returned `null`, and `data.type` threw
//     "Cannot read properties of null (reading 'type')"
//   which aborted the entire solve.
//
// Fix: every NDJSON stream parser (Codex, Claude, Agent, OpenCode) now skips any
// line that parses to a bare `null` or a non-object JSON primitive. Real stream
// events are always JSON objects.

import assert from 'node:assert/strict';

const { parseCodexExecJsonOutput } = await import('../src/codex.lib.mjs');

let passed = 0;
let failed = 0;

const test = (name, fn) => {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (error) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${error.message}`);
    failed++;
  }
};

console.log('Testing Codex bare-null stream line (Issue #1968)\n');

// ============================================================
// Section 1: The exact reproduction — a standalone `null` line in the stream
// ============================================================
console.log('=== 1. A bare `null` line must not crash the parser ===');

test('a standalone `null` line is ignored, surrounding events still parse', () => {
  const output = ['{"type":"item.started","item":{"id":"item_25","type":"command_execution"}}', 'null', '{"type":"turn.completed","usage":{"input_tokens":10,"output_tokens":5}}'].join('\n');

  let state;
  assert.doesNotThrow(() => {
    state = parseCodexExecJsonOutput(output, {}, 'gpt-5.5');
  }, 'parseCodexExecJsonOutput must not throw on a bare null line');

  // The valid events around the null line are still accounted for.
  assert.equal(state.eventCounts['item.started'], 1);
  assert.equal(state.eventCounts['turn.completed'], 1);
  // The null line must NOT have been counted as an "unknown" event.
  assert.equal(state.eventCounts['unknown'], undefined);
  // Usage from the surrounding turn.completed is still captured.
  assert.equal(state.tokenUsage.stepCount, 1);
  assert.equal(state.tokenUsage.outputTokens, 5);
});

// ============================================================
// Section 2: Other non-object JSON primitives must also be ignored
// ============================================================
console.log('\n=== 2. Other JSON primitives are ignored without throwing ===');

for (const primitive of ['null', '42', '"a string"', 'true', 'false', '[1,2,3]']) {
  test(`primitive line ${JSON.stringify(primitive)} does not throw`, () => {
    const output = ['{"type":"thread.started","thread_id":"t1"}', primitive, '{"type":"turn.completed","usage":{"input_tokens":1,"output_tokens":1}}'].join('\n');

    let state;
    assert.doesNotThrow(() => {
      state = parseCodexExecJsonOutput(output, {}, 'gpt-5.5');
    });
    assert.equal(state.sessionId, 't1');
    assert.equal(state.tokenUsage.stepCount, 1);
  });
}

// ============================================================
// Section 2b: The captured real-world chunk — echoed source code with `?? null`
// ============================================================
console.log('\n=== 2b. Echoed source code containing a bare `null` line ===');

test('echoed getApiKey() `?? null` fallback does not crash the solve', () => {
  // Mirrors the captured failure: codex echoed `sed -n '760,1340p' index.js`,
  // whose getApiKey() fallback puts `null` on its own line (log line 5282).
  const output = ['{"type":"item.started","item":{"id":"item_25","type":"command_execution"}}', '    return (', '      process.env.COMPOSIO_DIRECT_COMPOSIO_API_KEY ??', '      process.env.COMPOSIO_API_KEY ??', '      null', '    );', '{"type":"turn.completed","usage":{"input_tokens":7,"output_tokens":3}}'].join('\n');

  let state;
  assert.doesNotThrow(() => {
    state = parseCodexExecJsonOutput(output, {}, 'gpt-5.5');
  });
  assert.equal(state.eventCounts['item.started'], 1);
  assert.equal(state.eventCounts['turn.completed'], 1);
  assert.equal(state.tokenUsage.stepCount, 1);
});

// ============================================================
// Section 3: Normal object events keep working unchanged
// ============================================================
console.log('\n=== 3. Object events are unaffected by the guard ===');

test('agent_message text is still captured as resultSummary', () => {
  const output = '{"type":"item.completed","item":{"id":"i1","type":"agent_message","text":"done"}}';
  const state = parseCodexExecJsonOutput(output, {}, 'gpt-5.5');
  assert.equal(state.resultSummary, 'done');
});

console.log(`\nPassed: ${passed}  Failed: ${failed}`);
if (failed > 0) process.exit(1);
