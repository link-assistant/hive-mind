#!/usr/bin/env node

// Test script to verify --auto-continue default value and --no-auto-continue negation

import yargs from 'yargs';

console.log('Testing --auto-continue default value change...\n');

// Test 1: Test hive.mjs configuration
console.log('Test 1: Testing hive.mjs --auto-continue default...');
const { createYargsConfig: createHiveConfig } = await import('../src/hive.config.lib.mjs');

// Parse with no explicit flag
const argv1 = await createHiveConfig(yargs(['https://github.com/test/repo'])).parse();
console.log('  Without flag: autoContinue =', argv1.autoContinue);
if (argv1.autoContinue === true) {
  console.log('  ✅ Default is true');
} else {
  console.log('  ❌ Default is not true:', argv1.autoContinue);
}

// Parse with --no-auto-continue
const argv2 = await createHiveConfig(yargs(['https://github.com/test/repo', '--no-auto-continue'])).parse();
console.log('  With --no-auto-continue: autoContinue =', argv2.autoContinue);
if (argv2.autoContinue === false) {
  console.log('  ✅ --no-auto-continue works correctly');
} else {
  console.log('  ❌ --no-auto-continue does not work:', argv2.autoContinue);
}

// Parse with --auto-continue (explicit)
const argv3 = await createHiveConfig(yargs(['https://github.com/test/repo', '--auto-continue'])).parse();
console.log('  With --auto-continue: autoContinue =', argv3.autoContinue);
if (argv3.autoContinue === true) {
  console.log('  ✅ --auto-continue works correctly');
} else {
  console.log('  ❌ --auto-continue does not work:', argv3.autoContinue);
}

console.log('\nTest 2: Testing solve.mjs --auto-continue default...');
const { createYargsConfig: createSolveConfig } = await import('../src/solve.config.lib.mjs');

// Parse with no explicit flag
const argv4 = await createSolveConfig(yargs(['https://github.com/test/repo/issues/1'])).parse();
console.log('  Without flag: autoContinue =', argv4.autoContinue);
if (argv4.autoContinue === true) {
  console.log('  ✅ Default is true');
} else {
  console.log('  ❌ Default is not true:', argv4.autoContinue);
}

// Parse with --no-auto-continue
const argv5 = await createSolveConfig(yargs(['https://github.com/test/repo/issues/1', '--no-auto-continue'])).parse();
console.log('  With --no-auto-continue: autoContinue =', argv5.autoContinue);
if (argv5.autoContinue === false) {
  console.log('  ✅ --no-auto-continue works correctly');
} else {
  console.log('  ❌ --no-auto-continue does not work:', argv5.autoContinue);
}

// Parse with --auto-continue (explicit)
const argv6 = await createSolveConfig(yargs(['https://github.com/test/repo/issues/1', '--auto-continue'])).parse();
console.log('  With --auto-continue: autoContinue =', argv6.autoContinue);
if (argv6.autoContinue === true) {
  console.log('  ✅ --auto-continue works correctly');
} else {
  console.log('  ❌ --auto-continue does not work:', argv6.autoContinue);
}

console.log('\n✅ All tests completed!');
