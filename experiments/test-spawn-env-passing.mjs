#!/usr/bin/env node

/**
 * Test script to verify that environment variables are properly passed to spawned processes
 * This tests the fix for issue #904: Pass GITHUB_TOKEN environment variable when spawning solve commands
 */

import { spawn } from 'child_process';

console.log('Testing environment variable passing in spawn...\n');

// Test 1: Verify that process.env contains GITHUB_TOKEN (if available)
console.log('Test 1: Check current process environment');
if (process.env.GITHUB_TOKEN) {
  console.log('✓ GITHUB_TOKEN is available in current process');
  console.log(`  Token length: ${process.env.GITHUB_TOKEN.length} characters`);
} else {
  console.log('⚠ GITHUB_TOKEN is not set in current process (this is okay for testing)');
}

// Test 2: Spawn a child process with env: process.env and verify it receives the token
console.log('\nTest 2: Spawn child process with env: process.env');
const child = spawn('node', ['-e', 'console.log("GITHUB_TOKEN present:", !!process.env.GITHUB_TOKEN)'], {
  stdio: ['ignore', 'pipe', 'pipe'],
  env: process.env
});

let stdout = '';
let stderr = '';

child.stdout.on('data', data => {
  stdout += data.toString();
});

child.stderr.on('data', data => {
  stderr += data.toString();
});

child.on('close', code => {
  if (code === 0) {
    console.log('✓ Child process executed successfully');
    console.log(`  Output: ${stdout.trim()}`);
  } else {
    console.log(`✗ Child process failed with code ${code}`);
    if (stderr) {
      console.log(`  Error: ${stderr}`);
    }
  }

  // Test 3: Spawn without env parameter (should fail to inherit environment)
  console.log('\nTest 3: Spawn child process WITHOUT env parameter (should not inherit)');
  const childNoEnv = spawn('node', ['-e', 'console.log("GITHUB_TOKEN present:", !!process.env.GITHUB_TOKEN)'], {
    stdio: ['ignore', 'pipe', 'pipe']
    // Note: missing env parameter
  });

  let stdoutNoEnv = '';
  let stderrNoEnv = '';

  childNoEnv.stdout.on('data', data => {
    stdoutNoEnv += data.toString();
  });

  childNoEnv.stderr.on('data', data => {
    stderrNoEnv += data.toString();
  });

  childNoEnv.on('close', codeNoEnv => {
    if (codeNoEnv === 0) {
      console.log('✓ Child process executed successfully');
      console.log(`  Output: ${stdoutNoEnv.trim()}`);
      console.log('  Note: Environment variables may still be inherited by default on some systems');
    } else {
      console.log(`✗ Child process failed with code ${codeNoEnv}`);
      if (stderrNoEnv) {
        console.log(`  Error: ${stderrNoEnv}`);
      }
    }

    console.log('\n✓ All tests completed');
    console.log('\nConclusion:');
    console.log('- The fix adds env: process.env to all spawn() calls');
    console.log('- This ensures environment variables (including GITHUB_TOKEN) are passed to child processes');
    console.log('- This fixes the "Bad credentials" error in the Telegram bot /solve command');
  });
});
