#!/usr/bin/env node

globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const { $ } = await use('command-stream');

import { setupRepository } from '../src/solve.repository.lib.mjs';

console.log('\n🧪 Integration Test: Fork Conflict Detection in setupRepository\n');

console.log('This test simulates the scenario from issue #344:\n');
console.log('1. User has already forked zamtmn/zcad');
console.log('2. User tries to work on veb86/zcadvelecAI (also a fork of zamtmn/zcad)');
console.log('3. System should detect the conflict and fail early\n');

console.log('='.repeat(70));
console.log('TEST 1: Try to fork veb86/zcadvelecAI with --fork flag');
console.log('='.repeat(70) + '\n');

const argv = {
  fork: true,
  autoCleanup: false,
};

const owner = 'veb86';
const repo = 'zcadvelecAI';

console.log(`Repository to test: ${owner}/${repo}`);
console.log(`This repository is a fork of: zamtmn/zcad\n`);

console.log('Expected behavior:');
console.log('- If user has a fork of zamtmn/zcad: ERROR (fork conflict detected)');
console.log('- If user has no fork of zamtmn/zcad: SUCCESS (safe to fork)\n');

try {
  const result = await setupRepository(argv, owner, repo, null);
  console.log('\n✅ SUCCESS: No fork conflict detected');
  console.log('This means the current user does NOT have a fork of zamtmn/zcad');
  console.log('Result:', result);
} catch (error) {
  console.log('\n❌ FORK CONFLICT DETECTED (Expected if user has fork of zamtmn/zcad)');
  console.log('Error:', error.message || error);
}

console.log('\n' + '='.repeat(70));
console.log('TEST 2: Try to fork zamtmn/zcad (the original) with --fork flag');
console.log('='.repeat(70) + '\n');

const owner2 = 'zamtmn';
const repo2 = 'zcad';

console.log(`Repository to test: ${owner2}/${repo2}`);
console.log(`This repository is the original (not a fork)\n`);

console.log('Expected behavior:');
console.log('- Should always succeed (forking the original is allowed)\n');

try {
  const result = await setupRepository(argv, owner2, repo2, null);
  console.log('\n✅ SUCCESS: Fork of original repository is allowed');
  console.log('Result:', result);
} catch (error) {
  console.log('\n❌ UNEXPECTED ERROR');
  console.log('Error:', error.message || error);
}

console.log('\n' + '='.repeat(70));
console.log('TEST COMPLETE');
console.log('='.repeat(70));
