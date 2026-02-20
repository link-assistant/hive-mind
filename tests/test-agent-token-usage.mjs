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

// ==== Issue #1313: Exact log data from the bug report ====
console.log('\n📋 Test Group: Issue #1313 - Exact data from bug report\n');

runTest('Issue #1313: parses exact token values from the bug report log', () => {
  // This is the exact token structure reported in Issue #1313
  // The bug showed "0 input, 0 output" despite these values being in the log
  const output = '{"type":"step_finish","timestamp":1770982017418,"sessionID":"ses_3a93f1458ffeK5TKD4XfXXW4A3","part":{"id":"prt_c56c10976001ItHqFbhtFmk8aP","sessionID":"ses_3a93f1458ffeK5TKD4XfXXW4A3","messageID":"msg_c56c0ec62001LvHUlMLyTfvFEl","type":"step-finish","reason":"tool-calls","snapshot":"5d6c73c51a020ef88084e93fe72a793b31b7441f","cost":0,"tokens":{"input":406,"output":353,"reasoning":281,"cache":{"read":33880,"write":0}}}}\n';
  const result = parseAgentTokenUsage(output);

  assertEqual(result.stepCount, 1, 'Should parse 1 step from Issue #1313 data');
  assertEqual(result.inputTokens, 406, 'Should extract input=406 from Issue #1313');
  assertEqual(result.outputTokens, 353, 'Should extract output=353 from Issue #1313');
  assertEqual(result.reasoningTokens, 281, 'Should extract reasoning=281 from Issue #1313');
  assertEqual(result.cacheReadTokens, 33880, 'Should extract cache.read=33880 from Issue #1313');
  assertEqual(result.cacheWriteTokens, 0, 'Should extract cache.write=0 from Issue #1313');
});

runTest('Issue #1313: streaming accumulation correctly sums tokens like in the bug report', () => {
  // Simulates the streaming accumulation fix that should prevent Issue #1313 regression
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

  // Use the exact token data from Issue #1313 bug report
  const event1313 = {
    type: 'step_finish',
    part: { type: 'step-finish', cost: 0, tokens: { input: 406, output: 353, reasoning: 281, cache: { read: 33880, write: 0 } } },
  };
  accumulateTokenUsage(event1313);

  assertEqual(streamingTokenUsage.inputTokens, 406, 'Streaming should capture input=406');
  assertEqual(streamingTokenUsage.outputTokens, 353, 'Streaming should capture output=353');
  assertEqual(streamingTokenUsage.reasoningTokens, 281, 'Streaming should capture reasoning=281');
  assertEqual(streamingTokenUsage.cacheReadTokens, 33880, 'Streaming should capture cache.read=33880');
  assertEqual(streamingTokenUsage.stepCount, 1, 'Streaming should count 1 step');
});

runTest('Issue #1313: concatenated JSON (old bug scenario) gives 0 tokens', () => {
  // This demonstrates the EXACT scenario that caused Issue #1313:
  // When NDJSON lines are concatenated without newlines, post-hoc parsing gives 0 tokens.
  // The streaming accumulation fix (Issue #1250) solved this by NOT relying on post-hoc parsing.
  const concatenatedOutput = '{"type":"step_finish","part":{"tokens":{"input":406,"output":353,"reasoning":281,"cache":{"read":33880,"write":0}}}}' + '{"type":"step_finish","part":{"tokens":{"input":100,"output":50,"reasoning":0,"cache":{"read":5000,"write":0}}}}';

  // parseAgentTokenUsage (post-hoc) fails because two JSON objects are concatenated
  const result = parseAgentTokenUsage(concatenatedOutput);
  assertEqual(result.stepCount, 0, 'Post-hoc parsing of concatenated JSON returns 0 (the old bug)');
  assertEqual(result.inputTokens, 0, 'Should return 0 input (demonstrates why streaming fix was needed)');
});

// ==== accumulateTokenUsage function tests ====
console.log('\n📋 Test Group: accumulateTokenUsage - Streaming accumulation function\n');

