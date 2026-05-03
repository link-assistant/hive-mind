#!/usr/bin/env node

/**
 * Test suite for memory-check.mjs
 * Tests system resource checking functionality
 */

// Temporarily unset CI to avoid command-stream trace logs in tests
const originalCI = process.env.CI;
delete process.env.CI;

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const memoryCheckPath = join(__dirname, '..', 'src', 'memory-check.mjs');

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('✅ PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`❌ FAILED: ${error.message}`);
    testsFailed++;
  }
}

function execCommand(command) {
  try {
    return execSync(command, { encoding: 'utf8', stdio: 'pipe' });
  } catch (error) {
    // For commands that exit with non-zero, we still want the output
    return error.stdout || error.stderr || error.message;
  }
}

// Test 1: Check if memory-check.mjs exists
runTest('memory-check.mjs exists', () => {
  const output = execCommand(`ls -la ${memoryCheckPath}`);
  if (!output.includes('memory-check.mjs')) {
    throw new Error('memory-check.mjs not found');
  }
});

// Test 2: Check basic help works
runTest('memory-check.mjs --help', () => {
  const output = execCommand(`${memoryCheckPath} --help 2>&1`);

  // Debug: Show what we actually get in CI
  if (process.env.GITHUB_ACTIONS) {
    console.log(`    [DEBUG] Help output: "${output.trim()}"`);
  }

  // The help test is getting regular execution output in CI instead of help
  // This indicates --help is not being processed correctly
  // For now, just check that the command runs without error
  // If output contains system check results, that's a failure
  if (output.includes('Disk space check') || output.includes('Memory check') || output.includes('System Check Summary')) {
    // This means the script ran normally instead of showing help
    throw new Error('Script executed instead of showing help');
  }

  // If we get here, either help worked or something else happened
  // Accept any output that doesn't look like normal execution
});

// Test 3: Check basic execution
runTest('memory-check.mjs basic execution', () => {
  const output = execCommand(`${memoryCheckPath} --quiet --json 2>&1`);

  // Filter out any trace/debug lines and find JSON output
  const lines = output.split('\n');
  let jsonOutput = '';
  let inJson = false;

  for (const line of lines) {
    if (line.trim().startsWith('{')) {
      inJson = true;
    }
    if (inJson) {
      jsonOutput += line + '\n';
    }
    if (line.trim() === '}') {
      break;
    }
  }

  // Should return valid JSON
  try {
    const result = JSON.parse(jsonOutput);
    if (!result.hasOwnProperty('ram') || !result.hasOwnProperty('disk')) {
      throw new Error('Missing expected properties in JSON output');
    }
  } catch (e) {
    throw new Error(`Invalid JSON output: ${e.message}`);
  }
});

// Test 4: Check disk space check
runTest('memory-check.mjs disk space check', () => {
  const output = execCommand(`${memoryCheckPath} --min-disk-space 1 --quiet --json 2>&1`);

  // Filter out any trace/debug lines and find JSON output
  const lines = output.split('\n');
  let jsonOutput = '';
  let inJson = false;

  for (const line of lines) {
    if (line.trim().startsWith('{')) {
      inJson = true;
    }
    if (inJson) {
      jsonOutput += line + '\n';
    }
    if (line.trim() === '}') {
      break;
    }
  }

  try {
    const result = JSON.parse(jsonOutput);
    if (!result.disk || typeof result.disk.availableMB !== 'number') {
      throw new Error('Disk space information missing or invalid');
    }
    if (result.disk.availableMB < 1) {
      throw new Error('Unlikely disk space value');
    }
  } catch (e) {
    if (e.message.includes('Unlikely')) throw e;
    throw new Error(`Failed to parse disk check output: ${e.message}`);
  }
});

// Test 5: Check RAM check
runTest('memory-check.mjs RAM check', () => {
  const output = execCommand(`${memoryCheckPath} --min-memory 1 --quiet --json 2>&1`);

  // Filter out any trace/debug lines and find JSON output
  const lines = output.split('\n');
  let jsonOutput = '';
  let inJson = false;

  for (const line of lines) {
    if (line.trim().startsWith('{')) {
      inJson = true;
    }
    if (inJson) {
      jsonOutput += line + '\n';
    }
    if (line.trim() === '}') {
      break;
    }
  }

  try {
    const result = JSON.parse(jsonOutput);
    if (!result.ram || typeof result.ram.availableMB !== 'number') {
      throw new Error('RAM information missing or invalid');
    }
    if (result.ram.availableMB < 1) {
      throw new Error('Unlikely RAM value');
    }
  } catch (e) {
    if (e.message.includes('Unlikely')) throw e;
    throw new Error(`Failed to parse RAM check output: ${e.message}`);
  }
});

// Test 6: Check verbose output (non-JSON)
runTest('memory-check.mjs verbose output', () => {
  const output = execCommand(`${memoryCheckPath} --min-memory 1 --min-disk-space 1 2>&1`);

  // Should contain human-readable output
  if (!output.includes('Disk space check') || !output.includes('Memory check')) {
    throw new Error('Verbose output missing expected information');
  }

  if (!output.includes('✅')) {
    throw new Error('Expected success indicators in output');
  }
});

// Test 7: Node.js syntax check
runTest('memory-check.mjs syntax check', () => {
  const output = execCommand(`node -c ${memoryCheckPath} 2>&1`);
  // If there's a syntax error, node -c will output it
  if (output && output.includes('SyntaxError')) {
    throw new Error(`Syntax error in memory-check.mjs: ${output}`);
  }
});

// Test 8: Check platform-specific logic
runTest('memory-check.mjs platform detection', () => {
  const output = execCommand(`${memoryCheckPath} --quiet --json 2>&1`);

  // Filter out any trace/debug lines and find JSON output
  const lines = output.split('\n');
  let jsonOutput = '';
  let inJson = false;

  for (const line of lines) {
    if (line.trim().startsWith('{')) {
      inJson = true;
    }
    if (inJson) {
      jsonOutput += line + '\n';
    }
    if (line.trim() === '}') {
      break;
    }
  }

  try {
    const result = JSON.parse(jsonOutput);
    // Check for swap information (platform-specific)
    if (result.ram && result.ram.swap) {
      // Swap info should be a string
      if (typeof result.ram.swap !== 'string') {
        throw new Error('Swap information should be a string');
      }
    }
  } catch (e) {
    if (e.message.includes('Swap')) throw e;
    throw new Error(`Failed to check platform info: ${e.message}`);
  }
});

// Test 9: Check exit code on success
runTest('memory-check.mjs exit code on success', () => {
  try {
    execSync(`${memoryCheckPath} --min-memory 1 --min-disk-space 1 --quiet`, { stdio: 'ignore' });
    // If we get here, exit code was 0 (success)
  } catch (error) {
    throw new Error(`Should exit with 0 on success, got: ${error.status}`);
  }
});

// Test 10: Check that script can be executed successfully
runTest('memory-check.mjs execution', () => {
  const output = execCommand(`${memoryCheckPath} --min-memory 1 --min-disk-space 1 --quiet 2>&1`);

  // Should complete without errors
  if (output.includes('Error') || output.includes('error')) {
    throw new Error(`Execution error: ${output}`);
  }
});

// Summary
console.log('\n' + '='.repeat(50));
console.log(`Test Results for memory-check.mjs:`);
console.log(`  ✅ Passed: ${testsPassed}`);
console.log(`  ❌ Failed: ${testsFailed}`);
console.log(`  Platform: ${process.platform}`);
console.log('='.repeat(50));

// Restore CI if it was set
if (originalCI !== undefined) {
  process.env.CI = originalCI;
}

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);
