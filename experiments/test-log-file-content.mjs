#!/usr/bin/env node

// Test script to verify the raw command is written to the log file

import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';

const solvePath = path.join(process.cwd(), 'src', 'solve.mjs');

async function testLogFileContent() {
  console.log('Testing raw command in log file...\n');

  const testUrl = 'https://github.com/test/repo/issues/888';
  const testProcess = spawn('node', [solvePath, testUrl, '--dry-run', '--skip-tool-check', '--verbose'], {
    stdio: 'pipe'
  });

  let logFilePath = '';
  testProcess.stdout.on('data', data => {
    const text = data.toString();
    // Look for log file path
    if (text.includes('Log file:')) {
      const match = text.match(/Log file: (.+\.log)/);
      if (match) {
        logFilePath = match[1].trim();
      }
    }
  });

  await new Promise(resolve => {
    testProcess.on('close', resolve);
  });

  if (logFilePath) {
    console.log(`Found log file: ${logFilePath}\n`);

    // Read the log file
    try {
      const logContent = await fs.readFile(logFilePath, 'utf-8');
      console.log('First 500 characters of log file:');
      console.log('---');
      console.log(logContent.substring(0, 500));
      console.log('---\n');

      // Check if raw command is in the log file
      if (logContent.includes('Raw command executed:')) {
        console.log('✅ Raw command found in log file\n');

        // Extract the command from log
        const lines = logContent.split('\n');
        const cmdLine = lines.find(line => line.includes('Raw command executed:'));
        const nextLine = lines[lines.indexOf(cmdLine) + 1];

        if (cmdLine && nextLine) {
          console.log('Command in log file:');
          console.log(cmdLine);
          console.log(nextLine);

          // Verify it's at the beginning (within first 1000 chars)
          const cmdPosition = logContent.indexOf('Raw command executed:');
          if (cmdPosition < 1000) {
            console.log(`\n✅ Command is near the beginning of the log (position: ${cmdPosition})`);
          }
        }
      } else {
        console.log('❌ Raw command NOT found in log file');
      }

      // Clean up
      await fs.unlink(logFilePath);
      console.log(`\nCleaned up test log file: ${path.basename(logFilePath)}`);
    } catch (error) {
      console.error('Error reading log file:', error.message);
    }
  } else {
    console.log('❌ Could not find log file path in output');
  }
}

// Run the test
testLogFileContent().catch(console.error);
