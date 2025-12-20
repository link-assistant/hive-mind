#!/usr/bin/env node

/**
 * Test suite for review.mjs
 * Tests basic functionality without requiring GitHub or Claude authentication
 */

import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const reviewPath = join(__dirname, '..', 'src', 'review.mjs');

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

// Test 1: Check if review.mjs exists and is executable
runTest('review.mjs exists', () => {
  const output = execCommand(`ls -la ${reviewPath}`);
  if (!output.includes('review.mjs')) {
    throw new Error('review.mjs not found');
  }
});

// Test 2: Check usage output when no arguments provided
runTest('review.mjs usage without args', () => {
  const output = execCommand(`${reviewPath} 2>&1`);

  // Check that it shows usage information
  if (!output.includes('Usage:') && !output.includes('usage:')) {
    throw new Error('No usage information shown');
  }

  if (!output.includes('pr-url') || !output.includes('review')) {
    throw new Error('Usage should mention PR review');
  }
});

// Test 3: Check --version output
runTest('review.mjs --version', () => {
  const output = execCommand(`${reviewPath} --version 2>&1`).trim();
  // Version should be either x.y.z or x.y.z.commitSha format
  if (!output.match(/^\d+\.\d+\.\d+(\.[a-f0-9]{7,8})?$/)) {
    throw new Error(`Version output not in expected format: ${output}`);
  }
  // Should output only the version, no extra text
  const lines = output.trim().split('\n');
  if (lines.length !== 1) {
    throw new Error(`--version should output only the version, found ${lines.length} lines`);
  }
});

// Test 4: Check --help functionality
runTest('review.mjs --help', () => {
  const output = execCommand(`${reviewPath} --help 2>&1`);

  // Should show help without errors
  if (!output.includes('Usage: review.mjs <pr-url> [options]')) {
    throw new Error('--help should show proper usage information');
  }

  if (!output.includes('Options:')) {
    throw new Error('--help should show options section');
  }

  if (!output.includes('--model') || !output.includes('--verbose')) {
    throw new Error('--help should show option descriptions');
  }
});

// Test 5: Check -h functionality
runTest('review.mjs -h', () => {
  const output = execCommand(`${reviewPath} -h 2>&1`);

  // Should show help without errors
  if (!output.includes('Usage: review.mjs <pr-url> [options]')) {
    throw new Error('-h should show proper usage information');
  }

  if (!output.includes('Options:')) {
    throw new Error('-h should show options section');
  }
});

// Print summary
console.log('\n' + '='.repeat(50));
console.log(`Test Results: ${testsPassed} passed, ${testsFailed} failed`);
console.log('='.repeat(50));

// Exit with appropriate code
process.exit(testsFailed > 0 ? 1 : 0);