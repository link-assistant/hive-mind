#!/usr/bin/env node
/**
 * Test script for experiments/examples folder configuration options
 * Tests:
 * 1. --prompt-experiments-folder (default: ./experiments)
 * 2. --prompt-examples-folder (default: ./examples)
 * 3. Disable experiments folder (--prompt-experiments-folder '')
 * 4. Disable examples folder (--prompt-examples-folder '')
 * 5. Disable both folders
 * 6. Custom folder paths
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1199
 */

// Use use-m to load modules
globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const use = globalThis.use;

// Import config module
const configLib = await import('../src/solve.config.lib.mjs');
const { initializeConfig, parseArguments } = configLib;

// Import prompt helper
const { getExperimentsExamplesSubPrompt } = await import('../src/experiments-examples.prompts.lib.mjs');

// Initialize yargs
const { yargs, hideBin } = await initializeConfig(use);

console.log('Testing experiments/examples folder configuration options...\n');

let allTestsPassed = true;

// Test 1: Default behavior (both folders enabled with default paths)
console.log('Test 1: Default behavior');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1'];
try {
  const argv1 = await parseArguments(yargs, hideBin);
  console.log('  promptExperimentsFolder:', argv1.promptExperimentsFolder);
  console.log('  promptExamplesFolder:', argv1.promptExamplesFolder);

  const test1a = argv1.promptExperimentsFolder === './experiments';
  const test1b = argv1.promptExamplesFolder === './examples';

  console.log('  Default experiments folder should be ./experiments:', test1a ? 'PASS' : 'FAIL');
  console.log('  Default examples folder should be ./examples:', test1b ? 'PASS' : 'FAIL');

  if (!test1a || !test1b) {
    allTestsPassed = false;
    console.error('  Test 1 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  Error:', error.message);
}

// Test 2: Custom experiments folder
console.log('\nTest 2: Custom experiments folder');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1', '--prompt-experiments-folder', './my-experiments'];
try {
  const argv2 = await parseArguments(yargs, hideBin);
  console.log('  promptExperimentsFolder:', argv2.promptExperimentsFolder);

  const test2 = argv2.promptExperimentsFolder === './my-experiments';
  console.log('  Custom experiments folder should be ./my-experiments:', test2 ? 'PASS' : 'FAIL');

  if (!test2) {
    allTestsPassed = false;
    console.error('  Test 2 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  Error:', error.message);
}

// Test 3: Custom examples folder
console.log('\nTest 3: Custom examples folder');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1', '--prompt-examples-folder', './demos'];
try {
  const argv3 = await parseArguments(yargs, hideBin);
  console.log('  promptExamplesFolder:', argv3.promptExamplesFolder);

  const test3 = argv3.promptExamplesFolder === './demos';
  console.log('  Custom examples folder should be ./demos:', test3 ? 'PASS' : 'FAIL');

  if (!test3) {
    allTestsPassed = false;
    console.error('  Test 3 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  Error:', error.message);
}

// Test 4: Disable experiments folder (empty string)
console.log('\nTest 4: Disable experiments folder');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1', '--prompt-experiments-folder', ''];
try {
  const argv4 = await parseArguments(yargs, hideBin);
  console.log('  promptExperimentsFolder:', JSON.stringify(argv4.promptExperimentsFolder));

  const test4 = argv4.promptExperimentsFolder === '';
  console.log('  Experiments folder should be empty string (disabled):', test4 ? 'PASS' : 'FAIL');

  if (!test4) {
    allTestsPassed = false;
    console.error('  Test 4 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  Error:', error.message);
}

// Test 5: Disable examples folder (empty string)
console.log('\nTest 5: Disable examples folder');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1', '--prompt-examples-folder', ''];
try {
  const argv5 = await parseArguments(yargs, hideBin);
  console.log('  promptExamplesFolder:', JSON.stringify(argv5.promptExamplesFolder));

  const test5 = argv5.promptExamplesFolder === '';
  console.log('  Examples folder should be empty string (disabled):', test5 ? 'PASS' : 'FAIL');

  if (!test5) {
    allTestsPassed = false;
    console.error('  Test 5 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  Error:', error.message);
}

// Test 6: Disable both folders
console.log('\nTest 6: Disable both folders');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1', '--prompt-experiments-folder', '', '--prompt-examples-folder', ''];
try {
  const argv6 = await parseArguments(yargs, hideBin);
  console.log('  promptExperimentsFolder:', JSON.stringify(argv6.promptExperimentsFolder));
  console.log('  promptExamplesFolder:', JSON.stringify(argv6.promptExamplesFolder));

  const test6a = argv6.promptExperimentsFolder === '';
  const test6b = argv6.promptExamplesFolder === '';

  console.log('  Both should be empty:', test6a && test6b ? 'PASS' : 'FAIL');

  if (!test6a || !test6b) {
    allTestsPassed = false;
    console.error('  Test 6 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  Error:', error.message);
}

// Test 7: getExperimentsExamplesSubPrompt helper function
console.log('\nTest 7: getExperimentsExamplesSubPrompt helper function');
try {
  // Test with default values
  const subPrompt7a = getExperimentsExamplesSubPrompt({});
  const test7a = subPrompt7a.includes('./experiments') && subPrompt7a.includes('./examples');
  console.log('  Default values should include both folders:', test7a ? 'PASS' : 'FAIL');

  // Test with custom values
  const subPrompt7b = getExperimentsExamplesSubPrompt({
    promptExperimentsFolder: './my-exp',
    promptExamplesFolder: './my-demos',
  });
  const test7b = subPrompt7b.includes('./my-exp') && subPrompt7b.includes('./my-demos');
  console.log('  Custom values should be in prompt:', test7b ? 'PASS' : 'FAIL');

  // Test with experiments only
  const subPrompt7c = getExperimentsExamplesSubPrompt({
    promptExperimentsFolder: './experiments',
    promptExamplesFolder: '',
  });
  const test7c = subPrompt7c.includes('./experiments') && !subPrompt7c.includes('real world use case');
  console.log('  Experiments only mode should work:', test7c ? 'PASS' : 'FAIL');

  // Test with examples only
  const subPrompt7d = getExperimentsExamplesSubPrompt({
    promptExperimentsFolder: '',
    promptExamplesFolder: './examples',
  });
  const test7d = subPrompt7d.includes('./examples') && subPrompt7d.includes('real world use case');
  console.log('  Examples only mode should work:', test7d ? 'PASS' : 'FAIL');

  // Test with both disabled
  const subPrompt7e = getExperimentsExamplesSubPrompt({
    promptExperimentsFolder: '',
    promptExamplesFolder: '',
  });
  const test7e = subPrompt7e === '';
  console.log('  Both disabled should return empty string:', test7e ? 'PASS' : 'FAIL');

  if (!test7a || !test7b || !test7c || !test7d || !test7e) {
    allTestsPassed = false;
    console.error('  Test 7 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  Error:', error.message);
}

// Test 8: Both custom folders with both options together
console.log('\nTest 8: Both custom folders together');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1', '--prompt-experiments-folder', '/custom/experiments', '--prompt-examples-folder', '/custom/examples'];
try {
  const argv8 = await parseArguments(yargs, hideBin);
  console.log('  promptExperimentsFolder:', argv8.promptExperimentsFolder);
  console.log('  promptExamplesFolder:', argv8.promptExamplesFolder);

  const test8a = argv8.promptExperimentsFolder === '/custom/experiments';
  const test8b = argv8.promptExamplesFolder === '/custom/examples';

  console.log('  Both custom paths should work:', test8a && test8b ? 'PASS' : 'FAIL');

  if (!test8a || !test8b) {
    allTestsPassed = false;
    console.error('  Test 8 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  Error:', error.message);
}

// Summary
console.log('\n' + '='.repeat(60));
if (allTestsPassed) {
  console.log('All tests PASSED!');
  process.exit(0);
} else {
  console.error('Some tests FAILED!');
  process.exit(1);
}
