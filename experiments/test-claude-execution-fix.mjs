#!/usr/bin/env node

// Test the fix for solve.claude-execution.lib.mjs
const { use } = eval(await (await fetch('https://unpkg.com/use-m/use.js')).text());
const { $ } = await use('command-stream');

console.log('Testing the claude-execution fix...\n');

// Simulate the executeClaudeCommand pattern
async function testClaudeCommandPattern() {
  const tempDir = '/tmp';

  // Simulate a command similar to what Claude would run
  const testCommand = 'echo \'{"type": "text", "text": "Hello"}\n{"type": "tool_use", "name": "bash"}\n{"type": "exit", "code": 0}\' | jq -c .';

  console.log('Running command with fixed pattern:');
  console.log(`  cwd: ${tempDir}`);
  console.log(`  command: ${testCommand}\n`);

  try {
    // This is the fixed pattern
    const command = $({
      cwd: tempDir,
      shell: true,
      exitOnError: false,
    })`${testCommand}`;

    let messageCount = 0;
    let toolUseCount = 0;
    let exitCode = null;

    for await (const chunk of command.stream()) {
      if (chunk.type === 'exit') {
        exitCode = chunk.code;
        console.log(`Exit code: ${exitCode}`);
        break;
      }

      const output = chunk.type === 'stdout' ? chunk.data.toString() : '';
      const errorOutput = chunk.type === 'stderr' ? chunk.data.toString() : '';

      if (errorOutput) {
        console.log(`STDERR: ${errorOutput}`);
      }

      if (output) {
        const lines = output.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const data = JSON.parse(line);

            if (data.type === 'text') {
              console.log(`Text: ${data.text}`);
            } else if (data.type === 'tool_use') {
              toolUseCount++;
              console.log(`Tool use: ${data.name}`);
            }

            messageCount++;
          } catch (parseError) {
            if (line.trim()) {
              console.log(`Raw output: ${line}`);
            }
          }
        }
      }
    }

    console.log(`\n✅ Test passed!`);
    console.log(`   Messages: ${messageCount}`);
    console.log(`   Tool uses: ${toolUseCount}`);
    console.log(`   Exit code: ${exitCode}`);
    return true;
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    console.error(`   Stack: ${error.stack}`);
    return false;
  }
}

// Run the test
const success = await testClaudeCommandPattern();
process.exit(success ? 0 : 1);
