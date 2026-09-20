#!/usr/bin/env node
// @hive-mind-test-suite default

/**
 * Regression coverage for Issue #1819.
 *
 * The failing run created a fork named
 * konard/pypypy1337-parking.github.io, but repository setup parsed the
 * `gh repo fork` output as konard/pypypy1337-parking because the regex did
 * not allow dots in repository names. Verification then checked the wrong
 * repository and reported "Fork exists but not accessible".
 */

import { parseForkFullNameFromGhOutput } from '../src/github-repository-names.lib.mjs';
import { readFileSync } from 'fs';

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    testFn();
    console.log('PASSED');
    testsPassed++;
  } catch (error) {
    console.log(`FAILED: ${error.message}`);
    testsFailed++;
  }
}

runTest('parses dotted fork name from gh repo fork URL output', () => {
  const output = 'https://github.com/konard/pypypy1337-parking.github.io';
  const parsed = parseForkFullNameFromGhOutput(output);
  if (parsed !== 'konard/pypypy1337-parking.github.io') {
    throw new Error(`Expected konard/pypypy1337-parking.github.io, got ${parsed}`);
  }
});

runTest('parses dotted fork name from already-exists output', () => {
  const output = 'konard/pypypy1337-parking.github.io already exists';
  const parsed = parseForkFullNameFromGhOutput(output);
  if (parsed !== 'konard/pypypy1337-parking.github.io') {
    throw new Error(`Expected konard/pypypy1337-parking.github.io, got ${parsed}`);
  }
});

runTest('does not parse github.com/user as com/user', () => {
  const parsed = parseForkFullNameFromGhOutput('visit https://github.com/user for profile details');
  if (parsed !== null) {
    throw new Error(`Expected no repository full name, got ${parsed}`);
  }
});

runTest('strips .git suffix from clone-style URLs', () => {
  const parsed = parseForkFullNameFromGhOutput('git@github.com:konard/pypypy1337-parking.github.io.git');
  if (parsed !== 'konard/pypypy1337-parking.github.io') {
    throw new Error(`Expected konard/pypypy1337-parking.github.io, got ${parsed}`);
  }
});

runTest('repository setup uses the dotted-name-safe parser', () => {
  const source = readFileSync(new URL('../src/solve.repository.lib.mjs', import.meta.url), 'utf8');
  if (!source.includes('parseForkFullNameFromGhOutput(forkOutput)')) {
    throw new Error('setupRepository should parse gh repo fork output with parseForkFullNameFromGhOutput');
  }
});

console.log('');
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);

if (testsFailed > 0) {
  process.exit(1);
}
