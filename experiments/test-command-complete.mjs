#!/usr/bin/env node

/**
 * Test the actual pattern used in solve.claude-execution.lib.mjs
 */

const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
globalThis.use = use;

const { $ } = await use('command-stream');

console.log('Testing actual solve.mjs pattern...\n');

// Simulate the actual command pattern
const testDir = '/tmp';
const claudePath = 'echo'; // Using echo as placeholder
const claudeArgs = '"Test output" | jq -c .';

console.log('Executing command like solve.mjs does:');
const claudeCommand = $({
  cwd: testDir,
  shell: true,
  exitOnError: false
})`${claudePath} ${claudeArgs}`;

let commandFailed = false;
let outputReceived = false;

console.log('Starting iteration...');
for await (const chunk of claudeCommand.stream()) {
  console.log('Chunk received:', {
    type: chunk.type,
    hasData: !!chunk.data,
    isExit: chunk.type === 'exit',
    done: chunk.done,
    code: chunk.code
  });

  // This is what the current code checks (WRONG!)
  if (chunk.type === 'exit') {
    console.log('EXIT EVENT (current code expects this)');
    if (chunk.code !== 0) {
      commandFailed = true;
    }
    break;
  }

  // Process output
  if (chunk.type === 'stdout' && chunk.data) {
    outputReceived = true;
    console.log('Output:', chunk.data.toString());
  }
}

console.log('\n=== Results ===');
console.log('Command failed:', commandFailed);
console.log('Output received:', outputReceived);
console.log('Loop completed naturally (no exit event)');

console.log('\n=== Testing proper pattern ===');

// Now test the proper way
const result = await $({
  cwd: testDir,
  shell: true,
  exitOnError: false
})`${claudePath} ${claudeArgs}`;

console.log('Direct await result:');
console.log('Exit code:', result.code);
console.log('Stdout:', result.stdout?.toString());
console.log('Command completed properly');
