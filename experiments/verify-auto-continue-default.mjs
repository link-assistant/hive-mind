#!/usr/bin/env node

// Simple test to verify --auto-continue default value has been changed

import fs from 'fs';
import path from 'path';

console.log('Verifying --auto-continue default value change...\n');

let allPassed = true;

// Test 1: Check hive.config.lib.mjs
console.log('Test 1: Checking hive.config.lib.mjs...');
const hiveConfigPath = path.join(process.cwd(), 'src', 'hive.config.lib.mjs');
const hiveConfigContent = fs.readFileSync(hiveConfigPath, 'utf8');

// Find the auto-continue option definition
const hiveAutoContMatch = hiveConfigContent.match(/\.option\('auto-continue',\s*\{[^}]*default:\s*(true|false)[^}]*\}/s);
if (hiveAutoContMatch) {
  const defaultValue = hiveAutoContMatch[1];
  console.log(`  Found: default: ${defaultValue}`);
  if (defaultValue === 'true') {
    console.log('  ✅ hive.config.lib.mjs default is true');
  } else {
    console.log('  ❌ hive.config.lib.mjs default is NOT true');
    allPassed = false;
  }
} else {
  console.log('  ❌ Could not find auto-continue option in hive.config.lib.mjs');
  allPassed = false;
}

// Test 2: Check solve.config.lib.mjs
console.log('\nTest 2: Checking solve.config.lib.mjs...');
const solveConfigPath = path.join(process.cwd(), 'src', 'solve.config.lib.mjs');
const solveConfigContent = fs.readFileSync(solveConfigPath, 'utf8');

// Find the auto-continue option definition
const solveAutoContMatch = solveConfigContent.match(/\.option\('auto-continue',\s*\{[^}]*default:\s*(true|false)[^}]*\}/s);
if (solveAutoContMatch) {
  const defaultValue = solveAutoContMatch[1];
  console.log(`  Found: default: ${defaultValue}`);
  if (defaultValue === 'true') {
    console.log('  ✅ solve.config.lib.mjs default is true');
  } else {
    console.log('  ❌ solve.config.lib.mjs default is NOT true');
    allPassed = false;
  }
} else {
  console.log('  ❌ Could not find auto-continue option in solve.config.lib.mjs');
  allPassed = false;
}

// Test 3: Verify boolean-negation is enabled
console.log('\nTest 3: Checking boolean-negation support...');
if (hiveConfigContent.includes("'boolean-negation': true")) {
  console.log('  ✅ hive.config.lib.mjs has boolean-negation enabled');
} else {
  console.log('  ❌ hive.config.lib.mjs does NOT have boolean-negation enabled');
  allPassed = false;
}

if (solveConfigContent.includes("'boolean-negation': true")) {
  console.log('  ✅ solve.config.lib.mjs has boolean-negation enabled');
} else {
  console.log('  ❌ solve.config.lib.mjs does NOT have boolean-negation enabled');
  allPassed = false;
}

console.log('\n' + '='.repeat(60));
if (allPassed) {
  console.log('✅ All verification tests passed!');
  console.log('\nSummary:');
  console.log('  - --auto-continue is now enabled by default');
  console.log('  - --no-auto-continue is supported (via boolean-negation)');
  console.log('  - Users can disable with --no-auto-continue');
  process.exit(0);
} else {
  console.log('❌ Some tests failed. Please review the output above.');
  process.exit(1);
}
