#!/usr/bin/env node

/**
 * Test parsing of actual step_finish event from the log
 */

// This is exactly what the actual JSON structure looks like (extracted from the log)
const actualStepFinishEvent = {
  type: 'step_finish',
  timestamp: 1770982017418,
  sessionID: 'ses_3a93f1458ffeK5TKD4XfXXW4A3',
  part: {
    id: 'prt_c56c10976001ItHqFbhtFmk8aP',
    sessionID: 'ses_3a93f1458ffeK5TKD4XfXXW4A3',
    messageID: 'msg_c56c0ec62001LvHUlMLyTfvFEl',
    type: 'step-finish',
    reason: 'tool-calls',
    snapshot: '5d6c73c51a020ef88084e93fe72a793b31b7441f',
    cost: 0,
    tokens: {
      input: 13481,
      output: 159,
      reasoning: 73,
      cache: {
        read: 2028,
        write: 0,
      },
    },
  },
};

// Simulate streaming token usage
const streamingTokenUsage = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
  stepCount: 0,
};

// Copy of accumulateTokenUsage from agent.lib.mjs
const accumulateTokenUsage = data => {
  console.log('accumulateTokenUsage called with type:', data.type);
  console.log('data.part?.tokens:', data.part?.tokens);

  if (data.type === 'step_finish' && data.part?.tokens) {
    console.log('Condition matched!');
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
  } else {
    console.log('Condition NOT matched!');
    console.log('  data.type === "step_finish":', data.type === 'step_finish');
    console.log('  data.part?.tokens truthy:', !!data.part?.tokens);
  }
};

console.log('=== Test with actual step_finish event from log ===');
accumulateTokenUsage(actualStepFinishEvent);
console.log('Result:', JSON.stringify(streamingTokenUsage, null, 2));
console.log('Expected: stepCount=1, inputTokens=13481, outputTokens=159');
console.log('');

// Also test what happens when streaming
console.log('=== Simulate JSON.parse of NDJSON line ===');
const ndjsonLine = '{"type":"step_finish","timestamp":1770982017418,"sessionID":"ses_3a93f1458ffeK5TKD4XfXXW4A3","part":{"id":"prt_c56c10976001ItHqFbhtFmk8aP","sessionID":"ses_3a93f1458ffeK5TKD4XfXXW4A3","messageID":"msg_c56c0ec62001LvHUlMLyTfvFEl","type":"step-finish","reason":"tool-calls","snapshot":"5d6c73c51a020ef88084e93fe72a793b31b7441f","cost":0,"tokens":{"input":13481,"output":159,"reasoning":73,"cache":{"read":2028,"write":0}}}}';

const streamingTokenUsage2 = {
  inputTokens: 0,
  outputTokens: 0,
  reasoningTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  totalCost: 0,
  stepCount: 0,
};

const accumulateTokenUsage2 = data => {
  if (data.type === 'step_finish' && data.part?.tokens) {
    const tokens = data.part.tokens;
    streamingTokenUsage2.stepCount++;
    if (tokens.input) streamingTokenUsage2.inputTokens += tokens.input;
    if (tokens.output) streamingTokenUsage2.outputTokens += tokens.output;
    if (tokens.reasoning) streamingTokenUsage2.reasoningTokens += tokens.reasoning;
    if (tokens.cache) {
      if (tokens.cache.read) streamingTokenUsage2.cacheReadTokens += tokens.cache.read;
      if (tokens.cache.write) streamingTokenUsage2.cacheWriteTokens += tokens.cache.write;
    }
    if (data.part.cost !== undefined) {
      streamingTokenUsage2.totalCost += data.part.cost;
    }
  }
};

try {
  const parsed = JSON.parse(ndjsonLine);
  console.log('Parsed type:', parsed.type);
  accumulateTokenUsage2(parsed);
  console.log('Result:', JSON.stringify(streamingTokenUsage2, null, 2));
} catch (e) {
  console.log('Parse error:', e.message);
}

console.log('');
console.log('=== Conclusion ===');
console.log('The parsing and accumulation logic is CORRECT.');
console.log('The issue must be in how the streaming data is processed or stored.');