// Create a fresh accumulator for these tests
const createAccumulator = () => {
  const usage = {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalCost: 0,
    stepCount: 0,
  };

  const accumulate = data => {
    if (data.type === 'step_finish' && data.part?.tokens) {
      const tokens = data.part.tokens;
      usage.stepCount++;
      if (tokens.input) usage.inputTokens += tokens.input;
      if (tokens.output) usage.outputTokens += tokens.output;
      if (tokens.reasoning) usage.reasoningTokens += tokens.reasoning;
      if (tokens.cache) {
        if (tokens.cache.read) usage.cacheReadTokens += tokens.cache.read;
        if (tokens.cache.write) usage.cacheWriteTokens += tokens.cache.write;
      }
      if (data.part.cost !== undefined) {
        usage.totalCost += data.part.cost;
      }
    }
  };

  return { usage, accumulate };
};

runTest('accumulateTokenUsage: ignores non-step_finish events', () => {
  const { usage, accumulate } = createAccumulator();

  accumulate({ type: 'text', text: 'Hello world' });
  accumulate({ type: 'tool_use', part: { tool: 'bash' } });
  accumulate({ type: 'message', content: 'some content' });
  accumulate({ type: 'session.idle' });

  assertEqual(usage.stepCount, 0, 'Should ignore non-step_finish events');
  assertEqual(usage.inputTokens, 0, 'Should not accumulate from non-step_finish events');
});

runTest('accumulateTokenUsage: ignores step_finish without tokens', () => {
  const { usage, accumulate } = createAccumulator();

  accumulate({ type: 'step_finish', part: { type: 'step-finish', cost: 0 } });
  accumulate({ type: 'step_finish', part: { type: 'step-finish', cost: 0, tokens: null } });

  assertEqual(usage.stepCount, 0, 'Should not count steps without tokens');
});

runTest('accumulateTokenUsage: handles step_finish from stdout chunk', () => {
  const { usage, accumulate } = createAccumulator();

  // Simulate how streaming handles a stdout chunk
  const chunk = '{"type":"step_finish","part":{"type":"step-finish","cost":0.005,"tokens":{"input":1000,"output":200,"reasoning":50,"cache":{"read":10000,"write":500}}}}';
  const data = JSON.parse(chunk);
  accumulate(data);

  assertEqual(usage.stepCount, 1, 'Should count 1 step');
  assertEqual(usage.inputTokens, 1000, 'Should accumulate input tokens');
  assertEqual(usage.outputTokens, 200, 'Should accumulate output tokens');
  assertEqual(usage.reasoningTokens, 50, 'Should accumulate reasoning tokens');
  assertEqual(usage.cacheReadTokens, 10000, 'Should accumulate cache read tokens');
  assertEqual(usage.cacheWriteTokens, 500, 'Should accumulate cache write tokens');
  assertEqual(usage.totalCost, 0.005, 'Should accumulate cost');
});

runTest('accumulateTokenUsage: handles step_finish from stderr chunk (same as stdout)', () => {
  const { usage, accumulate } = createAccumulator();

  // Agent sends data through BOTH stdout and stderr; accumulate handles both the same way
  const stderrChunk = '{"type":"step_finish","sessionID":"ses_abc123","part":{"type":"step-finish","reason":"stop","cost":0,"tokens":{"input":500,"output":100,"reasoning":0,"cache":{"read":20000,"write":0}}}}';
  const data = JSON.parse(stderrChunk);
  accumulate(data);

  assertEqual(usage.stepCount, 1, 'Should count 1 step from stderr');
  assertEqual(usage.inputTokens, 500, 'Should accumulate input from stderr');
  assertEqual(usage.cacheReadTokens, 20000, 'Should accumulate cache.read from stderr');
});

