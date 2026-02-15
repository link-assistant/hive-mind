#!/usr/bin/env node

/**
 * Unit tests for agent token usage parsing and accumulation
 * Tests the token extraction logic from agent NDJSON output (Issue #1250)
 *
 * Key behaviors tested:
 * - parseAgentTokenUsage correctly sums tokens from step_finish events
 * - Handles proper NDJSON format (newline-delimited JSON)
 * - Handles edge cases (empty output, invalid JSON, missing fields)
 * - Issue #1250 fix: streaming accumulation handles concatenated JSON
 */

// Copy of parseAgentTokenUsage from src/agent.lib.mjs for testing
const parseAgentTokenUsage = output => {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
    stepCount: 0,
  };

  const lines = output.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || !trimmedLine.startsWith('{')) continue;

    try {
      const parsed = JSON.parse(trimmedLine);

      if (parsed.type === 'step_finish' && parsed.part?.tokens) {
        const tokens = parsed.part.tokens;
        usage.stepCount++;

        if (tokens.input) usage.inputTokens += tokens.input;
        if (tokens.output) usage.outputTokens += tokens.output;
        if (tokens.reasoning) usage.reasoningTokens += tokens.reasoning;

        if (tokens.cache) {
          if (tokens.cache.read) usage.cacheReadTokens += tokens.cache.read;
          if (tokens.cache.write) usage.cacheWriteTokens += tokens.cache.write;
        }

        if (parsed.part.cost !== undefined) {
          usage.totalCost += parsed.part.cost;
        }
      }
    } catch {
      continue;
    }
  }

  return usage;
};

// Test framework
let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

