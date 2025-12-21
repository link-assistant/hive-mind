#!/usr/bin/env node

// Dynamic import of use-m from unpkg
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

console.log('=== Echo Pipe to jq Test ===\n');

try {
  // Test 1: Simple echo piping to jq
  console.log('1. Testing echo with JSON string piped to jq...');
  const result1 = await $`echo '{"message": "hi", "number": 42}' | jq .`;
  console.log('Result:');
  console.log(result1.stdout);

  // Test 2: Extract specific field
  console.log('\n2. Extracting message field with jq...');
  const result2 = await $`echo '{"message": "hi", "number": 42}' | jq -r .message`;
  console.log('Extracted message:', result2.stdout.trim());
} catch (error) {
  console.error('❌ Test failed:', error.message);
}