runTest('accumulateTokenUsage: correctly sums across many steps', () => {
  const { usage, accumulate } = createAccumulator();

  // Simulate a typical multi-step agent run with 5 steps
  const steps = [
    { input: 1000, output: 100, reasoning: 0, cacheRead: 500, cacheWrite: 1000 },
    { input: 2000, output: 200, reasoning: 50, cacheRead: 1500, cacheWrite: 0 },
    { input: 3000, output: 300, reasoning: 100, cacheRead: 2500, cacheWrite: 0 },
    { input: 4000, output: 400, reasoning: 0, cacheRead: 3500, cacheWrite: 0 },
    { input: 5000, output: 500, reasoning: 200, cacheRead: 4500, cacheWrite: 0 },
  ];

  for (const step of steps) {
    accumulate({
      type: 'step_finish',
      part: {
        type: 'step-finish',
        cost: 0,
        tokens: { input: step.input, output: step.output, reasoning: step.reasoning, cache: { read: step.cacheRead, write: step.cacheWrite } },
      },
    });
  }

  const expectedInput = 1000 + 2000 + 3000 + 4000 + 5000;
  const expectedOutput = 100 + 200 + 300 + 400 + 500;
  const expectedReasoning = 0 + 50 + 100 + 0 + 200;
  const expectedCacheRead = 500 + 1500 + 2500 + 3500 + 4500;

  assertEqual(usage.stepCount, 5, 'Should count 5 steps');
  assertEqual(usage.inputTokens, expectedInput, 'Should sum all input tokens correctly');
  assertEqual(usage.outputTokens, expectedOutput, 'Should sum all output tokens correctly');
  assertEqual(usage.reasoningTokens, expectedReasoning, 'Should sum all reasoning tokens correctly');
  assertEqual(usage.cacheReadTokens, expectedCacheRead, 'Should sum all cache read tokens correctly');
  assertEqual(usage.cacheWriteTokens, 1000, 'Should sum cache write tokens correctly');
});

runTest('accumulateTokenUsage: processes interleaved non-step events correctly', () => {
  const { usage, accumulate } = createAccumulator();

  // Real agent output has many non-token events interleaved with step_finish events
  const events = [{ type: 'text', text: 'Starting analysis...' }, { type: 'tool_use', part: { tool: 'bash', input: { command: 'ls' } } }, { type: 'step_finish', part: { type: 'step-finish', cost: 0, tokens: { input: 500, output: 100 } } }, { type: 'text', text: 'Running checks...' }, { type: 'tool_result', part: { content: 'file1.txt\nfile2.txt' } }, { type: 'step_finish', part: { type: 'step-finish', cost: 0, tokens: { input: 1000, output: 200 } } }, { type: 'session.idle' }];

  for (const event of events) {
    accumulate(event);
  }

  assertEqual(usage.stepCount, 2, 'Should count only 2 step_finish events');
  assertEqual(usage.inputTokens, 1500, 'Should sum only step_finish tokens');
  assertEqual(usage.outputTokens, 300, 'Should sum only step_finish tokens');
});

runTest('accumulateTokenUsage: handles missing cache field gracefully', () => {
  const { usage, accumulate } = createAccumulator();

  // Some models may not include the cache field
  accumulate({ type: 'step_finish', part: { cost: 0, tokens: { input: 100, output: 50 } } });

  assertEqual(usage.stepCount, 1, 'Should count step even without cache field');
  assertEqual(usage.inputTokens, 100, 'Should accumulate input tokens');
  assertEqual(usage.cacheReadTokens, 0, 'Should default cache read to 0');
  assertEqual(usage.cacheWriteTokens, 0, 'Should default cache write to 0');
});

runTest('accumulateTokenUsage: handles cost accumulation across steps', () => {
  const { usage, accumulate } = createAccumulator();

  accumulate({ type: 'step_finish', part: { cost: 0.001, tokens: { input: 100, output: 50 } } });
  accumulate({ type: 'step_finish', part: { cost: 0.002, tokens: { input: 200, output: 100 } } });
  accumulate({ type: 'step_finish', part: { cost: 0.003, tokens: { input: 300, output: 150 } } });

  assertEqual(usage.totalCost, 0.006, 'Should sum costs across all steps');
  assertEqual(usage.stepCount, 3, 'Should count 3 steps');
});

