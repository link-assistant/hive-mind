#!/usr/bin/env node

// Test command-stream with cwd option and streaming
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');

console.log('Testing command-stream with cwd option and streaming...\n');

// Test 1: Simple command with cwd
console.log('Test 1: Simple command with cwd');
try {
  const result = await $({ cwd: '/tmp' })`pwd`;
  console.log('Result:', result.stdout.toString().trim());
  console.log('✅ Test 1 passed\n');
} catch (error) {
  console.error('❌ Test 1 failed:', error.message, '\n');
}

// Test 2: Command with streaming and cwd
console.log('Test 2: Command with streaming and cwd');
try {
  // Create command with options
  const cmd = $({ cwd: '/tmp' })`ls -la | head -5`;

  console.log('Streaming output:');
  for await (const chunk of cmd.stream()) {
    if (chunk.type === 'stdout') {
      process.stdout.write(chunk.data.toString());
    }
  }
  console.log('✅ Test 2 passed\n');
} catch (error) {
  console.error('❌ Test 2 failed:', error.message, '\n');
}

// Test 3: Complex command with pipes and cwd
console.log('Test 3: Complex command with pipes and cwd');
try {
  const tempDir = '/tmp';
  const command = 'echo "line1\nline2\nline3" | jq -c .';

  // Try the problematic syntax
  console.log('Testing problematic syntax: $({ cwd: tempDir })`command`');
  try {
    const cmd = $({ cwd: tempDir })`${command}`;
    const result = await cmd;
    console.log('Result:', result.stdout?.toString() || 'No output');
  } catch (e) {
    console.error('Failed with error:', e.message);
  }

  // Try alternative syntax
  console.log('\nTesting alternative: create command then stream');
  const cmd = $({ cwd: tempDir })`echo "test" | cat`;
  for await (const chunk of cmd.stream()) {
    if (chunk.type === 'stdout') {
      console.log('Output:', chunk.data.toString().trim());
    }
  }
  console.log('✅ Test 3 passed\n');
} catch (error) {
  console.error('❌ Test 3 failed:', error.message, '\n');
}
