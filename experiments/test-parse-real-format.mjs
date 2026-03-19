#!/usr/bin/env node
/**
 * Test script to check if parseAgentTokenUsage handles the real agent output format
 *
 * This test extracts real step_finish events from the log files and tests parsing
 */

import * as fs from 'fs/promises';
import * as path from 'path';

// Copy of parseAgentTokenUsage for testing
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
  let linesProcessed = 0;
  let linesSkipped = 0;
  let stepFinishFound = 0;

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (!trimmedLine || !trimmedLine.startsWith('{')) {
      linesSkipped++;
      continue;
    }

    try {
      linesProcessed++;
      const parsed = JSON.parse(trimmedLine);

      // Look for step_finish events which contain token usage
      if (parsed.type === 'step_finish' && parsed.part?.tokens) {
        stepFinishFound++;
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
    } catch (e) {
      // Skip lines that aren't valid JSON
      continue;
    }
  }

  console.log('Parsing stats:');
  console.log(`  Total lines: ${lines.length}`);
  console.log(`  Lines skipped (not JSON): ${linesSkipped}`);
  console.log(`  Lines processed as JSON: ${linesProcessed}`);
  console.log(`  step_finish events found: ${stepFinishFound}`);

  return usage;
};

// Test 1: Raw NDJSON format (what agent should output)
console.log('\n=== Test 1: Raw NDJSON Format ===\n');
const rawNDJSON = `{"type":"step_finish","timestamp":1770842531248,"sessionID":"ses_test123","part":{"id":"prt_1","sessionID":"ses_test123","messageID":"msg_1","type":"step-finish","reason":"tool-calls","snapshot":"abc123","cost":0,"tokens":{"input":15413,"output":64,"reasoning":0,"cache":{"read":32,"write":0}}}}
{"type":"step_finish","timestamp":1770842550825,"sessionID":"ses_test123","part":{"id":"prt_2","sessionID":"ses_test123","messageID":"msg_2","type":"step-finish","reason":"tool-calls","snapshot":"abc123","cost":0,"tokens":{"input":4602,"output":56,"reasoning":0,"cache":{"read":15456,"write":0}}}}
{"type":"step_finish","timestamp":1770842560848,"sessionID":"ses_test123","part":{"id":"prt_3","sessionID":"ses_test123","messageID":"msg_3","type":"step-finish","reason":"stop","snapshot":"abc123","cost":0,"tokens":{"input":360,"output":341,"reasoning":1,"cache":{"read":68456,"write":0}}}}
`;

const result1 = parseAgentTokenUsage(rawNDJSON);
console.log('\nResult:', JSON.stringify(result1, null, 2));

// Test 2: What if lines are concatenated without newlines?
console.log('\n=== Test 2: Concatenated JSON (no newlines) ===\n');
const concatenatedJSON = `{"type":"step_finish","timestamp":1770842531248,"sessionID":"ses_test123","part":{"id":"prt_1","type":"step-finish","cost":0,"tokens":{"input":15413,"output":64,"reasoning":0,"cache":{"read":32,"write":0}}}}{"type":"step_finish","timestamp":1770842550825,"sessionID":"ses_test123","part":{"id":"prt_2","type":"step-finish","cost":0,"tokens":{"input":4602,"output":56,"reasoning":0,"cache":{"read":15456,"write":0}}}}`;

const result2 = parseAgentTokenUsage(concatenatedJSON);
console.log('\nResult:', JSON.stringify(result2, null, 2));
console.log('\n❌ Issue: When lines are concatenated, JSON.parse fails because it sees two objects without separator!');

// Test 3: What if the output has [timestamp] [INFO] prefixes (like in log files)?
console.log('\n=== Test 3: Log Format with Prefixes ===\n');
const logFormat = `[2026-02-11T20:42:11.251Z] [INFO]   "type": "step_finish",
[2026-02-11T20:42:11.251Z] [INFO]   "timestamp": 1770842531248,
[2026-02-11T20:42:11.251Z] [INFO]   "sessionID": "ses_test123"
`;

const result3 = parseAgentTokenUsage(logFormat);
console.log('\nResult:', JSON.stringify(result3, null, 2));
console.log('\n❌ Issue: Log format is NOT valid NDJSON - each line has a prefix and the JSON is pretty-printed across multiple lines!');

// Test 4: Check if there's an issue with buffer boundaries in streaming
console.log('\n=== Test 4: Chunked/Split JSON (simulating streaming issues) ===\n');
// Simulate what happens if a JSON line gets split across chunks
const chunk1 = '{"type":"step_finish","timestamp":1770842531248,"session';
const chunk2 = 'ID":"ses_test123","part":{"id":"prt_1","type":"step-finish","cost":0,"tokens":{"input":15413,"output":64}}}\n';
const combined = chunk1 + chunk2;

console.log('Chunk 1:', JSON.stringify(chunk1));
console.log('Chunk 2:', JSON.stringify(chunk2));
console.log('Combined:', JSON.stringify(combined));

const result4 = parseAgentTokenUsage(combined);
console.log('\nResult:', JSON.stringify(result4, null, 2));
console.log('\n✅ If chunks are combined before parsing, it should work');

console.log('\n=== Summary ===');
console.log(`Test 1 (Raw NDJSON): stepCount = ${result1.stepCount}`);
console.log(`Test 2 (Concatenated): stepCount = ${result2.stepCount}`);
console.log(`Test 3 (Log Format): stepCount = ${result3.stepCount}`);
console.log(`Test 4 (Chunked): stepCount = ${result4.stepCount}`);