runTest('accumulateTokenUsage: does not double-count tokens from same event', () => {
  const { usage, accumulate } = createAccumulator();

  const event = { type: 'step_finish', part: { cost: 0, tokens: { input: 100, output: 50 } } };
  // Call once - should accumulate once
  accumulate(event);

  assertEqual(usage.inputTokens, 100, 'Should accumulate once');
  assertEqual(usage.stepCount, 1, 'Should count 1 step');

  // If called again with the same event (should NOT happen in real code but tests invariant)
  accumulate(event);
  assertEqual(usage.inputTokens, 200, 'Calling again with same event does accumulate (caller must ensure single call per event)');
  assertEqual(usage.stepCount, 2, 'Step count reflects actual calls');
});

// ==== Regression tests for Issue #1313 root cause ====
console.log('\n📋 Test Group: Issue #1313 regression prevention\n');

runTest('Regression: parseAgentTokenUsage returns non-zero when output has proper newlines', () => {
  // The core regression: if this returns 0, the Issue #1313 bug has returned
  const validNDJSON = `{"type":"step_finish","part":{"type":"step-finish","cost":0,"tokens":{"input":406,"output":353,"reasoning":281,"cache":{"read":33880,"write":0}}}}
{"type":"step_finish","part":{"type":"step-finish","cost":0,"tokens":{"input":100,"output":50,"reasoning":0,"cache":{"read":5000,"write":0}}}}
`;
  const result = parseAgentTokenUsage(validNDJSON);

  // CRITICAL: These must never be 0 when valid NDJSON is present
  if (result.inputTokens === 0) throw new Error('REGRESSION: inputTokens is 0 despite valid NDJSON - Issue #1313 may have regressed!');
  if (result.outputTokens === 0) throw new Error('REGRESSION: outputTokens is 0 despite valid NDJSON - Issue #1313 may have regressed!');

  assertEqual(result.stepCount, 2, 'Should parse 2 steps');
  assertEqual(result.inputTokens, 506, 'Total input tokens should be 406+100=506');
  assertEqual(result.outputTokens, 403, 'Total output tokens should be 353+50=403');
  assertEqual(result.reasoningTokens, 281, 'Should sum reasoning tokens');
  assertEqual(result.cacheReadTokens, 38880, 'Total cache read should be 33880+5000=38880');
});

runTest('Regression: streaming accumulation correctly sums tokens across many chunks', () => {
  // Validates that even if NDJSON is concatenated, streaming accumulation (the fix) still works
  const { usage, accumulate } = createAccumulator();

  // Simulate 46 step events (approximate count from Issue #1313 log)
  const eventCount = 46;
  const inputPerStep = 406;
  const outputPerStep = 353;

  for (let i = 0; i < eventCount; i++) {
    accumulate({
      type: 'step_finish',
      part: { type: 'step-finish', cost: 0, tokens: { input: inputPerStep, output: outputPerStep, reasoning: 0, cache: { read: 1000, write: 0 } } },
    });
  }

  // CRITICAL: These must never be 0 when events are processed
  if (usage.inputTokens === 0) throw new Error('REGRESSION: streaming inputTokens is 0 - streaming accumulation broken!');
  if (usage.outputTokens === 0) throw new Error('REGRESSION: streaming outputTokens is 0 - streaming accumulation broken!');

  assertEqual(usage.stepCount, eventCount, `Should count all ${eventCount} steps`);
  assertEqual(usage.inputTokens, inputPerStep * eventCount, `Should sum ${eventCount} × ${inputPerStep} input tokens`);
  assertEqual(usage.outputTokens, outputPerStep * eventCount, `Should sum ${eventCount} × ${outputPerStep} output tokens`);
});

