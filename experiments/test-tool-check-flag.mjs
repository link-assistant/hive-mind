#!/usr/bin/env node

// Test to verify --no-tool-check works using the toolCheck option approach

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test the solve.config.lib.mjs directly
const use = (await eval(await (await fetch('https://unpkg.com/use-m/use.js')).text())).use;
globalThis.use = use;

const config = await import('../src/solve.config.lib.mjs');
const { initializeConfig, createYargsConfig } = config;
const { yargs, hideBin } = await initializeConfig(use);

console.log('🧪 Testing --no-tool-check with tool-check option\n');

// Test 1: Default - no flags (toolCheck should be true by default)
console.log('Test 1: No flags (default)');
try {
  const argv1 = await createYargsConfig(yargs()).strict(false).demandCommand(0).parse(['https://github.com/test/repo/issues/1']);
  console.log('   toolCheck:', argv1.toolCheck);
  console.log('   skipToolCheck:', argv1.skipToolCheck);
  const skip1 = argv1.dryRun || argv1.skipToolCheck || !argv1.toolCheck;
  console.log('   Would skip tool check:', skip1);
  if (skip1 === false) {
    console.log('✅ Default behavior: tool check is performed\n');
  } else {
    console.log('❌ Default behavior broken\n');
  }
} catch (error) {
  console.log('Error:', error.message, '\n');
}

// Test 2: With --no-tool-check (toolCheck should be false)
console.log('Test 2: With --no-tool-check');
try {
  const argv2 = await createYargsConfig(yargs()).strict(false).demandCommand(0).parse(['https://github.com/test/repo/issues/1', '--no-tool-check']);
  console.log('   toolCheck:', argv2.toolCheck);
  console.log('   skipToolCheck:', argv2.skipToolCheck);
  const skip2 = argv2.dryRun || argv2.skipToolCheck || !argv2.toolCheck;
  console.log('   Would skip tool check:', skip2);
  if (skip2 === true) {
    console.log('✅ --no-tool-check works: tool check is skipped\n');
  } else {
    console.log('❌ --no-tool-check does NOT work\n');
  }
} catch (error) {
  console.log('Error:', error.message, '\n');
}

// Test 3: With --skip-tool-check (should still work)
console.log('Test 3: With --skip-tool-check');
try {
  const argv3 = await createYargsConfig(yargs()).strict(false).demandCommand(0).parse(['https://github.com/test/repo/issues/1', '--skip-tool-check']);
  console.log('   toolCheck:', argv3.toolCheck);
  console.log('   skipToolCheck:', argv3.skipToolCheck);
  const skip3 = argv3.dryRun || argv3.skipToolCheck || !argv3.toolCheck;
  console.log('   Would skip tool check:', skip3);
  if (skip3 === true) {
    console.log('✅ --skip-tool-check still works\n');
  } else {
    console.log('❌ --skip-tool-check broken\n');
  }
} catch (error) {
  console.log('Error:', error.message, '\n');
}

// Test 4: With --tool-check (explicit enable, should override any skip)
console.log('Test 4: With --tool-check (explicit enable)');
try {
  const argv4 = await createYargsConfig(yargs()).strict(false).demandCommand(0).parse(['https://github.com/test/repo/issues/1', '--tool-check']);
  console.log('   toolCheck:', argv4.toolCheck);
  console.log('   skipToolCheck:', argv4.skipToolCheck);
  const skip4 = argv4.dryRun || argv4.skipToolCheck || !argv4.toolCheck;
  console.log('   Would skip tool check:', skip4);
  if (skip4 === false) {
    console.log('✅ --tool-check works: tool check is performed\n');
  } else {
    console.log('❌ --tool-check does NOT work\n');
  }
} catch (error) {
  console.log('Error:', error.message, '\n');
}

console.log('✨ All tests completed!');
