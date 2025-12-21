#!/usr/bin/env node

import { spawn } from 'child_process';
import { promisify } from 'util';
import { exec as execCallback } from 'child_process';

const exec = promisify(execCallback);

async function findStartScreenCommand() {
  try {
    const { stdout } = await exec('which start-screen');
    return stdout.trim();
  } catch (error) {
    return null;
  }
}

function executeWithCommand(startScreenCmd, command, args) {
  return new Promise(resolve => {
    const allArgs = [command, ...args];

    console.log(`Executing: ${startScreenCmd} ${allArgs.join(' ')}`);

    const child = spawn(startScreenCmd, allArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: false
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      stdout += data.toString();
    });

    child.stderr.on('data', data => {
      stderr += data.toString();
    });

    child.on('error', error => {
      resolve({
        success: false,
        output: stdout,
        error: error.message
      });
    });

    child.on('close', code => {
      if (code === 0) {
        resolve({
          success: true,
          output: stdout
        });
      } else {
        resolve({
          success: false,
          output: stdout,
          error: stderr || `Command exited with code ${code}`
        });
      }
    });
  });
}

async function testSpawnImplementation() {
  console.log('Testing spawn-based implementation for issue #377');
  console.log('='.repeat(60));

  // Test 1: Find start-screen command
  console.log('\n1. Testing findStartScreenCommand()...');
  const whichPath = await findStartScreenCommand();
  if (whichPath) {
    console.log(`✅ Found start-screen at: ${whichPath}`);
  } else {
    console.log('❌ start-screen not found in PATH');
  }

  // Test 2: Try executing with start-screen command
  console.log('\n2. Testing execution with "start-screen" command...');
  try {
    const result = await executeWithCommand('start-screen', '--version', []);
    if (result.success) {
      console.log('✅ Command executed successfully');
      console.log('Output:', result.output.trim());
    } else {
      console.log('❌ Command failed');
      console.log('Error:', result.error);
    }
  } catch (error) {
    console.log('❌ Exception:', error.message);
  }

  // Test 3: Test first line parsing
  console.log('\n3. Testing first line parsing...');
  const testText1 = '/solve https://github.com/owner/repo/issues/123 --verbose\nIgnore this line';
  const firstLine1 = testText1.split('\n')[0].trim();
  console.log('Input:', JSON.stringify(testText1));
  console.log('First line:', JSON.stringify(firstLine1));
  console.log(
    firstLine1.includes('Ignore this line')
      ? '❌ Failed to extract first line only'
      : '✅ Correctly extracted first line'
  );

  console.log('\n='.repeat(60));
  console.log('Test completed');
}

testSpawnImplementation().catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