runTest('Regression: mixed stdout/stderr streaming accumulation', () => {
  // In real agent execution, tokens come from BOTH stdout AND stderr
  // Both are processed through the same accumulateTokenUsage function
  const { usage, accumulate } = createAccumulator();

  // Simulate stdout tokens
  const stdoutEvents = [
    { type: 'step_finish', part: { cost: 0, tokens: { input: 100, output: 50 } } },
    { type: 'step_finish', part: { cost: 0, tokens: { input: 200, output: 100 } } },
  ];

  // Simulate stderr tokens (same format, different source)
  const stderrEvents = [{ type: 'step_finish', part: { cost: 0, tokens: { input: 300, output: 150 } } }];

  // Process all events (both streams call the same accumulator in agent.lib.mjs)
  for (const event of [...stdoutEvents, ...stderrEvents]) {
    accumulate(event);
  }

  assertEqual(usage.stepCount, 3, 'Should count steps from both stdout and stderr');
  assertEqual(usage.inputTokens, 600, 'Should sum tokens from both streams');
  assertEqual(usage.outputTokens, 300, 'Should sum output from both streams');
});

// ==== Token display pipeline tests (Issue #1313 root scenario) ====
// These tests verify the full pipeline: accumulation -> display
// The original bug showed "Token usage: 0 input, 0 output" because
// the post-hoc parsing returned zeros. We verify that accumulated tokens
// feed correctly into the display format.
console.log('\n📋 Test Group: Token display pipeline (end-to-end Issue #1313 scenario)\n');

// Inline copy of the token display formatting logic from src/github.lib.mjs
// to test the full pipeline from accumulation to display
const buildTokenUsageDisplay = tokenUsage => {
  if (!tokenUsage) return 'Token usage: 0 input, 0 output';
  const u = tokenUsage;
  let tokenInfo = `Token usage: ${u.inputTokens?.toLocaleString() || 0} input, ${u.outputTokens?.toLocaleString() || 0} output`;
  if (u.reasoningTokens > 0) tokenInfo += `, ${u.reasoningTokens.toLocaleString()} reasoning`;
  if (u.cacheReadTokens > 0 || u.cacheWriteTokens > 0) tokenInfo += `, ${u.cacheReadTokens?.toLocaleString() || 0} cache read, ${u.cacheWriteTokens?.toLocaleString() || 0} cache write`;
  return tokenInfo;
};

runTest('Issue #1313 pipeline: accumulated tokens display non-zero', () => {
  // This test reproduces the exact bug scenario end-to-end:
  // 1. Streaming accumulator receives step_finish events
  // 2. The final usage is passed to the display function
  // 3. Result must NOT be "Token usage: 0 input, 0 output"
  const { usage, accumulate } = createAccumulator();

  // Exact values from Issue #1313 bug report
  accumulate({
    type: 'step_finish',
    part: { type: 'step-finish', cost: 0, tokens: { input: 406, output: 353, reasoning: 281, cache: { read: 33880, write: 0 } } },
  });

  const display = buildTokenUsageDisplay(usage);
  if (display === 'Token usage: 0 input, 0 output') {
    throw new Error('REGRESSION: Got "Token usage: 0 input, 0 output" - this is the exact Issue #1313 bug!');
  }

  if (!display.includes('406') || !display.includes('353')) {
    throw new Error(`Expected display to contain 406 and 353, got: ${display}`);
  }
});

runTest('Issue #1313 pipeline: zero accumulated tokens (old bug scenario) display correctly', () => {
  // This demonstrates what the old code produced - shows why the fix matters
  const emptyUsage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  const display = buildTokenUsageDisplay(emptyUsage);
  // The old bug: tokens WERE present but accumulation was broken, so it showed zeros
  // This test verifies that if accumulation actually produces zeros, display shows them correctly
  if (!display.includes('0 input') || !display.includes('0 output')) {
    throw new Error(`Expected "0 input, 0 output" format, got: ${display}`);
  }
});

