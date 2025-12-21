#!/usr/bin/env node

// Test script to verify hive.mjs shows absolute log path on error

import { spawn } from 'child_process';

async function testHiveError() {
  console.log('🧪 Testing hive.mjs error handling with absolute log path...\n');

  return new Promise(resolve => {
    // Test with valid GitHub URL but without Claude CLI configured
    // This will create a log file and then fail on Claude validation
    const child = spawn('node', ['src/hive.mjs', 'https://github.com/test/repo'], {
      cwd: process.cwd(),
      env: { ...process.env, CLAUDE_API_KEY: '' } // Ensure Claude check fails
    });

    let output = '';

    child.stdout.on('data', data => {
      output += data.toString();
      process.stdout.write(data);
    });

    child.stderr.on('data', data => {
      output += data.toString();
      process.stderr.write(data);
    });

    child.on('exit', code => {
      console.log('\n' + '='.repeat(50));

      // Check if absolute path is shown in log file message
      const hasAbsolutePath = output.includes('Full log file: /') || output.includes('Log file: /');

      if (hasAbsolutePath) {
        console.log('✅ Test passed: Absolute log file path is displayed');

        // Extract the log file path for verification
        const logPathMatch = output.match(/(?:Full log file|Log file): (\/[^\s]+\.log)/);
        if (logPathMatch) {
          console.log(`   Found absolute path: ${logPathMatch[1]}`);
        }
      } else {
        console.log('❌ Test failed: Absolute log file path not found');
        console.log('   Output should contain absolute path starting with /');
      }

      resolve(hasAbsolutePath);
    });
  });
}

testHiveError().catch(console.error);
