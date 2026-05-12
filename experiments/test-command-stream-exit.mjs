#!/usr/bin/env node
// Test script to understand command-stream exit event behavior
// This is for issue #1165 investigation

if (typeof globalThis.use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}
const { $ } = await use('command-stream');

console.log('=== Test: Exit event with good command ===');
try {
  const execCommand = $`echo "hello world"`;
  let exitCode = null;
  let chunkTypes = [];

  for await (const chunk of execCommand.stream()) {
    chunkTypes.push(chunk.type);
    if (chunk.type === 'stdout') {
      console.log('stdout:', chunk.data.toString().trim());
    } else if (chunk.type === 'stderr') {
      console.log('stderr:', chunk.data.toString().trim());
    } else if (chunk.type === 'exit') {
      exitCode = chunk.code;
      console.log('Exit code:', chunk.code);
    } else {
      console.log('Other chunk type:', chunk.type, chunk);
    }
  }
  console.log('Final exit code:', exitCode);
  console.log('Chunk types received:', chunkTypes);
} catch (e) {
  console.log('Exception:', e.message);
}

console.log('\n=== Test: Exit event with failing command ===');
try {
  const execCommand = $`bash -c "exit 42"`;
  let exitCode = null;
  let chunkTypes = [];

  for await (const chunk of execCommand.stream()) {
    chunkTypes.push(chunk.type);
    if (chunk.type === 'stdout') {
      console.log('stdout:', chunk.data.toString().trim());
    } else if (chunk.type === 'stderr') {
      console.log('stderr:', chunk.data.toString().trim());
    } else if (chunk.type === 'exit') {
      exitCode = chunk.code;
      console.log('Exit code:', chunk.code);
    }
  }
  console.log('Final exit code:', exitCode);
  console.log('Chunk types received:', chunkTypes);
} catch (e) {
  console.log('Exception:', e.message);
}

console.log('\n=== Test: Exit event with command not found (immediate failure) ===');
try {
  const execCommand = $`nonexistent_cmd_xyz_123`;
  let exitCode = null;
  let chunkTypes = [];
  let stdoutContent = '';
  let stderrContent = '';

  for await (const chunk of execCommand.stream()) {
    chunkTypes.push(chunk.type);
    if (chunk.type === 'stdout') {
      stdoutContent += chunk.data.toString();
      console.log('stdout:', chunk.data.toString().trim());
    } else if (chunk.type === 'stderr') {
      stderrContent += chunk.data.toString();
      console.log('stderr:', chunk.data.toString().trim());
    } else if (chunk.type === 'exit') {
      exitCode = chunk.code;
      console.log('Exit code:', chunk.code);
    }
  }
  console.log('Final exit code:', exitCode);
  console.log('Chunk types received:', chunkTypes);
  console.log('Has stderr:', stderrContent.length > 0);
  console.log('Has stdout:', stdoutContent.length > 0);

  // Simulate the detection logic from claude.lib.mjs
  const messageCount = 0; // No JSON parsed
  const toolUseCount = 0; // No tool uses
  const stderrErrors = [];
  const trimmed = stderrContent.trim();
  // Current pattern - MISSES "not found"
  if (trimmed && (trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed'))) {
    stderrErrors.push(trimmed);
  }
  console.log('stderrErrors with current pattern:', stderrErrors.length);

  // Would the current detection trigger?
  const wouldDetectFailure = stderrErrors.length > 0 && messageCount === 0 && toolUseCount === 0;
  console.log('Would current detection trigger?', wouldDetectFailure);

  // With proposed "not found" pattern
  const stderrErrorsProposed = [];
  if (trimmed && (trimmed.includes('Error:') || trimmed.includes('error') || trimmed.includes('failed') || trimmed.includes('not found'))) {
    stderrErrorsProposed.push(trimmed);
  }
  console.log('stderrErrors with proposed pattern:', stderrErrorsProposed.length);
  const wouldDetectFailureProposed = stderrErrorsProposed.length > 0 && messageCount === 0 && toolUseCount === 0;
  console.log('Would proposed detection trigger?', wouldDetectFailureProposed);
} catch (e) {
  console.log('Exception:', e.message);
}

console.log('\n=== Test: Mirror mode with command not found ===');
try {
  // This is how claude.lib.mjs calls it - mirror: false
  const execCommand = $({ mirror: false })`nonexistent_cmd_xyz_456`;
  let exitCode = null;
  let chunkTypes = [];

  for await (const chunk of execCommand.stream()) {
    chunkTypes.push(chunk.type);
    if (chunk.type === 'exit') {
      exitCode = chunk.code;
      console.log('Exit code:', chunk.code);
    }
  }
  console.log('Final exit code:', exitCode);
  console.log('Chunk types received:', chunkTypes);
} catch (e) {
  console.log('Exception:', e.message);
}

console.log('\n=== Done ===');