runTest('Issue #1313 pipeline: multi-step run produces correct non-zero display', () => {
  const { usage, accumulate } = createAccumulator();

  // Simulate a typical multi-step session like in the Issue #1313 log
  const steps = [
    { input: 406, output: 353, reasoning: 281, cache: { read: 33880, write: 0 } },
    { input: 512, output: 128, reasoning: 0, cache: { read: 50000, write: 0 } },
    { input: 1024, output: 256, reasoning: 0, cache: { read: 75000, write: 0 } },
  ];

  for (const step of steps) {
    accumulate({ type: 'step_finish', part: { cost: 0, tokens: step } });
  }

  const display = buildTokenUsageDisplay(usage);
  const expectedInput = 406 + 512 + 1024;
  const expectedOutput = 353 + 128 + 256;

  if (!display.includes(expectedInput.toLocaleString())) {
    throw new Error(`Expected input ${expectedInput.toLocaleString()} in display: ${display}`);
  }
  if (!display.includes(expectedOutput.toLocaleString())) {
    throw new Error(`Expected output ${expectedOutput.toLocaleString()} in display: ${display}`);
  }
});

// ==== Large number and precision tests ====
console.log('\n📋 Test Group: Large numbers and precision\n');

runTest('handles very large token counts without overflow', () => {
  const { usage, accumulate } = createAccumulator();

  // Simulate a very long session with hundreds of steps (large token counts)
  for (let i = 0; i < 100; i++) {
    accumulate({
      type: 'step_finish',
      part: { cost: 0.01, tokens: { input: 50000, output: 10000, reasoning: 5000, cache: { read: 100000, write: 10000 } } },
    });
  }

  assertEqual(usage.stepCount, 100, 'Should count 100 steps');
  assertEqual(usage.inputTokens, 5000000, 'Should handle 5M total input tokens');
  assertEqual(usage.outputTokens, 1000000, 'Should handle 1M total output tokens');
  assertEqual(usage.cacheReadTokens, 10000000, 'Should handle 10M cache read tokens');
  // Cost: 100 steps × $0.01 = $1.00, floating point sum
  if (Math.abs(usage.totalCost - 1.0) > 0.0001) {
    throw new Error(`Expected totalCost ~1.0, got ${usage.totalCost}`);
  }
});

runTest('parseAgentTokenUsage handles large token values correctly', () => {
  const output = `{"type":"step_finish","part":{"cost":0,"tokens":{"input":999999,"output":888888,"reasoning":777777,"cache":{"read":666666,"write":555555}}}}
`;
  const result = parseAgentTokenUsage(output);

  assertEqual(result.inputTokens, 999999, 'Should handle large input tokens');
  assertEqual(result.outputTokens, 888888, 'Should handle large output tokens');
  assertEqual(result.reasoningTokens, 777777, 'Should handle large reasoning tokens');
  assertEqual(result.cacheReadTokens, 666666, 'Should handle large cache read tokens');
  assertEqual(result.cacheWriteTokens, 555555, 'Should handle large cache write tokens');
});

// ==== NDJSON boundary tests ====
console.log('\n📋 Test Group: NDJSON format boundary cases\n');

runTest('parseAgentTokenUsage handles output with Windows-style line endings (CRLF)', () => {
  const output = '{"type":"step_finish","part":{"cost":0,"tokens":{"input":100,"output":50}}}\r\n' + '{"type":"step_finish","part":{"cost":0,"tokens":{"input":200,"output":100}}}\r\n';
  const result = parseAgentTokenUsage(output);

  // CRLF lines: the \r will be part of trimmedLine, but JSON.parse handles it
  // (trailing \r in JSON string is ignored by JSON.parse)
  assertEqual(result.stepCount, 2, 'Should parse CRLF-delimited NDJSON');
  assertEqual(result.inputTokens, 300, 'Should sum input tokens from CRLF lines');
});

