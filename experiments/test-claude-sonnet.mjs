#!/usr/bin/env node

// Test Claude CLI with sonnet model
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');

console.log('Testing Claude CLI connection with new sonnet model...');

try {
  console.log('Testing: printf hi | claude --model sonnet -p');
  const result = await $`printf hi | claude --model sonnet -p`;
  console.log('Exit code:', result.code);
  console.log('Stdout:', result.stdout?.toString());
  if (result.stderr?.toString()) {
    console.log('Stderr:', result.stderr.toString());
  }

  if (result.code === 0) {
    console.log('✅ Claude CLI connection test passed');
  } else {
    console.log('❌ Test failed with exit code:', result.code);
  }
} catch (error) {
  console.log('❌ Test failed:', error.message);
  console.log('Error code:', error.code);
}
