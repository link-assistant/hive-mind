#!/usr/bin/env node
// Test the detectAgentErrors function with real-world agent output

// Simulate the detectAgentErrors function from agent.lib.mjs
const detectAgentErrors = stdoutOutput => {
  const lines = stdoutOutput.split('\n');

  for (const line of lines) {
    if (!line.trim()) continue;

    try {
      const msg = JSON.parse(line);

      // Check for explicit error message types from agent
      if (msg.type === 'error' || msg.type === 'step_error') {
        return { detected: true, type: 'AgentError', match: msg.message || line.substring(0, 100) };
      }
    } catch {
      // Not JSON - ignore for error detection
      continue;
    }
  }

  return { detected: false };
};

// Test 1: Simple NDJSON with error line
console.log('=== Test 1: Single error line ===');
const test1 = '{"type":"error","timestamp":1769784980576,"sessionID":"ses_3f09cdf7affePwF0n1677v3wqX","error":"The operation timed out."}';
const result1 = detectAgentErrors(test1);
console.log('Result:', JSON.stringify(result1));
console.log('Expected: detected=true');
console.log('Pass:', result1.detected === true);
console.log();

// Test 2: Multiple NDJSON lines with error in the middle
console.log('=== Test 2: Error in middle of output ===');
const test2 = ['{"type":"step_start","timestamp":1769784708441,"sessionID":"ses_3f09cdf7affePwF0n1677v3wqX"}', '{"type":"step_finish","timestamp":1769784924532,"sessionID":"ses_3f09cdf7affePwF0n1677v3wqX"}', '{"type":"error","timestamp":1769784980576,"sessionID":"ses_3f09cdf7affePwF0n1677v3wqX","error":"The operation timed out."}', '{"type":"text","timestamp":1769785052790,"sessionID":"ses_3f09cdf7affePwF0n1677v3wqX"}', '{"type":"step_finish","timestamp":1769785052800,"sessionID":"ses_3f09cdf7affePwF0n1677v3wqX"}'].join('\n');
const result2 = detectAgentErrors(test2);
console.log('Result:', JSON.stringify(result2));
console.log('Expected: detected=true');
console.log('Pass:', result2.detected === true);
console.log();

// Test 3: Output with no errors
console.log('=== Test 3: No errors ===');
const test3 = ['{"type":"step_start","timestamp":1}', '{"type":"step_finish","timestamp":2}'].join('\n');
const result3 = detectAgentErrors(test3);
console.log('Result:', JSON.stringify(result3));
console.log('Expected: detected=false');
console.log('Pass:', result3.detected === false);
console.log();

// Test 4: Non-JSON mixed with JSON
console.log('=== Test 4: Mixed content ===');
const test4 = 'some plain text\n{"type":"error","error":"timeout"}\nmore plain text';
const result4 = detectAgentErrors(test4);
console.log('Result:', JSON.stringify(result4));
console.log('Expected: detected=true');
console.log('Pass:', result4.detected === true);
console.log();

// Test 5: Error JSON that arrives as partial chunks concatenated
console.log('=== Test 5: Concatenated JSON objects (no newline between) ===');
const test5 = '{"type":"step_finish","timestamp":2}{"type":"error","error":"timeout"}';
const result5 = detectAgentErrors(test5);
console.log('Result:', JSON.stringify(result5));
console.log('Expected: detected=true but will fail if objects are on same line');
console.log('Pass:', result5.detected === true);
console.log();

// Test 6: Simulating what fullOutput looks like when chunks arrive without trailing newlines
console.log('=== Test 6: Chunks without trailing newlines ===');
// Simulate: chunk1 = '{"type":"step_finish",...}\n', chunk2 = '{"type":"error",...}\n{"type":"text",...}\n'
const chunk1 = '{"type":"step_finish","timestamp":2}\n';
const chunk2 = '{"type":"error","error":"timeout"}\n{"type":"text","timestamp":3}\n';
const fullOutput = chunk1 + chunk2;
const result6 = detectAgentErrors(fullOutput);
console.log('Result:', JSON.stringify(result6));
console.log('Expected: detected=true');
console.log('Pass:', result6.detected === true);
console.log();

console.log('=== Summary ===');
const allPass = result1.detected && result2.detected && !result3.detected && result4.detected && result6.detected;
console.log('All basic tests pass:', allPass);
if (!result5.detected) {
  console.log('WARNING: Test 5 failed - concatenated JSON objects on same line are not detected!');
  console.log('This is the likely root cause of the bug.');
}