runTest('parseAgentTokenUsage skips lines that are not JSON objects', () => {
  const output = `some plain text log line
{"type":"step_finish","part":{"cost":0,"tokens":{"input":100,"output":50}}}
another plain log: executing bash command
[INFO] Starting agent...
{"type":"step_finish","part":{"cost":0,"tokens":{"input":200,"output":100}}}
`;
  const result = parseAgentTokenUsage(output);

  assertEqual(result.stepCount, 2, 'Should parse only JSON lines');
  assertEqual(result.inputTokens, 300, 'Should sum from JSON lines only');
});

runTest('parseAgentTokenUsage handles JSON arrays (should skip them)', () => {
  const output = `[{"type":"step_finish","part":{"tokens":{"input":100,"output":50}}}]
{"type":"step_finish","part":{"cost":0,"tokens":{"input":200,"output":100}}}
`;
  const result = parseAgentTokenUsage(output);

  // Arrays start with '[' not '{', so should be skipped
  assertEqual(result.stepCount, 1, 'Should skip JSON arrays (lines not starting with {)');
  assertEqual(result.inputTokens, 200, 'Should only count JSON object lines');
});

runTest('parseAgentTokenUsage handles deeply nested tokens structure', () => {
  // Some agents may include extra metadata in the tokens object
  const output = '{"type":"step_finish","extra":{"meta":"data"},"part":{"type":"step-finish","cost":0.005,"tokens":{"input":500,"output":100,"reasoning":25,"cache":{"read":5000,"write":100}}}}\n';
  const result = parseAgentTokenUsage(output);

  assertEqual(result.stepCount, 1, 'Should parse step with extra fields');
  assertEqual(result.inputTokens, 500, 'Should extract input tokens');
  assertEqual(result.cacheReadTokens, 5000, 'Should extract nested cache read');
});

// ==== Accumulator state isolation tests ====
console.log('\n📋 Test Group: Accumulator state isolation\n');

runTest('two separate accumulators are independent', () => {
  const acc1 = createAccumulator();
  const acc2 = createAccumulator();

  acc1.accumulate({ type: 'step_finish', part: { cost: 0, tokens: { input: 100, output: 50 } } });
  acc1.accumulate({ type: 'step_finish', part: { cost: 0, tokens: { input: 200, output: 100 } } });
  acc2.accumulate({ type: 'step_finish', part: { cost: 0, tokens: { input: 999, output: 888 } } });

  assertEqual(acc1.usage.inputTokens, 300, 'acc1 should have 300 input tokens');
  assertEqual(acc1.usage.stepCount, 2, 'acc1 should have 2 steps');
  assertEqual(acc2.usage.inputTokens, 999, 'acc2 should be independent with 999 input tokens');
  assertEqual(acc2.usage.stepCount, 1, 'acc2 should have 1 step');
});

runTest('accumulator starts fresh with all zeros', () => {
  const { usage } = createAccumulator();

  assertEqual(usage.inputTokens, 0, 'Should start at 0 input');
  assertEqual(usage.outputTokens, 0, 'Should start at 0 output');
  assertEqual(usage.reasoningTokens, 0, 'Should start at 0 reasoning');
  assertEqual(usage.cacheReadTokens, 0, 'Should start at 0 cache read');
  assertEqual(usage.cacheWriteTokens, 0, 'Should start at 0 cache write');
  assertEqual(usage.totalCost, 0, 'Should start at 0 cost');
  assertEqual(usage.stepCount, 0, 'Should start at 0 steps');
});

// ==== Issue #1313 exact reproduction test ====
console.log('\n📋 Test Group: Issue #1313 exact reproduction\n');

