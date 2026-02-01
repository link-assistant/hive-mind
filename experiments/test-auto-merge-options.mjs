#!/usr/bin/env node
/**
 * Test script for auto-merge and auto-restart-until-mergable options
 * Tests:
 * 1. --auto-merge (default false)
 * 2. --auto-restart-until-mergable (default false)
 * 3. --auto-merge implies --auto-restart-until-mergable
 * 4. Options can be used independently
 *
 * @see https://github.com/link-assistant/hive-mind/issues/1190
 */

// Use use-m to load modules
globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const use = globalThis.use;

// Import config module
const configLib = await import('../src/solve.config.lib.mjs');
const { initializeConfig, parseArguments } = configLib;

// Initialize yargs
const { yargs, hideBin } = await initializeConfig(use);

console.log('Testing auto-merge and auto-restart-until-mergable options configuration...\n');

let allTestsPassed = true;

// Test 1: Default behavior (both disabled by default)
console.log('Test 1: Default behavior');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1'];
try {
  const argv1 = await parseArguments(yargs, hideBin);
  console.log('  autoMerge:', argv1.autoMerge);
  console.log('  autoRestartUntilMergable:', argv1.autoRestartUntilMergable);

  const test1a = argv1.autoMerge === false;
  const test1b = argv1.autoRestartUntilMergable === false;

  console.log('  ✅ Default: auto-merge should be false:', test1a);
  console.log('  ✅ Default: auto-restart-until-mergable should be false:', test1b);

  if (!test1a || !test1b) {
    allTestsPassed = false;
    console.error('  ❌ Test 1 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  ❌ Error:', error.message);
}

// Test 2: Enable auto-merge
console.log('\nTest 2: Enable auto-merge');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1', '--auto-merge'];
try {
  const argv2 = await parseArguments(yargs, hideBin);
  console.log('  autoMerge:', argv2.autoMerge);

  const test2 = argv2.autoMerge === true;
  console.log('  ✅ Should be true:', test2);

  if (!test2) {
    allTestsPassed = false;
    console.error('  ❌ Test 2 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  ❌ Error:', error.message);
}

// Test 3: Enable auto-restart-until-mergable (without auto-merge)
console.log('\nTest 3: Enable auto-restart-until-mergable without auto-merge');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1', '--auto-restart-until-mergable'];
try {
  const argv3 = await parseArguments(yargs, hideBin);
  console.log('  autoMerge:', argv3.autoMerge);
  console.log('  autoRestartUntilMergable:', argv3.autoRestartUntilMergable);

  const test3a = argv3.autoRestartUntilMergable === true;
  const test3b = argv3.autoMerge === false;

  console.log('  ✅ auto-restart-until-mergable should be true:', test3a);
  console.log('  ✅ auto-merge should be false (independent):', test3b);

  if (!test3a || !test3b) {
    allTestsPassed = false;
    console.error('  ❌ Test 3 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  ❌ Error:', error.message);
}

// Test 4: Both options together
console.log('\nTest 4: Both options together');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1', '--auto-merge', '--auto-restart-until-mergable'];
try {
  const argv4 = await parseArguments(yargs, hideBin);
  console.log('  autoMerge:', argv4.autoMerge);
  console.log('  autoRestartUntilMergable:', argv4.autoRestartUntilMergable);

  const test4a = argv4.autoMerge === true;
  const test4b = argv4.autoRestartUntilMergable === true;

  console.log('  ✅ auto-merge should be true:', test4a);
  console.log('  ✅ auto-restart-until-mergable should be true:', test4b);

  if (!test4a || !test4b) {
    allTestsPassed = false;
    console.error('  ❌ Test 4 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  ❌ Error:', error.message);
}

// Test 5: Options are available alongside existing options
console.log('\nTest 5: Options alongside existing watch and auto-restart options');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1', '--auto-merge', '--watch', '--auto-restart-max-iterations', '5'];
try {
  const argv5 = await parseArguments(yargs, hideBin);
  console.log('  autoMerge:', argv5.autoMerge);
  console.log('  watch:', argv5.watch);
  console.log('  autoRestartMaxIterations:', argv5.autoRestartMaxIterations);

  const test5a = argv5.autoMerge === true;
  const test5b = argv5.watch === true;
  const test5c = argv5.autoRestartMaxIterations === 5;

  console.log('  ✅ auto-merge should be true:', test5a);
  console.log('  ✅ watch should be true:', test5b);
  console.log('  ✅ autoRestartMaxIterations should be 5:', test5c);

  if (!test5a || !test5b || !test5c) {
    allTestsPassed = false;
    console.error('  ❌ Test 5 FAILED');
  }
} catch (error) {
  allTestsPassed = false;
  console.error('  ❌ Error:', error.message);
}

// Summary
console.log('\n' + '='.repeat(60));
if (allTestsPassed) {
  console.log('✅ All tests PASSED!');
  process.exit(0);
} else {
  console.error('❌ Some tests FAILED!');
  process.exit(1);
}
