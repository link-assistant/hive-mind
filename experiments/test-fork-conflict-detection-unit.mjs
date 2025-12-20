#!/usr/bin/env node

globalThis.use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
const { $ } = await use('command-stream');

import { getRootRepository, checkExistingForkOfRoot } from '../src/solve.repository.lib.mjs';

let testsPassed = 0;
let testsFailed = 0;

function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  return testFn()
    .then(() => {
      console.log('✅ PASSED');
      testsPassed++;
    })
    .catch((error) => {
      console.log(`❌ FAILED: ${error.message}`);
      testsFailed++;
    });
}

console.log('\n🧪 Fork Conflict Detection Tests\n');

await runTest('getRootRepository - original repository (not a fork)', async () => {
  const rootRepo = await getRootRepository('link-assistant', 'hive-mind');
  if (!rootRepo) {
    throw new Error('getRootRepository returned null');
  }
  if (rootRepo !== 'link-assistant/hive-mind') {
    throw new Error(`Expected 'link-assistant/hive-mind', got '${rootRepo}'`);
  }
});

await runTest('getRootRepository - fork repository', async () => {
  const rootRepo = await getRootRepository('veb86', 'zcadvelecAI');
  if (!rootRepo) {
    throw new Error('getRootRepository returned null');
  }
  if (rootRepo !== 'zamtmn/zcad') {
    throw new Error(`Expected 'zamtmn/zcad', got '${rootRepo}'`);
  }
});

await runTest('checkExistingForkOfRoot - no existing fork', async () => {
  const existingFork = await checkExistingForkOfRoot('zamtmn/zcad');
  if (existingFork !== null) {
    throw new Error(`Expected null (no fork), got '${existingFork}'`);
  }
});

await runTest('getRootRepository - handles invalid repository', async () => {
  const rootRepo = await getRootRepository('nonexistent-owner-12345', 'nonexistent-repo-67890');
  if (rootRepo !== null) {
    throw new Error(`Expected null for invalid repo, got '${rootRepo}'`);
  }
});

await runTest('checkExistingForkOfRoot - handles invalid root repository', async () => {
  const existingFork = await checkExistingForkOfRoot('nonexistent-owner-12345/nonexistent-repo-67890');
  if (existingFork !== null) {
    throw new Error(`Expected null for invalid root repo, got '${existingFork}'`);
  }
});

console.log('\n' + '='.repeat(70));
console.log(`Tests passed: ${testsPassed}`);
console.log(`Tests failed: ${testsFailed}`);
console.log('='.repeat(70));

if (testsFailed > 0) {
  process.exit(1);
}
