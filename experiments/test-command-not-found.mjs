#!/usr/bin/env node
// Test script to understand how command-stream handles "command not found" errors
// This is for issue #1165 investigation

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const { $ } = await use('command-stream');

console.log('=== Test 1: Non-existent command ===');
try {
  const result = await $`nonexistent_command_xyz`;
  console.log('Result:', {
    code: result.code,
    exitCode: result.exitCode,
    stdout: result.stdout?.toString(),
    stderr: result.stderr?.toString(),
  });
} catch (e) {
  console.log('Exception:', e.message);
  console.log('Error code:', e.code);
}

console.log('\n=== Test 2: Streaming non-existent command ===');
try {
  const execCommand = $`nonexistent_command_xyz`;
  let exitCode = null;
  let stderrContent = '';
  let stdoutContent = '';

  for await (const chunk of execCommand.stream()) {
    console.log('Chunk type:', chunk.type);
    if (chunk.type === 'stdout') {
      stdoutContent += chunk.data.toString();
      console.log('stdout:', chunk.data.toString());
    } else if (chunk.type === 'stderr') {
      stderrContent += chunk.data.toString();
      console.log('stderr:', chunk.data.toString());
    } else if (chunk.type === 'exit') {
      exitCode = chunk.code;
      console.log('Exit code:', chunk.code);
    }
  }
  console.log('Final exit code:', exitCode);
  console.log('Total stderr:', stderrContent);
  console.log('Total stdout:', stdoutContent);
} catch (e) {
  console.log('Exception:', e.message);
  console.log('Error code:', e.code);
}

console.log('\n=== Test 3: Command with error output ===');
try {
  const execCommand = $`ls /nonexistent_directory_xyz`;
  let exitCode = null;
  let stderrContent = '';

  for await (const chunk of execCommand.stream()) {
    console.log('Chunk type:', chunk.type);
    if (chunk.type === 'stdout') {
      console.log('stdout:', chunk.data.toString());
    } else if (chunk.type === 'stderr') {
      stderrContent += chunk.data.toString();
      console.log('stderr:', chunk.data.toString());
    } else if (chunk.type === 'exit') {
      exitCode = chunk.code;
      console.log('Exit code:', chunk.code);
    }
  }
  console.log('Final exit code:', exitCode);
  console.log('Total stderr:', stderrContent);
} catch (e) {
  console.log('Exception:', e.message);
  console.log('Error code:', e.code);
}

console.log('\n=== Test 4: Command not found detection pattern ===');
const errorPatterns = ['/bin/sh: 1: claude: not found', 'command not found: claude', 'claude: not found', 'bash: claude: command not found', '/usr/bin/sh: claude: not found'];

// Current detection pattern
const currentPattern = str => {
  const trimmed = str.trim();
  return trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed');
};

// Proposed pattern with "not found" detection
const proposedPattern = str => {
  const trimmed = str.trim();
  return trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed') || trimmed.includes('not found') || trimmed.includes('command not found');
};

console.log('Testing error detection patterns:');
for (const errMsg of errorPatterns) {
  console.log(`  "${errMsg}"`);
  console.log(`    Current pattern detects: ${currentPattern(errMsg)}`);
  console.log(`    Proposed pattern detects: ${proposedPattern(errMsg)}`);
}

console.log('\n=== Done ===');
