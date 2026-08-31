#!/usr/bin/env node

/**
 * Test script to reproduce the YError stderr pollution issue in telegram-bot.mjs
 *
 * This script simulates the yargs validation that happens in telegram-bot.mjs
 * and demonstrates that YError messages are written to stderr.
 *
 * Usage:
 *   node docs/case-studies/issue-733-telegram-bot-killed/reproduce-issue.mjs
 *
 * Expected Output:
 *   - WITHOUT FIX: YError written to stderr
 *   - WITH FIX: No YError in stderr (suppressed)
 */

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

// Import the solve config to get the yargs configuration
const { createYargsConfig: createSolveYargsConfig } = await import('../../../src/solve.config.lib.mjs');

console.log('='.repeat(70));
console.log('Reproducing Issue #733: YError stderr pollution');
console.log('='.repeat(70));
console.log();

console.log('Test 1: Simulate telegram-bot.mjs validation (BEFORE FIX)');
console.log('-'.repeat(70));

const testArgs = [
  'https://github.com/deep-assistant/hive-mind/issues/733',
  '--verbose',
  '--auto-fork'
];

console.log('Validating args:', testArgs);
console.log();

// Capture stderr to check for YError
let stderrOutput = '';
const originalStderrWrite = process.stderr.write.bind(process.stderr);

process.stderr.write = function(chunk, encoding, callback) {
  stderrOutput += chunk.toString();
  return originalStderrWrite(chunk, encoding, callback);
};

try {
  const testYargs = createSolveYargsConfig(yargs());

  testYargs
    .exitProcess(false)
    .fail((msg, err) => {
      throw new Error(msg || (err && err.message) || 'Unknown validation error');
    });

  // This is the line that causes YError to be written to stderr
  testYargs.parse(testArgs);

  console.log('✅ Validation passed');
} catch (error) {
  console.log(`❌ Validation failed: ${error.message}`);
} finally {
  process.stderr.write = originalStderrWrite;
}

console.log();
console.log('Checking stderr output...');

if (stderrOutput.includes('YError') || stderrOutput.includes('Not enough arguments')) {
  console.log('❌ ISSUE REPRODUCED: YError found in stderr!');
  console.log();
  console.log('Stderr content:');
  console.log('-'.repeat(70));
  console.log(stderrOutput);
  console.log('-'.repeat(70));
} else {
  console.log('✅ No YError in stderr');
}

console.log();
console.log('='.repeat(70));
console.log('Test 2: Same validation WITH stderr suppression (AFTER FIX)');
console.log('-'.repeat(70));
console.log();

stderrOutput = '';
const stderrBuffer = [];

// Apply the fix: override stderr.write to capture output
process.stderr.write = function(chunk, encoding, callback) {
  stderrBuffer.push(chunk.toString());
  if (typeof encoding === 'function') {
    encoding();
  } else if (typeof callback === 'function') {
    callback();
  }
  return true;
};

try {
  const testYargs = createSolveYargsConfig(yargs());

  testYargs
    .exitProcess(false)
    .fail((msg, err) => {
      throw new Error(msg || (err && err.message) || 'Unknown validation error');
    });

  testYargs.parse(testArgs);

  console.log('✅ Validation passed');
} catch (error) {
  console.log(`❌ Validation failed: ${error.message}`);
} finally {
  process.stderr.write = originalStderrWrite;
}

console.log();
console.log('Checking stderr output...');

if (stderrBuffer.length > 0) {
  const captured = stderrBuffer.join('');
  if (captured.includes('YError') || captured.includes('Not enough arguments')) {
    console.log('✅ YError was CAPTURED (not written to user\'s stderr)');
    console.log();
    console.log('Captured content (would be suppressed):');
    console.log('-'.repeat(70));
    console.log(captured);
    console.log('-'.repeat(70));
  }
} else {
  console.log('✅ No YError captured or written');
}

console.log();
console.log('='.repeat(70));
console.log('Summary');
console.log('='.repeat(70));
console.log();
console.log('Test 1 (BEFORE FIX): Demonstrates the issue - YError written to stderr');
console.log('Test 2 (AFTER FIX):  Shows the solution - YError captured and suppressed');
console.log();
console.log('The fix prevents stderr pollution while maintaining validation functionality.');
console.log();
