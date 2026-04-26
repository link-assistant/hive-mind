#!/usr/bin/env node
/**
 * Issue #7: Stream output handling
 *
 * Problem: Iterating over command.stream() for real-time output requires proper chunk handling
 * Solution: Handle chunk types (stdout, stderr, exit) and parse JSON carefully
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');
const fs = (await import('fs')).promises;

console.log('=== Issue #7: Stream Output Handling ===\n');

console.log('Problem: Real-time streaming output requires careful chunk handling\n');

// Example 1: Basic streaming
console.log('Example 1: Basic streaming with chunk types');
console.log('Command: echo "Line 1"; sleep 1; echo "Line 2" >&2; sleep 1; echo "Line 3"');
console.log('\nStreaming output:');

try {
  const command = $`sh -c 'echo "Line 1"; sleep 1; echo "Line 2" >&2; sleep 1; echo "Line 3"'`;

  for await (const chunk of command.stream()) {
    if (chunk.type === 'stdout') {
      console.log(`  [STDOUT]: ${chunk.data.toString().trim()}`);
    } else if (chunk.type === 'stderr') {
      console.log(`  [STDERR]: ${chunk.data.toString().trim()}`);
    } else if (chunk.type === 'exit') {
      console.log(`  [EXIT]: Code ${chunk.code}`);
    }
  }
} catch (error) {
  console.log('Error:', error.message);
}

console.log('\n' + '='.repeat(60) + '\n');

// Example 2: JSON streaming (like Claude's output)
console.log('Example 2: Streaming JSON output (similar to Claude CLI)');
console.log('Command: Simulating JSON stream output\n');

// Create a test script that outputs JSON lines
const testScript = `/tmp/json-stream-test-${Date.now()}.sh`;
const scriptContent = `#!/bin/sh
echo '{"type":"start","session_id":"test-123"}'
sleep 0.5
echo '{"type":"message","content":"Processing..."}'
sleep 0.5
echo '{"type":"complete","result":"success"}'
`;

await fs.writeFile(testScript, scriptContent);
await $`chmod +x ${testScript}`;

console.log('Streaming and parsing JSON:');
try {
  const command = $`${testScript}`;

  for await (const chunk of command.stream()) {
    if (chunk.type === 'stdout') {
      const lines = chunk.data
        .toString()
        .split('\n')
        .filter(line => line.trim());
      for (const line of lines) {
        try {
          const json = JSON.parse(line);
          console.log(`  [JSON]: ${JSON.stringify(json)}`);
        } catch (parseError) {
          console.log(`  [RAW]: ${line}`);
        }
      }
    } else if (chunk.type === 'exit') {
      console.log(`  [EXIT]: Code ${chunk.code}`);
    }
  }
} catch (error) {
  console.log('Error:', error.message);
}

await fs.unlink(testScript);

console.log('\n' + '='.repeat(60) + '\n');

// Example 3: Handling large output with file logging
console.log('Example 3: Streaming to file while displaying progress');

const logFile = `/tmp/stream-log-${Date.now()}.log`;
console.log(`Log file: ${logFile}\n`);

try {
  const command = $`sh -c 'for i in 1 2 3 4 5; do echo "Processing item $i"; sleep 0.5; done'`;

  let lineCount = 0;
  for await (const chunk of command.stream()) {
    if (chunk.type === 'stdout') {
      const data = chunk.data.toString();
      // Write to file
      await fs.appendFile(logFile, data);
      // Display progress
      const lines = data.split('\n').filter(line => line.trim());
      lineCount += lines.length;
      console.log(`  Progress: ${lineCount} lines processed`);
    } else if (chunk.type === 'exit') {
      console.log(`  Complete: Exit code ${chunk.code}`);
    }
  }

  console.log(`\nLog file contents:`);
  const logContents = await fs.readFile(logFile, 'utf8');
  console.log(logContents);

  await fs.unlink(logFile);
} catch (error) {
  console.log('Error:', error.message);
}

console.log('\n=== SUMMARY ===');
console.log('Key Points for Stream Handling:');
console.log('1. Always check chunk.type (stdout, stderr, exit)');
console.log('2. Convert chunk.data to string with .toString()');
console.log('3. Handle partial lines when parsing JSON');
console.log('4. Use file logging for long-running commands');
console.log('5. Exit chunk provides the final status code');
console.log('\nBest Practice Pattern:');
console.log(`for await (const chunk of command.stream()) {
  if (chunk.type === 'stdout') {
    // Process stdout data
    const text = chunk.data.toString();
  } else if (chunk.type === 'stderr') {
    // Process stderr data
    const error = chunk.data.toString();
  } else if (chunk.type === 'exit') {
    // Handle exit code
    console.log('Exit code:', chunk.code);
  }
}`);
