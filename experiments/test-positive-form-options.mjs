#!/usr/bin/env node

/**
 * Test script for positive form options (--solve/--hive instead of --no-solve/--no-hive)
 */

if (typeof use === 'undefined') {
  globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
}

const yargsModule = await use('yargs@17.7.2');
const yargs = yargsModule.default || yargsModule;

console.log('Testing positive form options with yargs auto-negation...\n');

function createParser(args) {
  return yargs(args)
    .option('solve', {
      type: 'boolean',
      description: 'Enable /solve command',
      default: true,
    })
    .option('hive', {
      type: 'boolean',
      description: 'Enable /hive command',
      default: true,
    });
}

// Test 1: Default values (should be true)
console.log('Test 1: Default values');
const argv1 = createParser([]).parseSync();
console.log(`  solve: ${argv1.solve} (expected: true)`);
console.log(`  hive: ${argv1.hive} (expected: true)`);
console.log(`  ✅ ${argv1.solve === true && argv1.hive === true ? 'PASS' : 'FAIL'}\n`);

// Test 2: Explicit --solve and --hive
console.log('Test 2: Explicit --solve and --hive');
const argv2 = createParser(['--solve', '--hive']).parseSync();
console.log(`  solve: ${argv2.solve} (expected: true)`);
console.log(`  hive: ${argv2.hive} (expected: true)`);
console.log(`  ✅ ${argv2.solve === true && argv2.hive === true ? 'PASS' : 'FAIL'}\n`);

// Test 3: Auto-negation with --no-solve and --no-hive
console.log('Test 3: Auto-negation with --no-solve and --no-hive');
const argv3 = createParser(['--no-solve', '--no-hive']).parseSync();
console.log(`  solve: ${argv3.solve} (expected: false)`);
console.log(`  hive: ${argv3.hive} (expected: false)`);
console.log(`  ✅ ${argv3.solve === false && argv3.hive === false ? 'PASS' : 'FAIL'}\n`);

// Test 4: Mixed - disable only solve
console.log('Test 4: Mixed - disable only solve with --no-solve');
const argv4 = createParser(['--no-solve']).parseSync();
console.log(`  solve: ${argv4.solve} (expected: false)`);
console.log(`  hive: ${argv4.hive} (expected: true)`);
console.log(`  ✅ ${argv4.solve === false && argv4.hive === true ? 'PASS' : 'FAIL'}\n`);

console.log('All tests completed! ✅');
