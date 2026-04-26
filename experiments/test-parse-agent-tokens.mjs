#!/usr/bin/env node
/**
 * Test script to validate the parseAgentTokenUsage function
 * This tests the token parsing logic with sample NDJSON data from agent
 */

// Sample NDJSON data that agent would output (each line is a complete JSON object)
const sampleNDJSON = `{"type":"step_finish","timestamp":1770842531248,"sessionID":"ses_test123","part":{"id":"prt_1","sessionID":"ses_test123","messageID":"msg_1","type":"step-finish","reason":"tool-calls","snapshot":"abc123","cost":0,"tokens":{"input":15413,"output":64,"reasoning":0,"cache":{"read":32,"write":0}}}}
{"type":"step_finish","timestamp":1770842550825,"sessionID":"ses_test123","part":{"id":"prt_2","sessionID":"ses_test123","messageID":"msg_2","type":"step-finish","reason":"tool-calls","snapshot":"abc123","cost":0,"tokens":{"input":4602,"output":56,"reasoning":0,"cache":{"read":15456,"write":0}}}}
{"type":"step_finish","timestamp":1770842560848,"sessionID":"ses_test123","part":{"id":"prt_3","sessionID":"ses_test123","messageID":"msg_3","type":"step-finish","reason":"stop","snapshot":"abc123","cost":0,"tokens":{"input":360,"output":341,"reasoning":1,"cache":{"read":68456,"write":0}}}}
`;

/**
 * Copy of parseAgentTokenUsage for testing
 */
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

// Run test
console.log('=== Test: parseAgentTokenUsage ===\n');
console.log('Input NDJSON lines:', sampleNDJSON.split('\n').filter(l => l.trim()).length);

const result = parseAgentTokenUsage(sampleNDJSON);

console.log('\nParsed result:');
console.log(JSON.stringify(result, null, 2));

// Verify expected values
const expected = {
  inputTokens: 15413 + 4602 + 360, // = 20375
  outputTokens: 64 + 56 + 341, // = 461
  reasoningTokens: 1,
  cacheReadTokens: 32 + 15456 + 68456, // = 83944
  cacheWriteTokens: 0,
  totalCost: 0,
  stepCount: 3,
};

console.log('\nExpected result:');
console.log(JSON.stringify(expected, null, 2));

console.log('\nValidation:');
console.log(`  inputTokens: ${result.inputTokens === expected.inputTokens ? '✅' : '❌'} (got ${result.inputTokens}, expected ${expected.inputTokens})`);
console.log(`  outputTokens: ${result.outputTokens === expected.outputTokens ? '✅' : '❌'} (got ${result.outputTokens}, expected ${expected.outputTokens})`);
console.log(`  reasoningTokens: ${result.reasoningTokens === expected.reasoningTokens ? '✅' : '❌'} (got ${result.reasoningTokens}, expected ${expected.reasoningTokens})`);
console.log(`  cacheReadTokens: ${result.cacheReadTokens === expected.cacheReadTokens ? '✅' : '❌'} (got ${result.cacheReadTokens}, expected ${expected.cacheReadTokens})`);
console.log(`  cacheWriteTokens: ${result.cacheWriteTokens === expected.cacheWriteTokens ? '✅' : '❌'} (got ${result.cacheWriteTokens}, expected ${expected.cacheWriteTokens})`);
console.log(`  stepCount: ${result.stepCount === expected.stepCount ? '✅' : '❌'} (got ${result.stepCount}, expected ${expected.stepCount})`);

const allPassed = result.inputTokens === expected.inputTokens && result.outputTokens === expected.outputTokens && result.reasoningTokens === expected.reasoningTokens && result.cacheReadTokens === expected.cacheReadTokens && result.cacheWriteTokens === expected.cacheWriteTokens && result.stepCount === expected.stepCount;

console.log(`\nOverall: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

process.exit(allPassed ? 0 : 1);
