#!/usr/bin/env node
/**
 * Test script for auto-restart options
 * Tests:
 * 1. --auto-restart-on-uncommitted-changes (default true)
 * 2. --no-auto-restart-on-uncommitted-changes (disable)
 * 3. --auto-restart-max-iterations (default 3)
 */

// Use use-m to load modules
globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const use = globalThis.use;

// Import config module
const configLib = await import('../src/solve.config.lib.mjs');
const { initializeConfig, parseArguments } = configLib;

// Initialize yargs
const { yargs, hideBin } = await initializeConfig(use);

console.log('Testing auto-restart options configuration...\n');

// Test 1: Default behavior (auto-restart enabled by default)
console.log('Test 1: Default behavior');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1'];
try {
  const argv1 = await parseArguments(yargs, hideBin);
  console.log('  autoRestartOnUncommittedChanges:', argv1.autoRestartOnUncommittedChanges);
  console.log('  autoRestartMaxIterations:', argv1.autoRestartMaxIterations);
  console.log('  ✅ Default: auto-restart should be true:', argv1.autoRestartOnUncommittedChanges === true);
  console.log('  ✅ Default: max iterations should be 3:', argv1.autoRestartMaxIterations === 3);
} catch (error) {
  console.error('  ❌ Error:', error.message);
}

console.log('\nTest 2: Explicitly disable auto-restart');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1', '--no-auto-restart-on-uncommitted-changes'];
try {
  const argv2 = await parseArguments(yargs, hideBin);
  console.log('  autoRestartOnUncommittedChanges:', argv2.autoRestartOnUncommittedChanges);
  console.log('  ✅ Should be false:', argv2.autoRestartOnUncommittedChanges === false);
} catch (error) {
  console.error('  ❌ Error:', error.message);
}

console.log('\nTest 3: Custom max iterations');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1', '--auto-restart-max-iterations', '5'];
try {
  const argv3 = await parseArguments(yargs, hideBin);
  console.log('  autoRestartMaxIterations:', argv3.autoRestartMaxIterations);
  console.log('  ✅ Should be 5:', argv3.autoRestartMaxIterations === 5);
} catch (error) {
  console.error('  ❌ Error:', error.message);
}

console.log('\nTest 4: Combined options');
process.argv = ['node', 'test', 'https://github.com/owner/repo/issues/1', '--auto-restart-max-iterations', '10', '--no-auto-restart-on-uncommitted-changes'];
try {
  const argv4 = await parseArguments(yargs, hideBin);
  console.log('  autoRestartOnUncommittedChanges:', argv4.autoRestartOnUncommittedChanges);
  console.log('  autoRestartMaxIterations:', argv4.autoRestartMaxIterations);
  console.log('  ✅ Auto-restart should be false:', argv4.autoRestartOnUncommittedChanges === false);
  console.log('  ✅ Max iterations should be 10:', argv4.autoRestartMaxIterations === 10);
} catch (error) {
  console.error('  ❌ Error:', error.message);
}

console.log('\n✅ All tests completed!');
