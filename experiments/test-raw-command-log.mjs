#!/usr/bin/env node

// Test script to verify the raw command is logged properly
// This script simulates calling solve.mjs with various arguments

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

const solvePath = path.join(process.cwd(), 'src', 'solve.mjs');

async function testRawCommandLogging() {
  console.log('Testing raw command logging feature...\n');

  // Test with --help to see if raw command is logged
  console.log('1. Testing with --help flag:');
  const helpProcess = spawn('node', [solvePath, '--help'], {
    stdio: 'pipe'
  });

  let output = '';
  helpProcess.stdout.on('data', data => {
    output += data.toString();
  });

  helpProcess.stderr.on('data', data => {
    output += data.toString();
  });

  await new Promise(resolve => {
    helpProcess.on('close', resolve);
  });

  // Check if help text is shown (should exit early without logging)
  if (output.includes('Usage:')) {
    console.log('✅ Help text displayed correctly (early exit, no logging)\n');
  }

  // Test with a mock GitHub URL to see raw command logging
  console.log('2. Testing with mock GitHub URL:');
  const testUrl = 'https://github.com/test/repo/issues/999';
  const testProcess = spawn('node', [solvePath, testUrl, '--dry-run', '--skip-tool-check'], {
    stdio: 'pipe'
  });

  let testOutput = '';
  testProcess.stdout.on('data', data => {
    const text = data.toString();
    testOutput += text;
    // Look for the raw command in the output
    if (text.includes('Raw command executed:')) {
      console.log('Found in output:', text.trim());
    }
  });

  testProcess.stderr.on('data', data => {
    testOutput += data.toString();
  });

  await new Promise(resolve => {
    testProcess.on('close', resolve);
  });

  // Check if raw command was logged
  if (testOutput.includes('Raw command executed:')) {
    console.log('✅ Raw command logging found in console output\n');

    // Extract the command from output
    const lines = testOutput.split('\n');
    const cmdIndex = lines.findIndex(line => line.includes('Raw command executed:'));
    if (cmdIndex !== -1 && cmdIndex + 1 < lines.length) {
      const rawCmd = lines[cmdIndex + 1].trim();
      console.log('Logged command:', rawCmd);

      // Verify it contains expected parts
      if (rawCmd.includes('node') && rawCmd.includes('solve.mjs') && rawCmd.includes(testUrl)) {
        console.log('✅ Command contains all expected components\n');
      }
    }
  } else {
    console.log('❌ Raw command logging NOT found in output\n');
  }

  // Clean up any log files created during test
  const logFiles = await fs.readdir(process.cwd());
  for (const file of logFiles) {
    if (file.startsWith('solve-') && file.endsWith('.log')) {
      await fs.unlink(path.join(process.cwd(), file));
      console.log(`Cleaned up test log file: ${file}`);
    }
  }
}

// Run the test
testRawCommandLogging().catch(console.error);
