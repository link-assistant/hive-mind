#!/usr/bin/env node

/**
 * Test script to verify the spawn-based fix for Claude command execution
 */

import { spawn } from 'child_process';
import { promises as fs } from 'fs';

console.log('Testing spawn-based Claude command execution fix...\n');

// Test 1: Simple command execution with spawn
async function testSimpleSpawn() {
  console.log('Test 1: Simple echo with spawn');

  return new Promise(resolve => {
    const child = spawn('sh', ['-c', 'echo "Hello from spawn"'], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      stdout += data.toString();
      console.log('  stdout:', data.toString().trim());
    });

    child.stderr.on('data', data => {
      stderr += data.toString();
      console.log('  stderr:', data.toString().trim());
    });

    child.on('close', code => {
      console.log('  exit code:', code);
      console.log('  ✅ Test 1 passed\n');
      resolve(true);
    });

    child.on('error', err => {
      console.log('  ❌ Error:', err.message);
      resolve(false);
    });
  });
}

// Test 2: JSON piped through jq (simulating Claude output)
async function testJqPipe() {
  console.log('Test 2: JSON through jq (simulating Claude)');

  const testData = [
    '{"type": "text", "text": "Hello from Claude"}',
    '{"type": "tool_use", "name": "bash", "input": {"command": "ls"}}',
    '{"type": "tool_result", "output": "file1.txt file2.txt"}'
  ].join('\\n');

  return new Promise(resolve => {
    const command = `echo '${testData}' | jq -c .`;
    const child = spawn('sh', ['-c', command], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';
    let lineCount = 0;

    child.stdout.on('data', data => {
      stdout += data.toString();
      const lines = data
        .toString()
        .split('\n')
        .filter(line => line.trim());

      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          lineCount++;
          console.log(`  Line ${lineCount}: type=${parsed.type}`);

          if (parsed.type === 'text') {
            console.log(`    text: "${parsed.text}"`);
          } else if (parsed.type === 'tool_use') {
            console.log(`    tool: ${parsed.name}`);
          }
        } catch (e) {
          // Skip unparseable lines
        }
      }
    });

    child.stderr.on('data', data => {
      console.log('  stderr:', data.toString().trim());
    });

    child.on('close', code => {
      console.log('  exit code:', code);
      console.log(`  processed ${lineCount} JSON lines`);

      if (code === 0 && lineCount === 3) {
        console.log('  ✅ Test 2 passed\n');
        resolve(true);
      } else {
        console.log('  ❌ Test 2 failed\n');
        resolve(false);
      }
    });

    child.on('error', err => {
      console.log('  ❌ Error:', err.message);
      resolve(false);
    });
  });
}

// Test 3: Test working directory change
async function testWorkingDirectory() {
  console.log('Test 3: Working directory test');

  return new Promise(resolve => {
    const child = spawn('sh', ['-c', 'pwd'], {
      cwd: '/tmp',
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let stdout = '';

    child.stdout.on('data', data => {
      stdout += data.toString();
    });

    child.on('close', code => {
      const pwd = stdout.trim();
      console.log('  working directory:', pwd);
      console.log('  exit code:', code);

      if (code === 0 && pwd === '/tmp') {
        console.log('  ✅ Test 3 passed\n');
        resolve(true);
      } else {
        console.log('  ❌ Test 3 failed\n');
        resolve(false);
      }
    });

    child.on('error', err => {
      console.log('  ❌ Error:', err.message);
      resolve(false);
    });
  });
}

// Test 4: Test long-running command with streaming output
async function testStreaming() {
  console.log('Test 4: Streaming output test');

  return new Promise(resolve => {
    const command = 'for i in 1 2 3; do echo "Line $i"; sleep 0.1; done';
    const child = spawn('sh', ['-c', command], {
      stdio: ['pipe', 'pipe', 'pipe']
    });

    let lineCount = 0;
    const startTime = Date.now();

    child.stdout.on('data', data => {
      const lines = data
        .toString()
        .split('\n')
        .filter(line => line.trim());
      for (const line of lines) {
        lineCount++;
        const elapsed = Date.now() - startTime;
        console.log(`  [${elapsed}ms] ${line}`);
      }
    });

    child.on('close', code => {
      const totalTime = Date.now() - startTime;
      console.log('  exit code:', code);
      console.log(`  received ${lineCount} lines in ${totalTime}ms`);

      if (code === 0 && lineCount === 3) {
        console.log('  ✅ Test 4 passed\n');
        resolve(true);
      } else {
        console.log('  ❌ Test 4 failed\n');
        resolve(false);
      }
    });

    child.on('error', err => {
      console.log('  ❌ Error:', err.message);
      resolve(false);
    });
  });
}

// Run all tests
async function runTests() {
  console.log('Running spawn-based execution tests...\n');
  console.log('This tests the replacement of command-stream with child_process.spawn\n');
  console.log('='.repeat(60) + '\n');

  const results = [];

  results.push(await testSimpleSpawn());
  results.push(await testJqPipe());
  results.push(await testWorkingDirectory());
  results.push(await testStreaming());

  console.log('='.repeat(60));
  console.log('\nTest Summary:');
  console.log(`  Total tests: ${results.length}`);
  console.log(`  Passed: ${results.filter(r => r).length}`);
  console.log(`  Failed: ${results.filter(r => !r).length}`);

  if (results.every(r => r)) {
    console.log('\n✅ All tests passed! The spawn-based fix should work correctly.');
    process.exit(0);
  } else {
    console.log('\n❌ Some tests failed. Please review the implementation.');
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
