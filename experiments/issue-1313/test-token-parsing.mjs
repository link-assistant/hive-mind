#!/usr/bin/env node

/**
 * Experiment to reproduce and understand the token parsing issue from Issue #1313
 *
 * The issue: Agent logs show step_finish events with token data, but the final comment says "0 input, 0 output"
 *
 * Hypothesis 1: The NDJSON lines get concatenated without newlines, breaking JSON.parse
 * Hypothesis 2: The step_finish event type is different from what the code expects
 * Hypothesis 3: The tokens are in a different structure than expected
 */

import fs from 'fs';
import path from 'path';

// Copy of parseAgentTokenUsage from agent.lib.mjs
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

  // Try to parse each line as JSON (agent outputs NDJSON format)
  const lines = output.split('\n');
  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || !trimmedLine.startsWith('{')) continue;

    try {
      const parsed = JSON.parse(trimmedLine);

      // Look for step_finish events which contain token usage
      if (parsed.type === 'step_finish' && parsed.part?.tokens) {
        const tokens = parsed.part.tokens;
        usage.stepCount++;

        // Add token counts
        if (tokens.input) usage.inputTokens += tokens.input;
        if (tokens.output) usage.outputTokens += tokens.output;
        if (tokens.reasoning) usage.reasoningTokens += tokens.reasoning;

        // Handle cache tokens (can be in different formats)
        if (tokens.cache) {
          if (tokens.cache.read) usage.cacheReadTokens += tokens.cache.read;
          if (tokens.cache.write) usage.cacheWriteTokens += tokens.cache.write;
        }

        // Add cost from step_finish (usually 0 for free models like grok-code)
        if (parsed.part.cost !== undefined) {
          usage.totalCost += parsed.part.cost;
        }
      }
    } catch {
      // Skip lines that aren't valid JSON
      continue;
    }
  }

  return usage;
};

// Test with a sample step_finish event from the log (with log prefix stripped)
const sampleNDJSON = `{"type":"step_finish","timestamp":1770982017418,"sessionID":"ses_3a93f1458ffeK5TKD4XfXXW4A3","part":{"id":"prt_c56c10976001ItHqFbhtFmk8aP","sessionID":"ses_3a93f1458ffeK5TKD4XfXXW4A3","messageID":"msg_c56c0ec62001LvHUlMLyTfvFEl","type":"step-finish","reason":"tool-calls","snapshot":"5d6c73c51a020ef88084e93fe72a793b31b7441f","cost":0,"tokens":{"input":13481,"output":159,"reasoning":73,"cache":{"read":2028,"write":0}}}}`;

console.log('=== Test 1: Parse single NDJSON line ===');
const result1 = parseAgentTokenUsage(sampleNDJSON);
console.log('Result:', JSON.stringify(result1, null, 2));
console.log('Expected: stepCount=1, inputTokens=13481, outputTokens=159');
console.log('');

// Test with multiple NDJSON lines
const multipleNDJSON = `{"type":"step_finish","part":{"tokens":{"input":100,"output":50}}}
{"type":"step_finish","part":{"tokens":{"input":200,"output":100}}}
{"type":"other","part":{}}`;

console.log('=== Test 2: Parse multiple NDJSON lines ===');
const result2 = parseAgentTokenUsage(multipleNDJSON);
console.log('Result:', JSON.stringify(result2, null, 2));
console.log('Expected: stepCount=2, inputTokens=300, outputTokens=150');
console.log('');

// Test with pretty-printed JSON (as logged)
const prettyPrintedJSON = `{
  "type": "step_finish",
  "part": {
    "tokens": {
      "input": 100,
      "output": 50
    }
  }
}`;

console.log('=== Test 3: Parse pretty-printed JSON ===');
const result3 = parseAgentTokenUsage(prettyPrintedJSON);
console.log('Result:', JSON.stringify(result3, null, 2));
console.log('Expected: stepCount=0 (fails because line-by-line parsing breaks multi-line JSON)');
console.log('');

// Test with log-prefixed output (simulating solve.mjs log output)
const logPrefixedOutput = `[2026-02-13T11:26:57.421Z] [INFO] {
[2026-02-13T11:26:57.421Z] [INFO]   "type": "step_finish",
[2026-02-13T11:26:57.425Z] [INFO]   "part": {
[2026-02-13T11:26:57.425Z] [INFO]     "tokens": {
[2026-02-13T11:26:57.425Z] [INFO]       "input": 100,
[2026-02-13T11:26:57.425Z] [INFO]       "output": 50
[2026-02-13T11:26:57.425Z] [INFO]     }
[2026-02-13T11:26:57.425Z] [INFO]   }
[2026-02-13T11:26:57.426Z] [INFO] }`;

console.log('=== Test 4: Parse log-prefixed output ===');
const result4 = parseAgentTokenUsage(logPrefixedOutput);
console.log('Result:', JSON.stringify(result4, null, 2));
console.log('Expected: stepCount=0 (fails because log prefixes make JSON invalid)');
console.log('');

// Now let's test the streaming accumulation logic
console.log('=== Test 5: Simulate streaming accumulation ===');
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

// Simulate streaming output - each chunk is a complete NDJSON line
const chunks = ['{"type":"step_finish","part":{"tokens":{"input":100,"output":50}}}', '{"type":"step_finish","part":{"tokens":{"input":200,"output":100}}}'];

for (const chunk of chunks) {
  // In solve.mjs, each chunk is parsed and pretty-printed separately
  // The key insight: the OUTPUT that's logged is pretty-printed,
  // but the STREAMING accumulation happens BEFORE the pretty-printing
  try {
    const data = JSON.parse(chunk);
    accumulateTokenUsage(data);
    // This is what solve.mjs does: log the pretty-printed JSON
    console.log('Logged output:', JSON.stringify(data, null, 2).substring(0, 50) + '...');
  } catch (e) {
    console.log('Failed to parse:', chunk.substring(0, 50) + '...');
  }
}

console.log('Accumulated result:', JSON.stringify(streamingTokenUsage, null, 2));
console.log('Expected: stepCount=2, inputTokens=300, outputTokens=150');
console.log('');

console.log('=== Analysis ===');
console.log('The streaming accumulation logic is correct!');
console.log('');
console.log('The issue must be somewhere else. Possible causes:');
console.log('1. The streaming output is not being parsed correctly (stderr vs stdout)');
console.log('2. The streaming chunks are not complete NDJSON lines');
console.log('3. The accumulateTokenUsage function is not being called');
console.log('4. The pricingInfo.tokenUsage is not being set from streamingTokenUsage');