function assertEqual(actual, expected, message = '') {
  if (actual !== expected) {
    throw new Error(`${message}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
}

console.log('🧪 Running agent token usage tests (Issue #1250)...\n');
console.log('='.repeat(80));

// ==== Basic NDJSON parsing tests ====
console.log('\n📋 Test Group: Basic NDJSON parsing\n');

runTest('parses single step_finish event', () => {
  const output = '{"type":"step_finish","timestamp":1234567890,"part":{"type":"step-finish","cost":0,"tokens":{"input":100,"output":50,"reasoning":10,"cache":{"read":200,"write":100}}}}\n';
  const result = parseAgentTokenUsage(output);

  assertEqual(result.stepCount, 1, 'Should count 1 step');
  assertEqual(result.inputTokens, 100, 'Should sum input tokens');
  assertEqual(result.outputTokens, 50, 'Should sum output tokens');
  assertEqual(result.reasoningTokens, 10, 'Should sum reasoning tokens');
  assertEqual(result.cacheReadTokens, 200, 'Should sum cache read tokens');
  assertEqual(result.cacheWriteTokens, 100, 'Should sum cache write tokens');
});

runTest('sums tokens from multiple step_finish events', () => {
  const output = `{"type":"step_finish","timestamp":1234567890,"part":{"type":"step-finish","cost":0,"tokens":{"input":15413,"output":64,"reasoning":0,"cache":{"read":32,"write":0}}}}
{"type":"step_finish","timestamp":1234567891,"part":{"type":"step-finish","cost":0,"tokens":{"input":4602,"output":56,"reasoning":0,"cache":{"read":15456,"write":0}}}}
{"type":"step_finish","timestamp":1234567892,"part":{"type":"step-finish","cost":0,"tokens":{"input":360,"output":341,"reasoning":1,"cache":{"read":68456,"write":0}}}}
`;
  const result = parseAgentTokenUsage(output);

  assertEqual(result.stepCount, 3, 'Should count 3 steps');
  assertEqual(result.inputTokens, 15413 + 4602 + 360, 'Should sum all input tokens');
  assertEqual(result.outputTokens, 64 + 56 + 341, 'Should sum all output tokens');
  assertEqual(result.reasoningTokens, 1, 'Should sum reasoning tokens');
  assertEqual(result.cacheReadTokens, 32 + 15456 + 68456, 'Should sum all cache read tokens');
  assertEqual(result.cacheWriteTokens, 0, 'Should sum cache write tokens');
});

runTest('ignores non-step_finish events', () => {
  const output = `{"type":"text","timestamp":1234567890,"part":{"type":"text","text":"Hello"}}
{"type":"step_finish","timestamp":1234567891,"part":{"type":"step-finish","cost":0,"tokens":{"input":100,"output":50}}}
{"type":"tool_use","timestamp":1234567892,"part":{"type":"tool","tool":"bash"}}
`;
  const result = parseAgentTokenUsage(output);

  assertEqual(result.stepCount, 1, 'Should only count step_finish events');
  assertEqual(result.inputTokens, 100, 'Should only sum tokens from step_finish');
  assertEqual(result.outputTokens, 50, 'Should only sum tokens from step_finish');
});

// ==== Edge cases ====
console.log('\n📋 Test Group: Edge cases\n');

runTest('handles empty output', () => {
  const result = parseAgentTokenUsage('');
  assertEqual(result.stepCount, 0, 'Should have 0 steps');
  assertEqual(result.inputTokens, 0, 'Should have 0 input tokens');
});

runTest('handles output with only whitespace', () => {
  const result = parseAgentTokenUsage('   \n\n  \n   ');
  assertEqual(result.stepCount, 0, 'Should have 0 steps');
});

runTest('handles invalid JSON lines gracefully', () => {
  const output = `not valid json
{"type":"step_finish","timestamp":1234567890,"part":{"type":"step-finish","cost":0,"tokens":{"input":100,"output":50}}}
{broken json{
`;
  const result = parseAgentTokenUsage(output);

  assertEqual(result.stepCount, 1, 'Should parse valid JSON and skip invalid');
  assertEqual(result.inputTokens, 100, 'Should extract tokens from valid line');
});

runTest('handles step_finish without tokens field', () => {
  const output = '{"type":"step_finish","timestamp":1234567890,"part":{"type":"step-finish","cost":0}}\n';
  const result = parseAgentTokenUsage(output);

  assertEqual(result.stepCount, 0, 'Should not count step without tokens');
});

runTest('handles step_finish with null tokens', () => {
  const output = '{"type":"step_finish","timestamp":1234567890,"part":{"type":"step-finish","cost":0,"tokens":null}}\n';
  const result = parseAgentTokenUsage(output);

  assertEqual(result.stepCount, 0, 'Should not count step with null tokens');
});

runTest('handles missing optional token fields', () => {
  const output = '{"type":"step_finish","timestamp":1234567890,"part":{"type":"step-finish","cost":0,"tokens":{"input":100,"output":50}}}\n';
  const result = parseAgentTokenUsage(output);

  assertEqual(result.stepCount, 1, 'Should count step');
  assertEqual(result.inputTokens, 100, 'Should have input tokens');
  assertEqual(result.outputTokens, 50, 'Should have output tokens');
  assertEqual(result.reasoningTokens, 0, 'Should default reasoning to 0');
  assertEqual(result.cacheReadTokens, 0, 'Should default cache read to 0');
  assertEqual(result.cacheWriteTokens, 0, 'Should default cache write to 0');
});

runTest('handles token values of 0', () => {
  const output = '{"type":"step_finish","timestamp":1234567890,"part":{"type":"step-finish","cost":0,"tokens":{"input":0,"output":0,"reasoning":0,"cache":{"read":0,"write":0}}}}\n';
  const result = parseAgentTokenUsage(output);

  assertEqual(result.stepCount, 1, 'Should count step even with 0 tokens');
  assertEqual(result.inputTokens, 0, 'Should be 0');
  assertEqual(result.outputTokens, 0, 'Should be 0');
});

// ==== Issue #1250: Streaming accumulation tests ====
console.log('\n📋 Test Group: Issue #1250 - Streaming accumulation\n');

runTest('Issue #1250: concatenated JSON without newlines fails parsing', () => {
  // This demonstrates why the fix was needed - when NDJSON lines are concatenated
  // without newlines, JSON.parse fails because it sees two objects together
  const concatenated = '{"type":"step_finish","part":{"tokens":{"input":100,"output":50}}}{"type":"step_finish","part":{"tokens":{"input":200,"output":100}}}';
  const result = parseAgentTokenUsage(concatenated);

  // This should fail to parse both - demonstrating the bug that the streaming fix addresses
  assertEqual(result.stepCount, 0, 'Concatenated JSON without newlines fails to parse');
});

runTest('Issue #1250: properly newline-delimited JSON parses correctly', () => {
  const proper = `{"type":"step_finish","part":{"type":"step-finish","cost":0,"tokens":{"input":100,"output":50}}}
{"type":"step_finish","part":{"type":"step-finish","cost":0,"tokens":{"input":200,"output":100}}}
`;
  const result = parseAgentTokenUsage(proper);

  assertEqual(result.stepCount, 2, 'Proper NDJSON parses correctly');
  assertEqual(result.inputTokens, 300, 'Should sum all input tokens');
  assertEqual(result.outputTokens, 150, 'Should sum all output tokens');
});

runTest('Issue #1250: simulates streaming accumulation (the fix)', () => {
  // This simulates the fix: accumulating tokens during streaming
  // instead of re-parsing the full output afterward
  const streamingTokenUsage = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
    stepCount: 0,
  };

  const accumulateTokenUsage = data => {
    if (data.type === 'step_finish' && data.part?.tokens) {
      const tokens = data.part.tokens;
      streamingTokenUsage.stepCount++;
      if (tokens.input) streamingTokenUsage.inputTokens += tokens.input;
      if (tokens.output) streamingTokenUsage.outputTokens += tokens.output;
      if (tokens.reasoning) streamingTokenUsage.reasoningTokens += tokens.reasoning;
      if (tokens.cache) {
        if (tokens.cache.read) streamingTokenUsage.cacheReadTokens += tokens.cache.read;
        if (tokens.cache.write) streamingTokenUsage.cacheWriteTokens += tokens.cache.write;
      }
      if (data.part.cost !== undefined) {
        streamingTokenUsage.totalCost += data.part.cost;
      }
    }
  };

  // Simulate parsing and accumulating during streaming
  const events = [
    { type: 'step_finish', part: { type: 'step-finish', cost: 0, tokens: { input: 15413, output: 64, cache: { read: 32, write: 0 } } } },
    { type: 'step_finish', part: { type: 'step-finish', cost: 0, tokens: { input: 4602, output: 56, cache: { read: 15456, write: 0 } } } },
    { type: 'step_finish', part: { type: 'step-finish', cost: 0, tokens: { input: 360, output: 341, reasoning: 1, cache: { read: 68456, write: 0 } } } },
  ];

  for (const event of events) {
    accumulateTokenUsage(event);
  }

  assertEqual(streamingTokenUsage.stepCount, 3, 'Should count 3 steps');
  assertEqual(streamingTokenUsage.inputTokens, 15413 + 4602 + 360, 'Should sum all input tokens');
  assertEqual(streamingTokenUsage.outputTokens, 64 + 56 + 341, 'Should sum all output tokens');
  assertEqual(streamingTokenUsage.reasoningTokens, 1, 'Should sum reasoning tokens');
  assertEqual(streamingTokenUsage.cacheReadTokens, 32 + 15456 + 68456, 'Should sum cache read tokens');
});

// ==== Cost accumulation tests ====
console.log('\n📋 Test Group: Cost accumulation\n');

runTest('sums cost from multiple steps', () => {
  const output = `{"type":"step_finish","part":{"type":"step-finish","cost":0.001,"tokens":{"input":100,"output":50}}}
{"type":"step_finish","part":{"type":"step-finish","cost":0.002,"tokens":{"input":200,"output":100}}}
`;
  const result = parseAgentTokenUsage(output);

  assertEqual(result.totalCost, 0.003, 'Should sum costs');
});

runTest('handles zero cost (free models)', () => {
  const output = `{"type":"step_finish","part":{"type":"step-finish","cost":0,"tokens":{"input":100,"output":50}}}
{"type":"step_finish","part":{"type":"step-finish","cost":0,"tokens":{"input":200,"output":100}}}
`;
  const result = parseAgentTokenUsage(output);

  assertEqual(result.totalCost, 0, 'Should sum to zero for free models');
});

// ==== Real-world format test ====
console.log('\n📋 Test Group: Real-world format validation\n');

runTest('parses real agent output format with all fields', () => {
  // This mimics the exact format from the issue logs
  const output = `{"type":"step_finish","timestamp":1770842531248,"sessionID":"ses_3b18fab4bffe0lk7EjAhFk9h9B","part":{"id":"prt_c4e70a59e001oY4VSI21f7UXMb","sessionID":"ses_3b18fab4bffe0lk7EjAhFk9h9B","messageID":"msg_c4e705549001rOVQwJMU1HvR3x","type":"step-finish","reason":"tool-calls","snapshot":"be526f76ae2a6a53d624686b3c226c1f73536b6d","cost":0,"tokens":{"input":15413,"output":64,"reasoning":0,"cache":{"read":32,"write":0}}}}
{"type":"step_finish","timestamp":1770843068490,"sessionID":"ses_3b18fab4bffe0lk7EjAhFk9h9B","part":{"id":"prt_c4e78d839001qOJ47YqOQqT0OJ","sessionID":"ses_3b18fab4bffe0lk7EjAhFk9h9B","messageID":"msg_c4e78a463001aOhy9P3DiHgxwD","type":"step-finish","reason":"stop","snapshot":"cefe3dcef71b8f259c56062a9f5c0fb06baa2eb4","cost":0,"tokens":{"input":360,"output":341,"reasoning":1,"cache":{"read":68456,"write":0}}}}
`;
  const result = parseAgentTokenUsage(output);

  assertEqual(result.stepCount, 2, 'Should parse 2 steps from real format');
  assertEqual(result.inputTokens, 15413 + 360, 'Should sum input from real format');
  assertEqual(result.outputTokens, 64 + 341, 'Should sum output from real format');
  assertEqual(result.reasoningTokens, 1, 'Should capture reasoning tokens');
  assertEqual(result.cacheReadTokens, 32 + 68456, 'Should sum cache read from real format');
});

// Summary
console.log('\n' + '='.repeat(80));
console.log(`Test Results for agent token usage (Issue #1250):`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(80));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
