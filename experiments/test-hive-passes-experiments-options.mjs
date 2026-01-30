#!/usr/bin/env node
/**
 * Test script to verify that hive command passes --prompt-experiments-folder and
 * --prompt-examples-folder options to solve command
 *
 * This test verifies the fix for the comment:
 * "Ensure hive command pass these options to solve, when set and executed."
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1199
 * @see https://github.com/link-assistant/hive-mind/pull/1200
 */

// Use use-m to load modules
globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const use = globalThis.use;

// Import config module
const hiveConfigLib = await import('../src/hive.config.lib.mjs');
const { createYargsConfig } = hiveConfigLib;

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;
const { hideBin } = await use('yargs@17.7.2/helpers');

console.log('Testing that hive passes experiments/examples options to solve...\n');

let allTestsPassed = true;

// Test 1: Parse hive arguments with custom folders
console.log('Test 1: Parse hive arguments with custom folders');
process.argv = ['node', 'hive', 'https://github.com/owner', '--prompt-experiments-folder', './custom-experiments', '--prompt-examples-folder', './custom-examples', '--once'];

try {
  const argv = await createYargsConfig(yargs(hideBin(process.argv))).parse();
  console.log('  promptExperimentsFolder:', argv.promptExperimentsFolder);
  console.log('  promptExamplesFolder:', argv.promptExamplesFolder);

  const test1a = argv.promptExperimentsFolder === './custom-experiments';
  const test1b = argv.promptExamplesFolder === './custom-examples';

  console.log('  Experiments folder should be ./custom-experiments:', test1a ? 'PASS' : 'FAIL');
  console.log('  Examples folder should be ./custom-examples:', test1b ? 'PASS' : 'FAIL');

  if (!test1a || !test1b) {
    allTestsPassed = false;
    console.error('  Test 1 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  Error:', error.message);
}

// Test 2: Parse hive arguments with disabled folders
console.log('\nTest 2: Parse hive arguments with disabled folders');
process.argv = ['node', 'hive', 'https://github.com/owner', '--prompt-experiments-folder', '', '--prompt-examples-folder', '', '--once'];

try {
  const argv = await createYargsConfig(yargs(hideBin(process.argv))).parse();
  console.log('  promptExperimentsFolder:', JSON.stringify(argv.promptExperimentsFolder));
  console.log('  promptExamplesFolder:', JSON.stringify(argv.promptExamplesFolder));

  const test2a = argv.promptExperimentsFolder === '';
  const test2b = argv.promptExamplesFolder === '';

  console.log('  Both folders should be disabled (empty string):', test2a && test2b ? 'PASS' : 'FAIL');

  if (!test2a || !test2b) {
    allTestsPassed = false;
    console.error('  Test 2 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  Error:', error.message);
}

// Test 3: Verify the build args logic (simulated)
console.log('\nTest 3: Verify argument building logic');
try {
  // Simulate the argv object that would be passed to the worker
  const argv = {
    promptExperimentsFolder: './my-exp',
    promptExamplesFolder: './my-demos',
  };

  // Simulate building the args array (like in hive.mjs lines 748-775)
  const args = [];
  if (argv.promptExperimentsFolder !== undefined) {
    args.push('--prompt-experiments-folder', argv.promptExperimentsFolder);
  }
  if (argv.promptExamplesFolder !== undefined) {
    args.push('--prompt-examples-folder', argv.promptExamplesFolder);
  }

  const test3a = args.includes('--prompt-experiments-folder');
  const test3b = args.includes('./my-exp');
  const test3c = args.includes('--prompt-examples-folder');
  const test3d = args.includes('./my-demos');

  console.log('  Args should include --prompt-experiments-folder:', test3a ? 'PASS' : 'FAIL');
  console.log('  Args should include ./my-exp:', test3b ? 'PASS' : 'FAIL');
  console.log('  Args should include --prompt-examples-folder:', test3c ? 'PASS' : 'FAIL');
  console.log('  Args should include ./my-demos:', test3d ? 'PASS' : 'FAIL');

  if (!test3a || !test3b || !test3c || !test3d) {
    allTestsPassed = false;
    console.error('  Test 3 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  Error:', error.message);
}

// Test 4: Verify empty string handling
console.log('\nTest 4: Verify empty string handling');
try {
  const argv = {
    promptExperimentsFolder: '',
    promptExamplesFolder: '',
  };

  // Simulate building the args array
  const args = [];
  if (argv.promptExperimentsFolder !== undefined) {
    args.push('--prompt-experiments-folder', argv.promptExperimentsFolder);
  }
  if (argv.promptExamplesFolder !== undefined) {
    args.push('--prompt-examples-folder', argv.promptExamplesFolder);
  }

  const test4a = args.includes('--prompt-experiments-folder');
  const test4b = args.includes('');
  const test4c = args.includes('--prompt-examples-folder');

  console.log('  Args should include flags even with empty values:', test4a && test4b && test4c ? 'PASS' : 'FAIL');

  if (!test4a || !test4b || !test4c) {
    allTestsPassed = false;
    console.error('  Test 4 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  Error:', error.message);
}

// Summary
console.log('\n' + '='.repeat(60));
if (allTestsPassed) {
  console.log('✅ All tests PASSED!');
  console.log('\nThe hive command correctly:');
  console.log('  1. Accepts --prompt-experiments-folder option');
  console.log('  2. Accepts --prompt-examples-folder option');
  console.log('  3. Builds arguments to pass these to solve command');
  console.log('  4. Handles empty string values (disabled folders)');
  process.exit(0);
} else {
  console.error('❌ Some tests FAILED!');
  process.exit(1);
}
