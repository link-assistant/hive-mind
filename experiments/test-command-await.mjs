#!/usr/bin/env node

/**
 * Debug script to test command-stream await behavior
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
globalThis.use = use;

const { $ } = await use('command-stream');

console.log('Testing command-stream await behavior...\n');

// Test: Using await directly on command
console.log('Test: Direct await on command');
try {
  const result = await $({ shell: true, exitOnError: false })`echo '{"test": "value"}' | jq -c .`;
  console.log('Result:', result);
  console.log('Exit code:', result.code);
  console.log('Stdout:', result.stdout?.toString());
  console.log('Stderr:', result.stderr?.toString());
} catch (error) {
  console.log('Error:', error.message);
}

console.log('\n---\n');

// Test: Stream with proper iteration
console.log('Test: Stream iteration with done check');
const streamCommand = $({ shell: true, exitOnError: false })`echo "Line 1" && echo "Line 2"`;
let outputLines = [];

for await (const chunk of streamCommand.stream()) {
  console.log('Chunk received:', { type: chunk.type, done: chunk.done, code: chunk.code });

  if (chunk.done) {
    console.log('Command completed with code:', chunk.code);
    break;
  }

  if (chunk.type === 'stdout' && chunk.data) {
    outputLines.push(chunk.data.toString());
  }
}

console.log('Collected output:', outputLines);

console.log('\n---\n');

// Test: Check chunk structure
console.log('Test: Analyze chunk structure');
const testCommand = $({ shell: true, exitOnError: false })`echo "test"`;
for await (const chunk of testCommand.stream()) {
  console.log('Chunk keys:', Object.keys(chunk));
  console.log(
    'Full chunk:',
    JSON.stringify(chunk, (key, value) => (value instanceof Buffer ? `Buffer(${value.toString()})` : value))
  );
}
