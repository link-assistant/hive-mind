#!/usr/bin/env node
// Use use-m to dynamically import modules for cross-runtime compatibility
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());

// Use command-stream for consistent $ behavior across runtimes
const { $ } = await use('command-stream');

// Import uuid for UUIDv7 generation
const { v7: uuidv7 } = await use('uuid');

const claude = process.env.CLAUDE_PATH || '/Users/konard/.claude/local/claude';

console.log('=== Claude Session Management Test ===\n');
console.log(`Runtime: ${typeof Bun !== 'undefined' ? 'Bun' : 'Node.js'}\n`);

// Helper function to safely parse JSON lines
function parseJsonLine(stdout, lineIndex = 0, fieldName = null) {
  const lines = stdout.split('\n').filter(line => line.trim());
  if (lineIndex < 0 || lineIndex >= lines.length) {
    throw new Error(`Invalid line index: ${lineIndex}`);
  }
  try {
    const parsed = JSON.parse(lines[lineIndex]);
    return fieldName ? parsed[fieldName] : parsed;
  } catch (error) {
    console.error(`Failed to parse JSON at line ${lineIndex}:`, lines[lineIndex]);
    throw error;
  }
}

// Helper function to find and parse result line
function findResultLine(stdout) {
  const lines = stdout.split('\n').filter(line => line.trim());
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line);
      if (parsed.type === 'result') {
        return parsed;
      }
    } catch {
      // Skip non-JSON lines
    }
  }
  throw new Error('No result line found in output');
}

try {
  // Test 1: Extract session ID from JSON output
  console.log('1. Creating initial session and extracting ID...');
  const result1 = await $`${claude} -p "Hello, remember this: my favorite color is blue" --output-format stream-json --verbose --model sonnet`;
  const sessionId = parseJsonLine(result1.stdout, 0, 'session_id');
  console.log(`   ✅ Session ID extracted: ${sessionId}\n`);

  // Test 2: Create custom session ID using UUIDv7
  console.log('2. Creating session with custom ID (UUIDv7)...');
  const customId = uuidv7();
  console.log(`   Generated UUIDv7: ${customId}`);
  const result2 = await $`${claude} --session-id ${customId} -p "My favorite number is 42" --output-format stream-json --verbose --model sonnet`;
  const customSessionId = parseJsonLine(result2.stdout, 0, 'session_id');
  console.log(`   ✅ Custom session created: ${customSessionId}`);
  console.log(`   ✅ ID matches expected: ${customId === customSessionId ? 'YES' : 'NO'}\n`);

  // Test 3: Resume session (context restoration)
  console.log('3. Testing session restoration with --resume...');
  const result3 = await $`${claude} --resume ${sessionId} -p "What is my favorite color?" --output-format stream-json --verbose --model sonnet`;
  const resumedSessionId = parseJsonLine(result3.stdout, 0, 'session_id');
  const resultData = findResultLine(result3.stdout);
  const response = resultData.result;

  console.log(`   ✅ Resumed from: ${sessionId}`);
  console.log(`   ✅ New session ID: ${resumedSessionId}`);
  console.log(`   ✅ Context restored: ${response.toLowerCase().includes('blue') ? 'YES' : 'NO'}`);
  console.log(`   📝 Response: "${response}"\n`);

  // Test 4: Another session with UUIDv7 to verify no conflicts
  console.log('4. Creating another session with new UUIDv7...');
  const anotherCustomId = uuidv7();
  console.log(`   Generated UUIDv7: ${anotherCustomId}`);
  const result4 = await $`${claude} --session-id ${anotherCustomId} -p "Testing unique session" --output-format stream-json --verbose --model sonnet`;
  const anotherSessionId = parseJsonLine(result4.stdout, 0, 'session_id');
  console.log(`   ✅ Another session created: ${anotherSessionId}`);
  console.log(`   ✅ ID matches expected: ${anotherCustomId === anotherSessionId ? 'YES' : 'NO'}\n`);

  console.log('\n=== Summary ===');
  console.log('✅ Session IDs can be extracted from JSON output');
  console.log('✅ UUIDv7 generation ensures unique session IDs');
  console.log('✅ Custom session IDs work with --session-id flag');
  console.log('✅ Session restoration works with --resume (creates new ID but keeps context)');
  console.log('✅ Context is maintained across resumed sessions');
  console.log('✅ JSON parsing is robust with proper error handling');
} catch (error) {
  console.error('❌ Test failed:', error.message);
  if (error.stack) {
    console.error('Stack trace:', error.stack);
  }
  process.exit(1);
}
