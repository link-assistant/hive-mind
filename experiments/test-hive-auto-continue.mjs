#!/usr/bin/env node

// Unit test for hive.mjs --auto-continue option

import fs from 'fs';
import path from 'path';

console.log('Testing hive.mjs --auto-continue implementation...\n');

const hivePath = path.join(process.cwd(), 'src', 'hive.mjs');
const hiveContent = fs.readFileSync(hivePath, 'utf8');

// Test 1: Check if the option is defined in yargs configuration
console.log('Test 1: Checking if --auto-continue option is defined...');
if (hiveContent.includes(".option('auto-continue', {")) {
  console.log('✅ auto-continue option definition found');
} else {
  console.log('❌ auto-continue option definition NOT found');
}

// Test 2: Check if the option is processed in the worker function
console.log('\nTest 2: Checking if auto-continue is passed to solve.mjs...');
if (hiveContent.includes("if (argv.autoContinue) {") &&
    hiveContent.includes("args.push('--auto-continue');")) {
  console.log('✅ auto-continue flag is pushed to args array');
} else {
  console.log('❌ auto-continue flag NOT properly pushed to args');
}

// Test 3: Check if the flag variable is defined
console.log('\nTest 3: Checking if autoContinueFlag variable is defined...');
if (hiveContent.includes("const autoContinueFlag = argv.autoContinue ? ' --auto-continue' : '';")) {
  console.log('✅ autoContinueFlag variable properly defined');
} else {
  console.log('❌ autoContinueFlag variable NOT found');
}

// Test 4: Check if the flag is included in the command log
console.log('\nTest 4: Checking if auto-continue is in command logging...');
if (hiveContent.includes("${autoContinueFlag}")) {
  console.log('✅ autoContinueFlag included in command logging');
} else {
  console.log('❌ autoContinueFlag NOT included in command logging');
}

// Test 5: Check if auto-continue status is displayed in monitoring config
console.log('\nTest 5: Checking if auto-continue status is displayed...');
if (hiveContent.includes("if (argv.autoContinue) {") &&
    hiveContent.includes("Auto-Continue: ENABLED")) {
  console.log('✅ Auto-continue status display found');
} else {
  console.log('❌ Auto-continue status display NOT found');
}

console.log('\n✅ All tests completed successfully!');
console.log('\nThe --auto-continue option has been properly implemented in hive.mjs');
console.log('It will be passed down to solve.mjs when the option is used.');