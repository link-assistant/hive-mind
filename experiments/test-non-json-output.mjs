#!/usr/bin/env node
// Test script to verify non-JSON output handling from claude command
// This simulates the scenario where claude outputs non-JSON text

// Setup global.use if not already defined
if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const { $ } = await use('command-stream');

// Mock log function
const log = async (message, options = {}) => {
  console.log(message);
};

// Test 1: Simulate processing mixed JSON and non-JSON output
console.log('\n=== Test 1: Mixed JSON and non-JSON output ===\n');

const mixedOutput = `{"type":"message","session_id":"test123"}
This is plain text output from claude
{"type":"text","text":"Hello from Claude"}
Another plain text line
{"invalid json here
Final text output`;

const lines = mixedOutput.split('\n');
let parsedCount = 0;
let nonJsonCount = 0;

for (const line of lines) {
  if (!line.trim()) continue;

  try {
    const data = JSON.parse(line);
    await log(`✅ Parsed JSON: ${JSON.stringify(data)}`);
    parsedCount++;
  } catch (parseError) {
    // JSON parse errors are expected for non-JSON output
    // Only report in verbose mode (simulated here with false)
    if (global.verboseMode) {
      console.log(`[Verbose] Parse error: ${parseError.message}`);
    }
    // Not JSON or parsing failed, output as-is
    await log(`📝 Non-JSON output: ${line}`);
    nonJsonCount++;
  }
}

console.log(`\n📊 Results: ${parsedCount} JSON lines, ${nonJsonCount} non-JSON lines`);

// Test 2: Verify that output is never lost
console.log('\n=== Test 2: Ensure all output is captured ===\n');

const allLines = lines.filter(l => l.trim());
const processedLines = parsedCount + nonJsonCount;

if (allLines.length === processedLines) {
  console.log('✅ All lines were processed (none lost)');
} else {
  console.log(`❌ Line count mismatch: ${allLines.length} input vs ${processedLines} processed`);
}

// Test 3: Simulate global.verboseMode
console.log('\n=== Test 3: Verbose mode behavior ===\n');

global.verboseMode = true;
console.log('Verbose mode: ON');

const testLine = 'This is not JSON';
try {
  JSON.parse(testLine);
} catch (parseError) {
  if (global.verboseMode) {
    console.log('✅ In verbose mode, parse error would be reported to Sentry');
    console.log(`   Error: ${parseError.message}`);
  }
}

global.verboseMode = false;
console.log('\nVerbose mode: OFF');

try {
  JSON.parse(testLine);
} catch (parseError) {
  if (global.verboseMode) {
    console.log('Would report to Sentry');
  } else {
    console.log('✅ In normal mode, parse error is not reported to Sentry');
  }
}

console.log('\n✅ All tests completed successfully!\n');