runTest('Issue #1313: the exact gist log data parses non-zero tokens', () => {
  // This is the exact JSON structure from the gist linked in Issue #1313:
  // https://gist.githubusercontent.com/konard/baae4b8157c98675224c6e575fef7178/raw/.../solution-draft-log-pr-1770982293538.txt
  // The log showed tokens: { input: 406, output: 353, reasoning: 281, cache: { read: 33880, write: 0 } }
  // But the comment showed "Token usage: 0 input, 0 output" - this was the bug.
  const logLine = '{"type":"step_finish","timestamp":1770982017418,"sessionID":"ses_3a93f1458ffeK5TKD4XfXXW4A3","part":{"id":"prt_c56c10976001ItHqFbhtFmk8aP","sessionID":"ses_3a93f1458ffeK5TKD4XfXXW4A3","messageID":"msg_c56c0ec62001LvHUlMLyTfvFEl","type":"step-finish","reason":"tool-calls","snapshot":"5d6c73c51a020ef88084e93fe72a793b31b7441f","cost":0,"tokens":{"input":406,"output":353,"reasoning":281,"cache":{"read":33880,"write":0}}}}\n';

  // Test with post-hoc parsing (parseAgentTokenUsage)
  const parsedResult = parseAgentTokenUsage(logLine);
  assertEqual(parsedResult.inputTokens, 406, 'parseAgentTokenUsage: input should be 406 not 0');
  assertEqual(parsedResult.outputTokens, 353, 'parseAgentTokenUsage: output should be 353 not 0');
  assertEqual(parsedResult.reasoningTokens, 281, 'parseAgentTokenUsage: reasoning should be 281');

  // Test with streaming accumulation (the fix)
  const { usage, accumulate } = createAccumulator();
  accumulate(JSON.parse(logLine));
  assertEqual(usage.inputTokens, 406, 'streaming: input should be 406 not 0');
  assertEqual(usage.outputTokens, 353, 'streaming: output should be 353 not 0');
  assertEqual(usage.reasoningTokens, 281, 'streaming: reasoning should be 281');

  // Both approaches must return non-zero when the data is present
  if (parsedResult.inputTokens === 0) throw new Error('BUG REPRODUCED: parseAgentTokenUsage returns 0 for valid data!');
  if (usage.inputTokens === 0) throw new Error('BUG REPRODUCED: streaming accumulation returns 0 for valid data!');
});

runTest('Issue #1313: demonstrates old post-hoc bug with concatenated JSON', () => {
  // Old code tried JSON.parse(fullOutput) where fullOutput had concatenated JSON objects
  // This is exactly what happened in the v1.21.4 code before the streaming fix
  const concatenatedNDJSON = '{"type":"step_finish","part":{"tokens":{"input":406,"output":353}}}' + '{"type":"step_finish","part":{"tokens":{"input":512,"output":128}}}';

  // Simulate old post-hoc approach: try to parse the whole concatenated string
  let oldApproachResult;
  try {
    oldApproachResult = JSON.parse(concatenatedNDJSON); // This FAILS with SyntaxError
    throw new Error('Should have thrown');
  } catch (e) {
    if (e.message === 'Should have thrown') throw e;
    oldApproachResult = null; // Failed to parse - returns no tokens (the bug)
  }

  assertEqual(oldApproachResult, null, 'Old approach: JSON.parse fails on concatenated JSON');

  // New approach: parseAgentTokenUsage processes line by line
  // But even this can fail if there are no newlines (the bug was that lines got concatenated)
  const parseResult = parseAgentTokenUsage(concatenatedNDJSON);
  assertEqual(parseResult.stepCount, 0, 'parseAgentTokenUsage also fails on concatenated JSON (no newlines)');

  // The REAL fix: streaming accumulation processes each chunk as it arrives
  // So it never sees concatenated output - it processes events one by one
  const { usage, accumulate } = createAccumulator();
  // These events arrive separately during streaming (no concatenation issue)
  accumulate({ type: 'step_finish', part: { tokens: { input: 406, output: 353 } } });
  accumulate({ type: 'step_finish', part: { tokens: { input: 512, output: 128 } } });

  assertEqual(usage.stepCount, 2, 'Streaming fix: processes both events correctly');
  assertEqual(usage.inputTokens, 918, 'Streaming fix: correctly sums 406+512=918');
  assertEqual(usage.outputTokens, 481, 'Streaming fix: correctly sums 353+128=481');
});

// Summary
console.log('\n' + '='.repeat(80));
console.log(`Test Results for agent token usage (Issue #1250 / Issue #1313):`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log('='.repeat(80));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
