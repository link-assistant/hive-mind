#!/usr/bin/env node
// Test script for /top command implementation
// This script tests the screen session creation and capture logic

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, unlink } from 'fs/promises';

const execAsync = promisify(exec);

async function testScreenSession() {
  console.log('Testing screen session creation and capture...\n');

  const screenName = `test-top-${Date.now()}`;
  const outputFile = `/tmp/test-top-output-${Date.now()}.txt`;
  console.log(`1. Creating screen session: ${screenName}`);

  try {
    // Create a screen session with top outputting to a file
    await execAsync(`screen -dmS ${screenName} bash -c 'while true; do top -b -n 1 > ${outputFile}; sleep 2; done'`);
    console.log('   ✅ Screen session created');

    // Wait for top to start and produce output
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Test capture
    console.log('\n2. Testing output capture from file...');

    // Read the output file
    const output = await readFile(outputFile, 'utf-8');
    console.log('   ✅ Output file read successfully');

    console.log('\n3. Captured output (first 20 lines):');
    const lines = output.split('\n').slice(0, 20);
    lines.forEach((line, i) => {
      console.log(`   ${i + 1}: ${line}`);
    });

    // Test if output looks like top output
    if (output.includes('top -') || output.includes('Tasks:') || output.includes('CPU') || output.includes('%Cpu')) {
      console.log('\n   ✅ Output looks like top output');
    } else {
      console.log('\n   ⚠️  Output might not be top output');
    }

    // Test update by waiting and reading again
    console.log('\n4. Testing output updates...');
    await new Promise(resolve => setTimeout(resolve, 2500));
    const output2 = await readFile(outputFile, 'utf-8');
    if (output !== output2) {
      console.log('   ✅ Output is being updated');
    } else {
      console.log('   ⚠️  Output does not seem to be updating');
    }

    // Clean up
    console.log('\n5. Cleaning up screen session and file...');
    await execAsync(`screen -S ${screenName} -X quit`);
    await unlink(outputFile).catch(() => {});
    console.log('   ✅ Screen session terminated and file removed');

    console.log('\n✅ All tests passed!');
  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    // Try to clean up on error
    try {
      await execAsync(`screen -S ${screenName} -X quit`);
      await unlink(outputFile).catch(() => {});
    } catch {
      // Ignore cleanup errors
    }
    process.exit(1);
  }
}

async function checkScreenAvailability() {
  console.log('Checking if screen is available...');
  try {
    await execAsync('which screen');
    console.log('✅ screen command found\n');
    return true;
  } catch (error) {
    console.error('❌ screen command not found');
    console.error('   Please install screen: sudo apt-get install screen');
    return false;
  }
}

async function main() {
  console.log('=== Top Command Implementation Test ===\n');

  const screenAvailable = await checkScreenAvailability();
  if (!screenAvailable) {
    process.exit(1);
  }

  await testScreenSession();
}

main().catch(error => {
  console.error('Unexpected error:', error);
  process.exit(1);
});
