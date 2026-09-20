#!/usr/bin/env node
// Test script for issue #453 - Verify strict option validation

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.join(__dirname, '..');

console.log('🧪 Testing Issue #453: Strict Option Validation\n');

const tests = [
  {
    name: 'telegram-bot with em-dash (—fork)',
    command: 'node src/telegram-bot.mjs —fork',
    shouldFail: true,
    expectedError: 'Unknown option',
  },
  {
    name: 'telegram-bot with unknown option (--unknown)',
    command: 'node src/telegram-bot.mjs --unknown',
    shouldFail: true,
    expectedError: 'Unknown option',
  },
  {
    name: 'telegram-bot with valid --no-solve',
    command: 'node src/telegram-bot.mjs --no-solve 2>&1 | head -5',
    shouldFail: true, // Will fail due to missing token, but not due to option validation
    expectedError: 'TELEGRAM_BOT_TOKEN',
  },
  {
    name: 'start-screen with em-dash',
    command: 'node start-screen.mjs —fork',
    shouldFail: true,
    expectedError: 'Unknown option',
  },
  {
    name: 'start-screen with unknown option before command',
    command: 'node start-screen.mjs --unknown solve https://github.com/test/test',
    shouldFail: true,
    expectedError: 'Unknown option',
  },
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  process.stdout.write(`🔬 ${test.name}... `);

  try {
    const { stdout, stderr } = await execAsync(test.command, {
      cwd: rootDir,
      timeout: 5000,
    });

    const output = stdout + stderr;

    if (test.shouldFail) {
      console.log('❌ FAIL (expected to fail but succeeded)');
      failed++;
    } else {
      console.log('✅ PASS');
      passed++;
    }
  } catch (error) {
    const output = error.stdout + error.stderr;

    if (test.shouldFail) {
      if (output.includes(test.expectedError)) {
        console.log('✅ PASS');
        passed++;
      } else {
        console.log(`❌ FAIL (expected "${test.expectedError}" in error)`);
        console.log(`   Got: ${output.substring(0, 100)}`);
        failed++;
      }
    } else {
      console.log('❌ FAIL (unexpected error)');
      console.log(`   ${error.message}`);
      failed++;
    }
  }
}

console.log(`\n📊 Results: ${passed}/${tests.length} tests passed`);
if (failed > 0) {
  console.log('❌ Some tests failed');
  process.exit(1);
} else {
  console.log('✅ All tests passed');
}
