#!/usr/bin/env node

/**
 * Simple test to verify the fix works
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
globalThis.use = use;

const { $ } = await use('command-stream');

// Create mock JSON output
const mockOutput = '{"type":"text","text":"Hello"}\n{"type":"message","role":"assistant"}';

console.log('Testing command-stream with proper completion handling...\n');

// Test the pattern
const command = $({
  shell: true,
  exitOnError: false
})`echo '${mockOutput}'`;

let outputReceived = false;
let messageCount = 0;

console.log('Streaming output...');
for await (const chunk of command.stream()) {
  if (chunk.type === 'stdout' && chunk.data) {
    outputReceived = true;
    const output = chunk.data.toString();
    const lines = output.split('\n').filter(line => line.trim());

    for (const line of lines) {
      try {
        const data = JSON.parse(line);
        console.log('Parsed JSON:', data);
        if (data.type === 'message') {
          messageCount++;
        }
      } catch (e) {
        console.log('Raw line:', line);
      }
    }
  }
}

// Get the result after stream ends (THE FIX!)
const result = await command;

console.log('\n=== Results ===');
console.log('Exit code:', result.code);
console.log('Output received:', outputReceived);
console.log('Messages:', messageCount);

if (result.code === 0 && outputReceived) {
  console.log('\n✅ Fix works! Command completed successfully.');
} else {
  console.log('\n❌ Fix failed');
}
