#!/usr/bin/env node

/**
 * Debug script to test command-stream iteration behavior
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
globalThis.use = use;

const { $ } = await use('command-stream');

console.log('Testing command-stream iteration...\n');

// Test 1: Simple echo command
console.log('Test 1: Simple echo');
const echoCommand = $({ shell: true, exitOnError: false })`echo "Hello World"`;

console.log('Using .stream() method:');
for await (const chunk of echoCommand.stream()) {
  console.log('Chunk:', chunk);
  if (chunk.type === 'exit') {
    console.log('Exit code:', chunk.code);
    break;
  }
  if (chunk.type === 'stdout' && chunk.data) {
    console.log('Stdout:', chunk.data.toString());
  }
}

console.log('\n---\n');

// Test 2: Command with JSON output
console.log('Test 2: JSON output');
const jsonCommand = $({ shell: true, exitOnError: false })`echo '{"test": "value"}' | jq -c .`;

console.log('Using .stream() method:');
for await (const chunk of jsonCommand.stream()) {
  console.log('Chunk type:', chunk.type);
  if (chunk.type === 'exit') {
    console.log('Exit code:', chunk.code);
    break;
  }
  if (chunk.type === 'stdout' && chunk.data) {
    console.log('Stdout:', chunk.data.toString());
  }
  if (chunk.type === 'stderr' && chunk.data) {
    console.log('Stderr:', chunk.data.toString());
  }
}

console.log('\n---\n');

// Test 3: Check if jq is available
console.log('Test 3: Check jq availability');
const jqVersion = await $`which jq && jq --version`;
console.log('jq check result:', jqVersion.stdout?.toString() || 'jq not found');

console.log('\n---\n');

// Test 4: Test with a longer-running command
console.log('Test 4: Multi-line output');
const multiLineCommand = $({ shell: true, exitOnError: false })`printf "Line 1\nLine 2\nLine 3"`;

console.log('Using .stream() method:');
let gotOutput = false;
for await (const chunk of multiLineCommand.stream()) {
  console.log('Chunk type:', chunk.type, 'Has data:', !!chunk.data);
  if (chunk.type === 'exit') {
    console.log('Exit code:', chunk.code);
    break;
  }
  if (chunk.type === 'stdout' && chunk.data) {
    gotOutput = true;
    console.log('Stdout:', JSON.stringify(chunk.data.toString()));
  }
}
console.log('Got output:', gotOutput);
